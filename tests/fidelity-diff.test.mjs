import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeElement, makeSpec } from '../tools/fidelity/spec.mjs';
import { matchElements, diffSpec, toSummary, scoreOf, SUMMARY_MAX_ROWS } from '../tools/fidelity/diff.mjs';

const el = (id, over = {}) => makeElement({ id, ...over });

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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
    elements: [el('hero.0', { children: ['hero.title.0', 'hero.cta.0'] })],
  });
  const got = [el('hero.0', { children: ['hero.title.0', 'hero.cta.0'] })];
  const { rows } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  assert.equal(rows.find((r) => r.prop === 'children'), undefined);
});

test('system mode downgrades a token-snap delta to warn and labels it', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
  const spec = makeSpec({ target: 't', source: { kind: 'url', ref: 'x' }, widths: [1440], elements });
  const got = elements.map((e) => el(e.id, { type: { size: 12 } }));
  const summary = toSummary(diffSpec(spec, got, { mode: 'system', width: 1440 }), {});
  assert.ok(summary.rows.length <= SUMMARY_MAX_ROWS, `got ${summary.rows.length}`);
  assert.ok(summary.truncated > 0, 'must report how many rows were withheld');
  assert.equal(JSON.stringify(summary).includes('<'), false, 'summary must be markup-free');
});

test('toSummary keeps failures before warnings when it truncates', () => {
  const elements = Array.from({ length: 300 }, (_, i) => el(`row.${i}`, { type: { size: 20 } }));
  const spec = makeSpec({ target: 't', source: { kind: 'url', ref: 'x' }, widths: [1440], elements });
  // First 5 drift far (fail); the rest drift by 1px (warn).
  const got = elements.map((e, i) => el(e.id, { type: { size: i < 5 ? 8 : 19 } }));
  const summary = toSummary(diffSpec(spec, got, { mode: 'system', width: 1440 }), {});
  const kept = summary.rows.filter((r) => r.status === 'fail').length;
  assert.equal(kept, 5, 'every failure must survive truncation');
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
  const spec = makeSpec({ target: 't', source: { kind: 'url', ref: 'x' }, widths: [1440], elements });
  const got = elements.map((e) => el(e.id, { type: { size: 12 } }));
  const summary = toSummary(diffSpec(spec, got, { mode: 'system', width: 1440 }), {});
  assert.equal(summary.rows.length, SUMMARY_MAX_ROWS);
  assert.equal(summary.truncated, 0);
});

test('toSummary truncates exactly one row over the SUMMARY_MAX_ROWS cap', () => {
  const elements = Array.from({ length: SUMMARY_MAX_ROWS + 1 }, (_, i) => el(`row.${i}`, { type: { size: 20 } }));
  const spec = makeSpec({ target: 't', source: { kind: 'url', ref: 'x' }, widths: [1440], elements });
  const got = elements.map((e) => el(e.id, { type: { size: 12 } }));
  const summary = toSummary(diffSpec(spec, got, { mode: 'system', width: 1440 }), {});
  assert.equal(summary.rows.length, SUMMARY_MAX_ROWS);
  assert.equal(summary.truncated, 1);
});

test('a caller-supplied maxRows below the default is honoured and reported as truncated', () => {
  const elements = Array.from({ length: 10 }, (_, i) => el(`row.${i}`, { type: { size: 20 } }));
  const spec = makeSpec({ target: 't', source: { kind: 'url', ref: 'x' }, widths: [1440], elements });
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
  const spec = makeSpec({ target: 't', source: { kind: 'url', ref: 'x' }, widths: [1440], elements });
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero-section', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
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
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
    elements: [el('hero.0', { spacing: { padding: [] } })],
  });
  const got = [el('hero.0', { spacing: { padding: [] } })];
  const { rows, counts } = diffSpec(spec, got, { mode: 'system', width: 1440 });
  assert.equal(rows.find((r) => r.prop === 'spacing.padding'), undefined);
  assert.equal(Object.keys(counts).includes('undefined'), false);
});
