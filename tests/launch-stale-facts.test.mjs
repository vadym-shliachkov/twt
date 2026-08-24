// tests/launch-stale-facts.test.mjs — the rules must refuse a facts.json that
// the disk has moved past.
//
// Observed failure: Step 3 of the command dispatches /twt-qa to fill an evidence
// gap and then says, in prose, to re-run Step 2 so the harvest sees the new
// reports. On a real run the model dispatched QA, skipped the re-scan, and ran
// the rules against the pre-QA facts.json — so the audit shipped with
// `qa.present: false` in its own evidence file while its report cited the QA
// reports by name, and a HARV rule fired about missing QA that had existed for
// two minutes. An instruction that the next step can silently skip is not a
// guarantee; this is the same instruction, enforced where it can be checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const AUDIT = fileURLToPath(new URL('../skills/twt-launch-audit/tools/launch-audit.mjs', import.meta.url));
const SCANNED_AT = new Date('2026-08-05T08:00:00.000Z');

function project({ qaPresent = false, qaWrittenAt = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'twt-stale-'));
  const qaDir = join(dir, '.twt-artifacts', 'qa');
  mkdirSync(qaDir, { recursive: true });
  if (qaWrittenAt) {
    const p = join(qaDir, 'qa-report.md');
    writeFileSync(p, '# QA report\n', 'utf8');
    utimesSync(p, qaWrittenAt, qaWrittenAt);
  }
  const facts = {
    tool: 'launch-scan', version: 1, generated: SCANNED_AT.toISOString(), project: dir,
    mode: 'local', url: null,
    sources: { kind: 'html', base: dir, html: [], css: [], theme: null, deploy: null },
    layers: { scan: 'ok', harvest: 'ok', live: 'skipped' },
    checks: {},
    harvest: {
      status: 'ok',
      qa: { present: qaPresent, path: '.twt-artifacts/qa/qa-report.md' },
      gaps: { present: false, path: '.twt-artifacts/qa/gaps.md' },
      validations: [],
      seo_map: { present: false, path: '.twt-artifacts/pre-design/seo/seo-map.md' },
      assets_manifest: { present: false, path: '.twt-artifacts/design/assets/manifest.md' },
      approval: { present: false, path: '.twt-artifacts/content-approval/content-approval-checklist.xlsx' },
      staleness: { status: 'ok', stale: 0, stale_paths: [] },
      notes: [],
    },
  };
  const factsPath = join(dir, 'facts.json');
  writeFileSync(factsPath, JSON.stringify(facts, null, 2), 'utf8');
  return { dir, factsPath, out: join(dir, 'out') };
}

const run = (p) => spawnSync(process.execPath, [AUDIT, p.factsPath, '--out', p.out], { encoding: 'utf8' });

test('rules: a harvested report written after the scan stops the run', () => {
  // QA ran two minutes after the scan — exactly the Step 3 dispatch shape.
  const p = project({ qaPresent: false, qaWrittenAt: new Date(SCANNED_AT.getTime() + 120_000) });
  const r = run(p);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stderr}${r.stdout}`);
  assert.match(r.stderr, /qa-report\.md/, 'the message must name the file that moved');
  assert.match(r.stderr, /launch-scan\.mjs/, 'and the command that fixes it');
  assert.ok(!existsSync(join(p.out, 'findings.json')), 'nothing may be written from stale facts');
});

test('rules: a harvested report older than the scan is fine', () => {
  const p = project({ qaPresent: true, qaWrittenAt: new Date(SCANNED_AT.getTime() - 120_000) });
  const r = run(p);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  assert.ok(existsSync(join(p.out, 'findings.json')));
});

test('rules: a harvest source that never appeared on disk is not stale, just absent', () => {
  // The ordinary first-run shape: no QA anywhere. That is an UNVERIFIED finding,
  // not a stale-evidence error — the guard must not turn every fresh project
  // into a hard failure.
  const p = project({ qaPresent: false, qaWrittenAt: null });
  const r = run(p);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  assert.ok(existsSync(join(p.out, 'findings.json')));
});

test('rules: facts.json with no project path degrades to running, not to a false alarm', () => {
  // Older facts files have no `project` key; without it the guard cannot resolve
  // a relative harvest path and must stand down rather than guess.
  const p = project({ qaWrittenAt: new Date(SCANNED_AT.getTime() + 120_000) });
  const facts = JSON.parse(readFileSync(p.factsPath, 'utf8'));
  delete facts.project;
  writeFileSync(p.factsPath, JSON.stringify(facts), 'utf8');
  const r = run(p);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
});
