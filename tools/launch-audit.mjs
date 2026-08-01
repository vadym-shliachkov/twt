#!/usr/bin/env node
// launch-audit.mjs — vocabulary, finding schema, and verdict arithmetic for
// /twt-launch-audit.
//
// The vocabularies are closed on purpose. An owner outside the five roles means
// nobody can be handed the item; a severity outside the four tiers means the
// verdict function cannot classify it. Both ends of the pipeline call
// validateFinding() — the rules construct findings through finding(), but the
// MODEL writes findings.json by hand and never touches finding(), so
// launch-lint.mjs validates the same contract again on the way to the renderer.
import { strict as assert } from 'node:assert';
import { pathToFileURL } from 'node:url';

export const SEVERITIES = ['LAUNCH-BLOCKER', 'FIX-WEEK-ONE', 'NICE-TO-HAVE', 'UNVERIFIED'];
export const OWNERS = ['developer', 'content-owner', 'client-decision', 'designer', 'hosting-ops'];

export const CATEGORIES = [
  'content', 'discoverability', 'social', 'legal', 'analytics',
  'conversion', 'errors', 'performance', 'hygiene', 'carried', 'operational',
];

export const CATEGORY_TITLES = {
  content: 'Content complete & approved',
  discoverability: 'Discoverability',
  social: 'Social & brand assets',
  legal: 'Legal & compliance',
  analytics: 'Analytics & tracking',
  conversion: 'Conversion paths',
  errors: 'Error & edge states',
  performance: 'Performance & weight',
  hygiene: 'Build hygiene & secrets',
  carried: 'Carried-forward quality gates',
  operational: 'Operational readiness',
};

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

export function validateFinding(p) {
  const at = p?.id || p?.rule || '(unidentified finding)';
  if (!SEVERITIES.includes(p?.severity)) {
    throw new Error(`${at}: bad severity "${p?.severity}" (expected one of ${SEVERITIES.join(', ')})`);
  }
  if (!OWNERS.includes(p.owner)) {
    throw new Error(`${at}: bad owner "${p.owner}" (expected one of ${OWNERS.join(', ')})`);
  }
  if (!CATEGORIES.includes(p.category)) {
    throw new Error(`${at}: bad category "${p.category}" (expected one of ${CATEGORIES.join(', ')})`);
  }
  // `where` is what makes a finding actionable and `evidence` is what makes it
  // defensible. A finding missing either is a claim, not a finding.
  if (!isText(p.where)) throw new Error(`${at}: empty where`);
  if (!isText(p.evidence)) throw new Error(`${at}: empty evidence`);
  return p;
}

export function finding(p) {
  validateFinding(p);
  return {
    id: `${p.rule}-${p.where}`,
    rule: p.rule,
    category: p.category,
    severity: p.severity,
    owner: p.owner,
    where: p.where,
    evidence: p.evidence,
    // impact/action are judgment — the model fills them, the lint enforces them.
    impact: p.impact ?? null,
    action: p.action ?? null,
    blocking: p.severity === 'LAUNCH-BLOCKER',
    source: 'rule',
  };
}

// A scan that did not complete cannot produce a readiness verdict: absence of
// findings is not evidence of readiness. This check comes FIRST and cannot be
// outvoted by a clean findings array.
export function verdictFor(findings, layers) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of findings) if (counts[f.severity] !== undefined) counts[f.severity]++;
  if (!layers || layers.scan !== 'ok') return { verdict: 'NO-GO — evidence incomplete', counts };
  if (counts['LAUNCH-BLOCKER'] > 0) return { verdict: 'NO-GO', counts };
  if (counts.UNVERIFIED > 0 || counts['FIX-WEEK-ONE'] > 0) return { verdict: 'GO WITH RISKS', counts };
  return { verdict: 'GO', counts };
}

// Moved above the CLI block so both it and the --self-test block below can use it.
const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RULES, QUESTIONS } from './launch-audit/rules/index.mjs';

// node tools/launch-audit.mjs <facts.json> --out <dir> [--answers <answers.json>]
const _factsArg = process.argv[2];
if (_isMain && _factsArg && !_factsArg.startsWith('--')) {
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx > -1 ? process.argv[outIdx + 1] : null;
  if (!outDir) { console.error('usage: launch-audit.mjs <facts.json> --out <dir> [--answers <answers.json>]'); process.exit(2); }
  let facts;
  try { facts = JSON.parse(readFileSync(_factsArg, 'utf8')); }
  catch (e) { console.error(`cannot read facts: ${e.message}`); process.exit(2); }

  // Stored interview answers, so a question already answered on a previous run
  // does not come back as an UNVERIFIED finding. Absent is the normal case and
  // is silent; present-but-unreadable is NOT silent — it fails toward
  // over-reporting (every blocking question stays unanswered) and says so,
  // because silently treating a corrupt answers.json as "no answers" and
  // silently treating it as "all answered" look identical from the outside.
  const ansIdx = process.argv.indexOf('--answers');
  const answersPath = ansIdx > -1 ? process.argv[ansIdx + 1] : join(outDir, 'answers.json');
  facts.answers = null;
  if (existsSync(answersPath)) {
    try { facts.answers = JSON.parse(readFileSync(answersPath, 'utf8')); }
    catch (e) { console.error(`launch-audit: ${answersPath} is unreadable (${e.message}) — treating every interview question as unanswered`); }
  }

  const found = [];
  for (const r of RULES) {
    try { found.push(...r.run(facts)); }
    catch (e) { console.error(`rule ${r.id} threw: ${e.message}`); process.exit(2); }
  }
  // Sort blockers first, then by category order, so the renderer never has to.
  const order = (f) => SEVERITIES.indexOf(f.severity) * 100 + CATEGORIES.indexOf(f.category);
  found.sort((a, b) => order(a) - order(b) || a.rule.localeCompare(b.rule));

  const { verdict, counts } = verdictFor(found, facts.layers);
  mkdirSync(outDir, { recursive: true });
  const payload = {
    tool: 'launch-audit', version: 1, generated: new Date().toISOString(),
    layers: facts.layers, mode: facts.mode, url: facts.url ?? null,
    verdict, counts, findings: found, interview: QUESTIONS,
  };
  writeFileSync(join(outDir, 'findings.json'), JSON.stringify(payload, null, 2), 'utf8');
  const tally = SEVERITIES.map((s) => `${s}=${counts[s]}`).join('  ');
  const open = found.filter((f) => f.rule === 'INTV001').length;
  console.log(`launch-audit: ${verdict}  ${tally}  (${found.length} findings from ${RULES.length} rules)`);
  if (open) console.log(`launch-audit: ${open} blocking interview question${open === 1 ? '' : 's'} unanswered — answer them in ${join(outDir, 'answers.json')} and re-run to clear them`);
  process.exit(0);
}

if (_isMain && process.argv.includes('--self-test')) {
  assert.equal(CATEGORIES.length, 11, 'eleven categories');
  assert.equal(Object.keys(CATEGORY_TITLES).length, 11, 'every category needs a title');
  assert.throws(() => validateFinding({ rule: 'X', category: 'content', severity: 'High', owner: 'developer', where: 'a', evidence: 'b' }));
  assert.equal(verdictFor([], { scan: 'ok' }).verdict, 'GO');
  assert.equal(verdictFor([], { scan: 'failed' }).verdict, 'NO-GO — evidence incomplete');
  // verdictFor([]) IS 'GO' — that is correct arithmetic on an empty array, and
  // it is exactly why the emptiness must be impossible upstream. The blocking
  // interview questions are materialized as UNVERIFIED findings by the rules
  // (rules/interview.mjs), on every path, so a real run never hands this
  // function an empty array while questions stand unanswered.
  const blocking = QUESTIONS.filter((q) => q.blocking).length;
  const materialized = RULES.filter((r) => r.id.startsWith('INTV-')).length;
  assert.equal(materialized, blocking, 'every blocking question must be materialized as a rule');
  assert.ok(blocking > 0, 'a catalogue with no blocking question cannot stop a silent GO');
  const silent = RULES.flatMap((r) => r.run({ layers: { scan: 'ok' }, checks: {}, answers: null }));
  assert.notEqual(verdictFor(silent, { scan: 'ok' }).verdict, 'GO', 'silence must never verdict a clean GO');
  console.log('launch-audit self-test: OK');
}
