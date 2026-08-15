// diff.mjs — join reference against measured, apply the comparators, and emit
// a capped, markup-free summary.
//
// Stamped correspondence (data-fid) is the primary path. The heuristic matcher
// exists only for unstamped elements and for grading pages this loop did not
// build: its accuracy degrades exactly as layout drift grows, so it is least
// trustworthy when it matters most. Every heuristic pair is flagged as such.
'use strict';
import { PROPERTY_GROUPS } from './spec.mjs';
import { compareProperty, TOLERANCES } from './tolerance.mjs';

export const SUMMARY_MAX_ROWS = 120;
const HEURISTIC_ACCEPT = 0.55;

const WEIGHTS = { geometry: 30, typography: 25, structure: 25, colour: 20 };
const GROUP_OF = new Map(
  Object.entries(PROPERTY_GROUPS).flatMap(([g, props]) => props.map((p) => [p, g])),
);

const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function heuristicScore(a, b) {
  const near = (x, y, scale) => 1 - Math.min(1, Math.abs((x ?? 0) - (y ?? 0)) / scale);
  const pos = (near(a.box.x, b.box.x, 200) + near(a.box.y, b.box.y, 400)) / 2;
  const size = (near(a.box.w, b.box.w, 200) + near(a.box.h, b.box.h, 200)) / 2;
  const text = a.text && b.text ? (a.text.trim() === b.text.trim() ? 1 : 0) : 0.5;
  const role = a.role && b.role ? (a.role === b.role ? 1 : 0) : 0.5;
  return pos * 0.3 + size * 0.3 + text * 0.25 + role * 0.15;
}

export function matchElements(refEls, gotEls) {
  const pairs = [];
  const byId = new Map(gotEls.map((e) => [e.id, e]));
  const usedGot = new Set();
  const leftoverRef = [];

  for (const ref of refEls) {
    const got = byId.get(ref.id);
    if (got && !usedGot.has(got)) {
      pairs.push({ ref, got, how: 'stamp' });
      usedGot.add(got);
    } else {
      leftoverRef.push(ref);
    }
  }

  const leftoverGot = gotEls.filter((e) => !usedGot.has(e));
  const unmatchedRef = [];
  for (const ref of leftoverRef) {
    let best = null, bestScore = 0;
    for (const got of leftoverGot) {
      if (usedGot.has(got)) continue;
      const s = heuristicScore(ref, got);
      if (s > bestScore) { bestScore = s; best = got; }
    }
    if (best && bestScore >= HEURISTIC_ACCEPT) {
      pairs.push({ ref, got: best, how: 'heuristic' });
      usedGot.add(best);
    } else {
      unmatchedRef.push(ref);
    }
  }

  return { pairs, unmatchedRef, unmatchedGot: leftoverGot.filter((e) => !usedGot.has(e)) };
}

// A delta is "explained by a token snap" when the built element records which
// token supplied the value. system mode downgrades it to a warning and labels
// it; strict mode promotes it to a failure whose fix is to add the exact value
// to tokens.css as a real token (never an inlined literal).
function snapLabel(got, prop, ref, val) {
  const token = got.tokens?.[prop];
  if (!token) return null;
  const r = Array.isArray(ref) ? ref[0] : ref;
  const v = Array.isArray(val) ? val[0] : val;
  return `snapped: ${token} (ref ${r} -> token ${v}, d${Math.abs(v - r)})`;
}

export function diffSpec(refSpec, measuredEls, { mode = 'system', width } = {}) {
  const { pairs, unmatchedRef, unmatchedGot } = matchElements(refSpec.elements, measuredEls);
  const rows = [];

  for (const { ref, got, how } of pairs) {
    for (const prop of Object.keys(TOLERANCES)) {
      const refVal = at(ref, prop);
      const gotVal = at(got, prop);
      const ctx = { fontSize: ref.type?.size };

      // Array-valued properties (padding/margin/radius) compare element-wise
      // and report the worst side, so one bad edge cannot hide behind three
      // good ones.
      let cmp;
      if (Array.isArray(refVal) && Array.isArray(gotVal)) {
        const each = refVal.map((v, i) => compareProperty(prop, v, gotVal[i], ctx));
        const rank = { fail: 3, warn: 2, pass: 1, skip: 0 };
        cmp = each.reduce((worst, c) => (rank[c.status] > rank[worst.status] ? c : worst), each[0]);
        cmp = { ...cmp, ref: refVal, got: gotVal };
      } else {
        cmp = compareProperty(prop, refVal, gotVal, ctx);
      }
      if (cmp.status === 'skip') continue;

      const snapped = cmp.status !== 'pass' ? snapLabel(got, prop, refVal, gotVal) : null;
      let status = cmp.status;
      if (snapped) status = mode === 'strict' ? 'fail' : 'warn';

      rows.push({
        id: ref.id, how, width, prop, status,
        delta: cmp.delta, ref: cmp.ref, got: cmp.got, unit: cmp.unit,
        group: GROUP_OF.get(prop) ?? 'structure',
        snapped,
      });
    }
  }

  for (const ref of unmatchedRef) {
    rows.push({ id: ref.id, how: 'none', width, prop: 'element', status: 'fail',
      delta: null, ref: 'present', got: 'missing', unit: '',
      group: 'structure', snapped: null });
  }
  for (const got of unmatchedGot) {
    rows.push({ id: got.id, how: 'none', width, prop: 'element', status: 'fail',
      delta: null, ref: 'absent', got: 'extra', unit: '',
      group: 'structure', snapped: null });
  }

  // Child ORDER, not just child presence. Two elements can both exist, be
  // styled identically, and still compose wrongly because they were emitted
  // in the wrong order — which the per-property comparison above cannot see.
  for (const { ref, got } of pairs) {
    if (ref.children.length === 0 && got.children.length === 0) continue;
    const same = ref.children.length === got.children.length
      && ref.children.every((c, i) => c === got.children[i]);
    if (same) continue;
    rows.push({
      id: ref.id, how: 'order', width, prop: 'children', status: 'fail',
      delta: null, ref: ref.children.join(','), got: got.children.join(','),
      unit: '', group: 'structure', snapped: null,
    });
  }

  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  return { rows, counts, score: scoreOf(rows), mode, width };
}

export function scoreOf(rows) {
  const per = {};
  for (const g of Object.keys(WEIGHTS)) {
    const inGroup = rows.filter((r) => r.group === g);
    if (inGroup.length === 0) { per[g] = 5; continue; }
    const credit = inGroup.reduce(
      (sum, r) => sum + (r.status === 'pass' ? 1 : r.status === 'warn' ? 0.5 : 0), 0);
    per[g] = Number(((credit / inGroup.length) * 5).toFixed(2));
  }
  const health = Math.round(
    Object.entries(WEIGHTS).reduce((sum, [g, w]) => sum + (per[g] / 5) * w, 0));
  const band = health >= 80 ? 'Pass' : health >= 50 ? 'Revise' : 'Fail';
  return { per, health, band, weights: { ...WEIGHTS } };
}

// Failures survive truncation before warnings do — a cap that shed the
// failures would hand the model a clean-looking summary of a broken build.
export function toSummary(diff, { maxRows = SUMMARY_MAX_ROWS } = {}) {
  const rank = { fail: 0, warn: 1, pass: 2 };
  const interesting = diff.rows
    .filter((r) => r.status !== 'pass')
    .sort((a, b) => rank[a.status] - rank[b.status]);
  const kept = interesting.slice(0, maxRows).map((r) => ({
    id: r.id, prop: r.prop, status: r.status, delta: r.delta,
    ref: r.ref, got: r.got, unit: r.unit, group: r.group,
    width: r.width, how: r.how, snapped: r.snapped,
  }));
  return {
    target: diff.target ?? null,
    mode: diff.mode,
    counts: diff.counts,
    score: diff.score,
    rows: kept,
    truncated: Math.max(0, interesting.length - kept.length),
  };
}
