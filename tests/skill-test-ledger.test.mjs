import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { initRun, appendIteration, readRun, converged } =
  await import(new URL('../tools/lib/skill-test/ledger.mjs', import.meta.url).href);

const newRun = () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-run-'));
  initRun(dir, { skill: 'twt-demo', criteriaHash: 'sha256:abc', scope: ['contract'], target: 'C:/t', startTreeClean: true, selfDeclared: ['C-002'], criteriaIds: ['C-001', 'C-002'] });
  return dir;
};

test('initRun writes run.json with its metadata and an empty iteration list', () => {
  const dir = newRun();
  assert.ok(existsSync(join(dir, 'run.json')));
  const run = readRun(dir);
  assert.equal(run.skill, 'twt-demo');
  assert.equal(run.startTreeClean, true);
  assert.deepEqual(run.iterations, []);
});

test('appendIteration accumulates verdicts and applied fixes', () => {
  const dir = newRun();
  appendIteration(dir, { n: 1, verdicts: { 'C-001': 'FAIL' }, fixes: ['skills/twt-demo/SKILL.md'] });
  const run = readRun(dir);
  assert.equal(run.iterations.length, 1);
  assert.deepEqual(run.iterations[0].fixes, ['skills/twt-demo/SKILL.md']);
});

test('converged: all PASS with a non-self-declared criterion is converged-pass', () => {
  const run = { selfDeclared: ['C-002'], criteriaIds: ['C-001', 'C-002'], iterations: [{ n: 1, verdicts: { 'C-001': 'PASS', 'C-002': 'PASS' } }] };
  assert.equal(converged(run), 'converged-pass');
});

test('converged: all PASS but every passing criterion is self-declared is converged-pass-weak', () => {
  const run = { selfDeclared: ['C-002'], criteriaIds: ['C-002'], iterations: [{ n: 1, verdicts: { 'C-002': 'PASS' } }] };
  assert.equal(converged(run), 'converged-pass-weak');
});

test('converged: UNVERIFIABLE counts as not-passing', () => {
  const run = { selfDeclared: [], criteriaIds: ['C-001'], iterations: [{ n: 1, verdicts: { 'C-001': 'UNVERIFIABLE' } }] };
  assert.equal(converged(run), 'continue');
});

test('converged: an identical verdict map two iterations running is no-progress', () => {
  const v = { 'C-001': 'FAIL', 'C-002': 'PASS' };
  const run = { selfDeclared: [], criteriaIds: ['C-001', 'C-002'], iterations: [{ n: 1, verdicts: v }, { n: 2, verdicts: { ...v } }] };
  assert.equal(converged(run), 'no-progress');
});

test('converged: no-progress wins over iteration-cap when both apply', () => {
  const v = { 'C-001': 'FAIL' };
  const run = { selfDeclared: [], criteriaIds: ['C-001'], iterations: [{ n: 1, verdicts: { ...v } }, { n: 2, verdicts: { ...v } }, { n: 3, verdicts: { ...v } }] };
  assert.equal(converged(run), 'no-progress');
});

test('converged: cap reached with changing verdicts is iteration-cap', () => {
  const run = { selfDeclared: [], criteriaIds: ['C-001', 'C-002'], iterations: [
    { n: 1, verdicts: { 'C-001': 'FAIL', 'C-002': 'FAIL' } },
    { n: 2, verdicts: { 'C-001': 'PASS', 'C-002': 'FAIL' } },
    { n: 3, verdicts: { 'C-001': 'FAIL', 'C-002': 'FAIL' } },
  ] };
  assert.equal(converged(run), 'iteration-cap');
});

test('converged: an invalid-dispatch iteration does not count toward the cap', () => {
  const run = { selfDeclared: [], criteriaIds: ['C-001'], iterations: [
    { n: 1, verdicts: {}, invalidDispatch: true },
    { n: 2, verdicts: { 'C-001': 'FAIL' } },
  ] };
  assert.equal(converged(run), 'continue');
});

test('converged: a run with no valid iterations continues', () => {
  assert.equal(converged({ selfDeclared: [], criteriaIds: ['C-001'], iterations: [] }), 'continue');
});

test('converged: an incomplete verdict map (5 expected, 3 present and all PASS) is not converged-pass', () => {
  const run = { selfDeclared: [], criteriaIds: ['C-001', 'C-002', 'C-003', 'C-004', 'C-005'], iterations: [{ n: 1, verdicts: { 'C-001': 'PASS', 'C-002': 'PASS', 'C-003': 'PASS' } }] };
  assert.equal(converged(run), 'continue');
});

test('converged: a complete all-PASS map with a non-self-declared id is still converged-pass', () => {
  const run = { selfDeclared: [], criteriaIds: ['C-001'], iterations: [{ n: 1, verdicts: { 'C-001': 'PASS' } }] };
  assert.equal(converged(run), 'converged-pass');
});

test('converged: a run with missing criteriaIds throws with exit code 2', () => {
  const run = { selfDeclared: [], iterations: [{ n: 1, verdicts: { 'C-001': 'PASS' } }] };
  let err;
  assert.throws(() => {
    try { converged(run); } catch (e) { err = e; throw e; }
  });
  assert.equal(err.exitCode, 2);
  assert.match(err.message, /criteriaIds/);
});
