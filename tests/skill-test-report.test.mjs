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

// Finding 4: `continue` and `criteria-drift` are reachable stopReasons the
// orchestrator can produce but STOP_MEANING never covered.
test('the continue stop reason has a stated meaning', () => {
  const md = renderReport({ ...RUN, stopReason: 'continue' }, { criteria: CRITERIA });
  assert.match(md, /\*\*Stop reason:\*\* `continue`/);
  assert.doesNotMatch(md, /— unknown\./);
});

test('the criteria-drift stop reason has a stated meaning', () => {
  const md = renderReport({ ...RUN, stopReason: 'criteria-drift' }, { criteria: CRITERIA });
  assert.match(md, /\*\*Stop reason:\*\* `criteria-drift`/);
  assert.doesNotMatch(md, /— unknown\./);
});

// Finding 5(b): run.findings[] renders in the repo's BLOCKER/WARNING/SUGGESTION
// tier format, and out-of-boundary findings render separately as proposed
// patches rather than being silently discarded.
test('an in-boundary finding renders in the Where/Problem/Recommendation tier format', () => {
  const run = { ...RUN, findings: [
    { tier: 'BLOCKER', title: 'root-honouring violation', where: 'twt-ia-define, target C:/t', problem: 'artifacts landed at repo root', recommendation: 'resolve the injected project root' },
  ] };
  const md = renderReport(run, { criteria: CRITERIA });
  assert.match(md, /## Findings/);
  assert.match(md, /### 1\. \[BLOCKER\] root-honouring violation/);
  assert.match(md, /- \*\*Where:\*\* twt-ia-define, target C:\/t/);
  assert.match(md, /- \*\*Problem:\*\* artifacts landed at repo root/);
  assert.match(md, /- \*\*Recommendation:\*\* resolve the injected project root/);
});

test('an out-of-boundary finding renders as a proposed patch, not a Finding', () => {
  const run = { ...RUN, findings: [
    { tier: 'WARNING', title: 'shared tool bug', where: 'tools/foo.mjs:10', problem: 'off by one', recommendation: 'fix the loop bound', outOfBoundary: true, patch: 'change < to <=' },
  ] };
  const md = renderReport(run, { criteria: CRITERIA });
  assert.match(md, /## Proposed patches/);
  assert.match(md, /### 1\. shared tool bug/);
  assert.match(md, /\*\*Proposed patch \(not applied\):\*\* change < to <=/);
  // Not double-counted into the plain Findings section.
  const findingsSection = md.slice(md.indexOf('## Findings'), md.indexOf('## Proposed patches'));
  assert.doesNotMatch(findingsSection, /shared tool bug/);
});

test('no findings renders an explicit "none" rather than an empty section', () => {
  const md = renderReport(RUN, { criteria: CRITERIA });
  assert.match(md, /## Findings\n\nNone recorded\./);
  assert.match(md, /## Proposed patches\n\nNone —/);
});

// Finding 6: substitutions must be visible per iteration, not just as one
// overwritten scalar that the last iteration erases.
test('substitution counts are shown per iteration, not just the latest overwritten scalar', () => {
  const run = { ...RUN, substitutionsByIteration: { 1: 4, 2: 4, 3: 3 } };
  const md = renderReport(run, { criteria: CRITERIA });
  assert.match(md, /substitutions per iteration: it\.1=4, it\.2=4, it\.3=3/);
});

// Finding 9: a report rendered before any `ledger` call (stopReason still
// null from initRun, zero iterations) must stay valid GFM and must not call
// the null stop reason "unknown" — it is a documented, real state.
test('a zero-iteration report has a valid GFM verdict table and an explained null stop reason', () => {
  const run = { ...RUN, stopReason: null, iterations: [] };
  const md = renderReport(run, { criteria: CRITERIA });
  assert.doesNotMatch(md, /— unknown\./);
  assert.match(md, /\*\*Stop reason:\*\* `null`/);
  assert.match(md, /before its first `ledger` call/);
  // GFM delimiter row must not contain an empty zero-width cell ("||").
  assert.doesNotMatch(md, /\|---\|---\|\|/);
  assert.match(md, /^\| Criterion \| Dimension \|$/m);
  assert.match(md, /^\|---\|---\|$/m);
});

// --scope is a real filter, not a recorded-and-ignored string. The header has
// to name what was graded, and a criterion the scope dropped must read `n/a`
// — the `—` cell means "the grader ignored an in-scope criterion", which is a
// finding; an out-of-scope one is not.
test('the fidelity header names the graded scope', () => {
  const md = renderReport(RUN, { criteria: CRITERIA });
  assert.match(md, /^scope: contract, quality$/m);
});

test('an out-of-scope criterion is labelled and rendered n/a, never as a missing verdict', () => {
  const run = { ...RUN, scope: ['contract'], criteriaIds: ['C-001'] };
  const md = renderReport(run, { criteria: CRITERIA });
  assert.match(md, /^scope: contract$/m);
  assert.match(md, /\| C-002 \(self-declared, out of scope\) \| quality \| n\/a \| n\/a \| n\/a \|/);
  // The in-scope row is untouched.
  assert.match(md, /\| C-001 \| contract \| FAIL \| PASS \| FAIL \|/);
});

test('with no criteriaIds recorded (a pre-scope run) every criterion still renders its verdicts', () => {
  const { criteriaIds, ...run } = { ...RUN, criteriaIds: undefined };
  const md = renderReport(run, { criteria: CRITERIA });
  assert.doesNotMatch(md, /out of scope/);
  assert.match(md, /\| C-002 \(self-declared\) \| quality \| PASS \| PASS \| PASS \|/);
});

// A fix is evidenced only by the NEXT valid iteration's verdicts. One applied
// on the final iteration is committed by Step 5 having been graded by nothing.
test('a fix applied on the final iteration is marked UNVERIFIED', () => {
  const run = {
    ...RUN,
    iterations: [
      { n: 1, verdicts: { 'C-001': 'FAIL', 'C-002': 'PASS' }, fixes: ['skills/twt-ia-define/SKILL.md'], invalidDispatch: false },
      { n: 2, verdicts: { 'C-001': 'FAIL', 'C-002': 'PASS' }, fixes: ['skills/twt-ia-define/references/x.md'], invalidDispatch: false },
    ],
  };
  const md = renderReport(run, { criteria: CRITERIA });
  assert.match(md, /\*\*Iteration 1:\*\*$/m);            // re-graded by iteration 2
  assert.match(md, /\*\*Iteration 2:\*\* — \*\*UNVERIFIED\*\*/);
  assert.match(md, /No later iteration re-graded these edits/);
});

test('a fix followed only by an invalid-dispatch iteration is still UNVERIFIED', () => {
  const run = {
    ...RUN,
    iterations: [
      { n: 1, verdicts: { 'C-001': 'FAIL', 'C-002': 'PASS' }, fixes: ['skills/twt-ia-define/SKILL.md'], invalidDispatch: false },
      { n: 2, verdicts: {}, fixes: [], invalidDispatch: true },
    ],
  };
  const md = renderReport(run, { criteria: CRITERIA });
  assert.match(md, /\*\*Iteration 1:\*\* — \*\*UNVERIFIED\*\*/);
});

test('a commit carrying an unverified fix says so in the Landing section', () => {
  const run = {
    ...RUN,
    commit: 'abc1234',
    iterations: [
      { n: 1, verdicts: { 'C-001': 'FAIL', 'C-002': 'PASS' }, fixes: ['skills/twt-ia-define/SKILL.md'], invalidDispatch: false },
    ],
  };
  const md = renderReport(run, { criteria: CRITERIA });
  assert.match(md, /includes \*\*unverified\*\* edits from iteration 1/);
});

test('a commit whose every fix was re-graded carries no unverified warning', () => {
  const md = renderReport({ ...RUN, commit: 'abc1234' }, { criteria: CRITERIA });
  assert.match(md, /Committed locally as `abc1234`/);
  assert.doesNotMatch(md, /unverified/);
});
