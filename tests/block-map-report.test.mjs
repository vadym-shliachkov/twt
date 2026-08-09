import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  renderReport, matrixHtml, warnBanner, skeletonMermaid, neighborhoodMermaid,
  variantSection, markdownFor, blockPageHtml, pageFile, NEIGHBOR_CAP,
} from '../tools/block-map/report.mjs';

function fixtureMap(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'block-map.json'), JSON.stringify({
    meta: { pages: 3, blocks: 3, engine: 'static', jsRenderedPages: [], unadjudicated: 0, generated: '2026-08-08T00:00:00Z' },
    pages: [{ id: 'P1', url: '/index' }, { id: 'P2', url: '/services' }, { id: 'P3', url: '/pricing' }],
    blocks: [
      { id: 'B01', name: 'Site header', tier: 'organism', aliases: ['.site-head'], parents: [], children: [], reuse: { pages: 3, instances: 3 }, instances: [{ page: '/index', selector: 'header.site-head' }], variants: [{ id: 'v1', count: 3, html: '<header></header>' }] },
      { id: 'B02', name: 'Card grid', tier: 'organism', aliases: ['.features', '.svc'], parents: [], children: ['B03'], reuse: { pages: 2, instances: 2 }, instances: [], variants: [{ id: 'v1', count: 2, html: '<section></section>' }] },
      { id: 'B03', name: 'Card', tier: 'molecule', aliases: ['.card', '.service-box'], parents: ['B02'], children: [], reuse: { pages: 2, instances: 6 }, instances: [], variants: [{ id: 'v1', count: 6, html: '<div></div>' }] },
    ],
  }, null, 2));
}

test('homepage carries the reuse matrix with every page as a column', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  fixtureMap(dir);
  renderReport(dir);
  const html = readFileSync(join(dir, 'report.html'), 'utf8');
  for (const p of ['/index', '/services', '/pricing']) assert.ok(html.includes(p), `missing column ${p}`);
  assert.ok(html.includes('Site header') && html.includes('Card'));
});

test('homepage graph is filtered to reused blocks only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  fixtureMap(dir);
  renderReport(dir);
  const html = readFileSync(join(dir, 'report.html'), 'utf8');
  assert.ok(html.includes('mermaid'), 'a mermaid block must be present');
  const graph = html.slice(html.indexOf('class="mermaid"'), html.indexOf('</pre>', html.indexOf('class="mermaid"')));
  assert.ok(graph.includes('B02') && graph.includes('B03'), 'reused blocks belong in the skeleton');
});

test('one page per block, each with a neighborhood graph', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  fixtureMap(dir);
  const { blockPages } = renderReport(dir);
  assert.equal(blockPages.length, 3);
  const card = readFileSync(join(dir, 'block-B03-card.html'), 'utf8');
  assert.ok(card.includes('B02'), 'parent must appear in the neighborhood graph');
  assert.ok(card.includes('.service-box'), 'aliases must be listed');
});

test('markdown companion lists blocks with reuse counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  fixtureMap(dir);
  renderReport(dir);
  const md = readFileSync(join(dir, 'block-map.md'), 'utf8');
  assert.ok(md.includes('| Card |'));
  assert.ok(md.includes('.service-box'));
});

test('report renders with zero blocks without throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'block-map.json'), JSON.stringify({ meta: { pages: 1, blocks: 0, jsRenderedPages: ['/app'] }, pages: [{ id: 'P1', url: '/app' }], blocks: [] }));
  const { blockPages } = renderReport(dir);
  assert.equal(blockPages.length, 0);
  assert.ok(readFileSync(join(dir, 'report.html'), 'utf8').includes('/app'), 'the js-rendered warning must name the page');
});

// --- Review round 1: pin the 5 previously-uncovered deviations ------------
//
// Each of these five was a real fix over the brief's reference code, but
// tests/block-map-report.test.mjs (the brief's 5 tests, copied verbatim)
// could not see any of them — reverting the corresponding source hunk left
// all 5 original tests green. Pinned here, mutation-verified against the
// pre-fix behaviour before landing.

test('matrixHtml renders a 3-level parent chain at the correct indentation depth', () => {
  // card-with-list.html's real shape: Package grid (root) > Package
  // (child) > Feature list (grandchild). The brief's reference matrixHtml
  // only walks ONE level (roots, then roots' direct children), so the
  // grandchild would be silently absent from the matrix entirely — not
  // just under-indented. Depth is encoded as padding-left:${12+depth*16}px,
  // so depth 2 must read exactly padding-left:44px.
  const map = {
    meta: { pages: 1 }, pages: [{ id: 'P1', url: '/p' }],
    blocks: [
      { id: 'ROOT', name: 'Package grid', tier: 'organism', aliases: ['.pkgs'], parents: [], children: ['MID'], reuse: { pages: 1, instances: 1 }, instances: [] },
      { id: 'MID', name: 'Package', tier: 'molecule', aliases: ['.pkg'], parents: ['ROOT'], children: ['LEAF'], reuse: { pages: 1, instances: 3 }, instances: [] },
      { id: 'LEAF', name: 'Feature list', tier: 'molecule', aliases: ['.feats'], parents: ['MID'], children: [], reuse: { pages: 1, instances: 3 }, instances: [] },
    ],
  };
  const html = matrixHtml(map);
  const row = html.match(/<tr[^>]*>[\s\S]*?Feature list[\s\S]*?<\/tr>/);
  assert.ok(row, `"Feature list" (a grandchild, 2 hops from its root) is missing from the matrix entirely:\n${html}`);
  assert.ok(row[0].includes('padding-left:44px'), `expected depth-2 indent (44px), got:\n${row[0]}`);
});

test('skeletonMermaid entity-escapes a literal double-quote inside a block name', () => {
  // A raw `"` in a block name breaks Mermaid's OWN quoted-label grammar —
  // not just HTML safety. The brief's reference code only HTML-escapes the
  // whole joined mermaid source once, at the end; that escape round-trips
  // losslessly back through the browser's one-level entity decode of the
  // <pre>'s textContent, so Mermaid's parser still sees the bare `"` and
  // the label breaks. Fixed by escaping each label's own text before
  // composing it. Simulate exactly what the browser/Mermaid would see: one
  // level of HTML-entity decode on the <pre> contents.
  const map = {
    meta: { pages: 1 },
    blocks: [{ id: 'B1', name: 'He said "hi"', tier: 'organism', aliases: ['.x'], parents: [], children: [], reuse: { pages: 1, instances: 2 }, instances: [] }],
  };
  const html = skeletonMermaid(map);
  const raw = html.slice(html.indexOf('>') + 1, html.lastIndexOf('<'));
  // A real browser decodes HTML entities in ONE pass, not by re-scanning
  // its own output — chained sequential .replace() calls would incorrectly
  // decode &amp;quot; in two hops (-> &quot; -> ") instead of one (-> &quot;
  // as literal text), which is a different, WRONG simulation of what the
  // browser (and therefore Mermaid, reading .textContent) actually sees.
  const decoded = raw.replace(/&amp;|&lt;|&gt;|&quot;/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' }[m]));
  const label = decoded.match(/B1\["([\s\S]*?)"\]/);
  assert.ok(label, `mermaid source is not well-formed after a one-level entity decode:\n${decoded}`);
  assert.ok(label[1].includes('&quot;'), `the name's own quote must survive as an entity INSIDE the label, not as a literal " that closes it early. Got label: ${JSON.stringify(label[1])}`);
});

test('variantSection renders an overflow bucket with a distinct heading, never as a normal variant', () => {
  const html = variantSection({ id: 'v8', count: 16, html: '<div>h</div>', overflow: true, overflowShapes: 9 });
  assert.ok(html.includes('+9 more shape'), `overflow bucket must say how many shapes were folded in:\n${html}`);
  assert.ok(!html.includes('Variant v8'), `an overflow bucket's count is a SUM across shapes, not one instance count — must not read as a normal "Variant vN" heading:\n${html}`);
});

// --- Review round 1, Important 2: warnBanner must not contradict itself ---
//
// Removing the `engine === 'playwright'` gate (so the warning always shows
// once jsRenderedPages is non-empty, regardless of engine) was correct, but
// the WORDING was never adapted for that case: under the playwright engine
// the banner still said "read as static HTML ... Install Playwright and
// re-run without --static" — false and contradictory advice on the one
// artifact a user actually reads, right next to a "engine: playwright"
// subtitle two lines above it.

test('warnBanner under the static engine keeps the install-Playwright wording', () => {
  const html = warnBanner({ meta: { engine: 'static', jsRenderedPages: ['/app'] } });
  assert.ok(html.includes('/app'), 'must name the page');
  assert.ok(html.includes('Install Playwright'), 'static engine: the install-Playwright advice is correct here');
});

test('warnBanner under the playwright engine does not contradict itself', () => {
  const html = warnBanner({ meta: { engine: 'playwright', jsRenderedPages: ['/app'] } });
  assert.ok(html.includes('/app'), 'must still name the page — no engine gate suppresses the warning');
  assert.ok(!html.includes('Install Playwright'), `must not tell a playwright-engine user to install Playwright:\n${html}`);
  assert.ok(!html.includes('--static'), `must not reference the --static flag, which is irrelevant under playwright:\n${html}`);
});

test('warnBanner stays silent when jsRenderedPages is empty, under either engine', () => {
  assert.equal(warnBanner({ meta: { engine: 'static', jsRenderedPages: [] } }), '');
  assert.equal(warnBanner({ meta: { engine: 'playwright', jsRenderedPages: [] } }), '');
});

test('neighborhoodMermaid caps fan-out at NEIGHBOR_CAP and notes the overflow', () => {
  const byId = new Map();
  const parentIds = [];
  const total = NEIGHBOR_CAP + 5;
  for (let i = 0; i < total; i++) {
    const id = 'PAR' + i;
    byId.set(id, { id, name: 'Parent' });
    parentIds.push(id);
  }
  const block = { id: 'X', name: 'X', parents: parentIds, children: [] };
  const html = neighborhoodMermaid(block, byId);
  const nodeCount = (html.match(/Parent/g) || []).length;
  assert.equal(nodeCount, NEIGHBOR_CAP, `expected exactly NEIGHBOR_CAP (${NEIGHBOR_CAP}) parent nodes in an unreadable ${total}-parent fan-out, got ${nodeCount}`);
  assert.ok(html.includes(`+${total - NEIGHBOR_CAP} more parent`), `must note the ${total - NEIGHBOR_CAP} parents that were capped:\n${html}`);
});
