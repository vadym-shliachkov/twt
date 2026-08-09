// block-map-acquire.test.mjs — acquire layer: three source adapters, one Page[] shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { fromDir, fromUrl, fromFigmaExport } from '../tools/block-map/acquire.mjs';

// Spins up a throwaway HTTP server on an OS-assigned loopback port. Used to
// probe fromUrl's redirect handling without touching the real network or
// depending on DNS for a second hostname — two different loopback ports
// stand in for two different origins (sameHost() compares URL#host, which
// includes the port).
function startServer(handler) {
  return new Promise((res) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}
const closeServer = (server) => new Promise((r) => server.close(r));

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

test('fromFigmaExport disambiguates urls when two frames share a name', async () => {
  // Task 9/10 key page identity off Page.url (the reuse matrix filters
  // instances by `i.page === url` per column) — two frames both landing on
  // `figma://Card` would silently fold their instances onto one column.
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  const p = join(dir, 'figma.json');
  writeFileSync(p, JSON.stringify({ frames: [
    { name: 'Card', html: '<body>one</body>' },
    { name: 'Card', html: '<body>two</body>' },
  ] }));
  const pages = await fromFigmaExport(p);
  assert.equal(pages.length, 2, 'both frames must survive');
  assert.notEqual(pages[0].url, pages[1].url, 'duplicate frame names must not collide on url');
  assert.ok(pages[0].html.includes('one') && pages[1].html.includes('two'), 'content must not be lost or swapped');
});

// Builds a figma-export.json from a bare list of frame names (each frame's
// html is tagged with its own index so a test can independently verify no
// frame's content got lost or swapped along the way) and runs it through
// fromFigmaExport.
async function figmaPagesFor(names) {
  const dir = mkdtempSync(join(tmpdir(), 'bm-'));
  const p = join(dir, 'figma.json');
  writeFileSync(p, JSON.stringify({ frames: names.map((name, i) => ({ name, html: `<body>frame-${i}</body>` })) }));
  return fromFigmaExport(p);
}

function assertAllDistinctAndIntact(pages, names) {
  assert.equal(pages.length, names.length, 'every frame must survive');
  const urls = pages.map((p) => p.url);
  assert.equal(new Set(urls).size, urls.length, `every url must be distinct, got ${JSON.stringify(urls)}`);
  pages.forEach((p, i) => assert.equal(p.html, `<body>frame-${i}</body>`, `frame ${i}'s content must not be lost or swapped`));
  return urls;
}

test('fromFigmaExport: a later LITERAL name colliding with an earlier GENERATED suffix still gets a unique url ([Card, Card~2, Card])', async () => {
  // The bug this guards: naive disambiguation counts occurrences of the
  // ORIGINAL name ("Card" seen twice -> second Card gets suffix 2) without
  // ever checking whether "figma://Card~2" is already taken by a DIFFERENT
  // frame whose literal name happens to be "Card~2". That collision is the
  // exact instance-folding risk this function exists to prevent, just
  // reached via an adversarial/coincidental name instead of a plain repeat.
  const pages = await figmaPagesFor(['Card', 'Card~2', 'Card']);
  const urls = assertAllDistinctAndIntact(pages, ['Card', 'Card~2', 'Card']);
  assert.equal(urls[0], 'figma://Card');
  assert.equal(urls[1], 'figma://Card~2');
  assert.notEqual(urls[2], 'figma://Card~2', 'third frame must not collide with the second frame\'s literal name');
});

test('fromFigmaExport: same collision in reverse literal-name order still resolves uniquely ([Card~2, Card, Card])', async () => {
  // A loop-increment disambiguator can behave differently depending on
  // WHICH literal name is seen first — this pins the reverse ordering so a
  // fix that only handles "generated name collides with a later literal"
  // (and not "literal name collides with a later generated one") can't
  // pass by accident.
  const pages = await figmaPagesFor(['Card~2', 'Card', 'Card']);
  assertAllDistinctAndIntact(pages, ['Card~2', 'Card', 'Card']);
});

test('fromFigmaExport: disambiguation skips a suffix more than once when both are already taken ([Card, Card~2, Card~3, Card])', async () => {
  const pages = await figmaPagesFor(['Card', 'Card~2', 'Card~3', 'Card']);
  const urls = assertAllDistinctAndIntact(pages, ['Card', 'Card~2', 'Card~3', 'Card']);
  assert.equal(urls[0], 'figma://Card');
  assert.equal(urls[1], 'figma://Card~2');
  assert.equal(urls[2], 'figma://Card~3');
  assert.equal(urls[3], 'figma://Card~4', 'the 4th frame must skip past both already-taken suffixes');
});

test('fromFigmaExport: plain repeats still disambiguate cleanly (2 and 3 identically-named frames)', async () => {
  const two = await figmaPagesFor(['Card', 'Card']);
  assertAllDistinctAndIntact(two, ['Card', 'Card']);

  const three = await figmaPagesFor(['Card', 'Card', 'Card']);
  assertAllDistinctAndIntact(three, ['Card', 'Card', 'Card']);
});

test('fromUrl adopts the post-redirect host when the START url redirects cross-host, and still crawls the site', async () => {
  // Simulates the apex -> www shape: fetching the given start URL itself
  // redirects to a different host before any page content is ever served.
  const { server: destServer, port: destPort } = await startServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><a href="/about">about</a></body></html>');
    } else if (req.url === '/about') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>about page</body></html>');
    } else {
      res.writeHead(404); res.end();
    }
  });
  const { server: apexServer, port: apexPort } = await startServer((req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${destPort}/` });
    res.end();
  });
  try {
    const pages = await fromUrl(`http://127.0.0.1:${apexPort}/`, { max: 10 });
    assert.ok(pages.length >= 2, `a start-url redirect must not kill the crawl — got ${pages.length} pages`);
    assert.ok(pages.every((p) => p.url.includes(`:${destPort}`)), 'every page must be attributed to the post-redirect host, not the apex one');
  } finally {
    await closeServer(apexServer);
    await closeServer(destServer);
  }
});

test('fromUrl drops a page whose fetch redirects off-host mid-crawl, never ingesting its content', async () => {
  const marker = 'SHOULD-NEVER-APPEAR-IN-RESULTS';
  const { server: foreignServer, port: foreignPort } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body>${marker}</body></html>`);
  });
  const { server: homeServer, port: homePort } = await startServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><a href="/elsewhere">go</a></body></html>');
    } else if (req.url === '/elsewhere') {
      res.writeHead(302, { Location: `http://127.0.0.1:${foreignPort}/` });
      res.end();
    } else {
      res.writeHead(404); res.end();
    }
  });
  try {
    const pages = await fromUrl(`http://127.0.0.1:${homePort}/`, { max: 10 });
    assert.ok(!pages.some((p) => p.html.includes(marker)), 'a mid-crawl off-host redirect must never have its body ingested');
    assert.ok(!pages.some((p) => p.url.includes(`:${foreignPort}`)), 'no page may be attributed to the foreign host');
  } finally {
    await closeServer(homeServer);
    await closeServer(foreignServer);
  }
});

test('fromDir does not read a stylesheet whose href escapes the target directory', async () => {
  const outerDir = mkdtempSync(join(tmpdir(), 'bm-outer-'));
  const secretPath = join(outerDir, 'secret.css');
  writeFileSync(secretPath, '/* TRAVERSAL-SECRET-MARKER */ body{color:red}');
  const siteDir = mkdtempSync(join(tmpdir(), 'bm-site-'));
  const rel = relative(siteDir, secretPath).split(sep).join('/'); // e.g. "../bm-outer-XXXX/secret.css"
  writeFileSync(join(siteDir, 'index.html'), `<html><head><link rel="stylesheet" href="${rel}"></head><body>x</body></html>`);
  const pages = await fromDir(siteDir);
  assert.equal(pages.length, 1);
  assert.ok(!pages[0].css.includes('TRAVERSAL-SECRET-MARKER'), 'an href escaping the site root must not be read onto disk');
});

test('fromDir still loads a stylesheet referenced from a legitimate subdirectory', async () => {
  const siteDir = mkdtempSync(join(tmpdir(), 'bm-site2-'));
  mkdirSync(join(siteDir, 'assets'));
  writeFileSync(join(siteDir, 'assets', 'site.css'), '/* LEGIT-SUBDIR-CSS */ .btn{color:blue}');
  writeFileSync(join(siteDir, 'index.html'), '<html><head><link rel="stylesheet" href="assets/site.css"></head><body>x</body></html>');
  const pages = await fromDir(siteDir);
  assert.equal(pages.length, 1);
  assert.ok(pages[0].css.includes('LEGIT-SUBDIR-CSS'), 'a stylesheet inside the site dir must still load — the traversal guard must not overreach');
});
