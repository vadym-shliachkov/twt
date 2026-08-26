import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../tools/skill-test.mjs', import.meta.url));
const CRIT = fileURLToPath(new URL('./skill-criteria/twt-ia-define.md', import.meta.url));
const run = (args) => execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
const newDir = () => mkdtempSync(join(tmpdir(), 'twt-int-'));

test('the shipped twt-ia-define criteria file parses and declares one self-declared criterion', () => {
  const out = JSON.parse(run(['criteria', 'twt-ia-define', '--file', CRIT]));
  assert.equal(out.criteria.length, 5);
  assert.deepEqual(out.criteria.filter(c => c.selfDeclared).map(c => c.id), ['C-005']);
});

test('a full three-iteration cycle records verdicts and stops at the cap', () => {
  const runDir = newDir();
  const target = join(newDir(), 'target');
  run(['criteria', 'twt-ia-define', '--file', CRIT, '--freeze', runDir, '--target', target]);
  run(['seed', target, '--skill', 'twt-ia-define']);
  assert.ok(existsSync(join(target, '.twt-skill-test-owned')));

  run(['inject', 'twt-ia-define', '--run', runDir, '--target', target, '--iteration', '1']);
  const promptPath = join(runDir, 'iteration-1', 'prompt.md');
  assert.ok(existsSync(promptPath));

  // Strengthened assertions (Task 10 correction #3): Task 8's CLI test never
  // exercised `inject` at all, so this is the harness's only CLI-level coverage
  // of it. A weak assertion here (file merely exists) would miss a runner that
  // silently falls back to the Skill tool and grades a stale cached plugin copy.
  const prompt = readFileSync(promptPath, 'utf8');
  assert.match(prompt, /Do NOT call the Skill tool/);
  assert.ok(
    !prompt.includes('${CLAUDE_PLUGIN_ROOT}'),
    'every ${CLAUDE_PLUGIN_ROOT} occurrence must have been substituted',
  );
  const runAfterInject = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(typeof runAfterInject.substitutions, 'number');
  assert.ok(runAfterInject.substitutions > 0);

  for (const n of [1, 2, 3]) {
    const v = join(newDir(), `v${n}.json`);
    // C-001 flips each iteration so the run is NOT no-progress and reaches the cap
    writeFileSync(v, JSON.stringify({
      'C-001': n === 2 ? 'PASS' : 'FAIL', 'C-002': 'PASS', 'C-003': 'PASS',
      'C-004': 'PASS', 'C-005': 'PASS',
    }));
    run(['ledger', runDir, '--iteration', String(n), '--verdicts', v]);
  }
  assert.match(run(['converged', runDir]), /iteration-cap/);

  run(['report', runDir]);
  const report = readFileSync(join(runDir, 'report.md'), 'utf8');
  assert.match(report, /dispatch-fidelity: injected/);
  assert.match(report, /\| C-005 \(self-declared\) \|/);
  assert.match(report, /No commit was made/);

  run(['clean', target]);
  assert.equal(existsSync(target), false);
});

test('an all-self-declared pass is reported as weak, not clean', () => {
  const runDir = newDir();
  const crit = join(newDir(), 'weak.md');
  writeFileSync(crit, '### C-001 · quality · x\n\n- **self-declared:** yes\n');
  run(['criteria', 'twt-weak', '--file', crit, '--freeze', runDir]);
  const v = join(newDir(), 'v.json');
  writeFileSync(v, JSON.stringify({ 'C-001': 'PASS' }));
  run(['ledger', runDir, '--iteration', '1', '--verdicts', v]);
  assert.match(run(['converged', runDir]), /converged-pass-weak/);
});
