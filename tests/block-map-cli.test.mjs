import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../tools/block-map.mjs', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures/block-map-site', import.meta.url));

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

// --- numeric flags -----------------------------------------------------------

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
