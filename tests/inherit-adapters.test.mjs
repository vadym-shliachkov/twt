import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  detectStylingSystem, nearestStep, adaptTokens, renderTokenMap, tokenFamily,
} from '../tools/inherit/adapters.mjs';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../tools/inherit/adapters.mjs', import.meta.url));

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
  assert.equal(row.became, 'spacing.24');
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
  assert.equal(row.became, 'spacing.92');
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

test('nearestStep breaks a tie toward the smaller step on a REAL fractional Tailwind scale', () => {
  // Tailwind's actual default spacing scale has fractional keys (0.5, 1.5,
  // 2.5, ...). Those are not canonical integer object keys, so plain objects
  // enumerate them in INSERTION order, not value order — this scale is
  // deliberately built out of ascending-value order to prove the tie-break
  // doesn't secretly depend on how the caller happened to write the object
  // literal. 7 is equidistant from 6 (key 1.5) and 8 (key 2): must pick 1.5.
  const scale = { '0.5': 2, '1': 4, '1.5': 6, '2': 8, '2.5': 10, '3': 12 };
  assert.deepEqual(nearestStep(7, scale), { key: '1.5', value: 6, delta: -1 });
});

test('nearestStep finds the true nearest on a fractional scale inserted in descending order', () => {
  // Same fractional-key scale, but written in descending insertion order —
  // and a non-tie lookup, so this pins ordinary (non-tie) correctness against
  // the same insertion-order hazard, not just the tie-break case above.
  const scale = { '3': 12, '2.5': 10, '2': 8, '1.5': 6, '1': 4, '0.5': 2 };
  assert.deepEqual(nearestStep(9.5, scale), { key: '2.5', value: 10, delta: 0.5 });
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
  assert.equal(row.became, 'spacing.24');
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

// ---------------------------------------------------------------------------
// Token-family classification (final-review Critical C2). The adapter used to
// match on the VALUE alone (`^-?[\d.]+px$`) and snap every hit against the
// spacing scale as `py-<key>`, so a radius, a border width and a font size all
// silently became vertical padding while token-map.md reported zero unmapped
// and perfect fidelity. Every pre-existing test used `--space-*` names, so the
// whole suite stayed green on the happy naming. These pin the classifier.
// ---------------------------------------------------------------------------

const TAILWIND_SCALE = {
  spacing: { 1: 4, 2: 8, 4: 16, 6: 24, 12: 48 },
};

test('a radius token is NEVER turned into vertical padding', () => {
  const { map } = adaptTokens({ '--radius-lg': '16px' },
    { system: 'tailwind', hostScale: TAILWIND_SCALE, mode: 'host' });
  const row = map[0];
  assert.doesNotMatch(String(row.became), /^py-/, '--radius-lg must not become a py-* utility');
  assert.equal(row.status, 'unmapped', 'no borderRadius scale was supplied, so the honest answer is unmapped');
  assert.match(row.note, /borderRadius/, 'the note must name the family that could not be mapped');
});

test('a border-width token is NEVER turned into vertical padding', () => {
  const { map } = adaptTokens({ '--border-width': '2px' },
    { system: 'tailwind', hostScale: TAILWIND_SCALE, mode: 'host' });
  const row = map[0];
  assert.doesNotMatch(String(row.became), /^py-/);
  assert.equal(row.status, 'unmapped');
  assert.match(row.note, /borderWidth/);
});

test('a font-size token is NEVER turned into vertical padding', () => {
  const { map } = adaptTokens({ '--font-size-h1': '48px' },
    { system: 'tailwind', hostScale: TAILWIND_SCALE, mode: 'host' });
  const row = map[0];
  assert.doesNotMatch(String(row.became), /^py-/, '--font-size-h1 must not become py-12');
  assert.notEqual(row.became, 'py-12');
  assert.equal(row.status, 'unmapped');
  assert.match(row.note, /fontSize/);
});

test('the realistic four-token mix reports the loss instead of hiding it', () => {
  // Reproduces the review's exact evidence table. Before the fix this printed
  // "4 mapped · 0 unmapped" with py-4 / py-1 / py-12 / py-6.
  const { map } = adaptTokens({
    '--radius-lg': '16px', '--border-width': '2px',
    '--font-size-h1': '48px', '--space-6': '24px',
  }, { system: 'tailwind', hostScale: TAILWIND_SCALE, mode: 'host' });
  const by = Object.fromEntries(map.map((r) => [r.token, r]));
  assert.equal(by['--space-6'].status, 'mapped');
  assert.equal(by['--space-6'].became, 'spacing.6');
  for (const t of ['--radius-lg', '--border-width', '--font-size-h1']) {
    assert.equal(by[t].status, 'unmapped', `${t} has no host scale to map onto`);
    assert.equal(by[t].became, null);
  }
  const md = renderTokenMap(map, { system: 'tailwind', mode: 'host' });
  assert.match(md, /3 unmapped/, 'the loss must be counted, not reported as clean');
  // The rendered Became column, not the prose legend (which names `py-` as one
  // of the prefixes a builder may CHOOSE — that is guidance, not a mapping).
  assert.deepEqual(map.map((r) => r.became).filter(Boolean), ['spacing.6']);
  for (const r of map) assert.doesNotMatch(String(r.became), /py-/);
});

test('a non-spacing family IS mapped once the host supplies that scale', () => {
  const { map } = adaptTokens({ '--font-size-h1': '48px', '--radius-lg': '16px' }, {
    system: 'tailwind',
    hostScale: { spacing: { 6: 24 }, fontSize: { '5xl': 48 }, borderRadius: { lg: 16 } },
    mode: 'host',
  });
  const by = Object.fromEntries(map.map((r) => [r.token, r]));
  assert.equal(by['--font-size-h1'].became, 'fontSize.5xl');
  assert.equal(by['--font-size-h1'].status, 'mapped');
  assert.equal(by['--radius-lg'].became, 'borderRadius.lg');
  assert.equal(by['--radius-lg'].status, 'mapped');
});

test('a spacing token emits the bare scale key, never a chosen direction', () => {
  // Picking `py-` unilaterally is the same class of error as picking the wrong
  // scale: this module cannot know whether a spacing value is padding, margin,
  // or a flex gap. It names the scale entry; the builder picks the utility.
  const { map } = adaptTokens({ '--space-6': '24px' },
    { system: 'tailwind', hostScale: TAILWIND_SCALE, mode: 'host' });
  assert.equal(map[0].became, 'spacing.6');
  assert.doesNotMatch(map[0].became, /^(p|py|px|m|my|mx|gap)-/);
});

test('a token whose name names no family is unmapped with a note, never guessed at', () => {
  const { map } = adaptTokens({ '--zort': '12px' },
    { system: 'tailwind', hostScale: TAILWIND_SCALE, mode: 'host' });
  assert.equal(map[0].status, 'unmapped');
  assert.equal(map[0].became, null);
  assert.match(map[0].note, /no known design family/i);
});

test('tokenFamily resolves the specific family ahead of the general one', () => {
  assert.equal(tokenFamily('--space-6'), 'spacing');
  assert.equal(tokenFamily('--gap'), 'spacing');
  assert.equal(tokenFamily('--font-size-h1'), 'fontSize', 'font beats size');
  assert.equal(tokenFamily('--border-radius-lg'), 'borderRadius', 'radius beats border');
  assert.equal(tokenFamily('--border-width'), 'borderWidth');
  assert.equal(tokenFamily('--shadow-lg'), 'boxShadow');
  assert.equal(tokenFamily('--color-brand'), 'colors');
  assert.equal(tokenFamily('--icon-size-md'), 'size');
  assert.equal(tokenFamily('--zort'), null);
});

test('exact mode extends the RIGHT scale, not always spacing', () => {
  const { artifacts, map } = adaptTokens({ '--radius-xl': '20px' }, {
    system: 'tailwind',
    hostScale: { spacing: { 4: 16, 6: 24 }, borderRadius: { lg: 16 } },
    mode: 'exact',
  });
  assert.equal(map[0].status, 'mapped');
  assert.equal(map[0].became, 'borderRadius.20');
  const config = artifacts.find((a) => /tailwind\.config/.test(a.path));
  assert.ok(config, 'exact mode must emit a config extension');
  assert.match(config.contents, /"borderRadius"/, 'the extension must land under borderRadius');
  assert.doesNotMatch(config.contents, /"spacing"/, 'a radius must never extend the spacing scale');
});

test('nearestStep survives an undefined scale instead of throwing', () => {
  // nearestStep is exported, so a caller reaching a family the host never
  // supplied passes undefined. The documented contract is null, not TypeError.
  assert.equal(nearestStep(12, undefined), null);
});

// --- CLI entrypoint (task 3: adapters.mjs is reachable from a skill's Bash
// calls, mirroring scan.mjs's library-plus-isMain shape) -------------------

test('the CLI writes token-map.md and reports the summary on stderr', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inherit-adapt-'));
  const scanPath = join(dir, 'detection.json');
  const tokensPath = join(dir, 'tokens.css');
  writeFileSync(scanPath, JSON.stringify({ signals: [] }));
  writeFileSync(tokensPath, ':root {\n  --space-1: 4px;\n}\n');
  const out = join(dir, 'out');
  const { stderr } = await run('node', [CLI, '--scan', scanPath, '--tokens', tokensPath, '--out', out]);
  assert.ok(existsSync(join(out, 'token-map.md')), 'token-map.md must be written');
  const md = readFileSync(join(out, 'token-map.md'), 'utf8');
  assert.match(md, /--space-1/);
  assert.match(stderr, /system none/i);
  assert.match(stderr, /1 mapped/);
});

test('a missing tokens file exits 3, not 0 and not a crash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inherit-adapt-'));
  const scanPath = join(dir, 'detection.json');
  writeFileSync(scanPath, JSON.stringify({ signals: [] }));
  const out = join(dir, 'out');
  await assert.rejects(
    () => run('node', [CLI, '--scan', scanPath, '--tokens', join(dir, 'does-not-exist.css'), '--out', out]),
    (e) => e.code === 3 && /no tokens file/i.test(e.stderr || ''),
  );
  assert.ok(!existsSync(join(out, 'token-map.md')), 'nothing should be written on the exit-3 path');
});

test('missing required flags is a usage error, exit 2', async () => {
  await assert.rejects(() => run('node', [CLI]), (e) => e.code === 2);
});

test('the stderr summary names the unmapped count when a token has no host equivalent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inherit-adapt-'));
  const scanPath = join(dir, 'detection.json');
  const tokensPath = join(dir, 'tokens.css');
  // tailwind, high confidence, and no --host-style file at all — tailwindRow's
  // "host has no spacing scale" branch fires, so --space-6 is unmapped.
  writeFileSync(scanPath, JSON.stringify({
    signals: [{ claim: 'tailwind', confidence: 'high', evidence: ['a', 'b'] }],
  }));
  writeFileSync(tokensPath, ':root {\n  --space-6: 92px;\n}\n');
  const out = join(dir, 'out');
  const { stderr } = await run('node', [CLI, '--scan', scanPath, '--tokens', tokensPath, '--out', out]);
  assert.match(stderr, /1 unmapped/, 'the unmapped count must be visible, never buried');
  const md = readFileSync(join(out, 'token-map.md'), 'utf8');
  assert.match(md, /## Unmapped/);
});

test('--host-style supplies the host spacing scale the CLI maps against', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inherit-adapt-'));
  const scanPath = join(dir, 'detection.json');
  const tokensPath = join(dir, 'tokens.css');
  const hostStylePath = join(dir, 'host-style.json');
  writeFileSync(scanPath, JSON.stringify({
    signals: [{ claim: 'tailwind', confidence: 'high', evidence: ['a', 'b'] }],
  }));
  writeFileSync(tokensPath, ':root {\n  --space-6: 92px;\n}\n');
  writeFileSync(hostStylePath, JSON.stringify({ scale: { spacing: { 20: 80, 24: 96 } } }));
  const out = join(dir, 'out');
  const { stderr } = await run('node',
    [CLI, '--scan', scanPath, '--tokens', tokensPath, '--out', out, '--host-style', hostStylePath]);
  assert.match(stderr, /1 snapped/, '92px must snap onto the host scale supplied via --host-style, not go unmapped');
});
