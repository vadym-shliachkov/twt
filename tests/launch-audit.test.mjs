import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEVERITIES, OWNERS, CATEGORIES, CATEGORY_TITLES,
  validateFinding, finding, verdictFor,
} from '../skills/twt-launch-audit/tools/launch-audit.mjs';

const ok = {
  rule: 'DISC001', category: 'discoverability', severity: 'LAUNCH-BLOCKER',
  owner: 'developer', where: 'site/about.html:3',
  evidence: 'meta robots noindex present',
};

test('vocabulary: exact strings and order', () => {
  assert.deepEqual(SEVERITIES, ['LAUNCH-BLOCKER', 'FIX-WEEK-ONE', 'NICE-TO-HAVE', 'UNVERIFIED']);
  assert.deepEqual(OWNERS, ['developer', 'content-owner', 'client-decision', 'designer', 'hosting-ops']);
  assert.deepEqual(CATEGORIES, ['content', 'discoverability', 'social', 'legal', 'analytics',
    'conversion', 'errors', 'performance', 'hygiene', 'carried', 'operational']);
  for (const c of CATEGORIES) assert.equal(typeof CATEGORY_TITLES[c], 'string', `${c} needs a title`);
});

test('validateFinding: rejects a severity outside the vocabulary', () => {
  assert.throws(() => validateFinding({ ...ok, severity: 'Blocker' }), /bad severity "Blocker"/);
});

test('validateFinding: rejects an owner outside the closed vocabulary', () => {
  assert.throws(() => validateFinding({ ...ok, owner: 'Client' }), /bad owner "Client"/);
});

test('validateFinding: rejects an unknown category', () => {
  assert.throws(() => validateFinding({ ...ok, category: 'seo' }), /bad category "seo"/);
});

test('validateFinding: rejects an empty where or evidence', () => {
  assert.throws(() => validateFinding({ ...ok, where: '   ' }), /DISC001: empty where/);
  assert.throws(() => validateFinding({ ...ok, evidence: '' }), /DISC001: empty evidence/);
});

test('finding: derives id, blocking, and source', () => {
  const f = finding(ok);
  assert.equal(f.id, 'DISC001-site/about.html:3');
  assert.equal(f.blocking, true);
  assert.equal(f.source, 'rule');
  assert.equal(f.impact, null, 'impact is the model\'s job, not the rule\'s');
  assert.equal(f.action, null);
});

test('finding: blocking is false for every non-blocker severity', () => {
  for (const s of ['FIX-WEEK-ONE', 'NICE-TO-HAVE', 'UNVERIFIED']) {
    assert.equal(finding({ ...ok, severity: s }).blocking, false, s);
  }
});

test('verdictFor: an incomplete scan overrides everything', () => {
  const got = verdictFor([], { scan: 'failed', harvest: 'ok', live: 'skipped' });
  assert.equal(got.verdict, 'NO-GO — evidence incomplete');
});

test('verdictFor: an incomplete scan wins even with zero findings and ok harvest', () => {
  assert.equal(verdictFor([], { scan: 'partial' }).verdict, 'NO-GO — evidence incomplete');
});

test('verdictFor: any blocker is NO-GO', () => {
  const got = verdictFor([finding(ok)], { scan: 'ok' });
  assert.equal(got.verdict, 'NO-GO');
  assert.equal(got.counts['LAUNCH-BLOCKER'], 1);
});

test('verdictFor: UNVERIFIED alone is GO WITH RISKS, never GO', () => {
  const f = finding({ ...ok, severity: 'UNVERIFIED', owner: 'client-decision' });
  assert.equal(verdictFor([f], { scan: 'ok' }).verdict, 'GO WITH RISKS');
});

test('verdictFor: FIX-WEEK-ONE alone is GO WITH RISKS', () => {
  const f = finding({ ...ok, severity: 'FIX-WEEK-ONE' });
  assert.equal(verdictFor([f], { scan: 'ok' }).verdict, 'GO WITH RISKS');
});

test('verdictFor: only NICE-TO-HAVE items left is a clean GO', () => {
  const f = finding({ ...ok, severity: 'NICE-TO-HAVE' });
  assert.equal(verdictFor([f], { scan: 'ok' }).verdict, 'GO');
});

test('verdictFor: no findings at all with a complete scan is GO', () => {
  assert.equal(verdictFor([], { scan: 'ok' }).verdict, 'GO');
});
