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
