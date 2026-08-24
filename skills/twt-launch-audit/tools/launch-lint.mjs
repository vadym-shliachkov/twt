#!/usr/bin/env node
// launch-lint.mjs — the gate between the model pass and the renderer.
//
// Layer 3 of /twt-launch-audit writes findings.json BY HAND — the interview
// answers, and the judgment findings no rule can reach. Everything the schema
// requires would otherwise be enforced only by prose asking the model to
// remember eight fields, keep `blocking` in step with `severity`, and re-sort
// the array. Prose does not survive a 24-finding run — a sibling tool in this
// repo shipped 16 findings at a confidence its own document forbade.
//
// Two jobs, in this order:
//   --fix   DERIVE what nobody should be typing: id, blocking, source, the
//           sort order, and the verdict. Judgment (impact, action) is NEVER
//           derived — a finding without them is a claim, not an instruction.
//   lint    CHECK what is left, including the three things validateFinding()
//           does not: a missing impact or action (which the report would
//           print as "not yet assessed"), a verdict contradicting the
//           findings, and a non-provisional verdict on an incomplete scan.
//
// Usage: node tools/launch-lint.mjs <out-dir> [--fix]
// Exit 0 clean, 1 on any error, 2 on usage or IO failure.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SEVERITIES, CATEGORIES, validateFinding, verdictFor } from './launch-audit.mjs';

const outDir = process.argv[2];
const fix = process.argv.includes('--fix');
if (!outDir || outDir.startsWith('--')) {
  console.error('usage: launch-lint.mjs <out-dir> [--fix]');
  process.exit(2);
}
const path = join(outDir, 'findings.json');
if (!existsSync(path)) { console.error(`launch-lint: no findings.json in ${outDir}`); process.exit(2); }

let doc;
try { doc = JSON.parse(readFileSync(path, 'utf8')); }
catch (e) { console.error(`launch-lint: unreadable findings.json — ${e.message}`); process.exit(2); }
if (!Array.isArray(doc.findings)) { console.error('launch-lint: findings must be an array'); process.exit(2); }

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const errors = [];

if (fix) {
  for (const f of doc.findings) {
    // A finding that did not come through finding() was written by the model.
    if (!f.source) f.source = 'model';
    if (isText(f.rule) && isText(f.where)) f.id = `${f.rule}-${f.where}`;
    f.blocking = f.severity === 'LAUNCH-BLOCKER';
  }
  const order = (f) => SEVERITIES.indexOf(f.severity) * 100 + CATEGORIES.indexOf(f.category);
  doc.findings.sort((a, b) => order(a) - order(b) || String(a.rule).localeCompare(String(b.rule)));
  const v = verdictFor(doc.findings, doc.layers);
  doc.verdict = v.verdict;
  doc.counts = v.counts;
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf8');
  // The checks below run against `doc` — the fixed, in-memory document — not a
  // re-read of the file, so a --fix run always lints its own output.
}

for (const f of doc.findings) {
  // `where` is the identifier of last resort: a finding missing `rule` (so no
  // id could be derived) still needs to be locatable in the error output.
  const at = f.id || f.rule || f.where || '(unidentified finding)';
  try { validateFinding(f); } catch (e) { errors.push(e.message); continue; }
  // The renderer prints a missing impact/action as "not yet assessed", which
  // reads as a considered judgement rather than an omission. Catch it here.
  if (!isText(f.impact)) errors.push(`${at}: empty impact`);
  if (!isText(f.action)) errors.push(`${at}: empty action`);
  if (f.blocking !== (f.severity === 'LAUNCH-BLOCKER')) {
    errors.push(`${at}: blocking=${f.blocking} is out of step with severity=${f.severity}`);
  }
  if (!isText(f.id)) {
    // id is derived from rule+where. If either is missing, --fix could not
    // have produced one — telling the model to "run with --fix" again would
    // send it in a circle, so say what is actually missing instead.
    if (isText(f.rule) && isText(f.where)) {
      errors.push(`${at}: missing id (run with --fix)`);
    } else {
      errors.push(`${at}: missing id — cannot derive one without both rule and where`);
    }
  }
  if (!['rule', 'model'].includes(f.source)) errors.push(`${at}: bad source "${f.source}"`);
}

// A scan that did not complete cannot produce a readiness verdict, and
// verdictFor() already encodes that: whenever layers.scan !== 'ok' it returns
// exactly "NO-GO — evidence incomplete" regardless of the findings, so that
// case is fully covered by the contradiction check below. A separate
// layers.scan check would fire in lockstep with this one on the same bad
// document — two errors for one cause — so there is deliberately only one.
const expected = verdictFor(doc.findings, doc.layers);
if (doc.verdict !== expected.verdict) {
  errors.push(`verdict "${doc.verdict}" contradicts the findings — expected "${expected.verdict}"`);
}

if (errors.length) {
  console.error(`launch-lint: ${errors.length} error${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`launch-lint: OK — ${doc.findings.length} finding${doc.findings.length === 1 ? '' : 's'}, verdict ${doc.verdict}`);
process.exit(0);
