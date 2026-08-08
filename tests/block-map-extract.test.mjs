import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHtml } from '../tools/block-map/parse.mjs';
import { extractBlocks } from '../tools/block-map/extract.mjs';

const FIX = fileURLToPath(new URL('./fixtures/block-map-site/', import.meta.url));
const load = (f) => extractBlocks(parseHtml(readFileSync(FIX + f, 'utf8')));
const flatten = (bs) => bs.flatMap((b) => [b, ...flatten(b.children)]);
const classesOf = (bs) => flatten(bs).flatMap((b) => b.classes);

test('wrappers never appear in the output', () => {
  const all = classesOf(load('services.html'));
  for (const w of ['elementor-section', 'elementor-container', 'elementor-column', 'elementor-widget-wrap']) {
    assert.ok(!all.includes(w), `wrapper .${w} leaked into the map`);
  }
  const home = classesOf(load('index.html'));
  assert.ok(!home.includes('container'), 'wrapper .container leaked');
  assert.ok(!home.includes('wrap'), 'wrapper .wrap leaked');
});

test('repeated siblings become molecules with arity', () => {
  const cards = flatten(load('services.html')).filter((b) => b.classes.includes('service-box'));
  assert.equal(cards.length, 3);
  assert.equal(cards[0].tier, 'molecule');
  assert.equal(cards[0].arity, 3);
});

test('semantic landmarks are organisms', () => {
  const top = load('index.html');
  const tags = top.map((b) => b.tag);
  assert.ok(tags.includes('header'));
  assert.ok(tags.includes('footer'));
  assert.ok(top.filter((b) => b.tag === 'header')[0].tier === 'organism');
});

test('leaf clusters with 2+ atom types are molecules', () => {
  const hero = flatten(load('index.html')).find((b) => b.classes.includes('hero__copy'));
  assert.ok(hero, '.hero__copy should be emitted (h1 + p + a = 3 atom types)');
  assert.equal(hero.tier, 'molecule');
});

test('repeated single-atom nodes stay atoms, not molecules', () => {
  const logos = flatten(load('index.html')).find((b) => b.classes.includes('logos'));
  assert.ok(logos, '.logos should be emitted (semantic ul)');
  assert.equal(logos.children.length, 0, 'the six <li><img> must NOT become six molecules');
  assert.equal(logos.atoms.images, 6, 'repetition is recorded as atom count on the parent');
});

test('depth cap is honoured', () => {
  const deep = extractBlocks(parseHtml(readFileSync(FIX + 'services.html', 'utf8')), { depth: 1 });
  assert.equal(flatten(deep).every((b) => b.children.length === 0), true);
});

test('a JS mount point yields no blocks', () => {
  assert.equal(load('app.html').length, 0);
});

// --- fix-round-2 coverage ------------------------------------------------
// The tests above are byte-identical to the original plan brief. Everything
// below was added after a review found the brief's fix over-reached: rule
// (a) (repetition) had silently inherited rule (b)'s "no emitted
// descendants" gate, which drops any repeated component that wraps a list,
// a BEM sub-div, or any other nested cluster. See task-5-report.md's
// "fix round 2" section for the probes that found each of these.

test('a repeated card wrapping a <ul> is still recognized (rule a != rule b)', () => {
  const all = flatten(load('card-with-list.html'));
  const pkgs = all.filter((b) => b.classes.includes('pkg'));
  assert.equal(pkgs.length, 3, '.pkg must be emitted 3x, not swallowed by its own <ul>');
  assert.equal(pkgs[0].tier, 'molecule');
  assert.equal(pkgs[0].arity, 3);
  const feats = all.filter((b) => b.classes.includes('feats'));
  assert.equal(feats.length, 3, '.feats (a semantic <ul>) still emits too, nested under .pkg');
});

test('a two-level BEM card keeps the outer node, not just the inner body', () => {
  const all = flatten(load('bem-card.html'));
  const cards = all.filter((b) => b.classes.includes('card'));
  assert.equal(cards.length, 3, '.card must be emitted 3x with its real arity');
  assert.equal(cards[0].tier, 'molecule');
  assert.equal(cards[0].arity, 3, 'arity must not collapse to 1 by measuring .card__body instead');
  const bodies = all.filter((b) => b.classes.includes('card__body'));
  assert.equal(bodies.length, 3, '.card__body still emits too, nested under .card');
});

test('a landmark-free page still yields a block', () => {
  const blocks = load('landmark-free.html');
  assert.equal(blocks.length, 1, '<main><h1>...<p>...</main> must not map to zero blocks');
  assert.equal(blocks[0].tag, 'main');
  assert.equal(blocks[0].tier, 'organism');
});

test('a whole-page <section> wrapper is excluded so header/hero/footer surface directly', () => {
  const blocks = load('page-wrap.html');
  const tags = blocks.map((b) => b.tag);
  assert.ok(!tags.includes('section') || blocks.find((b) => b.classes.includes('page')) === undefined,
    'section.page (aggregates header+hero+footer) must not itself be emitted');
  assert.ok(tags.includes('header'), 'header must surface as its own organism');
  assert.ok(tags.includes('footer'), 'footer must surface as its own organism');
  const header = blocks.find((b) => b.tag === 'header');
  assert.equal(header.tier, 'organism');
  const nav = header.children.find((b) => b.tag === 'nav');
  assert.ok(nav, 'header>nav must still work: header emits with nav nested as its child');
  const hero = blocks.find((b) => b.classes.includes('hero'));
  assert.ok(hero, '.hero must surface as its own organism, not be demoted under section.page');
  assert.equal(hero.tier, 'organism');
});

test('depth cap does not let a truncated wrapper masquerade as a leaf cluster', () => {
  const html = '<body><div class="wrap">'
    + '<div class="card"><h3>One</h3><p>Body one.</p><a href="#">More</a></div>'
    + '<div class="card"><h3>Two</h3><p>Body two.</p><a href="#">More</a></div>'
    + '<div class="card"><h3>Three</h3><p>Body three.</p><a href="#">More</a></div>'
    + '</div></body>';
  const blocks = extractBlocks(parseHtml(html), { depth: 1 });
  const all = flatten(blocks);
  assert.ok(!all.some((b) => b.classes.includes('wrap')), '.wrap must not be promoted just because it sits at the depth cap');
  const cards = all.filter((b) => b.classes.includes('card'));
  assert.equal(cards.length, 3, 'the 3 real cards must not vanish, swallowed into a falsely-empty wrapper block');
});

test('a data table is one block, not N anonymous rows', () => {
  const blocks = load('data-table.html');
  assert.equal(blocks.length, 1, 'a 5-row table must not yield 5 anonymous <tr> molecules');
  assert.equal(blocks[0].tag, 'table');
  assert.equal(blocks[0].children.length, 0);
  assert.equal(blocks[0].atoms.links, 5);
  assert.equal(blocks[0].atoms.images, 5);
});

// --- fix-round-3 coverage -------------------------------------------------
// fix-round-2's isLandmarkAggregate/isSemantic-scoping fix (previous section
// above) traded its false positive for a wider regression: it counted
// SEMANTIC_BLOCK children (ul/ol/table/figure/form/nav) toward the
// aggregate, not just LANDMARKS, and used a bare count instead of a content
// ratio — so ANY landmark composing 2+ of these lost its own content
// entirely (a footer's copyright <p>, an article's own <h1>+lede). Round 3
// scopes the aggregate check to AGGREGATABLE tags only (section/article/
// aside — never header/footer/nav/form) and requires the landmark children
// to account for essentially all of the node's own content, not just a bare
// count. Round 3 also makes `depth` a pure display-truncation concern:
// qualification is now decided from the full, untruncated tree, and only
// an already-qualifying block's `children` array is truncated afterward.

test('a footer composing nav + social list + copyright is not deleted', () => {
  const html = '<body><footer class="site-foot">'
    + '<nav><a href="#">Home</a><a href="#">Blog</a></nav>'
    + '<ul class="social"><li><a href="#">X</a></li><li><a href="#">GH</a></li></ul>'
    + '<p>&copy; 2026 Acme Inc. All rights reserved.</p>'
    + '</footer></body>';
  const blocks = extractBlocks(parseHtml(html));
  assert.equal(blocks.length, 1, 'footer must not be deleted just because it composes nav + a semantic <ul>');
  assert.equal(blocks[0].tag, 'footer');
  assert.equal(blocks[0].children.length, 2, 'nav and .social must still emit nested inside footer');
  assert.equal(blocks[0].atoms.text, 1, 'the copyright <p> — not inside nav or .social — must not be orphaned out of the map entirely');
});

test('a header composing nav + a search form is not deleted', () => {
  const html = '<body><header class="site-head">'
    + '<nav><a href="#">Home</a><a href="#">Services</a></nav>'
    + '<form class="search"><input type="search"><button>Go</button></form>'
    + '</header></body>';
  const blocks = extractBlocks(parseHtml(html));
  assert.equal(blocks.length, 1, 'header must not be deleted just because it composes nav + a <form> (both are LANDMARKS-tagged)');
  assert.equal(blocks[0].tag, 'header');
  assert.equal(blocks[0].children.length, 2, 'nav and .search must still emit nested inside header');
});

test('a section with its own heading plus two lists is not deleted', () => {
  const html = '<body><main><section class="specs"><h2>Specifications</h2>'
    + '<ul><li>4 cores</li></ul><ul><li>512GB SSD</li></ul></section></main></body>';
  const blocks = extractBlocks(parseHtml(html));
  assert.equal(blocks.length, 1, 'section.specs must not be deleted for composing 2 <ul>s (SEMANTIC_BLOCK, not LANDMARKS)');
  assert.equal(blocks[0].tag, 'section');
  assert.equal(blocks[0].atoms.headings, 1, 'the <h2> must not be lost');
  assert.equal(blocks[0].children.length, 2);
});

test('an article with its own heading and lede plus two sections is not deleted', () => {
  const html = '<body><main><article class="post"><h1>Post title</h1><p>The lede paragraph goes here.</p>'
    + '<section><h2>Part one</h2><p>Body one.</p></section>'
    + '<section><h2>Part two</h2><p>Body two.</p></section></article></main></body>';
  const blocks = extractBlocks(parseHtml(html));
  assert.equal(blocks.length, 1, 'article.post must not be deleted — it carries its own h1 + lede, not just 2 nested <section>s');
  assert.equal(blocks[0].tag, 'article');
  assert.ok(blocks[0].atoms.headings >= 1, 'the h1 must not be lost');
  assert.ok(blocks[0].atoms.text >= 1, 'the lede paragraph must not be lost');
});

test('a section whose entire content is one other section IS excluded (count-1 hole)', () => {
  const html = '<body><section class="page"><section class="hero"><h1>Hi</h1><p>Copy</p><a href="#">Go</a></section></section></body>';
  const blocks = extractBlocks(parseHtml(html));
  assert.ok(!blocks.some((b) => b.classes.includes('page')), 'section.page adds no content of its own — it is a pure 1:1 wrapper around .hero and must not be emitted');
  const hero = blocks.find((b) => b.classes.includes('hero'));
  assert.ok(hero, '.hero must surface directly once section.page is excluded');
  assert.equal(hero.tier, 'organism');
});

test('a sub-REPEAT_MIN leaf cluster survives a tight depth cap without promoting its wrapper', () => {
  const html = '<body><div class="wrap">'
    + '<div class="card"><h3>One</h3><p>Body one.</p><a href="#">More</a></div>'
    + '<div class="card"><h3>Two</h3><p>Body two.</p><a href="#">More</a></div>'
    + '</div></body>';
  const blocks = extractBlocks(parseHtml(html), { depth: 2 });
  assert.ok(!blocks.some((b) => b.classes.includes('wrap')), '.wrap must not be promoted to a block just because the cap hid its real children');
  const cards = flatten(blocks).filter((b) => b.classes.includes('card'));
  assert.equal(cards.length, 2, 'both cards (arity 2, below REPEAT_MIN, rescued only by rule b) must survive, not vanish into a falsely-empty wrapper');
});

test('depth cap never lets an elementor-style wrapper leak, even with only 2 repeated cards', () => {
  const html = '<body><section class="svc">'
    + '<div class="elementor-section"><div class="elementor-container"><div class="elementor-column"><div class="elementor-widget-wrap">'
    + '<div class="service-box"><h3>Alpha</h3><p>Body alpha.</p><a href="#">More</a></div>'
    + '<div class="service-box"><h3>Beta</h3><p>Body beta.</p><a href="#">More</a></div>'
    + '</div></div></div></div></section></body>';
  const blocks = extractBlocks(parseHtml(html), { depth: 3 });
  const all = flatten(blocks);
  for (const w of ['elementor-section', 'elementor-container', 'elementor-column', 'elementor-widget-wrap']) {
    assert.ok(!all.some((b) => b.classes.includes(w)), `wrapper .${w} must never appear, even under a tight depth cap`);
  }
  const boxes = all.filter((b) => b.classes.includes('service-box'));
  assert.equal(boxes.length, 2, 'both service-box cards must survive the tight cap');
});

test('a tight depth cap does not favor one leaf cluster over its semantic sibling', () => {
  const html = readFileSync(FIX + 'index.html', 'utf8');
  const blocks = extractBlocks(parseHtml(html), { depth: 2 });
  const hero = flatten(blocks).find((b) => b.classes.includes('hero'));
  assert.ok(hero, '.hero must still be present at depth:2');
  const heroKids = hero.children.map((b) => b.classes[0]);
  assert.ok(heroKids.includes('hero__copy'), 'hero__copy (rule b, no rescue) must not be dropped at depth:2 while its sibling survives');
  assert.ok(heroKids.includes('logos'), 'logos (rule c, semantic <ul>) must still be present');
});

test('depth capping is pure truncation: capped output matches the full tree with children cut at the cap', () => {
  const strip = (bs) => bs.map((b) => ({ sig: b.tag + '.' + b.classes.join('.') + '|' + b.tier + '|' + b.arity, children: strip(b.children) }));
  const truncate = (bs, depth, d = 0) => bs.map((b) => ({
    sig: b.tag + '.' + b.classes.join('.') + '|' + b.tier + '|' + b.arity,
    children: d + 1 >= depth ? [] : truncate(b.children, depth, d + 1),
  }));
  for (const page of ['index.html', 'services.html', 'pricing.html', 'page-wrap.html']) {
    const html = readFileSync(FIX + page, 'utf8');
    const full = extractBlocks(parseHtml(html), { depth: 99 });
    for (const depth of [1, 2, 3]) {
      const expected = JSON.stringify(truncate(full, depth));
      const actual = JSON.stringify(strip(extractBlocks(parseHtml(html), { depth })));
      assert.equal(actual, expected, `${page} at depth:${depth} must equal the full tree truncated, not a different classification`);
    }
  }
});
