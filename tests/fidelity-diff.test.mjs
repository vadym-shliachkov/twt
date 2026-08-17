import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeElement, makeSpec } from '../tools/fidelity/spec.mjs';
import { matchElements, diffSpec, toSummary, scoreOf, SUMMARY_MAX_ROWS } from '../tools/fidelity/diff.mjs';

const el = (id, over = {}) => makeElement({ id, ...over });
const DIFF_CLI = fileURLToPath(new URL('../tools/fidelity/diff.mjs', import.meta.url));

// The CLI reads the reference spec straight off disk, in the shape
// twt-fidelity-fetch (Task 7) actually writes it: `widths` is an OBJECT keyed
// by pixel width, each value the elements array captured at that width — NOT
// spec.mjs's makeSpec() shape used everywhere else in this file (`widths: [array
// of numbers]` + a flat top-level `elements`), which is a unit-test convenience
// for calling diffSpec()/toSummary() directly with one width's slice already
// picked out. The brief's own Step 2 CLI test built its fixture with makeSpec()
// and would have produced `spec.widths['1440'] === undefined` (array indexed by
// a string key past its length) the moment the CLI tried to pair widths — an
// eighth brief defect in this plan (the cross-task fact about the widths-keyed
// map was right; the test fixture illustrating it used the wrong constructor).
// Every fixture below is hand-built in the real on-disk shape instead.
const onDiskSpec = ({ target, source, provenance, widths }) => ({
  schema: 'twt-fidelity/1', target, source, provenance, widths,
});

test('elements match on the data-fid stamp regardless of order', () => {
  const ref = [el('hero.title.0'), el('hero.cta.0')];
  const got = [el('hero.cta.0'), el('hero.title.0')];
  const { pairs, unmatchedRef, unmatchedGot } = matchElements(ref, got);
  assert.equal(pairs.length, 2);
  assert.ok(pairs.every((p) => p.how === 'stamp'));
  assert.deepEqual(unmatchedRef, []);
  assert.deepEqual(unmatchedGot, []);
});

test('an unstamped element falls back to heuristic matching and is flagged', () => {
  const ref = [el('hero.title.0', { box: { x: 0, y: 0, w: 400, h: 60 }, text: 'Build faster' })];
  const got = [el('__unstamped__0', { box: { x: 0, y: 2, w: 402, h: 60 }, text: 'Build faster' })];
  const { pairs } = matchElements(ref, got);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].how, 'heuristic');
});

test('heuristic matching refuses a pair that is nowhere near', () => {
  const ref = [el('hero.title.0', { box: { x: 0, y: 0, w: 400, h: 60 }, text: 'Build faster' })];
  const got = [el('__unstamped__0', { box: { x: 900, y: 1400, w: 40, h: 12 }, text: 'Privacy' })];
  const { pairs, unmatchedRef, unmatchedGot } = matchElements(ref, got);
  assert.equal(pairs.length, 0);
  assert.equal(unmatchedRef.length, 1);
  assert.equal(unmatchedGot.length, 1);
});

test('diffSpec produces one row per compared property with its group', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.title.0', { type: { size: 56, lineHeight: 64, family: 'Inter' } })],
  });
  const got = [el('hero.title.0', { type: { size: 48, lineHeight: 64, family: 'Inter' } })];
  const { rows } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  const sizeRow = rows.find((r) => r.prop === 'type.size');
  assert.equal(sizeRow.status, 'fail');
  assert.equal(sizeRow.delta, -8);
  assert.equal(sizeRow.group, 'typography');
  assert.equal(sizeRow.width, 1440);
  assert.equal(rows.find((r) => r.prop === 'type.lineHeight').status, 'pass');
});

test('a missing element is a structural failure, not a silent skip', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.title.0'), el('hero.cta.0')],
  });
  const { rows, counts } = diffSpec(spec, [el('hero.title.0')], { mode: 'system', width: 1440 });
  const structural = rows.find((r) => r.id === 'hero.cta.0' && r.prop === 'element');
  assert.equal(structural.status, 'fail');
  assert.equal(structural.group, 'structure');
  assert.ok(counts.fail >= 1);
});

test('reordered children fail even when every child is styled identically', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { children: ['hero.title.0', 'hero.cta.0'] })],
  });
  const got = [el('hero.0', { children: ['hero.cta.0', 'hero.title.0'] })];
  const { rows } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  const order = rows.find((r) => r.prop === 'children');
  assert.equal(order.status, 'fail');
  assert.equal(order.group, 'structure');
  assert.match(order.ref, /hero\.title\.0,hero\.cta\.0/);
});

test('identical children order produces no structural row at all', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { children: ['hero.title.0', 'hero.cta.0'] })],
  });
  const got = [el('hero.0', { children: ['hero.title.0', 'hero.cta.0'] })];
  const { rows } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  assert.equal(rows.find((r) => r.prop === 'children'), undefined);
});

test('system mode downgrades a token-snap delta to warn and labels it', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { spacing: { padding: [92, 0, 92, 0] } })],
  });
  const got = [el('hero.0', {
    spacing: { padding: [96, 0, 96, 0] },
    tokens: { 'spacing.padding': '--space-6' },
  })];
  const { rows } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  const row = rows.find((r) => r.prop === 'spacing.padding');
  assert.equal(row.status, 'warn');
  assert.match(row.snapped, /--space-6/);
  assert.match(row.snapped, /92/);
  assert.match(row.snapped, /96/);
});

test('strict mode promotes that same snap to a failure', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { spacing: { padding: [92, 0, 92, 0] } })],
  });
  const got = [el('hero.0', {
    spacing: { padding: [96, 0, 96, 0] },
    tokens: { 'spacing.padding': '--space-6' },
  })];
  const { rows } = diffSpec(spec, got, { mode: 'strict', width: 1440 });
  const row = rows.find((r) => r.prop === 'spacing.padding');
  assert.equal(row.status, 'fail');
  assert.match(row.snapped, /--space-6/);
});

test('the same delta is reported in both modes - only severity differs', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { spacing: { padding: [92, 0, 92, 0] } })],
  });
  const got = [el('hero.0', {
    spacing: { padding: [96, 0, 96, 0] }, tokens: { 'spacing.padding': '--space-6' },
  })];
  const a = diffSpec(spec, got, { mode: 'system', width: 1440 }).rows.find((r) => r.prop === 'spacing.padding');
  const b = diffSpec(spec, got, { mode: 'strict', width: 1440 }).rows.find((r) => r.prop === 'spacing.padding');
  assert.deepEqual(a.delta, b.delta);
  assert.notEqual(a.status, b.status);
});

test('score weights are geometry 30 / typography 25 / structure 25 / colour 20', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { type: { size: 56 }, fill: { color: '#000000' } })],
  });
  const perfect = diffSpec(spec, [el('hero.0', { type: { size: 56 }, fill: { color: '#000000' } })],
    { mode: 'system', width: 1440 });
  assert.equal(perfect.score.health, 100);
  assert.equal(perfect.score.band, 'Pass');
  assert.deepEqual(perfect.score.weights,
    { geometry: 30, typography: 25, structure: 25, colour: 20 });
});

test('toSummary caps rows and never carries markup', () => {
  const elements = Array.from({ length: 400 }, (_, i) => el(`row.${i}`, { type: { size: 20 } }));
  const spec = makeSpec({ target: 't', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440], elements });
  const got = elements.map((e) => el(e.id, { type: { size: 12 } }));
  const summary = toSummary(diffSpec(spec, got, { mode: 'system', width: 1440 }), {});
  assert.ok(summary.rows.length <= SUMMARY_MAX_ROWS, `got ${summary.rows.length}`);
  assert.ok(summary.truncated > 0, 'must report how many rows were withheld');
  assert.equal(JSON.stringify(summary).includes('<'), false, 'summary must be markup-free');
});

test('toSummary keeps failures before warnings when it truncates', () => {
  const elements = Array.from({ length: 300 }, (_, i) => el(`row.${i}`, { type: { size: 20 } }));
  const spec = makeSpec({ target: 't', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440], elements });
  // First 5 drift far (fail); the rest drift by 1px (warn).
  const got = elements.map((e, i) => el(e.id, { type: { size: i < 5 ? 8 : 19 } }));
  const summary = toSummary(diffSpec(spec, got, { mode: 'system', width: 1440 }), {});
  const kept = summary.rows.filter((r) => r.status === 'fail').length;
  assert.equal(kept, 5, 'every failure must survive truncation');
});

test('toSummary defaults pixdiff to null when the caller supplies none', () => {
  const spec = makeSpec({ target: 't', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { type: { size: 56 } })] });
  const summary = toSummary(diffSpec(spec, [el('hero.0', { type: { size: 56 } })], { mode: 'system', width: 1440 }), {});
  assert.equal(summary.pixdiff, null);
  assert.ok(Object.keys(summary).includes('pixdiff'), 'pixdiff must be an explicit null key, not simply absent');
});

test('toSummary carries a caller-supplied pixdiff through unchanged', () => {
  const spec = makeSpec({ target: 't', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { type: { size: 56 } })] });
  const pixdiff = { mismatch: 2.5, reported: true, out: 'diff/iter-1-1440.png' };
  const summary = toSummary(diffSpec(spec, [el('hero.0', { type: { size: 56 } })], { mode: 'system', width: 1440 }), { pixdiff });
  assert.deepEqual(summary.pixdiff, pixdiff);
});

// --- Extra boundary + regression coverage beyond the brief -----------------
// Standing instruction (progress.md, Task 3 dispatch): the brief's tests are a
// floor, not a ceiling. Every threshold this module compares against gets an
// assertion pinned just above and just below it.

test('heuristic matcher accepts a pair scoring just above the 0.55 accept threshold', () => {
  // heuristicScore = pos*0.3 + size*0.3 + text*0.25 + role*0.15.
  // Same size (size=1), mismatched text (text=0), both roles null (role=0.5),
  // y identical (near_y=1) isolates the threshold to box.x alone.
  // dx=160 -> near_x = 1-160/200 = 0.2 -> pos=(0.2+1)/2=0.6
  // score = 0.3*0.6 + 0.3*1 + 0 + 0.15*0.5 = 0.18+0.3+0.075 = 0.555 (> 0.55, accepted)
  const ref = [el('hero.title.0', { box: { x: 0, y: 0, w: 200, h: 50 }, text: 'Foo' })];
  const got = [el('__unstamped__0', { box: { x: 160, y: 0, w: 200, h: 50 }, text: 'Bar' })];
  const { pairs, unmatchedRef, unmatchedGot } = matchElements(ref, got);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].how, 'heuristic');
  assert.deepEqual(unmatchedRef, []);
  assert.deepEqual(unmatchedGot, []);
});

test('heuristic matcher rejects a pair scoring just below the 0.55 accept threshold', () => {
  // Same construction as above but dx=170 -> near_x = 1-170/200 = 0.15
  // -> pos=(0.15+1)/2=0.575 -> score = 0.3*0.575+0.3+0.075 = 0.5475 (< 0.55, refused)
  const ref = [el('hero.title.0', { box: { x: 0, y: 0, w: 200, h: 50 }, text: 'Foo' })];
  const got = [el('__unstamped__0', { box: { x: 170, y: 0, w: 200, h: 50 }, text: 'Bar' })];
  const { pairs, unmatchedRef, unmatchedGot } = matchElements(ref, got);
  assert.equal(pairs.length, 0);
  assert.equal(unmatchedRef.length, 1);
  assert.equal(unmatchedGot.length, 1);
});

test('heuristic matcher accepts a pair scoring exactly at the 0.55 accept threshold', () => {
  // Position fully saturated to 0 (dx=300>=200, dy=500>=400 both clamp
  // near() to 0), size matched exactly (1), text matched exactly (1),
  // role present on both but different (0):
  // score = 0*0.3 + 1*0.3 + 1*0.25 + 0*0.15 = 0.55 exactly (verified float-clean).
  // The accept comparison is `>=`, so a score exactly at the threshold must still match.
  const ref = [el('hero.title.0', { box: { x: 0, y: 0, w: 200, h: 50 }, text: 'Same', role: 'button' })];
  const got = [el('__unstamped__0', { box: { x: 300, y: 500, w: 200, h: 50 }, text: 'Same', role: 'link' })];
  const { pairs } = matchElements(ref, got);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].how, 'heuristic');
});

test('toSummary keeps every row exactly at the SUMMARY_MAX_ROWS cap with nothing truncated', () => {
  const elements = Array.from({ length: SUMMARY_MAX_ROWS }, (_, i) => el(`row.${i}`, { type: { size: 20 } }));
  const spec = makeSpec({ target: 't', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440], elements });
  const got = elements.map((e) => el(e.id, { type: { size: 12 } }));
  const summary = toSummary(diffSpec(spec, got, { mode: 'system', width: 1440 }), {});
  assert.equal(summary.rows.length, SUMMARY_MAX_ROWS);
  assert.equal(summary.truncated, 0);
});

test('toSummary truncates exactly one row over the SUMMARY_MAX_ROWS cap', () => {
  const elements = Array.from({ length: SUMMARY_MAX_ROWS + 1 }, (_, i) => el(`row.${i}`, { type: { size: 20 } }));
  const spec = makeSpec({ target: 't', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440], elements });
  const got = elements.map((e) => el(e.id, { type: { size: 12 } }));
  const summary = toSummary(diffSpec(spec, got, { mode: 'system', width: 1440 }), {});
  assert.equal(summary.rows.length, SUMMARY_MAX_ROWS);
  assert.equal(summary.truncated, 1);
});

test('a caller-supplied maxRows below the default is honoured and reported as truncated', () => {
  const elements = Array.from({ length: 10 }, (_, i) => el(`row.${i}`, { type: { size: 20 } }));
  const spec = makeSpec({ target: 't', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440], elements });
  const got = elements.map((e) => el(e.id, { type: { size: 12 } }));
  const summary = toSummary(diffSpec(spec, got, { mode: 'system', width: 1440 }), { maxRows: 3 });
  assert.equal(summary.rows.length, 3);
  assert.equal(summary.truncated, 7);
});

test('all failures survive truncation even when they are interleaved after warnings in row order', () => {
  // Build one fail element sandwiched between many warn elements, at a count
  // just over the cap, so a naive "keep the first N rows" truncation (rather
  // than a fail-before-warn sort) would silently drop the failure.
  const n = SUMMARY_MAX_ROWS + 20;
  const elements = Array.from({ length: n }, (_, i) => el(`row.${i}`, { type: { size: 20 } }));
  const spec = makeSpec({ target: 't', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440], elements });
  // Every element warns (1px drift) except the very last one, which fails hard.
  const got = elements.map((e, i) => el(e.id, { type: { size: i === n - 1 ? 2 : 19 } }));
  const summary = toSummary(diffSpec(spec, got, { mode: 'system', width: 1440 }), {});
  const failRow = summary.rows.find((r) => r.id === `row.${n - 1}`);
  assert.ok(failRow, 'the lone failure, though last in row order, must survive the cap');
  assert.equal(failRow.status, 'fail');
});

// --- Fix-round coverage (reviewer findings on Task 3) ----------------------

test('an unassessed group (zero rows) is null, not a free 5, and Health is renormalized over the assessed groups only', () => {
  // geometry (box defaults) and colour (fill.color) both pass; typography
  // fails hard on type.size; structure has no rows at all (no unmatched
  // elements, no reorder, no layout.* set). Hand-derived expectation:
  //   per = { geometry: 5, typography: 0, structure: null, colour: 5 }
  //   weightSum(assessed) = 30 + 25 + 20 = 75 (structure's 25 excluded)
  //   health = round(((5/5*30) + (0/5*25) + (5/5*20)) / 75 * 100)
  //          = round((30 + 0 + 20) / 75 * 100) = round(66.666...) = 67
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { type: { size: 56 }, fill: { color: '#000000' } })],
  });
  const got = [el('hero.0', { type: { size: 40 }, fill: { color: '#000000' } })];
  const { score } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  assert.equal(score.per.structure, null, 'a group with zero rows must not be graded');
  assert.equal(score.per.geometry, 5);
  assert.equal(score.per.typography, 0);
  assert.equal(score.per.colour, 5);
  assert.equal(score.health, 67, 'must be the exact renormalized integer, not a range');
  assert.equal(score.band, 'Revise');
});

test('a group that entirely fails drops Health by that group\'s renormalized share, not its raw weight', () => {
  // Same base fixture as above but colour fails hard instead of typography;
  // structure again has no rows.
  //   per = { geometry: 5, typography: 5, structure: null, colour: 0 }
  //   weightSum(assessed) = 30 + 25 + 20 = 75
  //   health = round(((5/5*30) + (5/5*25) + (0/5*20)) / 75 * 100)
  //          = round((30 + 25 + 0) / 75 * 100) = round(73.333...) = 73
  // A fully-passing run under the same unassessed-structure shape scores 100
  // (see "score weights are..." test below), so colour failing outright costs
  // 27 points here — not colour's raw 20-point weight, and not 25 (its share
  // of the un-renormalized 100), because the denominator shrank to 75 too.
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { type: { size: 56 }, fill: { color: '#000000' } })],
  });
  const got = [el('hero.0', { type: { size: 56 }, fill: { color: '#ffffff' } })];
  const { score } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  assert.equal(score.per.structure, null);
  assert.equal(score.per.colour, 0);
  assert.equal(score.health, 73, 'must be the exact renormalized integer, not a range');
  assert.equal(score.band, 'Revise');
});

test('scoreOf of zero rows is unassessed everywhere: health null, band "Not assessed", never a number', () => {
  const score = scoreOf([]);
  assert.deepEqual(score.per, { geometry: null, typography: null, structure: null, colour: null });
  assert.equal(score.health, null);
  assert.equal(score.band, 'Not assessed');
  assert.deepEqual(score.weights, { geometry: 30, typography: 25, structure: 25, colour: 20 });
});

test('asymmetric array snap labels the index that actually drifted, not always index 0', () => {
  // Only the third padding value (index 2) drifts; the others are identical.
  // A buggy snapLabel that always reads index 0 would report "92 -> 92, d0"
  // even though the worst-side reduce correctly picked index 2 (92 -> 96).
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { spacing: { padding: [92, 0, 92, 0] } })],
  });
  const got = [el('hero.0', {
    spacing: { padding: [92, 0, 96, 0] },
    tokens: { 'spacing.padding': '--space-6' },
  })];
  const { rows } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  const row = rows.find((r) => r.prop === 'spacing.padding');
  assert.equal(row.status, 'warn');
  assert.match(row.snapped, /--space-6/);
  assert.match(row.snapped, /ref 92 -> token 96, d4/, `expected the drifted index in the label, got: ${row.snapped}`);
  assert.doesNotMatch(row.snapped, /ref 92 -> token 92, d0/, 'must not report the untouched index 0');
});

test('diffSpec carries the reference spec\'s target through to the returned diff', () => {
  const spec = makeSpec({
    target: 'hero-section', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { type: { size: 56 } })],
  });
  const got = [el('hero.0', { type: { size: 56 } })];
  const diff = diffSpec(spec, got, { mode: 'system', width: 1440 });
  assert.equal(diff.target, 'hero-section');
  const summary = toSummary(diff, {});
  assert.equal(summary.target, 'hero-section', 'toSummary must surface the real target, not null');
});

test('a length-mismatched array pair is a definite fail, not an undefined-status row', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { spacing: { padding: [10, 20] } })],
  });
  const got = [el('hero.0', { spacing: { padding: [10, 20, 30] } })];
  const { rows, counts } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  const row = rows.find((r) => r.prop === 'spacing.padding');
  assert.ok(row, 'a length mismatch must still produce a row');
  assert.equal(row.status, 'fail');
  assert.equal(counts.fail, (counts.fail ?? 0), 'counts must not have accumulated an undefined key');
  assert.equal(Object.keys(counts).includes('undefined'), false);
});

test('a zero-length array pair on both sides produces no row (nothing to compare) rather than an undefined-status row', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' }, widths: [1440],
    elements: [el('hero.0', { spacing: { padding: [] } })],
  });
  const got = [el('hero.0', { spacing: { padding: [] } })];
  const { rows, counts } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  assert.equal(rows.find((r) => r.prop === 'spacing.padding'), undefined);
  assert.equal(Object.keys(counts).includes('undefined'), false);
});

// --- CLI entrypoint (Step 3 in the skill: "Diff and render") ---------------

test('the diff CLI writes deltas, summary and both reports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' },
    provenance: { measured: 1, estimated: 0 },
    widths: { 1440: [el('hero.title.0', { type: { size: 56 } })] },
  });
  writeFileSync(join(dir, 'reference-spec.json'), JSON.stringify(spec));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({
    widths: { 1440: [el('hero.title.0', { type: { size: 48 } })] }, how: 'test',
  }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}; stderr: ${res.stderr}`);
  for (const f of ['deltas.json', 'summary.json', 'validation-report.md', 'fidelity-report.html']) {
    assert.ok(existsSync(join(dir, f)), `missing ${f}`);
  }
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  assert.ok(summary.rows.some((r) => r.prop === 'type.size' && r.status === 'fail'));
});

test('the diff CLI honours the estimated filenames', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-est-'));
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'image', path: 'r.png' },
    provenance: { measured: 0, estimated: 1 },
    widths: { 1440: [el('hero.title.0', { type: { size: 56 } })] },
  });
  // Mark the one element estimated directly (spec.mjs's makeElement default is
  // 'measured'; the on-disk shape carries provenance per-element the same way).
  spec.widths['1440'][0].provenance = 'estimated';
  writeFileSync(join(dir, 'reference-spec-estimated.json'), JSON.stringify(spec));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({
    widths: { 1440: [el('hero.title.0', { type: { size: 48 } })] }, how: 'test',
  }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}; stderr: ${res.stderr}`);
  assert.ok(existsSync(join(dir, 'validation-report-estimated.md')));
  assert.ok(!existsSync(join(dir, 'validation-report.md')),
    'an estimated run must never render under the measured filename');
  assert.ok(existsSync(join(dir, 'fidelity-report-estimated.html')));
  assert.ok(!existsSync(join(dir, 'fidelity-report.html')),
    'an estimated run must never render its HTML report under the measured filename either');
});

// --- Boundary + regression coverage beyond the brief ------------------------
// Standing instruction: the brief's tests are a floor, not a ceiling — every
// threshold the CLI compares against gets an assertion, and both CLIs' exit
// codes get boundary coverage. Unlike pixdiff.mjs's exit-2 branch, both exit
// conditions below are deterministic and directly reachable from a real
// subprocess call — no environment-gating or injection seam needed.

test('no reference spec in --dir exits 3, not 0, and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({ widths: { 1440: [] }, how: 'test' }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 3, `expected exit 3, got ${res.status}`);
  assert.match(res.stderr, /no reference spec/);
  assert.ok(!existsSync(join(dir, 'deltas.json')), 'a failed run must not write a partial deltas.json');
});

test('a measured width the reference never captured exits 3, not a silent pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' },
    provenance: { measured: 1, estimated: 0 },
    widths: { 1440: [el('hero.title.0', { type: { size: 56 } })] },
  });
  writeFileSync(join(dir, 'reference-spec.json'), JSON.stringify(spec));
  // measured.json captured 768 — a width the reference spec above never saw.
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({
    widths: { 768: [el('hero.title.0', { type: { size: 48 } })] }, how: 'test',
  }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 3, `expected exit 3, got ${res.status}`);
  assert.match(res.stderr, /reference has no width 768/);
  assert.ok(!existsSync(join(dir, 'deltas.json')));
});

test('the score is computed across every measured width, not just the first (Ruling R2)', () => {
  // JS object keys that look like array indices (bare non-negative integers)
  // always iterate in ASCENDING NUMERIC order regardless of insertion order —
  // so Object.entries(measured.widths) below always yields 768 before 1440.
  // Width 768 fails hard alone (hand-derived health 67, same fixture shape as
  // the "unassessed group" test above); width 1440 matches perfectly alone
  // (health 100). A CLI that reused perWidth[0].score (the R2 regression)
  // would report 67/Revise; the correct renormalized-over-both-widths health
  // is 83/Pass — see the derivation in the comment below.
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const refEl = () => el('hero.0', { type: { size: 56 }, fill: { color: '#000000' } });
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' },
    provenance: { measured: 2, estimated: 0 },
    widths: { 768: [refEl()], 1440: [refEl()] },
  });
  writeFileSync(join(dir, 'reference-spec.json'), JSON.stringify(spec));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({
    widths: {
      768: [el('hero.0', { type: { size: 40 }, fill: { color: '#000000' } })], // fails hard: health 67 alone
      1440: [el('hero.0', { type: { size: 56 }, fill: { color: '#000000' } })], // perfect: health 100 alone
    },
    how: 'test',
  }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  const deltas = JSON.parse(readFileSync(join(dir, 'deltas.json'), 'utf8'));
  // Derivation: geometry rows across both widths all pass (box defaults match
  // on both sides) -> per.geometry = 5. colour: fill.color passes at both
  // widths -> per.colour = 5. typography: type.size passes at 1440, fails at
  // 768 -> credit (1+0)/2 = 0.5 -> per.typography = 2.5. structure: no rows
  // at either width -> null, excluded from the denominator.
  // weightSum(assessed) = 30 + 25 + 20 = 75
  // health = round(((5/5*30) + (2.5/5*25) + (5/5*20)) / 75 * 100)
  //        = round((30 + 12.5 + 20) / 75 * 100) = round(83.333...) = 83
  assert.equal(deltas.score.health, 83,
    'health must be renormalized over BOTH widths\' rows combined, not width 768\'s alone (67) or width 1440\'s alone (100)');
  assert.equal(deltas.score.band, 'Pass');
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  assert.equal(summary.score.health, 83, 'summary.json must carry the SAME renormalized score as deltas.json');
});

test('the validation report lists every assessed width, ascending, never a nonexistent spec.widths[0]', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const refEl = () => el('hero.0', { type: { size: 56 } });
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' },
    provenance: { measured: 2, estimated: 0 },
    widths: { 768: [refEl()], 1440: [refEl()] },
  });
  writeFileSync(join(dir, 'reference-spec.json'), JSON.stringify(spec));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({
    widths: { 768: [refEl()], 1440: [refEl()] }, how: 'test',
  }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  const md = readFileSync(join(dir, 'validation-report.md'), 'utf8');
  assert.match(md, /\*\*Widths:\*\* 768, 1440/,
    'meta.widths must be the ARRAY of assessed widths (renderValidationReport calls .join on it) — ' +
    'spec.widths on disk is the widths-keyed OBJECT, so spec.widths[0] would read a nonexistent key');
  // Only fidelity-report.html embeds the images block (validation-report.md
  // never prints image paths). The primary width must be the WIDEST captured
  // width (1440), not widthsArr[0] (768, the narrowest — JS integer-like
  // object keys always iterate ascending) — a mobile frame is the wrong
  // headline comparison for a design-fidelity report.
  const html = readFileSync(join(dir, 'fidelity-report.html'), 'utf8');
  assert.match(html, /reference\/1440\.png/, 'the images block must use the WIDEST assessed width, not the first key');
  assert.doesNotMatch(html, /reference\/768\.png/, 'must not fall back to the narrowest width either');
  assert.doesNotMatch(html, /undefined\.png/);
});

test('meta.source is rebuilt from the real on-disk shape (source.url), never a literal "undefined"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'url', url: 'https://example.test/hero', root: '.hero' },
    provenance: { measured: 1, estimated: 0 },
    widths: { 1440: [el('hero.title.0', { type: { size: 56 } })] },
  });
  writeFileSync(join(dir, 'reference-spec.json'), JSON.stringify(spec));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({
    widths: { 1440: [el('hero.title.0', { type: { size: 48 } })] }, how: 'test',
  }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  const md = readFileSync(join(dir, 'validation-report.md'), 'utf8');
  // report.mjs reads meta.source.kind + meta.source.ref. twt-fidelity-fetch's
  // real on-disk shape has no `ref` field at all (url/root, or path) — a CLI
  // that passed spec.source through unexamined renders "url `undefined`".
  assert.match(md, /\*\*Source:\*\* url `https:\/\/example\.test\/hero`/);
  assert.doesNotMatch(md, /`undefined`/, 'the Source line must never render the literal string undefined');
});

test('meta.source resolves source.path for the image adapter, the same rebuild rule as the url adapter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'image', path: 'ref-shots/hero.jpg' },
    provenance: { measured: 0, estimated: 1 },
    widths: { 1440: [el('hero.title.0', { type: { size: 56 }, provenance: 'estimated' })] },
  });
  writeFileSync(join(dir, 'reference-spec-estimated.json'), JSON.stringify(spec));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({
    widths: { 1440: [el('hero.title.0', { type: { size: 48 } })] }, how: 'test',
  }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  const md = readFileSync(join(dir, 'validation-report-estimated.md'), 'utf8');
  assert.match(md, /\*\*Source:\*\* image `ref-shots\/hero\.jpg`/);
  assert.doesNotMatch(md, /`undefined`/);
});

test('the images block resolves the actual reference-file extension on disk, never a hardcoded .png', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'image', path: 'r.jpg' },
    provenance: { measured: 0, estimated: 1 },
    widths: { 1440: [el('hero.title.0', { type: { size: 56 }, provenance: 'estimated' })] },
  });
  writeFileSync(join(dir, 'reference-spec-estimated.json'), JSON.stringify(spec));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({
    widths: { 1440: [el('hero.title.0', { type: { size: 48 } })] }, how: 'test',
  }));
  // The image adapter copies the reference under its OWN extension (twt-fidelity-fetch
  // Step 2c) — simulate that here with a real .jpg on disk, no .png anywhere.
  mkdirSync(join(dir, 'reference'), { recursive: true });
  writeFileSync(join(dir, 'reference', '1440.jpg'), 'not a real jpg, just bytes');
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  const html = readFileSync(join(dir, 'fidelity-report-estimated.html'), 'utf8');
  assert.match(html, /reference\/1440\.jpg/, 'must resolve the real .jpg on disk, not assume .png');
  assert.doesNotMatch(html, /reference\/1440\.png/);
});

test('an absent --dir exits 3 with a clean message, not a raw Node stack', () => {
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', join(tmpdir(), 'fid-does-not-exist-' + Date.now())], { encoding: 'utf8' });
  assert.equal(res.status, 3, `expected exit 3, got ${res.status}`);
  assert.match(res.stderr, /--dir not found/);
  assert.doesNotMatch(res.stderr, /at Object/, 'must not leak a raw Node stack trace');
});

test('a --dir with a spec but no measured.json exits 3 with a clean message, not a raw Node stack', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' },
    provenance: { measured: 1, estimated: 0 },
    widths: { 1440: [el('hero.title.0', { type: { size: 56 } })] },
  });
  writeFileSync(join(dir, 'reference-spec.json'), JSON.stringify(spec));
  // measured.json deliberately absent — Step 2 (measure) was never run.
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir], { encoding: 'utf8' });
  assert.equal(res.status, 3, `expected exit 3, got ${res.status}`);
  assert.match(res.stderr, /no measured\.json/);
  assert.doesNotMatch(res.stderr, /at Object/, 'must not leak a raw Node stack trace');
  assert.doesNotMatch(res.stderr, /ENOENT/, 'the guard must fire before the raw fs error would');
});

test('a pixdiff.json in the artifact dir surfaces the pixel-diff percentage in the report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' },
    provenance: { measured: 1, estimated: 0 },
    widths: { 1440: [el('hero.title.0', { type: { size: 56 } })] },
  });
  writeFileSync(join(dir, 'reference-spec.json'), JSON.stringify(spec));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({
    widths: { 1440: [el('hero.title.0', { type: { size: 48 } })] }, how: 'test',
  }));
  writeFileSync(join(dir, 'pixdiff.json'), JSON.stringify({ mismatch: 4.2, reported: true, out: 'diff/iter-1-1440.png' }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  const md = readFileSync(join(dir, 'validation-report.md'), 'utf8');
  assert.match(md, /\*\*Pixel diff:\*\* 4\.2% of pixels differ\./);
  // The skill's contract is "read summary.json and nothing else" — that is
  // only literally true if pixdiff.json's content is folded into summary.json
  // itself, not left as a second file the model must separately open.
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  assert.deepEqual(summary.pixdiff, { mismatch: 4.2, reported: true, out: 'diff/iter-1-1440.png' },
    'summary.json must carry pixdiff.json\'s content directly, not require a second read');
});

test('without a pixdiff.json the report renders cleanly with no pixel-diff line, and summary.json.pixdiff is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' },
    provenance: { measured: 1, estimated: 0 },
    widths: { 1440: [el('hero.title.0', { type: { size: 56 } })] },
  });
  writeFileSync(join(dir, 'reference-spec.json'), JSON.stringify(spec));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({
    widths: { 1440: [el('hero.title.0', { type: { size: 48 } })] }, how: 'test',
  }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  const md = readFileSync(join(dir, 'validation-report.md'), 'utf8');
  assert.doesNotMatch(md, /Pixel diff/, 'the existsSync guard must skip the pixel line, not crash, when pixdiff.json is absent');
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  assert.equal(summary.pixdiff, null, 'summary.json must carry an explicit null, never an omitted key, when no pixdiff.json was written');
});

test('an unassessed run (nothing comparable) reports "not assessed" on stderr, never a literal null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-cli-'));
  const spec = onDiskSpec({
    target: 'hero', source: { kind: 'url', url: 'https://x.test/hero' },
    provenance: { measured: 0, estimated: 0 },
    widths: { 1440: [] },
  });
  writeFileSync(join(dir, 'reference-spec.json'), JSON.stringify(spec));
  writeFileSync(join(dir, 'measured.json'), JSON.stringify({ widths: { 1440: [] }, how: 'test' }));
  const res = spawnSync(process.execPath, [DIFF_CLI, '--dir', dir, '--mode', 'system', '--iteration', '1'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  assert.match(res.stderr, /not assessed/);
  assert.doesNotMatch(res.stderr, /null/i, `stderr must not leak a literal null: ${res.stderr}`);
  const deltas = JSON.parse(readFileSync(join(dir, 'deltas.json'), 'utf8'));
  assert.equal(deltas.score.health, null);
});
