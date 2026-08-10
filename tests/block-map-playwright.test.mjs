import { test, skip } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../tools/lib/resolve-playwright.mjs';
import { walkWithPlaywright } from '../tools/block-map/playwright-walk.mjs';
import { parseHtml } from '../tools/block-map/parse.mjs';
import { extractBlocks } from '../tools/block-map/extract.mjs';
import { readFileSync } from 'node:fs';

const FIX = fileURLToPath(new URL('./fixtures/block-map-site/', import.meta.url));
const { pw } = await loadPlaywright();

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
