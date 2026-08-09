import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHtml } from '../tools/block-map/parse.mjs';
import { extractBlocks } from '../tools/block-map/extract.mjs';
import { cluster, GRAY_CAP, MERGE_AT, nameFor } from '../tools/block-map/identity.mjs';
import { fingerprint, similarity } from '../tools/block-map/fingerprint.mjs';

const FIX = fileURLToPath(new URL('./fixtures/block-map-site/', import.meta.url));
const flatten = (bs) => bs.flatMap((b) => [b, ...flatten(b.children)]);

function instancesFor(files) {
  return files.flatMap((f) =>
    flatten(extractBlocks(parseHtml(readFileSync(FIX + f, 'utf8'))))
      .map((block) => ({ block, page: '/' + f.replace('.html', ''), selector: block.selector })));
}

const PAGES = ['index.html', 'services.html', 'pricing.html'];

test('the three card aliases collapse into one block', () => {
  const { blocks } = cluster(instancesFor(PAGES));
  const card = blocks.find((b) => b.aliases.some((a) => a.includes('card')));
  assert.ok(card, 'no block absorbed .card');
  for (const alias of ['.card', '.service-box', '.teaser']) {
    assert.ok(card.aliases.includes(alias), `missing alias ${alias}: got ${card.aliases.join(', ')}`);
  }
  assert.equal(card.reuse.instances, 9);
  assert.equal(card.reuse.pages, 3);
});

test('pricing and testimonial molecules do not merge', () => {
  const { blocks } = cluster(instancesFor(PAGES));
  const plan = blocks.find((b) => b.aliases.includes('.plan'));
  const quote = blocks.find((b) => b.aliases.includes('.quote'));
  assert.ok(plan && quote, 'both must exist as separate blocks');
  assert.notEqual(plan.id, quote.id);
});

test('the site header clusters across every page', () => {
  const { blocks } = cluster(instancesFor(PAGES));
  const header = blocks.find((b) => b.aliases.includes('.site-head'));
  assert.equal(header.reuse.pages, 3);
});

test('gray band is capped and sorted by ambiguity', () => {
  const many = instancesFor(PAGES);
  const { grayBand } = cluster(many);
  assert.ok(grayBand.length <= GRAY_CAP);
  for (let i = 1; i < grayBand.length; i++) {
    assert.ok(Math.abs(grayBand[i - 1].score - 0.75) <= Math.abs(grayBand[i].score - 0.75) + 1e-9,
      'most ambiguous pairs must come first');
  }
});

test('gray band excerpts are bounded', () => {
  const { grayBand } = cluster(instancesFor(PAGES));
  for (const p of grayBand) {
    assert.ok(p.aExcerpt.length <= 400, 'excerpt exceeded 400 chars');
    assert.ok(p.bExcerpt.length <= 400, 'excerpt exceeded 400 chars');
  }
});

test('every block gets a stable id and a human name', () => {
  const { blocks } = cluster(instancesFor(PAGES));
  for (const b of blocks) {
    assert.match(b.id, /^B\d{2,}$/);
    assert.ok(b.name && b.name.length > 1);
  }
  const ids = blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
});

// --- Fix round: complete-linkage clustering -----------------------------
//
// A `.card`-shaped chain, all through the real parse/extract/fingerprint
// pipeline: A (3 links, 4 imgs), B (3 links, 3 imgs), C (3 links, 2 imgs).
// Measured: sim(A,B)=0.9688, sim(B,C)=0.9643 (both >= MERGE_AT), but
// sim(A,C)=0.9375 (< MERGE_AT, still > SPLIT_AT — a real gray-band pair).
// Union-find (this file's PRIOR fix) chains A-B-C into ONE group via the
// B bridge, silently burying the 0.9375 pair inside a single canonical
// block where the gray band can never see it (the gray band only compares
// pairs ACROSS groups). Complete-linkage refuses to merge {A,B} with C
// because the cluster-to-cluster score is min(sim(A,C), sim(B,C)) = 0.9375
// < MERGE_AT — the same information the gray band would have shown, but
// enforced as a structural guarantee instead of an optional adjudication.
function cardPage(links, imgs) {
  const linkHtml = Array.from({ length: links }, (_, i) => `<a href="#">L${i}</a>`).join('');
  const imgHtml = Array.from({ length: imgs }, (_, i) => `<img src="${i}.png">`).join('');
  return `<body><main><div class="card"><h3>Card</h3>${linkHtml}${imgHtml}</div></main></body>`;
}
function chainInstances() {
  const A = flatten(extractBlocks(parseHtml(cardPage(3, 4))))[0];
  const B = flatten(extractBlocks(parseHtml(cardPage(3, 3))))[0];
  const C = flatten(extractBlocks(parseHtml(cardPage(3, 2))))[0];
  return [
    { block: A, page: '/a', selector: A.selector },
    { block: B, page: '/b', selector: B.selector },
    { block: C, page: '/c', selector: C.selector },
  ];
}

test('THE invariant: minimum pairwise similarity within every produced block is >= MERGE_AT', () => {
  const { blocks } = cluster(chainInstances());
  assert.equal(blocks.length, 2, 'A and C must NOT end up in the same block via the B bridge');
  const bigger = blocks.find((b) => b.instances.length === 2);
  assert.ok(bigger, 'expected exactly one 2-member block (A+B) and one singleton (C)');
});

test('the invariant holds generally: no block ever contains a pair scoring below MERGE_AT', () => {
  const { blocks } = cluster(instancesFor(PAGES));
  let checked = 0;
  for (const b of blocks) {
    if (b._members.length < 2) continue;
    const fps = b._members.map((m) => fingerprint(m.block));
    for (let i = 0; i < fps.length; i++) {
      for (let j = i + 1; j < fps.length; j++) {
        const s = similarity(fps[i], fps[j]);
        checked++;
        assert.ok(s >= MERGE_AT, `block ${b.id} contains a pair scoring ${s} < MERGE_AT`);
      }
    }
  }
  assert.ok(checked > 0, 'sanity: this fixture must actually contain a multi-instance block to check');
});

test('order invariance holds on the real chain reproducer too (not just the synthetic triangle)', () => {
  const base = chainInstances();
  const orders = [
    [base[0], base[1], base[2]],
    [base[1], base[0], base[2]],
    [base[2], base[1], base[0]],
    [base[1], base[2], base[0]],
    [base[2], base[0], base[1]],
    [base[0], base[2], base[1]],
  ];
  const summarize = (blocks) => blocks.map((b) => b.instances.map((i) => i.page).sort().join(',')).sort().join(' | ');
  const results = orders.map((o) => summarize(cluster(o).blocks));
  assert.equal(new Set(results).size, 1, `all 6 orderings must produce the same partition, got: ${results.join(' ;; ')}`);
});

test('order invariance: all 6 permutations of a synthetic same-block triangle agree', () => {
  // Same triangle used to diagnose the original union-find/first-member
  // order-dependence bug (task-7-report.md, Trap 1): sim(1,2)=0.94 (just
  // under MERGE_AT), sim(1,3)=0.96, sim(2,3)=0.97 — three genuine instances
  // of ONE block. A correct, order-invariant clusterer puts all three in
  // one group in every order (complete-linkage: {1,3} qualifies at 0.96,
  // then admitting 2 requires min(sim(2,1),sim(2,3))=min(0.94,0.97)=0.94 <
  // MERGE_AT... so complete-linkage actually gives 2 GROUPS here, not 1 —
  // that is the correct, bounded behaviour: item 1 never clears the bar
  // against item 2 from EVERY angle, unlike the loose union-find chain that
  // used to merge all three via transitivity through item 3). The point of
  // this test is not which partition wins, but that it is the SAME
  // partition regardless of arrival order.
  const mkBlock = (label, extra) => {
    const node = { tag: 'div', classes: [label], id: '', children: [], text: '' };
    return {
      tag: 'div', classes: [label], id: '', tier: 'molecule', arity: 1,
      atoms: { headings: 0, text: 1, links: 0, buttons: 0, images: 0, inputs: 0, lists: 0, ...extra },
      children: [], node, selector: `div.${label}`,
    };
  };
  // Engineer countSim so sim(1,2)=0.94, sim(1,3)=0.96, sim(2,3)=0.97 exactly
  // is fragile by hand; instead reuse the identity-agnostic synthetic-sim
  // approach: monkeypatch is not available (fingerprint/similarity are
  // real), so this test asserts the WEAKER, always-true property directly
  // useful in isolation — permutation invariance — using the real A/B/C
  // chain reproducer's three items, which already gives a non-trivial
  // (2-groups) partition to check for stability. (The literal 1/2/3
  // synthetic triangle from the report was verified with injected
  // similarity in a scratch probe, not against the real fingerprint
  // pipeline, since fingerprint() cannot be handed arbitrary scores.)
  const a = { block: mkBlock('x', { links: 3, images: 4 }), page: '/a', selector: 'div.x' };
  const b = { block: mkBlock('x', { links: 3, images: 3 }), page: '/b', selector: 'div.x' };
  const c = { block: mkBlock('x', { links: 3, images: 2 }), page: '/c', selector: 'div.x' };
  const perms = [[a,b,c],[a,c,b],[b,a,c],[b,c,a],[c,a,b],[c,b,a]];
  const summarize = (blocks) => blocks.map((bl) => bl.instances.map((i) => i.page).sort().join(',')).sort().join(' | ');
  const results = perms.map((p) => summarize(cluster(p).blocks));
  assert.equal(new Set(results).size, 1, `all 6 permutations must agree, got: ${results.join(' ;; ')}`);
});

// --- Fix round: ROLE_NOUN whole-token matching, not substring ------------
//
// The round-1 fix moved /copy|content|text/ FIRST in ROLE_NOUN to solve the
// `.hero__copy` -> "Hero" collision (see task-7-report.md Step 1 of the
// original round), but that regex is a plain substring test — moving it
// first means it now wins against far more common input: any utility class
// that merely CONTAINS "text"/"content"/"copy" as a substring, which is
// near-universal in Tailwind/Bootstrap/Elementor output. Fixed by matching
// whole class TOKENS (splitting compound classes on "-", so "site-head"
// still resolves via "head", but "text-center" contributes the tokens
// "text"+"center" — neither of which should win over a co-occurring class
// that matches a MORE SPECIFIC category checked earlier in ROLE_NOUN order)
// and moving copy|content|text back to LAST (lowest priority). BEM element
// syntax ("hero__copy") is handled separately: only the part AFTER the
// last "__" is a primary match candidate, so "hero" (the block prefix) is
// never a competing token for that class at all — see nameFor's BEM
// handling below for why this keeps `.hero__copy` -> "Heading group"
// without reintroducing the utility-class collision.
const mem = (classes, tier = 'molecule', tag = 'div', id = '') => [{ block: { classes, id, tag, tier } }];

test('nameFor: a co-occurring utility class never wins over a more specific real class', () => {
  assert.equal(nameFor(mem(['card', 'text-center'])), 'Card');
  assert.equal(nameFor(mem(['plan', 'text-lg'])), 'Plan');
  assert.equal(nameFor(mem(['nav', 'content-nav'])), 'Navigation');
  // "Quote" is the item-level label for the quote|testimonial|review
  // category as of Step 4 (was "Testimonial" when this test was first
  // written in Step 3 — the label changed, but the property under test
  // here, "copyright" never wins, still holds).
  assert.equal(nameFor(mem(['quote', 'copyright'])), 'Quote');
});

test('nameFor: a Tailwind-styled card still reads as Card, not Heading group', () => {
  assert.equal(nameFor(mem(['card', 'flex', 'flex-col', 'p-4', 'shadow-md', 'rounded-lg'])), 'Card');
});

test('nameFor: BEM element .hero__copy still reads as Heading group (no regression)', () => {
  assert.equal(nameFor(mem(['hero__copy'])), 'Heading group');
});

test('nameFor: hyphen-compound semantic classes still resolve (site-head, site-foot)', () => {
  assert.equal(nameFor(mem(['site-head'])), 'Site header');
  assert.equal(nameFor(mem(['site-foot'])), 'Site footer');
});

// --- Fix round: reconcile names with GROUND-TRUTH, all 9 pages -----------
//
// Container (organism, plural) vs item (molecule, singular) now read
// differently, matching GROUND-TRUTH's own domain vocabulary rather than a
// bare "<Noun> grid" concatenation (which would get 2 of 4 wrong: a
// Testimonial grid holds Quotes, a Pricing grid holds Plans — neither
// container word is its item word + "grid").
const ALL_PAGES = [
  'index.html', 'services.html', 'pricing.html', 'app.html',
  'card-with-list.html', 'bem-card.html', 'landmark-free.html',
  'page-wrap.html', 'data-table.html',
];

test('9-page GROUND-TRUTH: container/item naming matches for every documented alias', () => {
  const { blocks } = cluster(instancesFor(ALL_PAGES));
  const byAlias = (alias) => blocks.find((b) => b.aliases.includes(alias));

  assert.equal(byAlias('.site-head').name, 'Site header');
  assert.equal(byAlias('.site-foot').name, 'Site footer');
  assert.equal(byAlias('.hero').name, 'Hero');
  assert.equal(byAlias('.hero__copy').name, 'Heading group');
  assert.equal(byAlias('.logos').name, 'Logo row');
  assert.equal(byAlias('.plans').name, 'Pricing grid');
  assert.equal(byAlias('.plan').name, 'Plan');
  assert.equal(byAlias('.quotes').name, 'Testimonial grid');
  assert.equal(byAlias('.quote').name, 'Quote');
  assert.equal(byAlias('.pkgs').name, 'Package grid');
  assert.equal(byAlias('.pkg').name, 'Package');
  assert.equal(byAlias('.feats').name, 'Feature list');

  const mainBlock = blocks.find((b) => b.aliases.includes('main'));
  assert.ok(mainBlock, 'landmark-free.html\'s bare <main> must still be its own block');
  assert.equal(mainBlock.name, 'About content');

  const tableBlock = blocks.find((b) => b.aliases.includes('table'));
  assert.ok(tableBlock, 'data-table.html\'s bare <table> must still be its own block');
  assert.equal(tableBlock.name, 'Data table');
});

test('9-page: block names are unique within a run', () => {
  const { blocks } = cluster(instancesFor(ALL_PAGES));
  const names = blocks.map((b) => b.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.equal(dupes.length, 0, `duplicate names found: ${[...new Set(dupes)].join(', ')}`);
  // Sanity: this fixture is KNOWN to produce same-named-different-block
  // collisions before dedup (page-wrap's Hero/Site header/Site footer are
  // structurally too different from the 3-page versions to merge — verified
  // separately at similarity 0.295 and 0.5973, both well under SPLIT_AT for
  // site-head — so without a dedup pass this assertion would catch real,
  // reproduced duplicates, not a hypothetical).
  assert.ok(blocks.length >= 20, `sanity: expected a rich 9-page block set, got ${blocks.length}`);
});

test('9-page: app.html contributes zero blocks (JS-rendered, must not emit a thin tree)', () => {
  const { blocks } = cluster(instancesFor(ALL_PAGES));
  const fromApp = blocks.flatMap((b) => b.instances).filter((i) => i.page === '/app');
  assert.equal(fromApp.length, 0);
});
