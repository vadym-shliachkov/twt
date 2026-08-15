import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectStylingSystem, nearestStep, adaptTokens, renderTokenMap,
} from '../tools/inherit/adapters.mjs';

const scanWith = (signals, extra = {}) => ({ signals, deps: {}, configs: [], ...extra });

test('tailwind is detected from its signal', () => {
  const r = detectStylingSystem(scanWith([{ claim: 'tailwind', confidence: 'high', evidence: ['x', 'y'] }]));
  assert.equal(r.system, 'tailwind');
  assert.equal(r.confidence, 'high');
});

test('css-modules outranks scss when both are present', () => {
  // A project with sass AND *.module.css authors components as modules; the
  // scss claim is about the compiler, not the authoring idiom.
  const r = detectStylingSystem(scanWith([
    { claim: 'scss', confidence: 'medium', evidence: ['dependency sass'] },
    { claim: 'css-modules', confidence: 'medium', evidence: ['a *.module.css file exists'] },
  ]));
  assert.equal(r.system, 'css-modules');
});

test('no styling signal yields the degraded none system, never a guess', () => {
  const r = detectStylingSystem(scanWith([{ claim: 'wordpress', confidence: 'high', evidence: ['a', 'b'] }]));
  assert.equal(r.system, 'none');
  assert.deepEqual(r.evidence, []);
});

test('nearestStep picks the closest scale entry and reports a signed delta', () => {
  const scale = { 20: 80, 24: 96, 16: 64 };
  assert.deepEqual(nearestStep(92, scale), { key: '24', value: 96, delta: 4 });
  assert.deepEqual(nearestStep(81, scale), { key: '20', value: 80, delta: -1 });
  assert.deepEqual(nearestStep(96, scale), { key: '24', value: 96, delta: 0 });
});

test('nearestStep breaks an exact tie toward the smaller step, deterministically', () => {
  // 88 is equidistant from 80 and 96. Deterministic beats "reasonable".
  assert.deepEqual(nearestStep(88, { 20: 80, 24: 96 }), { key: '20', value: 80, delta: -8 });
});

test('host mode snaps to the nearest step and records the delta', () => {
  const { map } = adaptTokens(
    { '--space-6': '92px' },
    { system: 'tailwind', hostScale: { spacing: { 20: 80, 24: 96 } }, mode: 'host' },
  );
  const row = map.find((r) => r.token === '--space-6');
  assert.equal(row.status, 'snapped');
  assert.equal(row.became, 'py-24');
  assert.equal(row.delta, 4);
});

test('exact mode extends the host scale with a NAMED step, never an arbitrary escape', () => {
  const { artifacts, map } = adaptTokens(
    { '--space-6': '92px' },
    { system: 'tailwind', hostScale: { spacing: { 20: 80, 24: 96 } }, mode: 'exact' },
  );
  const row = map.find((r) => r.token === '--space-6');
  assert.equal(row.status, 'mapped');
  assert.equal(row.delta, 0);
  const config = artifacts.find((a) => /tailwind\.config/.test(a.path));
  assert.ok(config, 'exact mode must emit a tailwind config extension');
  assert.doesNotMatch(JSON.stringify(artifacts), /\[92px\]/,
    'an inline arbitrary-value escape is never acceptable output');
  // `row.became` is the class name renderTokenMap prints into the markdown
  // table a human reads — an arbitrary-value escape there is just as much a
  // failure as one in the generated artifact file, and mutation-testing
  // showed the artifacts-only assertion above does not catch it (see task
  // report: became is never printed into an artifact, so a class-name
  // regression here is invisible to that check alone).
  assert.doesNotMatch(row.became, /\[92px\]/,
    'the class name itself must not be an arbitrary-value escape');
  assert.equal(row.became, 'py-92');
});

test('both modes report the same source value; only the outcome differs', () => {
  // Unlike /twt-fidelity's system/strict (where the DELTA is identical and only
  // severity moves), here the modes genuinely produce different deltas — host
  // snaps and carries the gap, exact extends the scale and closes it to zero.
  // What must not drift is the token's own reported source value.
  const opts = { system: 'tailwind', hostScale: { spacing: { 20: 80, 24: 96 } } };
  const host = adaptTokens({ '--space-6': '92px' }, { ...opts, mode: 'host' }).map[0];
  const exact = adaptTokens({ '--space-6': '92px' }, { ...opts, mode: 'exact' }).map[0];
  assert.equal(host.value, '92px');
  assert.equal(exact.value, '92px');
  assert.equal(host.status, 'snapped');
  assert.equal(exact.status, 'mapped');
  assert.equal(host.delta, 4);
  assert.equal(exact.delta, 0);
});

test('a token colliding with an existing host variable is reported, never redefined', () => {
  const { artifacts, map } = adaptTokens(
    { '--surface': '#111111' },
    { system: 'css-vars', hostVars: { '--surface': '#0b0b0f' }, mode: 'host' },
  );
  const row = map.find((r) => r.token === '--surface');
  assert.equal(row.status, 'collision');
  assert.match(row.note, /already defines/i);
  assert.doesNotMatch(JSON.stringify(artifacts), /--surface:\s*#111111/,
    'the host variable must not be redefined');
});

test('an unmappable token is reported, never silently dropped', () => {
  const { map } = adaptTokens(
    { '--shadow-lg': '0 20px 40px rgba(0,0,0,.4)' },
    { system: 'tailwind', hostScale: { spacing: { 20: 80 } }, mode: 'host' },
  );
  const row = map.find((r) => r.token === '--shadow-lg');
  assert.equal(row.status, 'unmapped');
  assert.ok(row.note && row.note.length > 0, 'an unmapped token must say why');
});

test('every input token appears in the map exactly once', () => {
  const tokens = { '--a': '4px', '--b': '#fff', '--c': 'weird(1)' };
  const { map } = adaptTokens(tokens, { system: 'css-vars', mode: 'host' });
  assert.equal(map.length, 3);
  assert.deepEqual(map.map((r) => r.token).sort(), ['--a', '--b', '--c']);
});

test('css-vars adaptation emits a mergeable file and marks tokens mapped', () => {
  const { artifacts, map } = adaptTokens({ '--space-6': '24px' }, { system: 'css-vars', mode: 'host' });
  assert.equal(map[0].status, 'mapped');
  assert.match(artifacts[0].contents, /--space-6:\s*24px/);
});

test('the none system is degraded and says so in the map', () => {
  const { map } = adaptTokens({ '--space-6': '24px' }, { system: 'none', mode: 'host' });
  assert.match(map[0].note, /degraded|no styling system/i);
});

test('the adapters fit the REAL scanner, not just a synthetic scan object', async () => {
  // Every other test here builds a synthetic scanWith({signals}) object, so a
  // field rename in scan.mjs would leave them all green while the two modules
  // no longer fit together. This is the only test that proves the seam.
  const { scanProject } = await import('../tools/inherit/scan.mjs');
  const { fileURLToPath } = await import('node:url');
  const fix = (n) => fileURLToPath(new URL(`./fixtures/${n}/`, import.meta.url));

  assert.equal(detectStylingSystem(scanProject(fix('inherit-next-tailwind'))).system, 'tailwind');
  assert.equal(detectStylingSystem(scanProject(fix('inherit-vite-modules'))).system, 'css-modules');
  assert.equal(detectStylingSystem(scanProject(fix('inherit-wp-classic'))).system, 'none');
});

test('renderTokenMap reports unmapped counts rather than burying them', () => {
  const rows = [
    { token: '--a', value: '4px', became: 'p-1', status: 'mapped' },
    { token: '--b', value: 'x', became: null, status: 'unmapped', note: 'no equivalent' },
    { token: '--c', value: '92px', became: 'py-24', status: 'snapped', delta: 4 },
  ];
  const md = renderTokenMap(rows, { system: 'tailwind', mode: 'host' });
  assert.match(md, /1 unmapped/);
  assert.match(md, /1 snapped/);
  assert.match(md, /--b/);
  assert.match(md, /no equivalent/);
});

// ---------------------------------------------------------------------------
// Extra coverage beyond the brief (standing instruction: the brief's tests are
// a floor, not a ceiling). nearestStep is compared-against at every threshold:
// below the smallest entry, above the largest, and a single-entry scale — none
// of which the brief's own tests exercise (its cases all land inside the
// scale's range, on a 2-entry scale).
// ---------------------------------------------------------------------------

test('nearestStep clamps to the smallest entry when the value is below every step', () => {
  const scale = { 16: 64, 20: 80, 24: 96 };
  assert.deepEqual(nearestStep(1, scale), { key: '16', value: 64, delta: 63 });
});

test('nearestStep clamps to the largest entry when the value is above every step', () => {
  const scale = { 16: 64, 20: 80, 24: 96 };
  assert.deepEqual(nearestStep(1000, scale), { key: '24', value: 96, delta: -904 });
});

test('nearestStep on a single-entry scale always returns that entry, whichever side the value falls on', () => {
  const scale = { 20: 80 };
  assert.deepEqual(nearestStep(1, scale), { key: '20', value: 80, delta: 79 });
  assert.deepEqual(nearestStep(999, scale), { key: '20', value: 80, delta: -919 });
  assert.deepEqual(nearestStep(80, scale), { key: '20', value: 80, delta: 0 });
});

test('nearestStep on an empty scale has nothing to snap to and returns null', () => {
  assert.equal(nearestStep(50, {}), null);
});

test('a tailwind token with an empty host spacing scale is unmapped, not thrown or crashed on', () => {
  // Exercises nearestStep's null-scale path end-to-end through adaptTokens,
  // since tailwindRow guards this before ever calling nearestStep.
  const { map } = adaptTokens(
    { '--space-1': '4px' },
    { system: 'tailwind', hostScale: { spacing: {} }, mode: 'host' },
  );
  assert.equal(map[0].status, 'unmapped');
  assert.match(map[0].note, /no spacing scale/i);
});

test('exact mode still snaps cleanly (no scale extension) when the value already sits on the host scale', () => {
  const { artifacts, map } = adaptTokens(
    { '--space-6': '96px' },
    { system: 'tailwind', hostScale: { spacing: { 20: 80, 24: 96 } }, mode: 'exact' },
  );
  const row = map.find((r) => r.token === '--space-6');
  assert.equal(row.status, 'mapped');
  assert.equal(row.delta, 0);
  assert.equal(row.became, 'py-24');
  // No extension was needed, so no config-extension artifact should appear.
  assert.equal(artifacts.find((a) => /tailwind\.config/.test(a.path)), undefined);
});

test('every input token appears in the map exactly once, even through tailwindRow\'s early-return paths', () => {
  // The brief's "every input token appears in the map exactly once" test only
  // exercises system: 'css-vars', whose default branch has no early-return
  // path to lose a token through. tailwindRow DOES have one (an unmappable
  // value, or an empty host scale) — this is the case that actually needs
  // pinning, and mutation-testing confirmed the css-vars version does not
  // catch a regression here (see task report).
  const tokens = { '--a': '4px', '--b': 'not-a-length', '--c': '4px' };
  const { map } = adaptTokens(
    tokens,
    { system: 'tailwind', hostScale: { spacing: {} }, mode: 'host' },
  );
  assert.equal(map.length, 3);
  assert.deepEqual(map.map((r) => r.token).sort(), ['--a', '--b', '--c']);
  assert.ok(map.every((r) => r.status === 'unmapped'), 'empty host scale unmaps every length token too');
});

test('a collision is reported per-system, not just for css-vars', () => {
  // The brief's collision test only exercises system: 'css-vars'. Confirm the
  // hostVars guard applies uniformly and is not accidentally scoped to one
  // system's branch.
  const { map } = adaptTokens(
    { '--brand': '#ff00ff' },
    { system: 'scss', hostVars: { '--brand': '#00ffff' }, mode: 'host' },
  );
  const row = map.find((r) => r.token === '--brand');
  assert.equal(row.status, 'collision');
  assert.match(row.note, /already defines/i);
});
