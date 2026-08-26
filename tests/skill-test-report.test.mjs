import { test } from 'node:test';
import assert from 'node:assert/strict';

const { renderReport } =
  await import(new URL('../tools/lib/skill-test/report.mjs', import.meta.url).href);

const CRITERIA = [
  { id: 'C-001', dimension: 'contract', title: 'declared-write-exists', selfDeclared: false, fixture: 'happy' },
  { id: 'C-002', dimension: 'quality', title: 'sitemap-is-plausible', selfDeclared: true, fixture: 'happy' },
];

const RUN = {
  skill: 'twt-ia-define',
  criteriaHash: 'sha256:abc123',
  scope: ['contract', 'quality'],
  target: 'C:/Work/twt/skill-test/twt-ia-define-01',
  startTreeClean: true,
  dispatchFidelity: 'injected',
  pluginCacheVersion: '1.0.129',
  substitutions: 4,
  selfDeclared: ['C-002'],
  stopReason: 'iteration-cap',
  commit: null,
  iterations: [
    { n: 1, verdicts: { 'C-001': 'FAIL', 'C-002': 'PASS' }, fixes: [], invalidDispatch: false },
    { n: 2, verdicts: { 'C-001': 'PASS', 'C-002': 'PASS' }, fixes: ['skills/twt-ia-define/SKILL.md'], invalidDispatch: false },
    { n: 3, verdicts: { 'C-001': 'FAIL', 'C-002': 'PASS' }, fixes: [], invalidDispatch: false },
  ],
};

test('the fidelity header names the mode, the cached version, and the substitution count', () => {
  const md = renderReport(RUN, { criteria: CRITERIA });
  assert.match(md, /dispatch-fidelity: injected \(working tree\)/);
  assert.match(md, /sub-skills resolved from: cache\/twt-marketplace\/twt\/1\.0\.129/);
  assert.match(md, /\$\{CLAUDE_PLUGIN_ROOT\} substitutions: 4/);
});

test('the verdict table has one column per iteration so a regression is visible', () => {
  const md = renderReport(RUN, { criteria: CRITERIA });
  assert.match(md, /\| C-001 \| contract \| FAIL \| PASS \| FAIL \|/);
});

test('a self-declared criterion is marked in the table', () => {
  assert.match(renderReport(RUN, { criteria: CRITERIA }), /C-002 .*self-declared/);
});

test('the stop reason is stated plainly with its meaning', () => {
  const md = renderReport(RUN, { criteria: CRITERIA });
  assert.match(md, /\*\*Stop reason:\*\* `iteration-cap`/);
  assert.match(md, /cap reached with failures outstanding/i);
});

test('an unpushed commit is reported as local-only', () => {
  const md = renderReport({ ...RUN, commit: 'abc1234' }, { criteria: CRITERIA });
  assert.match(md, /abc1234/);
  assert.match(md, /not been pushed/i);
  assert.match(md, /installed plugin still runs the older version/i);
});

test('a run with no commit says the working tree was left dirty', () => {
  assert.match(renderReport(RUN, { criteria: CRITERIA }), /No commit was made/);
});

test('applied fixes are listed per iteration', () => {
  assert.match(renderReport(RUN, { criteria: CRITERIA }), /skills\/twt-ia-define\/SKILL\.md/);
});

test('the invalid-dispatch-cap stop reason has a stated meaning', () => {
  const md = renderReport({ ...RUN, stopReason: 'invalid-dispatch-cap' }, { criteria: CRITERIA });
  assert.match(md, /\*\*Stop reason:\*\* `invalid-dispatch-cap`/);
  assert.doesNotMatch(md, /— unknown\./);
});

test('limitations section discloses invalid-dispatch detection is best-effort', () => {
  assert.match(renderReport(RUN, { criteria: CRITERIA }), /side-channel check/);
});
