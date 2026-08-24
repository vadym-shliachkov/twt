// tests/launch-lint.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const LINT = fileURLToPath(new URL('../skills/twt-launch-audit/tools/launch-lint.mjs', import.meta.url));
const newOut = () => { const d = mkdtempSync(join(tmpdir(), 'twt-lint-')); mkdirSync(d, { recursive: true }); return d; };
const write = (dir, payload) => writeFileSync(join(dir, 'findings.json'), JSON.stringify(payload, null, 2), 'utf8');
const read = (dir) => JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf8'));
function lint(dir, ...args) {
  try {
    const out = execFileSync(process.execPath, [LINT, dir, ...args], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}

const good = {
  rule: 'DISC001', category: 'discoverability', severity: 'LAUNCH-BLOCKER', owner: 'developer',
  where: 'site/a.html:3', evidence: 'meta robots noindex',
  impact: 'The site will not appear in search results.', action: 'Remove the meta robots tag before deploy.',
  id: 'DISC001-site/a.html:3', blocking: true, source: 'rule',
};
const payload = (findings, extra = {}) => ({
  tool: 'launch-audit', version: 1, generated: '2026-07-30T00:00:00.000Z',
  layers: { scan: 'ok', harvest: 'ok', live: 'skipped' },
  verdict: 'NO-GO', counts: {}, findings, interview: [], ...extra,
});

test('lint: a fully formed findings file passes', () => {
  const dir = newOut();
  write(dir, payload([good]));
  assert.equal(lint(dir).code, 0);
});

test('lint: a missing findings.json exits 2', () => {
  assert.equal(lint(newOut()).code, 2);
});

test('lint: no arguments exits 2', () => {
  try { execFileSync(process.execPath, [LINT], { encoding: 'utf8' }); assert.fail('should exit 2'); }
  catch (e) { assert.equal(e.status, 2); }
});

test('lint: an owner outside the vocabulary is an error', () => {
  const dir = newOut();
  write(dir, payload([{ ...good, owner: 'Client' }]));
  const r = lint(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /bad owner "Client"/);
});

test('lint: a severity outside the four tiers is an error', () => {
  const dir = newOut();
  write(dir, payload([{ ...good, severity: 'Blocker' }]));
  assert.equal(lint(dir).code, 1);
});

test('lint: a missing impact or action is an error', () => {
  const dir = newOut();
  write(dir, payload([{ ...good, impact: '' }]));
  let r = lint(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /impact/);
  write(dir, payload([{ ...good, action: null }]));
  r = lint(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /action/);
});

test('lint: blocking out of step with severity is an error', () => {
  const dir = newOut();
  write(dir, payload([{ ...good, severity: 'NICE-TO-HAVE', blocking: true }]));
  const r = lint(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /blocking/);
});

test('lint: a verdict contradicting the findings is an error', () => {
  const dir = newOut();
  write(dir, payload([good], { verdict: 'GO' }));
  const r = lint(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /verdict/i);
});

test('lint: an UNVERIFIED finding whose owner cannot act is an error', () => {
  const dir = newOut();
  write(dir, payload([{ ...good, severity: 'UNVERIFIED', where: '', evidence: 'unknown' }]));
  assert.equal(lint(dir).code, 1, 'an UNVERIFIED finding still needs a where');
});

test('lint --fix: derives id, blocking, and source, then sorts blockers first', () => {
  const dir = newOut();
  const nice = { rule: 'PERF002', category: 'performance', severity: 'NICE-TO-HAVE', owner: 'developer',
    where: 'site/a.html:8', evidence: 'no lazy', impact: 'Minor shift.', action: 'Add loading=lazy.' };
  const blocker = { rule: 'DISC001', category: 'discoverability', severity: 'LAUNCH-BLOCKER', owner: 'developer',
    where: 'site/a.html:3', evidence: 'noindex', impact: 'Deindexed.', action: 'Remove it.' };
  write(dir, payload([nice, blocker]));
  assert.equal(lint(dir, '--fix').code, 0);
  const fixed = read(dir);
  assert.equal(fixed.findings[0].rule, 'DISC001', 'blockers sort first');
  assert.equal(fixed.findings[0].id, 'DISC001-site/a.html:3');
  assert.equal(fixed.findings[0].blocking, true);
  assert.equal(fixed.findings[1].blocking, false);
  assert.equal(fixed.findings[0].source, 'model', 'a finding with no source is the model\'s');
  assert.equal(lint(dir).code, 0, 'the fixed file must then lint clean');
});

test('lint --fix: recomputes the verdict from the findings', () => {
  const dir = newOut();
  write(dir, payload([{ ...good, id: undefined, blocking: undefined, source: undefined }], { verdict: 'GO' }));
  lint(dir, '--fix');
  assert.equal(read(dir).verdict, 'NO-GO');
});

test('lint --fix: does not invent an impact or action', () => {
  const dir = newOut();
  write(dir, payload([{ ...good, id: undefined, impact: '', action: '' }]));
  assert.equal(lint(dir, '--fix').code, 1, 'judgment is never derived — the model must supply it');
});

test('lint: an incomplete scan with a non-provisional verdict is an error', () => {
  const dir = newOut();
  write(dir, payload([], { layers: { scan: 'partial', harvest: 'ok', live: 'skipped' }, verdict: 'GO' }));
  const r = lint(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /evidence incomplete/);
});

// --- Regression tests (found while implementing this task) -----------------

test('lint: an incomplete scan with a wrong verdict reports exactly one error, not two', () => {
  // verdictFor() always returns exactly "NO-GO — evidence incomplete" when
  // layers.scan !== 'ok', regardless of findings — so a separate layers.scan
  // check duplicates the contradiction check on the same bad document.
  const dir = newOut();
  write(dir, payload([], { layers: { scan: 'partial', harvest: 'ok', live: 'skipped' }, verdict: 'GO' }));
  const r = lint(dir);
  assert.equal(r.code, 1);
  const errorLines = r.out.split('\n').filter((l) => l.trim().startsWith('-'));
  assert.equal(errorLines.length, 1, `expected exactly one error line, got:\n${r.out}`);
});

test('lint --fix: a finding with no rule cannot get an id, and says so plainly', () => {
  const dir = newOut();
  const noRule = { ...good, rule: undefined, id: undefined };
  write(dir, payload([noRule]));
  const r = lint(dir, '--fix');
  assert.equal(r.code, 1, '--fix cannot derive an id without a rule, so the check must still fail');
  // Must not tell the model to do the very thing it just did.
  assert.doesNotMatch(r.out, /run with --fix/);
  assert.match(r.out, /rule/);
});

test('lint --fix: is idempotent — running it twice yields the same file', () => {
  const dir = newOut();
  const nice = { rule: 'PERF002', category: 'performance', severity: 'NICE-TO-HAVE', owner: 'developer',
    where: 'site/a.html:8', evidence: 'no lazy', impact: 'Minor shift.', action: 'Add loading=lazy.' };
  const blocker = { rule: 'DISC001', category: 'discoverability', severity: 'LAUNCH-BLOCKER', owner: 'developer',
    where: 'site/a.html:3', evidence: 'noindex', impact: 'Deindexed.', action: 'Remove it.' };
  write(dir, payload([nice, blocker]));
  lint(dir, '--fix');
  const once = read(dir);
  lint(dir, '--fix');
  const twice = read(dir);
  assert.deepEqual(twice, once);
});

test('lint: an empty findings array with a clean scan is OK with verdict GO', () => {
  const dir = newOut();
  write(dir, payload([], { verdict: 'GO' }));
  const r = lint(dir);
  assert.equal(r.code, 0);
  assert.match(r.out, /GO/);
});
