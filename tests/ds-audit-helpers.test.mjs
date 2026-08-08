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

test('normUrl strips a trailing slash except on the bare root', () => {
  // Neither case above reaches the stripping branch: /a?b=1#c has no
  // trailing slash, and / is length-1 so it hits the exception, not the
  // strip. Pin the actual strip (pathname.length > 1) and the exception
  // side by side.
  assert.equal(normUrl('https://x.com/about/'), 'https://x.com/about');
  assert.equal(normUrl('https://x.com/about//'), 'https://x.com/about'); // /\/+$/ strips all trailing slashes, not just one
  assert.equal(normUrl('https://x.com/'), 'https://x.com/'); // bare root: pathname.length === 1, exception applies, slash kept
});

test('sameHost compares hosts, not schemes', () => {
  assert.equal(sameHost('https://x.com/a', 'http://x.com/b'), true);
  assert.equal(sameHost('https://x.com/a', 'https://y.com/b'), false);
  assert.equal(sameHost('not-a-url', 'https://x.com'), false);
});

test('extractLinks resolves relative hrefs against base', () => {
  const html = '<a href="/a">A</a><a href="b">B</a><a href="https://y.com/c">C</a>';
  const links = extractLinks(html, 'https://x.com/dir/');
  // Full result set, not just .includes() — an .ok(includes()) assertion
  // can't catch extra or duplicate entries slipping in.
  assert.deepEqual(links, ['https://x.com/a', 'https://x.com/dir/b', 'https://y.com/c']);
});

test('extractLinks drops blocked file extensions and blocked link protocols', () => {
  const html = '<a href="/a">keep</a>' +
    '<a href="/doc.pdf">skip pdf</a>' +
    '<a href="/style.css">skip css</a>' +
    '<a href="/script.js">skip js file</a>' +
    '<a href="mailto:x@y.com">skip mailto</a>' +
    '<a href="tel:+123456">skip tel</a>' +
    '<a href="javascript:void(0)">skip js protocol</a>' +
    '<a href="/b">keep</a>';
  const links = extractLinks(html, 'https://x.com/dir/');
  assert.deepEqual(links, ['https://x.com/a', 'https://x.com/b']);
});

test('stylesheetHrefs finds rel=stylesheet and resolves them', () => {
  const html = '<link rel="stylesheet" href="/s.css"><link rel="icon" href="/f.ico">';
  const hrefs = stylesheetHrefs(html, 'https://x.com/');
  assert.deepEqual(hrefs, ['https://x.com/s.css']);
});

test('stylesheetHrefs dedups repeated hrefs that resolve to the same absolute URL', () => {
  const html = '<link rel="stylesheet" href="/s.css">' +
    '<link rel="stylesheet" href="/s.css">' +
    '<link rel="stylesheet" href="/other.css">';
  const hrefs = stylesheetHrefs(html, 'https://x.com/');
  assert.deepEqual(hrefs, ['https://x.com/s.css', 'https://x.com/other.css']);
});

test('detectRootFontPx reads html font-size, defaults to 16', () => {
  assert.equal(detectRootFontPx('html{font-size:62.5%}'), 10);
  assert.equal(detectRootFontPx('body{color:red}'), 16);
});

test('detectRootFontPx converts %, em, and rem to px (16px base)', () => {
  assert.equal(detectRootFontPx(':root{font-size:80%}'), 12.8);
  assert.equal(detectRootFontPx('html{font-size:1.5em}'), 24);
  assert.equal(detectRootFontPx(':root{font-size:1.25rem}'), 20);
});

test('detectRootFontPx: last declaration with a font-size wins; a later rule without one leaves it untouched', () => {
  assert.equal(detectRootFontPx('html{font-size:62.5%} :root{font-size:2em} html{font-size:20px}'), 20);
  // second rule has no font-size at all — the `if (!f) continue` branch —
  // so the value from the first rule survives rather than resetting to 16.
  assert.equal(detectRootFontPx('html{font-size:20px} :root{color:blue}'), 20);
});

test('looksJsRendered flags an empty-body mount point', () => {
  assert.equal(looksJsRendered('<body><div id="root"></div><script src="/app.js"></script></body>'), true);
  assert.equal(looksJsRendered('<body><main><h1>Real</h1><p>Content here that is long enough to count as real rendered output for the heuristic.</p></main></body>'), false);
});
