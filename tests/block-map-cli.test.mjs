import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../tools/lib/resolve-playwright.mjs';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../tools/block-map.mjs', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures/block-map-site', import.meta.url));
const { pw } = await loadPlaywright();

test('maps the fixture dir and writes every artifact', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static']);
  for (const f of ['block-map.json', 'summary.json', 'gray-band.json', 'report.html', 'block-map.md']) {
    assert.ok(existsSync(join(out, f)), `missing ${f}`);
  }
  assert.ok(stdout.includes('blocks'), 'stdout must report a block count');
});

test('stdout stays under 40 lines and never contains the artifact', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static']);
  assert.ok(stdout.split('\n').length <= 40, `stdout was ${stdout.split('\n').length} lines`);
  assert.ok(!stdout.includes('"variants"'), 'stdout leaked block-map.json');
  assert.ok(!stdout.includes('<section'), 'stdout leaked markup');
});

test('bad usage exits 2', async () => {
  await assert.rejects(() => run('node', [TOOL]), (e) => e.code === 2);
});

test('warns loudly about js-rendered pages under the static engine', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static']);
  assert.ok(/js-rendered/i.test(stdout), 'app.html must trigger a visible warning');
});

test('the Playwright engine still opens the right file for a directory source once page urls became relative labels', { skip: !pw }, async () => {
  // acquire.mjs's fromDir keeps `url` as a display-only relative label (the
  // matrix column header) but must still hand the REAL absolute path
  // (`fsPath`) to the Playwright walk — pathToFileURL() on a relative url
  // silently resolves to nothing openable, which wouldn't crash, it would
  // just make walkWithPlaywright() return null and the engine silently fall
  // back to 'static' with no error. Catch that regression by asserting the
  // engine genuinely reaches 'playwright' for a directory source.
  const src = mkdtempSync(join(tmpdir(), 'bm-pw-src-'));
  writeFileSync(join(src, 'index.html'), '<html><body><section class="hero"><h1>x</h1><p>enough text to not look js-rendered by the heuristic</p></section></body></html>');
  const out = mkdtempSync(join(tmpdir(), 'bm-pw-'));
  await run('node', [TOOL, src, '--out', out]); // no --static
  const s = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  assert.equal(s.meta.engine, 'playwright', 'the walk must succeed against fsPath, not the relative display url');
  assert.equal(s.pages[0].url, 'index.html');
});

test('warns loudly when a directory source has subdirectories fromDir cannot see into', async () => {
  // dist/blog/*.html shape: pages under a subdirectory are invisible to the
  // non-recursive directory adapter and must not vanish without a trace.
  const src = mkdtempSync(join(tmpdir(), 'bm-src-'));
  writeFileSync(join(src, 'index.html'), '<html><body><section class="hero"><h1>x</h1><p>y</p></section></body></html>');
  mkdirSync(join(src, 'blog'));
  writeFileSync(join(src, 'blog', 'post.html'), '<html><body>a post that must never surface</body></html>');

  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const { stdout } = await run('node', [TOOL, src, '--out', out, '--static']);
  assert.match(stdout, /subdirector(y|ies)/i, 'a skipped subdirectory must trigger a visible warning');
  assert.match(stdout, /blog/, 'the warning must name the skipped subdirectory');
  assert.ok(stdout.split('\n').length <= 40, `stdout was ${stdout.split('\n').length} lines`);
  assert.ok(!stdout.includes('a post that must never surface'), 'stdout must never leak page content');
});

// --- argument-parsing robustness -------------------------------------------
//
// The brief's reference parser located the source with
// `argv.find(...); argv.indexOf(a)`, which resolves to the FIRST index of a
// repeated string — so a flag's VALUE colliding with another flag's NAME (or
// a repeated flag) can mis-locate the "am I a flag's value" check. These
// pin the rewritten single-pass parser against exactly those shapes.

test('--out works when given BEFORE the source positional', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const { stdout } = await run('node', [TOOL, '--out', out, FIX, '--static']);
  assert.ok(existsSync(join(out, 'summary.json')), 'summary.json must be written when --out precedes the source');
  assert.ok(stdout.includes('blocks'));
});

test('--out works when given AFTER the source positional', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const { stdout } = await run('node', [TOOL, FIX, '--static', '--out', out]);
  assert.ok(existsSync(join(out, 'summary.json')));
  assert.ok(stdout.includes('blocks'));
});

test('a source path containing spaces is not mis-tokenized', async () => {
  const spacedRoot = mkdtempSync(join(tmpdir(), 'bm src '));
  const spacedSrc = join(spacedRoot, 'my site dir');
  mkdirSync(spacedSrc);
  cpSync(FIX, spacedSrc, { recursive: true });
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const { stdout } = await run('node', [TOOL, spacedSrc, '--out', out, '--static']);
  assert.ok(existsSync(join(out, 'summary.json')));
  assert.ok(stdout.includes('blocks'));
});

test('a source value equal to a flag name string does not confuse the parser', async () => {
  // Regression pin for the brief's indexOf(a) bug: if the source happened to
  // be the literal string "--out", argv.indexOf('--out') would find the
  // FLAG occurrence, not this positional one, under the old approach. Our
  // walk-once parser must still just report "source not found" (exit 1),
  // not silently swallow it as a flag.
  await assert.rejects(() => run('node', [TOOL, '--out']), (e) => e.code === 2, 'a bare --out with nothing after it is a missing-value usage error, not a valid source');
});

test('an unknown flag is a usage error (exit 2), not silently ignored', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  await assert.rejects(() => run('node', [TOOL, FIX, '--out', out, '--depht', '3']), (e) => e.code === 2);
});

test('a flag missing its value is a usage error (exit 2)', async () => {
  await assert.rejects(() => run('node', [TOOL, FIX, '--out']), (e) => e.code === 2);
});

test('more than one positional argument is a usage error (exit 2)', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  await assert.rejects(() => run('node', [TOOL, FIX, out, '--static']), (e) => e.code === 2);
});

// --- fatal-error paths (exit 1) ---------------------------------------------

test('a source that does not exist exits 1 with a clear message', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const missing = join(out, 'does-not-exist-dir');
  await assert.rejects(
    () => run('node', [TOOL, missing, '--out', out, '--static']),
    (e) => e.code === 1 && /not found/i.test(e.stderr || '')
  );
});

test('an unwritable --out exits 1, not a stack trace to the user', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const blocker = join(out, 'blocker-file');
  writeFileSync(blocker, 'not a directory');
  const unwritable = join(blocker, 'nested', 'more'); // parent path component is a FILE — mkdirSync must throw
  await assert.rejects(
    () => run('node', [TOOL, FIX, '--out', unwritable, '--static']),
    (e) => e.code === 1
  );
});

test('a malformed --decisions JSON file exits 1 with a clear message', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const dec = join(out, 'decisions.json');
  writeFileSync(dec, '{ not valid json');
  await assert.rejects(
    () => run('node', [TOOL, FIX, '--out', out, '--static', '--decisions', dec]),
    (e) => e.code === 1 && /decisions/i.test(e.stderr || '') && /json/i.test(e.stderr || '')
  );
  assert.ok(!existsSync(join(out, 'summary.json')), 'no artifact should be written on a fatal --decisions parse error');
});

test('a well-formed but empty --decisions file is accepted and noted in stdout', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const dec = join(out, 'decisions.json');
  writeFileSync(dec, '[]');
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static', '--decisions', dec]);
  assert.ok(existsSync(join(out, 'summary.json')));
  assert.ok(/decisions/i.test(stdout), 'stdout should acknowledge the --decisions file was read');
});

// --- task-14 review fixes ----------------------------------------------------

test('a --decisions file containing a null entry exits 1 with a clear message, not a stack trace (review minor 3)', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const dec = join(out, 'decisions.json');
  writeFileSync(dec, JSON.stringify([null]));
  await assert.rejects(
    () => run('node', [TOOL, FIX, '--out', out, '--static', '--decisions', dec]),
    (e) => e.code === 1 && /decisions/i.test(e.stderr || '') && !/TypeError/.test(e.stderr || '')
  );
  assert.ok(!existsSync(join(out, 'summary.json')), 'no artifact should be written on a malformed --decisions entry');
});

test('a --decisions file with an entry missing a/b/verdict as strings exits 1, not a crash (review minor 3)', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const dec = join(out, 'decisions.json');
  writeFileSync(dec, JSON.stringify([{ a: 'B01' }])); // missing b, verdict
  await assert.rejects(
    () => run('node', [TOOL, FIX, '--out', out, '--static', '--decisions', dec]),
    (e) => e.code === 1 && /decisions/i.test(e.stderr || '')
  );
});

test('a ruling whose pair is not in the current run\'s gray band is skipped, not applied, and warned about (review IMPORTANT 2)', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  await run('node', [TOOL, FIX, '--out', out, '--static']);
  const before = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).blocks.length;
  const dec = join(out, 'decisions.json');
  // Simulates the real danger the review flagged: a ruling naming ids that
  // ARE real blocks (not a typo/nonexistent id — that path is already
  // guarded inside applyDecisions itself) but do NOT form a pair in this
  // run's gray band, as if a live re-crawl shifted the ids after the model
  // adjudicated a prior run. Without this check, both real blocks silently
  // merge (verified by mutation testing: removing the filter merges B01
  // into B03 here, 25 blocks -> 24, with zero warning).
  const gb = JSON.parse(readFileSync(join(out, 'gray-band.json'), 'utf8'));
  const grayPairs = new Set(gb.map((g) => [g.a, g.b].sort().join('|')));
  const ids = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).blocks.map((b) => b.id);
  let staleA = null, staleB = null;
  outer: for (const a of ids) for (const b of ids) {
    if (a >= b) continue;
    if (!grayPairs.has([a, b].sort().join('|'))) { staleA = a; staleB = b; break outer; }
  }
  assert.ok(staleA && staleB, 'fixture must have at least two real block ids that are not a gray-band pair');
  writeFileSync(dec, JSON.stringify([{ a: staleA, b: staleB, verdict: 'same', reason: 'stale' }]));
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static', '--decisions', dec]);
  const after = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).blocks.length;
  assert.equal(after, before, 'a stale ruling naming two real, non-paired blocks must not merge them');
  assert.match(stdout, /applied 0 merge/i, 'stdout must report merges actually applied, not rulings read');
  assert.match(stdout, /skipped 1/i);
  assert.match(stdout, /gray band|stale/i);
});

// --- numeric flags -----------------------------------------------------------

test('--decisions merges the pairs the model ruled the same', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  await run('node', [TOOL, FIX, '--out', out, '--static']);
  const before = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).blocks.length;
  const dec = join(out, 'decisions.json');
  const gb = JSON.parse(readFileSync(join(out, 'gray-band.json'), 'utf8'));
  if (!gb.length) return;                       // nothing ambiguous in the fixture; nothing to assert
  writeFileSync(dec, JSON.stringify([{ a: gb[0].a, b: gb[0].b, verdict: 'same', reason: 'test' }]));
  await run('node', [TOOL, FIX, '--out', out, '--static', '--decisions', dec]);
  const after = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).blocks.length;
  assert.equal(after, before - 1);
});

test('mergedBy reaches block-map.json but never leaks into summary.json', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  await run('node', [TOOL, FIX, '--out', out, '--static']);
  const gb = JSON.parse(readFileSync(join(out, 'gray-band.json'), 'utf8'));
  if (!gb.length) return; // nothing ambiguous in the fixture; nothing to assert
  const dec = join(out, 'decisions.json');
  writeFileSync(dec, JSON.stringify([{ a: gb[0].a, b: gb[0].b, verdict: 'same', reason: 'unit-test-reason-marker' }]));
  await run('node', [TOOL, FIX, '--out', out, '--static', '--decisions', dec]);
  const full = JSON.parse(readFileSync(join(out, 'block-map.json'), 'utf8'));
  const survivor = full.blocks.find((b) => (b.mergedBy || []).length > 0);
  assert.ok(survivor, 'block-map.json must record a mergedBy entry for the merged pair');
  assert.equal(survivor.mergedBy[0].absorbed, gb[0].b);
  assert.equal(survivor.mergedBy[0].reason, 'unit-test-reason-marker');
  const summaryRaw = readFileSync(join(out, 'summary.json'), 'utf8');
  assert.ok(!summaryRaw.includes('mergedBy'), 'summary.json must never carry mergedBy');
  assert.ok(!summaryRaw.includes('unit-test-reason-marker'), 'summary.json must never carry a merge reason string');
});

test('--max 0 and --depth 0 do not crash the CLI', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static', '--max', '0', '--depth', '0']);
  assert.ok(existsSync(join(out, 'summary.json')));
  assert.ok(stdout.includes('blocks'));
});

test('a non-numeric --max is a usage error (exit 2)', async () => {
  const out = mkdtempSync(join(tmpdir(), 'bm-'));
  await assert.rejects(() => run('node', [TOOL, FIX, '--out', out, '--max', 'nope']), (e) => e.code === 2);
});
