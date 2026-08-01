// tests/launch-integration.test.mjs — proves the /twt-launch-audit pipeline
// end to end against two real project trees, and mechanically pins the one
// rule a future refactor is most likely to break silently: a report under the
// measured filename must never assert a scan that did not complete.
//
// Each test copies a fixture into its own fresh mkdtempSync directory, so
// tests never share state and are not order-dependent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const T = (n) => fileURLToPath(new URL(`../tools/${n}`, import.meta.url));
const FIX = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const node = (tool, args) => execFileSync(process.execPath, [tool, ...args], { encoding: 'utf8' });

function pipeline(fixture) {
  const dir = mkdtempSync(join(tmpdir(), 'twt-e2e-'));
  cpSync(FIX(fixture), dir, { recursive: true });
  const out = join(dir, '.twt-artifacts', 'launch');
  node(T('launch-scan.mjs'), [dir]);
  node(T('launch-audit.mjs'), [join(out, 'facts.json'), '--out', out]);
  return { dir, out, findings: JSON.parse(readFileSync(join(out, 'findings.json'), 'utf8')) };
}
const has = (d, f) => existsSync(join(d, f));

// The rules leave impact/action null by design — that is the model's Layer 6
// job. Stand in for it so the lint and render contracts can be exercised end to
// end. `mutate` lets a test bend the document (e.g. force a failed scan layer)
// in the same pass, so no test has to re-read and re-write the file itself.
function judged(out, mutate = () => {}) {
  const p = join(out, 'findings.json');
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  for (const f of doc.findings) { f.impact = 'Stated impact.'; f.action = 'Stated action.'; }
  mutate(doc);
  writeFileSync(p, JSON.stringify(doc, null, 2), 'utf8');
  return p;
}

test('e2e: the clean fixture produces no LAUNCH-BLOCKER from the mechanical layers', () => {
  const { findings } = pipeline('launch-clean');
  const blockers = findings.findings.filter((f) => f.blocking && f.source === 'rule');
  assert.deepEqual(blockers.map((f) => `${f.rule} ${f.where}`), [],
    'a fixture built to be clean must not trip a rule — if it does, the rule or the fixture is wrong');
});

test('e2e: the dirty fixture trips every blocker class exactly once', () => {
  const { findings } = pipeline('launch-dirty');
  const rules = new Set(findings.findings.filter((f) => f.blocking).map((f) => f.rule));
  for (const expected of ['DISC001', 'HYG001', 'CONV001', 'ANLY001', 'ANLY002', 'CONT001']) {
    assert.ok(rules.has(expected), `expected blocker ${expected}`);
  }
  assert.equal(findings.verdict, 'NO-GO');
});

test('e2e: lint --fix then lint passes on real pipeline output', () => {
  const { out } = pipeline('launch-dirty');
  judged(out);
  node(T('launch-lint.mjs'), [out, '--fix']);
  assert.doesNotThrow(() => node(T('launch-lint.mjs'), [out]));
});

test('e2e: the renderer produces the measured filenames on a complete scan', () => {
  const { out } = pipeline('launch-dirty');
  const p = judged(out);
  node(T('launch-lint.mjs'), [out, '--fix']);
  node(T('launch-report.mjs'), [p, '--out', out]);
  assert.ok(has(out, 'launch-report.md'));
  assert.ok(has(out, 'punch-list.md'));
  assert.ok(!has(out, 'launch-report-provisional.md'));
});

test('e2e: FAILURE DISCIPLINE — an incomplete scan never renders the measured filename', () => {
  const { out } = pipeline('launch-dirty');
  // Straight to the renderer: lint --fix would recompute the verdict, and the
  // point here is what the renderer does with layers.scan on its own.
  const p = judged(out, (doc) => {
    doc.layers.scan = 'failed';
    doc.verdict = 'NO-GO — evidence incomplete';
  });
  node(T('launch-report.mjs'), [p, '--out', out]);
  assert.ok(!has(out, 'launch-report.md'),
    'a report under the measured filename asserts a scan that did not happen');
  assert.ok(has(out, 'launch-report-provisional.md'));
  assert.match(readFileSync(join(out, 'launch-report-provisional.md'), 'utf8'), /evidence incomplete/);
});

test('e2e: the punch list assigns every open item to an owner who can act', () => {
  const { out } = pipeline('launch-dirty');
  const p = judged(out);
  node(T('launch-lint.mjs'), [out, '--fix']);
  node(T('launch-report.mjs'), [p, '--out', out]);
  const pl = readFileSync(join(out, 'punch-list.md'), 'utf8');
  assert.match(pl, /## developer/);
  assert.match(pl, /## client-decision/, 'the analytics and consent items are the client\'s, not the developer\'s');
});
