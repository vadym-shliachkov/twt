import { test, skip } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../tools/lib/resolve-playwright.mjs';
import { walkWithPlaywright } from '../skills/twt-block-map/tools/block-map/playwright-walk.mjs';
import { parseHtml } from '../skills/twt-block-map/tools/block-map/parse.mjs';
import { extractBlocks } from '../skills/twt-block-map/tools/block-map/extract.mjs';
import { readFileSync } from 'node:fs';

const FIX = fileURLToPath(new URL('./fixtures/block-map-site/', import.meta.url));
const { pw } = await loadPlaywright();

// tests/fixtures/block-map-engines/ — durable, engine-parity-only fixtures.
// Deliberately NOT added to tests/fixtures/block-map-site/: that directory's
// contents are pinned by GROUND-TRUTH.md and the 9-page suite, and each file
// here exists to pin exactly ONE walker behaviour that GROUND-TRUTH's pages
// never exercise (nested <template>, a <textarea> with markup inside it, an
// SVG with camelCase attribute names, and multi-run/entity-heavy text). Each
// was proven red against the pre-fix walker before being committed — see
// task-11-report.md.
const ENGINE_FIX = fileURLToPath(new URL('./fixtures/block-map-engines/', import.meta.url));
const ENGINE_FIXTURES = ['template-nesting.html', 'textarea-markup.html', 'svg-viewbox.html', 'entities-whitespace.html'];

// Recursive shape used by the table-driven parity test below: every field
// extractBlocks actually reports, minus the circular `.node` back-reference
// (deepEqual can't walk a cycle, and the raw DOM/parse node isn't part of
// the public contract anyway).
function slimBlocks(blocks) {
  return blocks.map((b) => ({
    tag: b.tag, classes: b.classes, id: b.id, tier: b.tier, arity: b.arity,
    atoms: b.atoms, selector: b.selector, children: slimBlocks(b.children),
  }));
}

function countBlocks(blocks) {
  return blocks.reduce((n, b) => n + 1 + countBlocks(b.children), 0);
}

// DFS over the RAW tree shape ({ tag, attrs, classes, id, text, children }),
// as opposed to slimBlocks' extracted-block shape above — used by the
// dedicated tests below that inspect a field (`.text`, `.attrs`) which
// extractBlocks never surfaces at all, so a bug confined to that field is
// invisible to the table-driven test and needs its own assertion.
function findNode(root, pred) {
  if (pred(root)) return root;
  for (const c of root.children) {
    const hit = findNode(c, pred);
    if (hit) return hit;
  }
  return null;
}

test('returns null when playwright is unavailable', { skip: !!pw }, async () => {
  assert.equal(await walkWithPlaywright('http://example.invalid/'), null);
});

test('produces the same block structure as the static engine', { skip: !pw }, async () => {
  const url = pathToFileURL(FIX + 'index.html').href;
  const tree = await walkWithPlaywright(url);
  assert.ok(tree, 'playwright walk returned nothing');
  const viaPw = extractBlocks(tree);
  const viaStatic = extractBlocks(parseHtml(readFileSync(FIX + 'index.html', 'utf8')));
  const names = (bs) => bs.flatMap((b) => [b.classes.join('.'), ...names(b.children)]).sort();
  assert.deepEqual(names(viaPw), names(viaStatic),
    'the two engines must agree on static markup — they only diverge on JS-rendered pages');
});

test('renders a JS page the static engine cannot', { skip: !pw }, async () => {
  const url = pathToFileURL(FIX + 'app.html').href;
  const tree = await walkWithPlaywright(url);
  assert.ok(tree, 'walk must succeed even when the page renders nothing');
});

// Table-driven: every engine-parity fixture runs through both engines and
// must produce an IDENTICAL, full recursive extractBlocks tree (not just
// matching top-level names — see the first test above for that shallower
// check). A future fixture dropped into block-map-engines/ and added to
// ENGINE_FIXTURES gets this coverage for free.
for (const file of ENGINE_FIXTURES) {
  test(`engine parity: ${file}`, { skip: !pw }, async () => {
    const html = readFileSync(ENGINE_FIX + file, 'utf8');
    const url = pathToFileURL(ENGINE_FIX + file).href;
    const tree = await walkWithPlaywright(url);
    assert.ok(tree, `playwright walk returned nothing for ${file}`);
    const viaPw = slimBlocks(extractBlocks(tree));
    const viaStatic = slimBlocks(extractBlocks(parseHtml(html)));
    assert.deepEqual(viaPw, viaStatic, `${file}: engines must agree on the full recursive block tree`);
  });
}

// template-nesting.html, dedicated: the table-driven test above already
// catches this (a wrong `.children` read collapses the whole subtree to
// nothing), but a bare deepEqual failure doesn't say WHAT collapsed. This
// pins the shape in words: a template's content (including a template
// NESTED inside another template) must surface as real, walkable blocks —
// not just "the walk didn't throw" (Task 11's original scripted test only
// ever asserted `tree` was truthy on the JS-rendered page, which a
// completely empty tree would also satisfy).
test('nested <template> content surfaces as real blocks, not just a non-empty tree', { skip: !pw }, async () => {
  const url = pathToFileURL(ENGINE_FIX + 'template-nesting.html').href;
  const tree = await walkWithPlaywright(url);
  const blocks = extractBlocks(tree);
  assert.equal(countBlocks(blocks), 3,
    'expected section.promo > article.promo-card > div.promo-note (3 nested blocks) — ' +
    'a walker reading el.children instead of el.content.children on a <template> would report 1 (the empty wrapper) or 0');
  const article = findNode(tree, (n) => n.classes.includes('promo-card'));
  assert.ok(article, 'the templated <article> must appear in the walked tree');
  const note = findNode(tree, (n) => n.classes.includes('promo-note'));
  assert.ok(note, 'the NESTED template (inside the outer template) must also surface');
});

// textarea-markup.html, dedicated: extractBlocks never carries `.text` on
// its returned block objects (only tag-derived atom counts), so a bug
// confined to a node's own `.text` field is completely invisible to the
// table-driven test above — this has to inspect the raw tree directly.
test('<textarea> content never leaks into text or children', { skip: !pw }, async () => {
  const url = pathToFileURL(ENGINE_FIX + 'textarea-markup.html').href;
  const tree = await walkWithPlaywright(url);
  const textarea = findNode(tree, (n) => n.tag === 'textarea');
  assert.ok(textarea, 'textarea node must exist in the walked tree');
  assert.equal(textarea.text, '',
    'parse.mjs forces text \'\' for every RAW tag except <title> — a textarea\'s default value ' +
    'must not leak through as real text just because the DOM decodes it for free');
  assert.deepEqual(textarea.children, [], 'a textarea must never report child elements');
});

// svg-viewbox.html, dedicated: like `.text`, extractBlocks never carries
// `.attrs` on its returned blocks (only `.classes`/`.id`), so an
// un-lowercased attribute name is invisible to the table-driven test too.
test('SVG attribute names are lowercased like attrsOf(), tag names stay lowercase', { skip: !pw }, async () => {
  const url = pathToFileURL(ENGINE_FIX + 'svg-viewbox.html').href;
  const tree = await walkWithPlaywright(url);
  const svg = findNode(tree, (n) => n.tag === 'svg');
  assert.ok(svg, 'svg node must exist in the walked tree');
  assert.equal(svg.attrs.viewbox, '0 0 24 24', 'viewBox must be readable under the lowercased key attrsOf() uses');
  assert.equal(svg.attrs.viewBox, undefined, 'the camelCase key must not also exist — attrsOf() only ever produces one, lowercased, key');
  assert.equal(svg.attrs.preserveaspectratio, 'xMidYMid meet', 'preserveAspectRatio must lowercase the same way');
  const clip = findNode(tree, (n) => n.tag === 'clippath');
  assert.ok(clip, 'clipPath must be walked as tag "clippath", matching parse.mjs\'s regex-tokenizer lowercasing');
  assert.equal(clip.attrs.id, 'iconClip', 'attribute VALUES are never case-folded — only the attribute NAME is');
});

// entities-whitespace.html, dedicated: same reasoning as the textarea test
// — `.text` never reaches extractBlocks' output, so per-chunk whitespace
// collapse (and decoded-entity fidelity) needs its own direct assertion
// against both the exact expected string and the static engine's output.
test('direct text is decoded and whitespace-collapsed per chunk, matching parse.mjs', { skip: !pw }, async () => {
  const html = readFileSync(ENGINE_FIX + 'entities-whitespace.html', 'utf8');
  const url = pathToFileURL(ENGINE_FIX + 'entities-whitespace.html').href;
  const pwTree = await walkWithPlaywright(url);
  const stTree = parseHtml(html);

  const pwLead = findNode(pwTree, (n) => n.classes.includes('lead'));
  const stLead = findNode(stTree, (n) => n.classes.includes('lead'));
  // Source: `Before <em>emphasis</em> after   text   with     multiple   spaces.`
  // Two DIRECT text runs surround <em> ("Before " and " after   text...").
  // A per-NODE-only `.trim()` (the brief's original sketch) trims the ends of
  // each run but leaves the run's OWN interior whitespace uncollapsed, so it
  // would produce "Before after   text   with     multiple   spaces." —
  // matching internal-multi-space text, not this exact string.
  assert.equal(pwLead.text, 'Before after text with multiple spaces.');
  assert.equal(pwLead.text, stLead.text, 'lead paragraph text must match the static engine exactly');

  const pwQuote = findNode(pwTree, (n) => n.classes.includes('quote'));
  const stQuote = findNode(stTree, (n) => n.classes.includes('quote'));
  assert.equal(pwQuote.text, stQuote.text, 'entity-heavy text (curly quotes, em dash, double-encoded amp, astral emoji) must match the static engine exactly');
  assert.match(pwQuote.text, /\u{1F600}/u, 'the astral numeric entity must decode to the real emoji character');

  const pwH2 = findNode(pwTree, (n) => n.tag === 'h2');
  const stH2 = findNode(stTree, (n) => n.tag === 'h2');
  assert.equal(pwH2.text, 'A messy heading', 'a text run split across a source line break must collapse to single spaces');
  assert.equal(pwH2.text, stH2.text);
});
