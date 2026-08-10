import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHtml } from '../tools/block-map/parse.mjs';
import { extractBlocks } from '../tools/block-map/extract.mjs';
import { cluster, GRAY_CAP, MERGE_AT, nameFor, excerpt, applyDecisions } from '../tools/block-map/identity.mjs';
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

test('gray band is capped and sorted score-descending (near-merge first)', () => {
  // Amended from |score-0.75| (task-13 report / plan amendment): that sort
  // kept the middle of the band and shed both edges once capped, which on
  // a saturated site adjudicated ZERO pairs scoring >=0.90 — the "same
  // block, different name" case the gray band exists to resolve. Score-
  // descending puts the most consequential (closest to MERGE_AT) pairs
  // first, so a capped band drops the least-actionable near-split pairs
  // instead.
  const many = instancesFor(PAGES);
  const { grayBand } = cluster(many);
  assert.ok(grayBand.length <= GRAY_CAP);
  for (let i = 1; i < grayBand.length; i++) {
    assert.ok(grayBand[i - 1].score >= grayBand[i].score,
      'highest-scoring (nearest-merge) pairs must come first');
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

// --- Fix round 2: nameFor must be CATEGORY-major, not token-major --------
//
// The Step-3 fix (above) matched whole tokens instead of substrings, but
// the matching loop was still TOKEN-major: it iterated `primaryTokens` in
// the order classes were WRITTEN on the element and returned on the first
// token that matched ANY category. `classTokens` hyphen-splits a class
// with no "__", so `class="text-center card"` expands to primaryTokens
// ["text","center","card"] IN THAT ORDER — "text" (which only the LAST,
// lowest-priority copy/content/text category recognizes) got checked
// before "card" ever had a chance, purely because it was written first in
// the class attribute. Same bug family as the substring collision, just
// one level up: class-attribute ORDER decided the name instead of
// ROLE_NOUN priority order.
test('nameFor: category priority wins regardless of class attribute order (both directions)', () => {
  assert.equal(nameFor(mem(['card', 'text-center'])), 'Card');
  assert.equal(nameFor(mem(['text-center', 'card'])), 'Card', 'utility class written FIRST must not win');
  assert.equal(nameFor(mem(['plan', 'text-lg'])), 'Plan');
  assert.equal(nameFor(mem(['text-lg', 'plan'])), 'Plan', 'utility class written FIRST must not win');
  // "content-nav" hyphen-splits to ["content","nav"] — "nav" is a genuine
  // ROLE_NOUN keyword (Navigation), positioned ABOVE Card, so Navigation
  // legitimately wins here regardless of order — unlike "text-center" (only
  // ever matches the lowest-priority copy/content/text bucket), this isn't
  // a substring false-positive, it's a real, order-INDEPENDENT category
  // priority decision. The property under test is that BOTH orderings
  // agree — under the old token-major bug, `content-nav,card` gave "Heading
  // group" (via the "content" token) while `card,content-nav` gave "Card";
  // now both give the SAME answer, which is what category-major means.
  assert.equal(nameFor(mem(['content-nav', 'card'])), 'Navigation');
  assert.equal(nameFor(mem(['card', 'content-nav'])), 'Navigation', 'order must not change the outcome');
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
  // page-wrap.html deliberately has near-duplicate .site-head/.site-foot/.hero
  // blocks that do NOT merge with the 3-page canonical versions (GROUND-TRUTH
  // assertion 9) — so more than one block can share the exact same alias, and
  // .find() below returns whichever one sits first in `blocks`' own array
  // order, which is unrelated to which one is the reuse-dominant "canonical"
  // block. This test is about nameFor()'s CATEGORY-NOUN heuristic, not about
  // which colliding block wins the bare-vs-"(2)" dedupe suffix (that's
  // covered separately below), so strip any dedupe suffix before comparing.
  const byAlias = (alias) => blocks.find((b) => b.aliases.includes(alias));
  const noun = (b) => b.name.replace(/ \(\d+\)$/, '');

  assert.equal(noun(byAlias('.site-head')), 'Site header');
  assert.equal(noun(byAlias('.site-foot')), 'Site footer');
  assert.equal(noun(byAlias('.hero')), 'Hero');
  assert.equal(noun(byAlias('.hero__copy')), 'Heading group');
  assert.equal(noun(byAlias('.logos')), 'Logo row');
  assert.equal(noun(byAlias('.plans')), 'Pricing grid');
  assert.equal(noun(byAlias('.plan')), 'Plan');
  assert.equal(noun(byAlias('.quotes')), 'Testimonial grid');
  assert.equal(noun(byAlias('.quote')), 'Quote');
  assert.equal(noun(byAlias('.pkgs')), 'Package grid');
  assert.equal(noun(byAlias('.pkg')), 'Package');
  assert.equal(noun(byAlias('.feats')), 'Feature list');

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

// Task 10 review finding (deferred to here, since these strings are the
// block-map report's matrix row labels): dedupeNames used to walk `blocks`
// in its existing content-lexicographic array order, so on a name
// collision the FIRST block in that order kept the bare name regardless of
// which one is the real, dominant, GROUND-TRUTH block. On the 9-page
// fixture this produced "Card (2)" for the canonical 9-instance/3-page
// Card (`.card`, `.service-box`, `.teaser`) while bem-card.html's
// structurally-distinct 3-instance/1-page one-off `.card` kept the bare
// "Card" — backwards from what a reader of the report would expect. Same
// pattern hit "Card grid" (3-page canonical vs bem's 1-page one-off) and
// "Site footer" (3-page canonical vs page-wrap's 1-page one-off), though
// not "Site header" for this fixture's particular array order, which is
// exactly why the array-order dependence is the bug: it's a coin flip per
// collision, not a rule. Fixed by sorting the dedup pass itself by reuse
// (instances desc, then pages desc) before assigning suffixes, so the most-
// reused block always keeps the bare name — the returned `blocks` array's
// own order, ids, partition, and every other field are untouched; only
// which colliding block gets the "(2)" suffix changes.
test('9-page: dedupe keeps the bare name on the MORE-reused block, not array order', () => {
  const { blocks } = cluster(instancesFor(ALL_PAGES));
  const canonicalCard = blocks.find((b) => b.aliases.includes('.service-box'));
  const oneOffCard = blocks.find((b) => b.aliases.includes('.card__body') === false && b.aliases.includes('.card') && !b.aliases.includes('.service-box'));
  assert.ok(canonicalCard, 'the 9-instance canonical Card must exist');
  assert.ok(oneOffCard, 'bem-card.html\'s one-off Card must exist');
  assert.equal(canonicalCard.reuse.instances, 9);
  assert.equal(oneOffCard.reuse.instances, 3);
  assert.equal(canonicalCard.name, 'Card', 'the dominant, 9-instance block must keep the bare name');
  assert.equal(oneOffCard.name, 'Card (2)', 'the one-off block must carry the suffix');

  const canonicalGrid = blocks.find((b) => b.aliases.includes('.related'));
  const oneOffGrid = blocks.find((b) => b.aliases.includes('.cards'));
  assert.equal(canonicalGrid.name, 'Card grid');
  assert.equal(oneOffGrid.name, 'Card grid (2)');

  const canonicalFooter = blocks.find((b) => b.reuse.pages === 3 && b.aliases.includes('.site-foot'));
  const oneOffFooter = blocks.find((b) => b.reuse.pages === 1 && b.aliases.includes('.site-foot'));
  assert.equal(canonicalFooter.name, 'Site footer');
  assert.equal(oneOffFooter.name, 'Site footer (2)');
});

test('9-page: app.html contributes zero blocks (JS-rendered, must not emit a thin tree)', () => {
  const { blocks } = cluster(instancesFor(ALL_PAGES));
  const fromApp = blocks.flatMap((b) => b.instances).filter((i) => i.page === '/app');
  assert.equal(fromApp.length, 0);
});

// --- Fix round 2, Step 4: the gray-band/blocks cross-check, for real -----
//
// round 1 added a test here claiming to be the "dedicated cross-check
// test" identity.mjs's comment referred to, but it only asserted each
// grayBand id was a MEMBER OF THE BLOCK-ID SET — since block ids are a
// dense B01..BN range, almost ANY permutation of the mapping stays
// "valid" under that check. Two mutations were shown to pass it anyway:
// shifting grayBand's `a` id by +1, and sorting `groups` between the
// gray-band loop and the `blocks` construction (the exact divergence the
// surrounding code comment claims this test catches).
//
// The REAL invariant is not "g.a is SOME block id" but "g.a is the id of
// the SPECIFIC block whose member produced g.aExcerpt" — i.e. the id and
// the excerpt must refer to the same underlying instance. `excerpt()` is
// exported so this test can independently reconstruct, from each
// candidate block's own `_members`, what its excerpt SHOULD read as, and
// require an exact match against what the gray-band entry actually
// stored.
function assertExcerptOwnedByBlock(blocks, id, wantExcerpt, label) {
  const block = blocks.find((b) => b.id === id);
  assert.ok(block, `${label}=${id} does not match any block id`);
  const owningMember = block._members.find((m) => excerpt(m.block) === wantExcerpt);
  assert.ok(owningMember,
    `block ${id} (aliases: ${block.aliases.join(',')}) has no member whose excerpt matches ${label}Excerpt — ` +
    `the id does not actually own this excerpt`);
}

test('gray-band ids resolve to the block that actually produced the excerpt (cross-check)', () => {
  for (const pages of [PAGES, ALL_PAGES]) {
    const { blocks, grayBand } = cluster(instancesFor(pages));
    assert.ok(grayBand.length > 0, 'sanity: this fixture must produce a non-empty gray band to test against');
    for (const g of grayBand) {
      assertExcerptOwnedByBlock(blocks, g.a, g.aExcerpt, 'g.a');
      assertExcerptOwnedByBlock(blocks, g.b, g.bExcerpt, 'g.b');
    }
  }
});

// --- Fix round 2: order-invariance regression (tie-dense construction) ---
//
// The prior round's order-invariance tests (above, "order invariance holds
// on the real chain reproducer" / "...synthetic same-block triangle") use
// 3-element constructions with DISTINCT scores — structurally incapable of
// catching a tie-break bug, because there are no ties to break. A 12x12
// grid of `.card` variants (links 1-12 x images 1-12 — the same
// construction independently used to diagnose the bug) reliably produces
// `similarity()`'s 4-decimal quantization ties: the top qualifying score
// 0.9900 is shared by 2 pairs, 0.9896 by 4, 0.9891 by 6, etc. The prior
// `pairKeyLess` broke those ties by ORIGINAL INSTANCE INDEX — a function of
// which position an instance happened to occupy in the input array, not of
// its content — so which pair won a tie, and therefore which items got
// pulled into a cluster first, depended on arrival order.
function tieDenseInstances() {
  const variants = [];
  for (let links = 1; links <= 12; links++) for (let imgs = 1; imgs <= 12; imgs++) variants.push([links, imgs]);
  return variants.map(([links, imgs]) => {
    const linkHtml = Array.from({ length: links }, (_, k) => `<a href="#">L${k}</a>`).join('');
    const imgHtml = Array.from({ length: imgs }, (_, k) => `<img src="${k}.png">`).join('');
    const html = `<body><main><div class="card"><h3>Card</h3>${linkHtml}${imgHtml}</div></main></body>`;
    const block = flatten(extractBlocks(parseHtml(html)))[0];
    return { block, page: `/v${links}-${imgs}`, selector: block.selector };
  });
}
function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function partitionSignature(blocks) {
  return blocks.map((b) => b.instances.map((i) => i.page).sort().join(',')).sort().join(' | ');
}

test('order invariance survives a TIE-DENSE construction (12x12 ladder, quantized-score ties)', () => {
  const base = tieDenseInstances();
  const orders = {
    natural: base,
    reversed: base.slice().reverse(),
    shuffle1: seededShuffle(base, 1),
    shuffle2: seededShuffle(base, 2),
    shuffle3: seededShuffle(base, 3),
  };
  const results = Object.entries(orders).map(([name, order]) => [name, cluster(order).blocks]);
  const signatures = results.map(([name, blocks]) => [name, partitionSignature(blocks)]);
  const counts = results.map(([name, blocks]) => [name, blocks.length]);
  const uniqueSigs = new Set(signatures.map(([, s]) => s));
  assert.equal(uniqueSigs.size, 1,
    `all 5 orderings must produce the identical partition; got block counts ${JSON.stringify(counts)}`);
});

// --- Fix round 2, Step 3: .card__body no longer merges into Card ---------
//
// End-to-end (real 9-page fixture) pin for the fingerprint-level fix in
// tests/block-map-fingerprint.test.mjs ("a solo molecule and a 3-up
// repeated molecule do not auto-merge"). Before this fix, bem-card.html's
// `.card__body` (molecule, arity 1) silently merged into the 3-page Card
// block, inflating it to 4 pages / 12 instances and leaving no separate
// "Card body" block at all — the exact residual documented as open at the
// end of fix round 1.
test('9-page: .card__body no longer merges into Card — GROUND-TRUTH split restored', () => {
  const { blocks } = cluster(instancesFor(ALL_PAGES));

  const mergedCard = blocks.find((b) => b.aliases.includes('.service-box'));
  assert.ok(mergedCard, 'the .card/.service-box/.teaser block must still exist');
  assert.deepEqual([...mergedCard.aliases].sort(), ['.card', '.service-box', '.teaser']);
  assert.equal(mergedCard.reuse.pages, 3);
  assert.equal(mergedCard.reuse.instances, 9);

  const cardBody = blocks.find((b) => b.aliases.includes('.card__body'));
  assert.ok(cardBody, '.card__body must be its own separate block, not absorbed into Card');
  assert.equal(cardBody.name, 'Card body');
  assert.equal(cardBody.reuse.instances, 3);
  assert.notEqual(cardBody.id, mergedCard.id);
});

test('9-page: a solo-vs-repeated molecule pair surfaces in the gray band, not silently over-merged', () => {
  const { grayBand } = cluster(instancesFor(ALL_PAGES));
  const cardVsCardBody = grayBand.find((g) => {
    // aExcerpt/bExcerpt render the actual node markup — .card__body's
    // excerpt renders as a <div class="card__body">... tag.
    return /class="card__body"/.test(g.aExcerpt) || /class="card__body"/.test(g.bExcerpt);
  });
  assert.ok(cardVsCardBody, '.card__body must appear in the gray band against a repeated-card block');
  assert.ok(cardVsCardBody.score > 0.60 && cardVsCardBody.score < 0.95,
    `expected a gray-band score, got ${cardVsCardBody.score}`);
});

// --- applyDecisions() --------------------------------------------------------
//
// Built from hand-rolled block objects (not cluster() output) so each test
// controls exactly which ids collide, chain, or reference an already-merged
// block, without depending on the fixture's real similarity scores.

function fakeBlock(id, { page = '/p', aliases, children = [], parents = [] } = {}) {
  return {
    id, name: id, tier: 'molecule',
    aliases: aliases || [id.toLowerCase()],
    parents: [...parents], children: [...children],
    reuse: { pages: 1, instances: 1 },
    instances: [{ page, selector: '.' + id.toLowerCase() }],
    _members: [{ page, block: { id } }],
  };
}

function applyTo(blocks, decisions) {
  return applyDecisions({ blocks, grayBand: [], unadjudicated: 0 }, decisions);
}

test('applyDecisions: a chain of rulings that always references the same survivor merges all three', () => {
  const blocks = [fakeBlock('B01', { page: '/a' }), fakeBlock('B02', { page: '/b' }), fakeBlock('B03', { page: '/c' })];
  const { blocks: out } = applyTo(blocks, [
    { a: 'B01', b: 'B02', verdict: 'same', reason: 'r1' },
    { a: 'B01', b: 'B03', verdict: 'same', reason: 'r2' },
  ]);
  assert.equal(out.length, 1);
  const survivor = out[0];
  assert.equal(survivor.id, 'B01');
  assert.deepEqual([...survivor.aliases].sort(), ['b01', 'b02', 'b03']);
  assert.equal(survivor.reuse.instances, 3);
  assert.equal(survivor.reuse.pages, 3);
  assert.equal(survivor.mergedBy.length, 2);
  assert.deepEqual(survivor.mergedBy.map((m) => m.absorbed).sort(), ['B02', 'B03']);
});

test('applyDecisions: a ruling naming an already-absorbed block as the NEW keep is silently skipped', () => {
  // "chain" shape where the second ruling names the just-absorbed block (B02)
  // as its `a` (keep) rather than re-using the original survivor (B01) — the
  // function does not chase the merge transitively through a dropped id, it
  // just refuses to touch it again.
  const blocks = [fakeBlock('B01', { page: '/a' }), fakeBlock('B02', { page: '/b' }), fakeBlock('B03', { page: '/c' })];
  const { blocks: out } = applyTo(blocks, [
    { a: 'B01', b: 'B02', verdict: 'same', reason: 'r1' },
    { a: 'B02', b: 'B03', verdict: 'same', reason: 'r2' },
  ]);
  assert.equal(out.length, 2, 'B03 must remain separate — B02 was already absorbed and cannot keep anything');
  const survivor = out.find((b) => b.id === 'B01');
  assert.equal(survivor.mergedBy.length, 1);
  assert.equal(survivor.mergedBy[0].absorbed, 'B02');
  assert.ok(out.some((b) => b.id === 'B03'), 'B03 must still exist, untouched');
});

test('applyDecisions: a ruling naming an already-absorbed block as `b` (gone) is silently skipped', () => {
  const blocks = [fakeBlock('B01', { page: '/a' }), fakeBlock('B02', { page: '/b' }), fakeBlock('B03', { page: '/c' })];
  const { blocks: out } = applyTo(blocks, [
    { a: 'B01', b: 'B02', verdict: 'same', reason: 'r1' },
    { a: 'B03', b: 'B02', verdict: 'same', reason: 'r2' }, // B02 already gone — must not be absorbed twice
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.some((b) => b.id === 'B03' && (b.mergedBy || []).length === 0), 'B03 must be untouched by the second ruling');
});

test('applyDecisions: self-merge (a === b) is a no-op', () => {
  const blocks = [fakeBlock('B01'), fakeBlock('B02')];
  const { blocks: out } = applyTo(blocks, [{ a: 'B01', b: 'B01', verdict: 'same', reason: 'x' }]);
  assert.equal(out.length, 2);
  assert.equal((out.find((b) => b.id === 'B01').mergedBy || []).length, 0);
});

test('applyDecisions: rulings naming ids that do not exist are silently skipped, not thrown', () => {
  const blocks = [fakeBlock('B01'), fakeBlock('B02')];
  assert.doesNotThrow(() => {
    const { blocks: out } = applyTo(blocks, [
      { a: 'B99', b: 'B01', verdict: 'same', reason: 'x' },
      { a: 'B01', b: 'B99', verdict: 'same', reason: 'x' },
    ]);
    assert.equal(out.length, 2, 'neither ruling references two real ids, so nothing merges');
  });
});

test('applyDecisions: a duplicate ruling merges once, not twice', () => {
  const blocks = [fakeBlock('B01', { page: '/a' }), fakeBlock('B02', { page: '/b' })];
  const { blocks: out } = applyTo(blocks, [
    { a: 'B01', b: 'B02', verdict: 'same', reason: 'r1' },
    { a: 'B01', b: 'B02', verdict: 'same', reason: 'r1-repeat' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].mergedBy.length, 1, 'the duplicate ruling must not append a second mergedBy entry');
  assert.equal(out[0].reuse.instances, 2);
});

test('applyDecisions: reuse.pages/reuse.instances stay exact through a merge, including overlapping pages', () => {
  // B01 has 2 instances on the SAME page; B02 has 1 instance on a page B01
  // already covers plus none new. reuse.pages after merge must count
  // DISTINCT pages across the union, not sum the two blocks' page counts.
  const b01 = fakeBlock('B01', { page: '/a' });
  b01.instances = [{ page: '/a', selector: '.b01' }, { page: '/a', selector: '.b01' }];
  b01.reuse = { pages: 1, instances: 2 };
  const b02 = fakeBlock('B02', { page: '/a' }); // same page as b01
  const { blocks: out } = applyTo([b01, b02], [{ a: 'B01', b: 'B02', verdict: 'same', reason: 'x' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].reuse.instances, 3, 'instance count must be exact (2 + 1)');
  assert.equal(out[0].reuse.pages, 1, 'both blocks live only on /a — pages must not double-count the overlap');

  // A second case where the pages genuinely differ, to confirm the union path too.
  const c01 = fakeBlock('C01', { page: '/x' });
  const c02 = fakeBlock('C02', { page: '/y' });
  const { blocks: out2 } = applyTo([c01, c02], [{ a: 'C01', b: 'C02', verdict: 'same', reason: 'x' }]);
  assert.equal(out2[0].reuse.instances, 2);
  assert.equal(out2[0].reuse.pages, 2, 'distinct pages must both be counted');
});

test('applyDecisions: children/parents pointing at a dropped block are re-pointed to the survivor', () => {
  const b01 = fakeBlock('B01', { page: '/a' });
  const b02 = fakeBlock('B02', { page: '/a', children: ['B03'] });
  const b03 = fakeBlock('B03', { page: '/a', parents: ['B02'] });
  const { blocks: out } = applyTo([b01, b02, b03], [{ a: 'B01', b: 'B02', verdict: 'same', reason: 'x' }]);
  assert.equal(out.length, 2);
  const survivor = out.find((b) => b.id === 'B01');
  const child = out.find((b) => b.id === 'B03');
  assert.ok(survivor.children.includes('B03'), 'B02\'s child edge must be re-pointed to the survivor B01');
  assert.ok(child.parents.includes('B01'), 'B03\'s parent edge must be re-pointed to the survivor B01');
  assert.ok(!child.parents.includes('B02'), 'the dropped id must not remain in any edge list');
});

// No block may be its own ancestor by following `children` edges —
// acyclicity is a stated invariant of the parents/children graph (Step 5's
// "orphan = no parents" reading and report.mjs's neighborhood diagram both
// assume a DAG).
function assertAcyclic(blocks, msg) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const start of blocks) {
    const seen = new Set();
    const stack = [...start.children];
    while (stack.length) {
      const id = stack.pop();
      assert.notEqual(id, start.id, `${msg}: ${start.id} is its own ancestor (cycle through ${id})`);
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (node) stack.push(...node.children);
    }
  }
}

test('applyDecisions: a merge across ancestor distance >= 2 cannot leave a cycle (task-14 review IMPORTANT 1)', () => {
  // Chain B03 -> B01 -> B02 (parent -> child). Ruling merges B02 with its
  // own grandparent B03: naive edge-union would give the merged B02 both
  // B03's inherited child edge to B01 AND B02's own original parent edge
  // to B01 — B01 ends up listed as both parent and child of B02, a direct
  // 2-cycle (the exact reproducer from the review, at ancestor distance 2).
  const b03 = fakeBlock('B03', { page: '/c', children: ['B01'] });
  const b01 = fakeBlock('B01', { page: '/b', parents: ['B03'], children: ['B02'] });
  const b02 = fakeBlock('B02', { page: '/a', parents: ['B01'] });
  const { blocks: out } = applyTo([b03, b01, b02], [{ a: 'B02', b: 'B03', verdict: 'same', reason: 'grandparent merge' }]);
  assert.equal(out.length, 2);
  assertAcyclic(out, 'post-merge graph');
  // The merge and the survivor's own instance/alias bookkeeping must still
  // have happened — cycle-breaking must not silently undo the merge itself.
  const survivor = out.find((b) => b.id === 'B02');
  assert.ok(survivor, 'B02 must still be the survivor');
  assert.equal(survivor.mergedBy.length, 1);
  assert.equal(survivor.mergedBy[0].absorbed, 'B03');
});

test('applyDecisions: a longer merge chain that would close a longer cycle stays acyclic', () => {
  // Chain B04 -> B03 -> B01 -> B02. Two rulings merge B02 into its
  // grandparent-once-removed B04, testing that cycle-breaking holds even
  // once the survivor's own id has already absorbed one block.
  const b04 = fakeBlock('B04', { page: '/d', children: ['B03'] });
  const b03 = fakeBlock('B03', { page: '/c', parents: ['B04'], children: ['B01'] });
  const b01 = fakeBlock('B01', { page: '/b', parents: ['B03'], children: ['B02'] });
  const b02 = fakeBlock('B02', { page: '/a', parents: ['B01'] });
  const { blocks: out } = applyTo([b04, b03, b01, b02], [
    { a: 'B02', b: 'B04', verdict: 'same', reason: 'x' },
  ]);
  assertAcyclic(out, 'post-merge graph (longer chain)');
});
