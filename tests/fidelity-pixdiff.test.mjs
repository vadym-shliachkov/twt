import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pixdiff, classifyPixdiffExit } from '../tools/fidelity/pixdiff.mjs';
import { shoot } from '../tools/fidelity/pixdiff.mjs';
import { detectPlaywright } from '../tools/lib/resolve-playwright.mjs';

const CLI = fileURLToPath(new URL('../tools/fidelity/pixdiff.mjs', import.meta.url));

const FIX = fileURLToPath(new URL('./fixtures/fidelity-pair/', import.meta.url));

// Independent of shoot()/pixdiff()'s own return values, so a mutation that
// makes either function wrongly return false/null cannot register as a
// "playwright unavailable" skip instead of a hard failure — same pattern
// tests/fidelity-measure.test.mjs uses (chromiumAvailable()), applied here so
// the mutation-verification tests below cannot be masked by the t.skip gate.
let chromiumOk;
async function chromiumAvailable() {
  if (chromiumOk === undefined) {
    const d = await detectPlaywright();
    chromiumOk = d.playwright && d.chromium;
  }
  return chromiumOk;
}

// Reads width/height straight out of a PNG's IHDR chunk (bytes 16-23,
// big-endian) — no image library needed, just the fixed PNG header layout.
// Used to pin the union-sizing behaviour (out heatmap dims === max of the
// two inputs) without guessing rendered pixel sizes ahead of time.
function pngSize(path) {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Builds a flat-color NxN swatch with a single rectangular patch in the
// corner, so the exact count of differing pixels between two swatches (and
// therefore the exact mismatch %) is known ahead of time — no reliance on
// text/font rendering, which is not pixel-exact across environments.
function swatch({ dir, name, size, patchW, patchH, bg, patch }) {
  const file = join(dir, name);
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>
    *{margin:0;box-sizing:border-box}
    .box{width:${size}px;height:${size}px;background:rgb(${bg.join(',')});position:relative}
    .patch{position:absolute;top:0;left:0;width:${patchW}px;height:${patchH}px;background:rgb(${patch.join(',')})}
  </style><div class="box"><div class="patch"></div></div>`);
  return file;
}

test('identical images report zero mismatch and are not reported', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-'));
  const a = join(dir, 'a.png');
  const ok = await shoot({ file: FIX + 'reference.html', root: '.hero', width: 1440, out: a });
  if (!ok) return t.skip('playwright/chromium unavailable');
  const res = await pixdiff({ a, b: a, out: join(dir, 'd.png') });
  assert.equal(res.mismatch, 0);
  assert.equal(res.reported, false);
});

test('the drifted fixture differs measurably from the reference', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-'));
  const a = join(dir, 'a.png'), b = join(dir, 'b.png'), d = join(dir, 'd.png');
  const okA = await shoot({ file: FIX + 'reference.html', root: '.hero', width: 1440, out: a });
  const okB = await shoot({ file: FIX + 'drifted.html', root: '.hero', width: 1440, out: b });
  if (!okA || !okB) return t.skip('playwright/chromium unavailable');
  const res = await pixdiff({ a, b, out: d });
  assert.ok(res.mismatch > 1, `expected a visible difference, got ${res.mismatch}%`);
  assert.equal(res.reported, true);
  assert.ok(existsSync(d), 'a heatmap PNG must be written');
});

// The brief's version of this test shot `reference.html` at two viewport
// widths — but `.hero` there is a fixed `width: 1000px`, which does not
// respond to viewport at all, so both screenshots came out pixel-identical
// (mismatch === 0) and `assert.ok(res.mismatch > 0)` failed for real. Swapped
// to `widths.html` (`.hero { width: 50% }`, the same fixture
// fidelity-measure.test.mjs uses to prove per-width layout differs) so the
// two shots are genuinely different sizes, which is what this test claims to
// exercise.
test('images of different sizes compare on their union, not by crashing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-'));
  const a = join(dir, 'a.png'), b = join(dir, 'b.png');
  const okA = await shoot({ file: FIX + 'widths.html', root: '.hero', width: 1440, out: a });
  const okB = await shoot({ file: FIX + 'widths.html', root: '.hero', width: 375, out: b });
  if (!okA || !okB) return t.skip('playwright/chromium unavailable');
  const res = await pixdiff({ a, b, out: join(dir, 'd.png') });
  assert.ok(Number.isFinite(res.mismatch));
  assert.ok(res.mismatch > 0);
});

// --- Extra coverage beyond the brief -------------------------------------
//
// The brief's suite proves the three headline behaviours (identical -> zero,
// drifted -> reported, mismatched sizes -> union, not a crash) but pins none
// of the two numeric thresholds pixdiff.mjs actually compares against: the
// per-pixel anti-aliasing slack (`dr+dg+db+dAlpha > 24`) and the `reported`
// floor (`mismatch >= floor`, default 0.5). Both are boundaries a future edit
// could quietly shift in either direction without any brief test noticing.
// Each pair below is built from a flat-color swatch with a known, exact
// pixel-diff count, so the expected mismatch % is arithmetic, not measured.

test('a per-pixel diff of exactly 24 sits on the AA-slack boundary and is NOT counted', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'fid-'));
  // 10x10 = 100px swatch; a single 1x1 patch differs by exactly 8 per
  // channel (8+8+8+0 = 24). The comparator's `> 24` must leave this pixel
  // uncounted: a `>= 24` mutation would flip it to 1/100 = 1%.
  const fa = swatch({ dir, name: 'a.html', size: 10, patchW: 1, patchH: 1, bg: [255, 255, 255], patch: [255, 255, 255] });
  const fb = swatch({ dir, name: 'b.html', size: 10, patchW: 1, patchH: 1, bg: [255, 255, 255], patch: [247, 247, 247] });
  const a = join(dir, 'a.png'), b = join(dir, 'b.png');
  const okA = await shoot({ file: fa, root: '.box', width: 100, out: a });
  const okB = await shoot({ file: fb, root: '.box', width: 100, out: b });
  assert.ok(okA && okB, 'chromium was independently confirmed available — shoot() must not fail');
  const res = await pixdiff({ a, b, out: join(dir, 'd.png') });
  assert.equal(res.mismatch, 0, 'a diff sum of exactly 24 must stay under the AA-slack cutoff');
  assert.equal(res.reported, false);
});

test('a per-pixel diff of exactly 25 crosses the AA-slack boundary and IS counted', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'fid-'));
  // Same swatch, one channel-unit further away (9+8+8+0 = 25). Exactly one
  // pixel of 100 must now register as changed: mismatch === 1%.
  const fa = swatch({ dir, name: 'a.html', size: 10, patchW: 1, patchH: 1, bg: [255, 255, 255], patch: [255, 255, 255] });
  const fb = swatch({ dir, name: 'b.html', size: 10, patchW: 1, patchH: 1, bg: [255, 255, 255], patch: [246, 247, 247] });
  const a = join(dir, 'a.png'), b = join(dir, 'b.png');
  const okA = await shoot({ file: fa, root: '.box', width: 100, out: a });
  const okB = await shoot({ file: fb, root: '.box', width: 100, out: b });
  assert.ok(okA && okB, 'chromium was independently confirmed available — shoot() must not fail');
  const res = await pixdiff({ a, b, out: join(dir, 'd.png') });
  assert.equal(res.mismatch, 1, 'exactly 1 of 100 pixels must register as changed once the diff sum exceeds 24');
  assert.equal(res.reported, true);
});

test('a mismatch of exactly the default floor (0.5%) is reported', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'fid-'));
  // 100x100 = 10000px swatch; a 50x1 black patch on white = 50 differing
  // pixels = 0.5% exactly. `reported = mismatch >= floor` must read this as
  // reportable — a `>` mutation would flip it to false.
  const fa = swatch({ dir, name: 'a.html', size: 100, patchW: 50, patchH: 1, bg: [255, 255, 255], patch: [255, 255, 255] });
  const fb = swatch({ dir, name: 'b.html', size: 100, patchW: 50, patchH: 1, bg: [255, 255, 255], patch: [0, 0, 0] });
  const a = join(dir, 'a.png'), b = join(dir, 'b.png');
  const okA = await shoot({ file: fa, root: '.box', width: 200, out: a });
  const okB = await shoot({ file: fb, root: '.box', width: 200, out: b });
  assert.ok(okA && okB, 'chromium was independently confirmed available — shoot() must not fail');
  const res = await pixdiff({ a, b, out: join(dir, 'd.png') });
  assert.equal(res.mismatch, 0.5);
  assert.equal(res.reported, true, 'mismatch exactly at the floor must still be reported (>=, not >)');
});

test('a mismatch just under the default floor (0.49%) is not reported', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'fid-'));
  // One column narrower than the 0.5% case above: 49 differing pixels of
  // 10000 = 0.49%, just under the default 0.5 floor.
  const fa = swatch({ dir, name: 'a.html', size: 100, patchW: 49, patchH: 1, bg: [255, 255, 255], patch: [255, 255, 255] });
  const fb = swatch({ dir, name: 'b.html', size: 100, patchW: 49, patchH: 1, bg: [255, 255, 255], patch: [0, 0, 0] });
  const a = join(dir, 'a.png'), b = join(dir, 'b.png');
  const okA = await shoot({ file: fa, root: '.box', width: 200, out: a });
  const okB = await shoot({ file: fb, root: '.box', width: 200, out: b });
  assert.ok(okA && okB, 'chromium was independently confirmed available — shoot() must not fail');
  const res = await pixdiff({ a, b, out: join(dir, 'd.png') });
  assert.equal(res.mismatch, 0.49);
  assert.equal(res.reported, false, 'mismatch just under the floor must be absorbed as AA noise, per spec §9.4');

  // Same pixels, but a caller-supplied floor below 0.49 must flip the verdict
  // — proves `floor` is a real parameter, not a value the comparator ignores
  // in favour of a hardcoded 0.5.
  const res2 = await pixdiff({ a, b, out: join(dir, 'd2.png'), floor: 0.4 });
  assert.equal(res2.mismatch, 0.49);
  assert.equal(res2.reported, true, 'a lower explicit floor must make the same mismatch reportable');
});

test('the output heatmap is sized to the union of the two inputs, in either argument order', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'fid-'));
  const big = join(dir, 'big.png'), small = join(dir, 'small.png');
  const okBig = await shoot({ file: FIX + 'widths.html', root: '.hero', width: 1440, out: big });
  const okSmall = await shoot({ file: FIX + 'widths.html', root: '.hero', width: 375, out: small });
  assert.ok(okBig && okSmall, 'chromium was independently confirmed available — shoot() must not fail');
  const sBig = pngSize(big), sSmall = pngSize(small);
  const wantW = Math.max(sBig.width, sSmall.width);
  const wantH = Math.max(sBig.height, sSmall.height);

  // A mutation that drops `Math.max` in favour of just the first argument's
  // size would pass this ordering by accident (big is already the max in
  // both dimensions) — the mirrored call below closes that gap by making
  // the SMALLER image the first argument, so only a genuine union survives.
  const d1 = join(dir, 'd1.png');
  await pixdiff({ a: big, b: small, out: d1 });
  const s1 = pngSize(d1);
  assert.equal(s1.width, wantW);
  assert.equal(s1.height, wantH);

  const d2 = join(dir, 'd2.png');
  await pixdiff({ a: small, b: big, out: d2 });
  const s2 = pngSize(d2);
  assert.equal(s2.width, wantW, 'union must hold with the smaller image passed as `a`');
  assert.equal(s2.height, wantH, 'union must hold with the smaller image passed as `a`');
});

// --- classifyPixdiffExit: pure boundary coverage ---------------------------
//
// The CLI's exit-2 branch ("Playwright/Chromium is genuinely unavailable")
// cannot be exercised by spawning the real CLI in this environment — every
// box that runs this suite already has Chromium installed, the identical
// constraint Task 4/measure.mjs hit for its launch-classification tests.
// classifyPixdiffExit is the CLI's actual branching decision (isMain calls
// it, does not reimplement it), so pinning it here with fabricated inputs
// tests the real logic, not a parallel copy of it.

test('classifyPixdiffExit: playwright unavailable is always exit 2, even with a legitimate result', () => {
  assert.equal(classifyPixdiffExit({ playwrightOk: false, result: null }), 2);
  assert.equal(classifyPixdiffExit({ playwrightOk: false, result: { mismatch: 0, reported: false, out: 'x' } }), 2,
    'unavailable must win over a truthy result — the CLI never calls pixdiff() when playwrightOk is false, but the classifier must not depend on that call order to be correct');
});

test('classifyPixdiffExit: playwright available but pixdiff() returned null is exit 3', () => {
  assert.equal(classifyPixdiffExit({ playwrightOk: true, result: null }), 3);
});

test('classifyPixdiffExit: playwright available and a real result is exit 0', () => {
  assert.equal(classifyPixdiffExit({ playwrightOk: true, result: { mismatch: 1.2, reported: true, out: 'd.png' } }), 0);
});

// --- CLI entrypoint (subprocess) -------------------------------------------

test('the pixdiff CLI writes the heatmap and the JSON, and the summary line reports the mismatch percentage', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const a = join(dir, 'a.png'), b = join(dir, 'b.png'), out = join(dir, 'd.png'), jsonPath = join(dir, 'r.json');
  const okA = await shoot({ file: FIX + 'reference.html', root: '.hero', width: 1440, out: a });
  const okB = await shoot({ file: FIX + 'drifted.html', root: '.hero', width: 1440, out: b });
  assert.ok(okA && okB, 'chromium was independently confirmed available — shoot() must not fail');

  const res = spawnSync(process.execPath, [CLI, '--a', a, '--b', b, '--out', out, '--json', jsonPath], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}; stderr: ${res.stderr}`);
  assert.ok(existsSync(out), 'a heatmap PNG must be written');
  assert.ok(existsSync(jsonPath), 'the --json result file must be written');

  const result = JSON.parse(readFileSync(jsonPath, 'utf8'));
  assert.ok(result.mismatch > 1, `expected a visible difference, got ${result.mismatch}%`);
  assert.equal(result.reported, true);
  assert.equal(result.out, out);
  assert.match(res.stderr, /%/, 'the summary line on stderr must report the mismatch percentage');
  assert.match(res.stderr, new RegExp(String(result.mismatch).replace('.', '\\.')),
    'the stderr summary must report the SAME mismatch number written to --json, not a different computation');
});

test('without --json the result is written to stdout as JSON', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const a = join(dir, 'a.png'), out = join(dir, 'd.png');
  const okA = await shoot({ file: FIX + 'reference.html', root: '.hero', width: 1440, out: a });
  assert.ok(okA, 'chromium was independently confirmed available — shoot() must not fail');

  const res = spawnSync(process.execPath, [CLI, '--a', a, '--b', a, '--out', out], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.mismatch, 0);
  assert.equal(parsed.reported, false);
});

test('a missing input file exits 3, not 0', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const missing = join(dir, 'does-not-exist.png');
  const b = join(dir, 'b.png');
  const okB = await shoot({ file: FIX + 'reference.html', root: '.hero', width: 1440, out: b });
  assert.ok(okB, 'chromium was independently confirmed available — shoot() must not fail');

  const res = spawnSync(process.execPath, [CLI, '--a', missing, '--b', b, '--out', join(dir, 'd.png')], { encoding: 'utf8' });
  assert.equal(res.status, 3, `expected exit 3 for a missing input file, got ${res.status}; stderr: ${res.stderr}`);
  assert.notEqual(res.status, 0, 'a missing input file must never report a false success');
  assert.match(res.stderr, /comparison failed/i);
});
