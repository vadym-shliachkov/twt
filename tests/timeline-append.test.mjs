import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (e.g. this repo lives under "C:\Work\~marketplace", and
// Node percent-encodes "~" to "%7E" in import.meta.url) are decoded correctly.
const HOOK = fileURLToPath(new URL('../hooks/twt-debug-log.js', import.meta.url));

function run(dir, args) {
  return execFileSync(process.execPath, [HOOK, ...args], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
}

const LOG_FIXTURE = `# Session log

## Run 2026-07-13T10:00:00Z
**Command:** /twt-site
**Mode:** interactive

### Timeline
1. [question] Stage: What stage is this build? → New build
2. [step] Pre-design: twt-pre-design — establishes brand first

### Outcome
`;

function newProject(log = LOG_FIXTURE) {
  const dir = mkdtempSync(join(tmpdir(), 'twt-timeline-'));
  mkdirSync(join(dir, '.twt-artifacts'), { recursive: true });
  writeFileSync(join(dir, '.twt-artifacts', 'site-log.md'), log, 'utf8');
  return dir;
}
const log = (dir) => readFileSync(join(dir, '.twt-artifacts', 'site-log.md'), 'utf8');

test('appends a numbered [question] entry after the last existing entry, in the harvest-parseable shape', () => {
  const dir = newProject();
  run(dir, ['--timeline', 'Target: Which build target? → HTML']);
  const text = log(dir);
  assert.match(text, /^3\. \[question\] Target: Which build target\? → HTML$/m);
  const timelineIdx = text.indexOf('### Timeline');
  const outcomeIdx = text.indexOf('### Outcome');
  const entryIdx = text.indexOf('3. [question] Target');
  assert.ok(entryIdx > timelineIdx && entryIdx < outcomeIdx, 'entry lands inside the Timeline section');
});

test('the appended line is exactly what wiki-harvest parses', () => {
  const dir = newProject();
  run(dir, ['--timeline', 'Fonts: Which pairing? → Inter + Lora']);
  // same regex wiki-harvest.mjs parseTimelineQA binds to
  const m = /^\d+\.\s*\[question\]\s*([^:]+):\s*(.+)$/m.exec(log(dir).split('\n').find((l) => /Fonts/.test(l)));
  assert.ok(m, 'line matches the harvester regex');
  assert.equal(m[1].trim(), 'Fonts');
  assert.match(m[2], /→ Inter \+ Lora/);
});

test('numbering starts at 1 under an empty Timeline', () => {
  const dir = newProject('# Session log\n\n## Run x\n\n### Timeline\n\n### Outcome\n');
  run(dir, ['--timeline', 'Stage: New? → Yes']);
  assert.match(log(dir), /^1\. \[question\] Stage: New\? → Yes$/m);
});

test('appends under the LAST Timeline when multiple runs exist', () => {
  const dir = newProject(LOG_FIXTURE + '\n## Run 2026-07-13T12:00:00Z\n\n### Timeline\n1. [question] A: b? → c\n\n### Outcome\n');
  run(dir, ['--timeline', 'B: c? → d']);
  const text = log(dir);
  assert.match(text, /^2\. \[question\] B: c\? → d$/m);
  assert.equal(/3\. \[question\] B/.test(text), false, 'numbering belongs to the last run, not the first');
});

test('no log or no Timeline heading is a silent no-op — never breaks a run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-timeline-'));
  run(dir, ['--timeline', 'X: y? → z']); // no .twt-artifacts at all
  assert.equal(existsSync(join(dir, '.twt-artifacts', 'site-log.md')), false);
  const dir2 = newProject('# Session log\nno timeline heading\n');
  const before = log(dir2);
  run(dir2, ['--timeline', 'X: y? → z']);
  assert.equal(log(dir2), before);
});
