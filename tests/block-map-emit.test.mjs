import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseHtml } from '../tools/block-map/parse.mjs';
import { extractBlocks } from '../tools/block-map/extract.mjs';
import { cluster } from '../tools/block-map/identity.mjs';
import { emitAll } from '../tools/block-map/emit.mjs';

const FIX = fileURLToPath(new URL('./fixtures/block-map-site/', import.meta.url));
const flatten = (bs) => bs.flatMap((b) => [b, ...flatten(b.children)]);

function build() {
  const files = ['index.html', 'services.html', 'pricing.html'];
  const pages = files.map((f, i) => ({ id: 'P' + (i + 1), url: '/' + f.replace('.html', ''), html: readFileSync(FIX + f, 'utf8'), css: '', jsRendered: false }));
  const instances = pages.flatMap((p) =>
    flatten(extractBlocks(parseHtml(p.html))).map((block) => ({ block, page: p.url, selector: block.selector })));
  return { pages, ...cluster(instances) };
}

test('summary.json contains no markup and no css', () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  emitAll(build(), out);
  const raw = readFileSync(join(out, 'summary.json'), 'utf8');
  assert.ok(!raw.includes('<div'), 'summary leaked markup');
  assert.ok(!raw.includes('<section'), 'summary leaked markup');
  const s = JSON.parse(raw);
  for (const b of s.blocks) {
    assert.equal(b.variants, undefined);
    assert.equal(b.instances, undefined, 'per-instance rows do not belong in summary');
    assert.ok(b.reuse.pages >= 1);
  }
});

test('block-map.json carries representative markup per variant', () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  emitAll(build(), out);
  const m = JSON.parse(readFileSync(join(out, 'block-map.json'), 'utf8'));
  const card = m.blocks.find((b) => b.aliases.includes('.card'));
  assert.ok(card.variants.length >= 1);
  assert.ok(card.variants[0].html.includes('<'), 'variant must carry markup');
  assert.equal(card.variants.reduce((s, v) => s + v.count, 0), card.reuse.instances,
    'variant counts must sum to the instance count');
});

test('variant markup escapes decoded text — no live markup injection', () => {
  // parse.mjs decodes entities, so source `&lt;script&gt;` becomes the literal
  // string `<script>` in node.text. It must NOT be re-emitted as a live tag.
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const html = '<body><section class="x"><div class="c"><h3>A</h3><p>&lt;script&gt;alert(1)&lt;/script&gt;</p><a href="#">go</a></div><div class="c"><h3>B</h3><p>b</p><a href="#">go</a></div><div class="c"><h3>C</h3><p>c</p><a href="#">go</a></div></section></body>';
  const pages = [{ id: 'P1', url: '/x', html, css: '', jsRendered: false }];
  const instances = pages.flatMap((p) =>
    flatten(extractBlocks(parseHtml(p.html))).map((block) => ({ block, page: p.url, selector: block.selector })));
  emitAll({ pages, ...cluster(instances) }, out);
  const raw = readFileSync(join(out, 'block-map.json'), 'utf8');
  assert.ok(!raw.includes('<script>'), 'decoded text was re-emitted as live markup');
  assert.ok(raw.includes('&lt;script&gt;'), 'the text should survive, escaped');
});

test('block-map.json never contains the internal _members field', () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  emitAll(build(), out);
  assert.ok(!readFileSync(join(out, 'block-map.json'), 'utf8').includes('_members'));
});

test('summary.json is dramatically smaller than block-map.json', () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  emitAll(build(), out);
  const big = readFileSync(join(out, 'block-map.json'), 'utf8').length;
  const small = readFileSync(join(out, 'summary.json'), 'utf8').length;
  assert.ok(small < big / 2, `summary ${small} should be far under half of map ${big}`);
});

// --- Review-round fixes -----------------------------------------------------

function runHtml(html) {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const pages = [{ id: 'P1', url: '/x', html, css: '', jsRendered: false }];
  const instances = pages.flatMap((p) =>
    flatten(extractBlocks(parseHtml(p.html))).map((block) => ({ block, page: p.url, selector: block.selector })));
  emitAll({ pages, ...cluster(instances) }, out);
  return JSON.parse(readFileSync(join(out, 'block-map.json'), 'utf8'));
}

test('CRITICAL 1: serialize() keeps both text and children — an inline link inside prose is not dropped', () => {
  // Ordinary prose: a <p> with a real sentence containing an inline <a>.
  // The old `node.text ? esc(text) : children...` branch treated text and
  // children as mutually exclusive and silently dropped the link.
  const html = '<body><section class="x">'
    + '<div class="c"><h3>A</h3><p>Learn more about <a class="inline-link" href="/us">us</a> today.</p><a href="#">go</a></div>'
    + '<div class="c"><h3>B</h3><p>b</p><a href="#">go</a></div>'
    + '<div class="c"><h3>C</h3><p>c</p><a href="#">go</a></div>'
    + '</section></body>';
  const m = runHtml(html);
  const card = m.blocks.find((b) => b.aliases.includes('.c'));
  const withLink = card.variants.find((v) => v.html.includes('inline-link'));
  assert.ok(withLink, 'no variant carries the inline-link markup at all');
  assert.ok(withLink.html.includes('Learn more about'), 'text before the child was dropped');
  assert.ok(withLink.html.includes('today.'), 'text after the child was dropped');
  assert.ok(withLink.html.includes('>us<'), 'the child anchor itself was dropped');
});

test('IMPORTANT 2: an already-encoded &amp; in an href is not double-escaped', () => {
  // parse.mjs's attrsOf() never decodes entities in attribute values (only
  // node.text goes through decodeEntities), so a source href like
  // `href="/x?a=1&amp;b=2"` — the spec-correct way to write a literal `&`
  // in an href, and common on real sites — arrives here STILL encoded, as
  // the literal string "/x?a=1&amp;b=2". Escaping `&` again on top of that
  // corrupts the URL into "&amp;amp;".
  const html = '<body><section class="x">'
    + '<div class="c"><h3>A</h3><p>a</p><a class="cta" href="/x?a=1&amp;b=2">go</a></div>'
    + '<div class="c"><h3>B</h3><p>b</p><a href="#">go</a></div>'
    + '<div class="c"><h3>C</h3><p>c</p><a href="#">go</a></div>'
    + '</section></body>';
  const m = runHtml(html);
  const card = m.blocks.find((b) => b.aliases.includes('.c'));
  const v = card.variants.find((x) => x.html.includes('/x?a=1'));
  assert.ok(v, 'variant carrying the crafted href was not found');
  assert.ok(v.html.includes('href="/x?a=1&amp;b=2"'), `href was double-encoded: ${v.html}`);
  assert.ok(!v.html.includes('&amp;amp;'), 'href was double-escaped');
});

test('IMPORTANT 2: a bare & in text content is still escaped (text IS decoded, unlike attrs)', () => {
  // Card A gets an extra <span class="tag"> child so it is structurally
  // distinct from B/C (different class shape) and always lands in its own
  // variant bucket, regardless of how the bucket key treats attribute
  // values or inter-tag text — this test cares only about text escaping.
  const html = '<body><section class="x">'
    + '<div class="c"><h3>A</h3><p>Widgets & Gadgets</p><span class="tag">New</span><a href="#">go</a></div>'
    + '<div class="c"><h3>B</h3><p>b</p><a href="#">go</a></div>'
    + '<div class="c"><h3>C</h3><p>c</p><a href="#">go</a></div>'
    + '</section></body>';
  const m = runHtml(html);
  const card = m.blocks.find((b) => b.aliases.includes('.c'));
  const v = card.variants.find((x) => x.html.includes('tag'));
  assert.ok(v, 'variant carrying the distinguishing <span class="tag"> was not found');
  assert.ok(v.html.includes('Widgets &amp; Gadgets'), `bare & in text was not escaped: ${v.html}`);
});

test('CRITICAL 1: a node with text and two children keeps all three pieces of content', () => {
  // parse.mjs's addText concatenates ALL of a node's direct text runs into
  // one `.text` string — the original before/between/after interleaving is
  // not recoverable at this layer (documented in emit.mjs). This test only
  // asserts that nothing is silently lost: the node's own text plus both
  // children's content must all survive serialization.
  const html = '<body><section class="x"><div class="c">lead <h3>Head</h3> mid <p>para</p> trail</div></section></body>';
  const m = runHtml(html);
  const card = m.blocks.find((b) => b.aliases.includes('.c'));
  const html1 = card.variants[0].html;
  assert.ok(html1.includes('lead'), 'own leading text dropped');
  assert.ok(html1.includes('mid'), 'own middle text dropped');
  assert.ok(html1.includes('trail'), 'own trailing text dropped');
  assert.ok(html1.includes('Head'), 'first child (h3) dropped');
  assert.ok(html1.includes('para'), 'second child (p) dropped');
});
