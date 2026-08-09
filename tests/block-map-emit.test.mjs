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
