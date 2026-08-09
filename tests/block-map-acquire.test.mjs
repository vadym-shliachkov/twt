// block-map-acquire.test.mjs — acquire layer: three source adapters, one Page[] shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fromDir, fromFigmaExport } from '../tools/block-map/acquire.mjs';

const FIX = fileURLToPath(new URL('./fixtures/block-map-site', import.meta.url));

test('fromDir reads every html file and inlines local css', async () => {
  const pages = await fromDir(FIX);
  // The brief's reference test hardcoded 4 (the fixture's original page
  // count). Tasks 5/6/7 grew the fixture to 9 html files without touching
  // this test, which would have made the hardcoded number stale again the
  // next time a fixture page is added. Counting the directory instead ties
  // the assertion to the fixture's actual contents so it can't drift.
  const expected = readdirSync(FIX).filter((f) => /\.html?$/i.test(f)).length;
  assert.equal(pages.length, expected);
  const home = pages.find((p) => p.url.endsWith('index.html'));
  assert.ok(home.html.includes('<section class="hero">'));
  assert.ok(home.css.includes('--brand'), 'linked stylesheet must be inlined');
});

test('fromDir flags the JS-rendered page', async () => {
  const pages = await fromDir(FIX);
  assert.equal(pages.find((p) => p.url.endsWith('app.html')).jsRendered, true);
  assert.equal(pages.find((p) => p.url.endsWith('index.html')).jsRendered, false);
});

test('fromFigmaExport normalizes frames into pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  const p = join(dir, 'figma.json');
  writeFileSync(p, JSON.stringify({ frames: [{ name: 'Home', html: '<body><section class="hero"><h1>x</h1><p>y</p></section></body>' }] }));
  const pages = await fromFigmaExport(p);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].url, 'figma://Home');
  assert.ok(pages[0].html.includes('hero'));
});

test('fromFigmaExport rejects a malformed export with a clear message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  const p = join(dir, 'bad.json');
  writeFileSync(p, JSON.stringify({ nope: true }));
  await assert.rejects(() => fromFigmaExport(p), /frames/);
});
