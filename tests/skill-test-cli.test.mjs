import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../tools/skill-test.mjs', import.meta.url));
const run = (args) => execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
const runCode = (args) => {
  try { execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', stdio: 'pipe' }); return 0; }
  catch (e) { return e.status; }
};
const newDir = () => mkdtempSync(join(tmpdir(), 'twt-cli-'));

test('no verb exits 1 with usage', () => {
  assert.equal(runCode([]), 1);
});

test('seed creates a marked target; clean removes it', () => {
  const target = join(newDir(), 'target');
  run(['seed', target, '--skill', 'twt-demo']);
  assert.ok(existsSync(join(target, '.twt-skill-test-owned')));
  run(['clean', target]);
  assert.equal(existsSync(target), false);
});

test('seed exits 3 on a non-empty unmarked tree', () => {
  const target = join(newDir(), 'real');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'file.md'), 'x');
  assert.equal(runCode(['seed', target, '--skill', 'twt-demo']), 3);
  assert.ok(existsSync(join(target, 'file.md')));
});

test('criteria --check exits 4 when the file changed after freeze', () => {
  const runDir = newDir();
  const critDir = join(newDir(), 'crit');
  mkdirSync(critDir, { recursive: true });
  const critFile = join(critDir, 'twt-demo.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');

  run(['criteria', 'twt-demo', '--file', critFile, '--freeze', runDir]);
  assert.equal(runCode(['criteria', 'twt-demo', '--file', critFile, '--check', runDir]), 0);

  writeFileSync(critFile, '### C-001 · contract · SOFTENED\n\n- **self-declared:** no\n');
  assert.equal(runCode(['criteria', 'twt-demo', '--file', critFile, '--check', runDir]), 4);
});

test('converged prints the stop reason on stdout', () => {
  const runDir = newDir();
  const critFile = join(newDir(), 'c.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');
  run(['criteria', 'twt-demo', '--file', critFile, '--freeze', runDir]);
  const verdicts = join(newDir(), 'v.json');
  writeFileSync(verdicts, JSON.stringify({ 'C-001': 'PASS' }));
  run(['ledger', runDir, '--iteration', '1', '--verdicts', verdicts]);
  assert.match(run(['converged', runDir]), /converged-pass/);
});

test('report writes report.md into the run dir', () => {
  const runDir = newDir();
  const critFile = join(newDir(), 'c.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');
  run(['criteria', 'twt-demo', '--file', critFile, '--freeze', runDir]);
  const verdicts = join(newDir(), 'v.json');
  writeFileSync(verdicts, JSON.stringify({ 'C-001': 'PASS' }));
  run(['ledger', runDir, '--iteration', '1', '--verdicts', verdicts]);
  run(['converged', runDir]);
  run(['report', runDir]);
  assert.match(readFileSync(join(runDir, 'report.md'), 'utf8'), /dispatch-fidelity/);
});

test('guard reports a dirty tree as commit-blocked', () => {
  const repo = newDir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'untracked.md'), 'x');
  const out = JSON.parse(run(['guard', repo]));
  assert.equal(out.clean, false);
  assert.equal(out.mayCommit, false);
});

test('guard reports a clean tree as commit-allowed', () => {
  const repo = newDir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const out = JSON.parse(run(['guard', repo]));
  assert.equal(out.clean, true);
  assert.equal(out.mayCommit, true);
});
