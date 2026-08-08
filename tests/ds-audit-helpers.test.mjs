import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MOD = fileURLToPath(new URL('../tools/ds-audit.mjs', import.meta.url));
const { normUrl, sameHost, extractLinks, stylesheetHrefs, detectRootFontPx, looksJsRendered } =
  await import(pathToFileURL(MOD));

test('normUrl drops hash and query, keeps path', () => {
  assert.equal(normUrl('https://x.com/a?b=1#c'), 'https://x.com/a');
  assert.equal(normUrl('https://x.com/'), 'https://x.com/');
});

test('sameHost compares hosts, not schemes', () => {
  assert.equal(sameHost('https://x.com/a', 'http://x.com/b'), true);
  assert.equal(sameHost('https://x.com/a', 'https://y.com/b'), false);
  assert.equal(sameHost('not-a-url', 'https://x.com'), false);
});

test('extractLinks resolves relative hrefs against base', () => {
  const html = '<a href="/a">A</a><a href="b">B</a><a href="https://y.com/c">C</a>';
  const links = extractLinks(html, 'https://x.com/dir/');
  assert.ok(links.includes('https://x.com/a'));
  assert.ok(links.includes('https://x.com/dir/b'));
  assert.ok(links.includes('https://y.com/c'));
});

test('stylesheetHrefs finds rel=stylesheet and resolves them', () => {
  const html = '<link rel="stylesheet" href="/s.css"><link rel="icon" href="/f.ico">';
  const hrefs = stylesheetHrefs(html, 'https://x.com/');
  assert.deepEqual(hrefs, ['https://x.com/s.css']);
});

test('detectRootFontPx reads html font-size, defaults to 16', () => {
  assert.equal(detectRootFontPx('html{font-size:62.5%}'), 10);
  assert.equal(detectRootFontPx('body{color:red}'), 16);
});

test('looksJsRendered flags an empty-body mount point', () => {
  assert.equal(looksJsRendered('<body><div id="root"></div><script src="/app.js"></script></body>'), true);
  assert.equal(looksJsRendered('<body><main><h1>Real</h1><p>Content here that is long enough to count as real rendered output for the heuristic.</p></main></body>'), false);
});
