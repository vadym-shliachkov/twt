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

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  assert.equal(CATEGORIES.length, 11, 'eleven categories');
  assert.equal(Object.keys(CATEGORY_TITLES).length, 11, 'every category needs a title');
  assert.throws(() => validateFinding({ rule: 'X', category: 'content', severity: 'High', owner: 'developer', where: 'a', evidence: 'b' }));
  assert.equal(verdictFor([], { scan: 'ok' }).verdict, 'GO');
  assert.equal(verdictFor([], { scan: 'failed' }).verdict, 'NO-GO — evidence incomplete');
  console.log('launch-audit self-test: OK');
}
