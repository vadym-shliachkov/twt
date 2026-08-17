// diff.mjs — join reference against measured, apply the comparators, and emit
// a capped, markup-free summary.
//
// Stamped correspondence (data-fid) is the primary path. The heuristic matcher
// exists only for unstamped elements and for grading pages this loop did not
// build: its accuracy degrades exactly as layout drift grows, so it is least
// trustworthy when it matters most. Every heuristic pair is flagged as such.
'use strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROPERTY_GROUPS, isEstimated, reportBasenames } from './spec.mjs';
import { compareProperty, TOLERANCES } from './tolerance.mjs';
import { renderValidationReport, renderHtml } from './report.mjs';

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
//
// `index` names WHICH side of an array-valued property (padding/margin/radius)
// actually drove the worst-side verdict, so the label names the value that
// differs rather than always index 0 — a symmetric fixture can't tell the two
// apart, which is why the array branch below tracks it explicitly.
function snapLabel(got, prop, ref, val, index = 0) {
  const token = got.tokens?.[prop];
  if (!token) return null;
  const r = Array.isArray(ref) ? ref[index] : ref;
  const v = Array.isArray(val) ? val[index] : val;
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
      // good ones. worstIndex tracks WHICH side won so snapLabel can name the
      // value that actually drifted. A length mismatch is a definite fail on
      // the property (never an `undefined`-status row from reducing an empty
      // array), and a zero-length pair on both sides has nothing to compare.
      let cmp;
      let worstIndex = 0;
      if (Array.isArray(refVal) && Array.isArray(gotVal)) {
        if (refVal.length !== gotVal.length) {
          cmp = { prop, status: 'fail', delta: null, ref: refVal, got: gotVal, unit: '' };
        } else if (refVal.length === 0) {
          cmp = { prop, status: 'skip', delta: null, ref: refVal, got: gotVal, unit: '' };
        } else {
          const each = refVal.map((v, i) => compareProperty(prop, v, gotVal[i], ctx));
          const rank = { fail: 3, warn: 2, pass: 1, skip: 0 };
          cmp = each[0];
          each.forEach((c, i) => {
            if (rank[c.status] > rank[cmp.status]) { cmp = c; worstIndex = i; }
          });
          cmp = { ...cmp, ref: refVal, got: gotVal };
        }
      } else {
        cmp = compareProperty(prop, refVal, gotVal, ctx);
      }
      if (cmp.status === 'skip') continue;

      const snapped = cmp.status !== 'pass' ? snapLabel(got, prop, refVal, gotVal, worstIndex) : null;
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

  return { rows, counts, score: scoreOf(rows), mode, width, target: refSpec.target };
}

// A group with zero compared rows was never ASSESSED — it must not collect
// full marks by default. Health is the weighted average over only the
// groups that have rows, renormalized by those groups' weight sum (so
// structure sitting empty on a typical run, the common case, cannot inflate
// Health by silently banking its 25 points). When nothing was assessed at
// all, health is `null` and the band says so — never a number standing in
// for "we don't know."
export function scoreOf(rows) {
  const per = {};
  for (const g of Object.keys(WEIGHTS)) {
    const inGroup = rows.filter((r) => r.group === g);
    if (inGroup.length === 0) { per[g] = null; continue; }
    const credit = inGroup.reduce(
      (sum, r) => sum + (r.status === 'pass' ? 1 : r.status === 'warn' ? 0.5 : 0), 0);
    per[g] = Number(((credit / inGroup.length) * 5).toFixed(2));
  }
  const assessed = Object.entries(WEIGHTS).filter(([g]) => per[g] !== null);
  const weightSum = assessed.reduce((sum, [, w]) => sum + w, 0);
  const health = weightSum === 0
    ? null
    : Math.round(assessed.reduce((sum, [g, w]) => sum + (per[g] / 5) * w, 0) / weightSum * 100);
  const band = health === null ? 'Not assessed' : health >= 80 ? 'Pass' : health >= 50 ? 'Revise' : 'Fail';
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

// --- CLI entrypoint --------------------------------------------------------
//
// A SKILL.md is prose executed by a model: it runs Bash and file tools, never
// library functions. This is the diff/render half of that same gap — reads
// the reference spec + measured.json off disk, joins them, and writes
// deltas.json, summary.json, and both human-facing reports via report.mjs.
//
// Usage:
//   node tools/fidelity/diff.mjs --dir <artifact-dir> --mode <system|strict> --iteration <n>
// Exit: 0 ok | 3 no reference spec in --dir, or a measured width the
// reference never captured (measured widths must be a SUBSET of the
// reference's captured widths — comparing a width the reference never saw
// would silently score against nothing). Both conditions are deterministic
// and trivially reachable from a real subprocess test (a missing file, a
// width absent from a hand-built fixture) — unlike pixdiff.mjs's exit-2
// branch, nothing here needs an availability probe or a pure classifier to
// be testable; the guards below are the whole contract.
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
  const dir = arg('dir');
  const mode = arg('mode', 'system');
  const iteration = Number(arg('iteration', '1'));

  const specPath = ['reference-spec.json', 'reference-spec-estimated.json']
    .map((f) => join(dir, f)).find(existsSync);
  if (!specPath) {
    process.stderr.write(`no reference spec in ${dir}\n`);
    process.exit(3);
  }

  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const measured = JSON.parse(readFileSync(join(dir, 'measured.json'), 'utf8'));

  // Pair the reference and the build BY WIDTH. The reference spec on disk is
  // a widths-keyed MAP (`{ "1440": [...elements] }`) — exactly like
  // measured.json — not the flat `elements` array that spec.mjs's makeSpec()
  // test-fixture helper produces (that shape is a unit-test convenience for
  // diffSpec()/toSummary(), called directly with one width's slice; it is
  // NOT what twt-fidelity-fetch writes to disk). An earlier version of this
  // plan gave the on-disk spec a single flat `elements` array, which cannot
  // represent a reference captured at 1440/768/390 — three measured widths
  // would have been compared against one reference set.
  const perWidth = Object.entries(measured.widths).map(([w, els]) => {
    const refEls = spec.widths?.[w];
    if (!refEls) {
      process.stderr.write(`reference has no width ${w} — measured widths must be a subset of captured ones\n`);
      process.exit(3);
    }
    // diffSpec takes { elements } — hand it this width's slice, not the whole spec.
    return diffSpec({ ...spec, elements: refEls }, els, { mode, width: Number(w) });
  });
  const merged = {
    rows: perWidth.flatMap((d) => d.rows),
    counts: perWidth.reduce((acc, d) => {
      for (const [k, v] of Object.entries(d.counts)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, { pass: 0, warn: 0, fail: 0 }),
    mode,
    target: spec.target,
  };
  // Score across EVERY width, not perWidth[0]: the default is three widths, so
  // reusing one width's score would report a number for 1440 under a header
  // claiming 1440/768/390.
  merged.score = scoreOf(merged.rows);

  // The widths actually assessed this run, as an ARRAY of numbers — derived
  // from measured.json's own keys (== perWidth's widths), never from
  // `spec.widths` directly. report.mjs's renderValidationReport calls
  // `.join()` on meta.widths and every caller of it (fidelity-report.test.mjs
  // included) passes an array — but the on-disk spec's `widths` field is the
  // widths-keyed OBJECT, not an array, so `spec.widths[0]` (an earlier draft
  // of this CLI) would read a nonexistent key "0" off that map and undefined
  // would flow into `${undefined}.png` while `meta.widths.join` threw outright.
  const widthsArr = perWidth.map((d) => d.width);

  const names = reportBasenames(spec);
  const meta = {
    target: spec.target, source: spec.source, widths: widthsArr,
    provenance: spec.provenance, mode, iteration,
    pixdiff: existsSync(join(dir, 'pixdiff.json'))
      ? JSON.parse(readFileSync(join(dir, 'pixdiff.json'), 'utf8')) : null,
    images: {
      reference: `reference/${widthsArr[0]}.png`,
      built: `built/iter-${iteration}-${widthsArr[0]}.png`,
      diff: `diff/iter-${iteration}-${widthsArr[0]}.png`,
    },
  };

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'deltas.json'), JSON.stringify(merged, null, 2));
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(toSummary(merged, {}), null, 2));
  writeFileSync(join(dir, names.md), renderValidationReport(merged, meta));
  writeFileSync(join(dir, names.html), renderHtml(merged, meta));
  // Route Health through the same null-safe formatting report.mjs's renderer
  // uses (fmtHealth) rather than interpolating diff.score.health directly —
  // an unassessed run (score.health === null) must never leak the literal
  // string "null" here either, the same defect class Task 6 found twice in
  // report.mjs itself.
  const healthStr = merged.score.health === null ? 'not assessed' : `${merged.score.health}/100`;
  process.stderr.write(
    `fidelity: ${merged.counts.fail} fail / ${merged.counts.warn} warn — ${merged.score.band} ${healthStr}${isEstimated(spec) ? ' (ESTIMATED)' : ''}\n`);
}
