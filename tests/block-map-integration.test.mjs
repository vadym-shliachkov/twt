// block-map-integration.test.mjs — the end-to-end gate for /twt-block-map.
//
// Every other block-map test either drives the internal modules directly
// (identity.mjs, extract.mjs, ...) or runs the CLI against the LOCAL
// directory adapter (block-map-cli.test.mjs). Neither exercises the crawl
// adapter (acquire.mjs's fromUrl) for real: link discovery, same-host
// filtering, redirect handling. This file serves the fixture over a real
// `node:http` server (same pattern as tests/site-crawl.test.mjs — no
// installed binary, no new dependency) and runs the actual CLI against it.
//
// It also re-verifies /twt-design-system-audit (tools/ds-audit.mjs) end to
// end: Task 2 of this plan moved eight helper functions out of ds-audit.mjs
// into tools/lib/site-fetch.mjs so block-map and ds-audit share one crawl
// implementation. That extraction is the only change this whole project
// made to an already-shipped skill's behavior, so this file is where that
// gets a permanent regression gate instead of a one-off scratchpad check.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../tools/block-map.mjs', import.meta.url));
const DS_AUDIT = fileURLToPath(new URL('../tools/ds-audit.mjs', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures/block-map-site/', import.meta.url));

let srv, port, base;
before(async () => {
  srv = createServer((req, res) => {
    const f = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
    const p = join(FIX, f);
    if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', f.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(readFileSync(p));
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
});
after(() => srv.close());

test('full pipeline over HTTP reproduces the ground truth for the pages the crawl can reach', async () => {
  // GROUND-TRUTH.md's 4-page canonical set is index/services/pricing/app.html,
  // but only the first three are nav-linked (confirmed by grep across every
  // fixture page: nothing anywhere links to app.html or to any of the round-2
  // pages added later — card-with-list, bem-card, landmark-free, page-wrap,
  // data-table). A link-following crawl over HTTP therefore reaches exactly
  // those 3 pages, never app.html. That's the fixture working as designed
  // (GROUND-TRUTH.md pins it, so this test does not add a nav link to make
  // app.html "reachable") — assert only what the crawl actually sees here;
  // the js-rendered/app.html assertion is checked below via the directory
  // adapter instead, which is the only adapter that reaches app.html at all.
  //
  // Start the crawl at the bare origin, not "/index.html". Before the
  // normUrl() index-folding fix, the fixture server maps "/" to the exact
  // same bytes as "/index.html" but the two were genuinely different URLs
  // to the crawler, so starting at "/" visited the home page twice (4
  // "pages", 12 .card instances instead of 9). normUrl() now folds a
  // trailing index filename into its parent directory, so "/" and
  // "/index.html" collapse to one URL and this holds as a real regression
  // gate rather than a workaround.
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  try {
    await run('node', [TOOL, `${base}/`, '--out', out, '--static', '--max', '10']);
    const s = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));

    assert.equal(s.meta.pages, 3, 'nav only links index/services/pricing.html');
    assert.equal(s.meta.engine, 'static');

    const card = s.blocks.find((b) => b.aliases.includes('.card'));
    assert.ok(card, 'the card block must exist');
    for (const a of ['.card', '.service-box', '.teaser']) assert.ok(card.aliases.includes(a), `alias ${a} missing`);
    assert.equal(card.reuse.instances, 9);

    const all = s.blocks.flatMap((b) => b.aliases);
    for (const w of ['.container', '.wrap', '.elementor-section', '.elementor-container', '.elementor-column', '.elementor-widget-wrap', '.grid']) {
      assert.ok(!all.includes(w), `wrapper ${w} leaked into the map`);
    }

    const plan = s.blocks.find((b) => b.aliases.includes('.plan'));
    const quote = s.blocks.find((b) => b.aliases.includes('.quote'));
    assert.ok(plan, 'plan block must exist');
    assert.ok(quote, 'quote block must exist');
    assert.notEqual(plan.id, quote.id, '.plan and .quote must not merge despite identical h3+p+a tag skeletons');

    assert.ok(existsSync(join(out, 'report.html')));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the directory adapter reaches every fixture page, including the one the crawl cannot: app.html flags js-rendered under --static', async () => {
  // app.html carries only <div id="root"><script src="app.js"> — no real
  // markup for the static engine to read — and nothing links to it, so an
  // HTTP crawl never visits it (see the test above). The directory adapter
  // (fromDir) reads every *.html file in the folder rather than following
  // <a href>, so it's the only way to exercise GROUND-TRUTH's assertion 5:
  // app.html must be flagged js-rendered, not silently mapped as a thin
  // empty tree.
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  try {
    await run('node', [TOOL, FIX, '--out', out, '--static']);
    const s = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    assert.equal(s.meta.pages, 9, 'the directory adapter must read all 9 fixture pages');
    assert.ok(
      s.meta.jsRenderedPages.some((u) => u.includes('app.html')),
      'app.html must be flagged js-rendered under the static engine'
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('/twt-design-system-audit still works end to end against the same HTTP fixture (Task 2 regression gate)', async () => {
  // Task 2 moved normUrl/sameHost/fetchUrl/extractLinks/stylesheetHrefs/
  // collectCss/detectRootFontPx/looksJsRendered out of this file and into
  // tools/lib/site-fetch.mjs, re-exporting them from ds-audit.mjs for
  // backward compatibility. If that extraction broke anything, this is
  // where it shows: a real HTTP crawl through the shared module, all the
  // way to a written audit.json with a non-zero page count.
  const out = mkdtempSync(join(tmpdir(), 'ds-'));
  try {
    await run('node', [DS_AUDIT, 'site', `${base}/index.html`, '--out', out, '--max', '5']);
    const auditPath = join(out, 'audit.json');
    assert.ok(existsSync(auditPath), 'audit.json must be written');
    const raw = readFileSync(auditPath, 'utf8');
    assert.ok(raw.trim().length > 0, 'audit.json must not be empty');
    const audit = JSON.parse(raw);
    assert.ok(audit.summary && audit.summary.pages > 0, 'ds-audit must report a non-zero page count');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
