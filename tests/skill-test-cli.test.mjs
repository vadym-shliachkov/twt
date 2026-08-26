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

// Finding 7: --iterations is documented but was never threaded to converged()'s
// cap. --cap on the converged verb is what makes that wiring possible.
test('converged --cap overrides the default 3-iteration cap', () => {
  const runDir = newDir();
  const critFile = join(newDir(), 'c.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');
  run(['criteria', 'twt-demo', '--file', critFile, '--freeze', runDir]);
  const v = join(newDir(), 'v.json');
  writeFileSync(v, JSON.stringify({ 'C-001': 'FAIL' }));
  run(['ledger', runDir, '--iteration', '1', '--verdicts', v]);
  assert.match(run(['converged', runDir, '--cap', '1']), /iteration-cap/);
});

test('converged defaults to a cap of 3 when --cap is absent', () => {
  const runDir = newDir();
  const critFile = join(newDir(), 'c.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');
  run(['criteria', 'twt-demo', '--file', critFile, '--freeze', runDir]);
  const v = join(newDir(), 'v.json');
  writeFileSync(v, JSON.stringify({ 'C-001': 'FAIL' }));
  run(['ledger', runDir, '--iteration', '1', '--verdicts', v]);
  assert.match(run(['converged', runDir]), /continue/);
});

// Finding 8: flag() must not read a trailing flag as `undefined`, and must
// not swallow the next flag's name as if it were this flag's value.
test('flag() defaults a trailing --tree-clean to the safer false, not true', () => {
  const runDir = newDir();
  const critFile = join(newDir(), 'c.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');
  // --tree-clean is the last token on the line — nothing follows it. A
  // malformed invocation must not silently flip toward "the tree was clean".
  run(['criteria', 'twt-demo', '--file', critFile, '--freeze', runDir, '--tree-clean']);
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(meta.startTreeClean, false);
});

test('flag() does not swallow the next flag\'s name as its own value', () => {
  const runDir = newDir();
  const critFile = join(newDir(), 'c.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');
  // --target is immediately followed by another flag, not a value.
  run(['criteria', 'twt-demo', '--file', critFile, '--freeze', runDir, '--target', '--tree-clean', 'true']);
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(meta.target, '');
  assert.equal(meta.startTreeClean, true);
});

// Finding 5(c): the `finding` verb is how the skill records a contract
// BLOCKER (root-honouring) or an out-of-boundary proposed patch so it
// survives to run.json and renders in the report.
test('finding appends a BLOCKER to run.json', () => {
  const runDir = newDir();
  const critFile = join(newDir(), 'c.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');
  run(['criteria', 'twt-demo', '--file', critFile, '--freeze', runDir]);
  run(['finding', runDir, '--tier', 'BLOCKER', '--title', 'root-honouring violation', '--where', 'target', '--problem', 'wrote to repo root', '--recommendation', 'fix root resolution']);
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(meta.findings.length, 1);
  assert.equal(meta.findings[0].tier, 'BLOCKER');
  assert.equal(meta.findings[0].outOfBoundary, false);
});

test('finding --out-of-boundary true records a proposed patch', () => {
  const runDir = newDir();
  const critFile = join(newDir(), 'c.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');
  run(['criteria', 'twt-demo', '--file', critFile, '--freeze', runDir]);
  run(['finding', runDir, '--tier', 'WARNING', '--title', 'shared bug', '--where', 'tools/x.mjs:1', '--problem', 'p', '--recommendation', 'r', '--out-of-boundary', 'true', '--patch', 'change x to y']);
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(meta.findings[0].outOfBoundary, true);
  assert.equal(meta.findings[0].patch, 'change x to y');
});

// Regression-of-the-fix (coordinator finding A): the Finding-8 flag() guard
// that rejects a `--`-leading value as a flag's value also swallowed a
// LEGITIMATE `--`-leading value — many twt skills take their own `--live`
// style flags, and a pasted diff for --patch starts with `---`. The escape
// hatch is `--name=value`, which must survive a value that itself starts
// with `--` untouched.
test('flag() --name=value lets --args carry a value starting with -- (e.g. --live)', () => {
  const runDir = newDir();
  const critFile = join(newDir(), 'c.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');
  run(['criteria', 'twt-skill-test', '--file', critFile, '--freeze', runDir]);
  run(['inject', 'twt-skill-test', '--run', runDir, '--target', 'C:/tmp/skill-test-flag-test', '--iteration', '1', '--args=--live']);
  const prompt = readFileSync(join(runDir, 'iteration-1', 'prompt.md'), 'utf8');
  assert.match(prompt, /Arguments: --live/);
  assert.doesNotMatch(prompt, /Arguments: \(none\)/);
});

test('flag() --name=value lets --patch carry a pasted diff starting with ---', () => {
  const runDir = newDir();
  const critFile = join(newDir(), 'c.md');
  writeFileSync(critFile, '### C-001 · contract · a\n\n- **self-declared:** no\n');
  run(['criteria', 'twt-demo', '--file', critFile, '--freeze', runDir]);
  run(['finding', runDir, '--tier', 'WARNING', '--title', 't', '--where', 'w', '--problem', 'p', '--recommendation', 'r', '--out-of-boundary', 'true', '--patch=--- a/file\n+++ b/file']);
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  assert.equal(meta.findings[0].patch, '--- a/file\n+++ b/file');
});
