#!/usr/bin/env node
// check-validation-report.mjs — generic structural checker for the CONVENTIONS
// §12 report format, run by every scorecard-carrying validator and QA audit
// after writing its report (the brand validator keeps its own specialized
// checker, which supersets these checks).
//
// Structural only — it verifies the report can't lie about its own arithmetic
// or drop required machinery; it does not (cannot) replace the rubric's
// judgment. Checks:
//   - `## Scorecard` pipe table: integer weights summing to 100, scores 0–5,
//     Weighted == weight*score/5 (±0.06), Total == sum of weighted (±0.6 —
//     score-rubric.mjs rounds)
//   - `**Health: N — Band: X**` line: health == total; Pass ⇒ health ≥ 80,
//     Fail ⇒ health < 50, Revise ⇒ health ≥ 50 (a skill may tighten its own
//     Pass bar, so high-health Revise is legal; sub-50 Revise is not)
//   - `## Findings` present; every `### N. [TIER]` finding uses
//     BLOCKER/WARNING/SUGGESTION and carries **Where:** / **Problem:** /
//     **Recommendation:**
//   - `## Summary` present and non-empty
//   - `## Decisions to confirm` present (skip with --no-decisions — the QA
//     audit reports don't carry it)
//
// Usage: node tools/check-validation-report.mjs --file <report.md> [--no-decisions]
// Exit 0 when structurally sound; exit 1 listing every problem found.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const TIERS = new Set(['BLOCKER', 'WARNING', 'SUGGESTION']);

export function checkReport(text, { requireDecisions = true } = {}) {
  const problems = [];
  const section = (name) => {
    const re = new RegExp(`^##\\s+${name}\\s*$`, 'm');
    const m = re.exec(text);
    if (!m) return null;
    const start = m.index + m[0].length;
    const rest = text.slice(start);
    const end = rest.search(/^## /m);
    return (end === -1 ? rest : rest.slice(0, end));
  };

  // --- scorecard -------------------------------------------------------------
  const sc = section('Scorecard');
  if (!sc) problems.push('missing `## Scorecard` section');
  else {
    const rows = sc.split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l))
      .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
    const data = rows.filter((r) => r.length >= 4 && !/^:?-{2,}/.test(r[0]) && !/criterion/i.test(r[0]));
    const total = data.find((r) => /\*\*total\*\*/i.test(r[0]));
    const criteria = data.filter((r) => r !== total);
    if (!criteria.length) problems.push('Scorecard has no criterion rows');
    let weightSum = 0; let weightedSum = 0;
    for (const r of criteria) {
      const weight = Number(r[1].replace(/\*/g, ''));
      const score = Number(r[2]);
      const weighted = Number(r[3].replace(/\*/g, ''));
      if (!Number.isFinite(weight)) { problems.push(`criterion '${r[0]}': weight '${r[1]}' is not a number`); continue; }
      weightSum += weight;
      if (!Number.isFinite(score) || score < 0 || score > 5) problems.push(`criterion '${r[0]}': score '${r[2]}' is not 0–5`);
      if (!Number.isFinite(weighted)) problems.push(`criterion '${r[0]}': weighted '${r[3]}' is not a number`);
      else if (Number.isFinite(score) && Math.abs(weighted - (weight * score) / 5) > 0.06) {
        problems.push(`criterion '${r[0]}': weighted ${weighted} ≠ weight ${weight} × score ${score} / 5 = ${(weight * score / 5).toFixed(1)}`);
      } else weightedSum += weighted;
    }
    if (criteria.length && weightSum !== 100) problems.push(`weights sum to ${weightSum}, not 100`);
    // The Total row is `| **Total** | **100** | | **<health>** | |` — the
    // health lives in the Weighted column (index 3), never the weight column.
    const totalVal = total ? Number((total[3] || '').replace(/\*/g, '')) : NaN;
    if (total && Number.isFinite(totalVal) && Math.abs(totalVal - weightedSum) > 0.6) {
      problems.push(`Total ${totalVal} ≠ sum of weighted ${weightedSum.toFixed(1)}`);
    }
    const health = /\*\*Health:\s*([\d.]+)\s*[—–-]+\s*Band:\s*(Pass|Revise|Fail)/i.exec(text);
    if (!health) problems.push('missing `**Health: N — Band: X**` line (band must be Pass, Revise, or Fail)');
    else {
      const h = Number(health[1]); const band = health[2].toLowerCase();
      if (criteria.length && Math.abs(h - weightedSum) > 0.6) problems.push(`Health ${h} ≠ sum of weighted ${weightedSum.toFixed(1)}`);
      if (band === 'pass' && h < 80) problems.push(`Band Pass with health ${h} (< 80)`);
      if (band === 'fail' && h >= 50) problems.push(`Band Fail with health ${h} (≥ 50)`);
      if (band === 'revise' && h < 50) problems.push(`Band Revise with health ${h} (< 50 is Fail)`);
    }
  }

  // --- findings ----------------------------------------------------------------
  const findings = section('Findings');
  if (findings === null) problems.push('missing `## Findings` section');
  else {
    const heads = [...findings.matchAll(/^###\s*\d+\.\s*\[([^\]]+)\][^\n]*$/gm)];
    for (const h of heads) {
      if (!TIERS.has(h[1])) problems.push(`finding tier [${h[1]}] is not BLOCKER/WARNING/SUGGESTION`);
      const start = h.index + h[0].length;
      const rest = findings.slice(start);
      const end = rest.search(/^###?#?\s/m);
      const block = end === -1 ? rest : rest.slice(0, end);
      for (const field of ['Where', 'Problem', 'Recommendation']) {
        if (!new RegExp(`\\*\\*${field}:?\\*\\*`).test(block)) {
          problems.push(`finding '${h[0].trim()}' is missing **${field}:**`);
        }
      }
    }
  }

  const summary = section('Summary');
  if (summary === null) problems.push('missing `## Summary` section');
  else if (!summary.trim()) problems.push('`## Summary` is empty');

  if (requireDecisions && section('Decisions to confirm') === null) {
    problems.push('missing `## Decisions to confirm` section (state "none" rather than omitting it)');
  }
  return problems;
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const good = `# Validation report — thing
Generated: x

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| A | 60 | 4 | 48.0 | fine |
| B | 40 | 3 | 24.0 | ok |
| **Total** | **100** | | **72** | |

**Health: 72 — Band: Revise**

## Decisions to confirm
- none

## Findings
### 1. [WARNING] Something
- **Where:** here
- **Problem:** because
- **Recommendation:** do this

## Summary
Tied together.
`;
  assert.deepEqual(checkReport(good), []);
  assert.ok(checkReport(good.replace('| A | 60 |', '| A | 55 |')).some((p) => /weights sum to 95/.test(p)), 'weight sum caught');
  assert.ok(checkReport(good.replace('48.0', '52.0')).some((p) => /weighted 52/.test(p)), 'bad arithmetic caught');
  assert.ok(checkReport(good.replace('Band: Revise', 'Band: Pass')).some((p) => /Pass with health 72/.test(p)), 'band/health mismatch caught');
  assert.ok(checkReport(good.replace('- **Where:** here\n', '')).some((p) => /missing \*\*Where/.test(p)), 'missing Where caught');
  assert.ok(checkReport(good.replace('## Summary\nTied together.\n', '')).some((p) => /missing `## Summary`/.test(p)), 'missing summary caught');
  assert.ok(checkReport(good.replace('[WARNING]', '[NITPICK]')).some((p) => /not BLOCKER/.test(p)), 'invalid tier caught');
  const noDec = good.replace('## Decisions to confirm\n- none\n\n', '');
  assert.ok(checkReport(noDec).some((p) => /Decisions to confirm/.test(p)), 'missing decisions caught');
  assert.deepEqual(checkReport(noDec, { requireDecisions: false }), [], '--no-decisions skips that check');
  console.log('check-validation-report self-test: OK');
} else if (_isMain) {
  const i = process.argv.indexOf('--file');
  if (i === -1) { console.error('usage: node tools/check-validation-report.mjs --file <report.md> [--no-decisions]'); process.exit(1); }
  const problems = checkReport(readFileSync(process.argv[i + 1], 'utf8'),
    { requireDecisions: !process.argv.includes('--no-decisions') });
  if (problems.length) {
    for (const p of problems) console.error('FAIL: ' + p);
    process.exit(1);
  }
  console.log('check-validation-report: OK');
}
