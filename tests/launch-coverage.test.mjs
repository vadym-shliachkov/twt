// tests/launch-coverage.test.mjs — a category with nothing to read must not
// render as CLEAR.
//
// Observed failure this file exists to prevent: a run whose locator found no
// built pages at all (`sources.html: []`) still printed CLEAR for Content,
// Social, Conversion, Performance and Build hygiene, because the matrix state
// was derived from the finding count alone. Zero findings from zero input is
// not a pass — and in the run that surfaced this, "Social & brand assets:
// CLEAR" sat in the same document as a cited 404 on the site's favicon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { coverageFor } from '../tools/launch-audit/coverage.mjs';

const REPORT = fileURLToPath(new URL('../tools/launch-report.mjs', import.meta.url));
const txt = (dir, f) => readFileSync(join(dir, f), 'utf8');

function render(doc) {
  const dir = mkdtempSync(join(tmpdir(), 'twt-cov-'));
  const p = join(dir, 'findings.json');
  writeFileSync(p, JSON.stringify(doc, null, 2), 'utf8');
  execFileSync(process.execPath, [REPORT, p, '--out', dir], { encoding: 'utf8' });
  return dir;
}
const doc = (over = {}) => ({
  tool: 'launch-audit', generated: '2026-08-05T00:00:00.000Z',
  layers: { scan: 'ok', harvest: 'ok', live: 'ok' }, mode: 'local+live', url: 'https://x.test',
  verdict: 'GO', counts: { 'LAUNCH-BLOCKER': 0, 'FIX-WEEK-ONE': 0, 'NICE-TO-HAVE': 0, UNVERIFIED: 0 },
  findings: [], interview: [], ...over,
});

// ---- the derivation ---------------------------------------------------------

const facts = (over = {}) => ({
  mode: 'local+live',
  sources: { kind: null, base: null, html: [], css: [], theme: null, deploy: null },
  layers: { scan: 'ok', harvest: 'ok', live: 'ok' },
  live: { status: 'ok', checks: { reachable: true } },
  harvest: {
    status: 'ok',
    qa: { present: false }, gaps: { present: false }, validations: [],
    seo_map: { present: false }, assets_manifest: { present: false }, approval: { present: false },
  },
  ...over,
});

test('coverage: page-scoped categories are NOT assessed when the locator found no pages', () => {
  const c = coverageFor(facts());
  for (const cat of ['content', 'social', 'legal', 'analytics', 'conversion', 'performance']) {
    assert.equal(c.assessed[cat], false, `${cat} has no input when sources.html is empty`);
  }
  assert.equal(c.inputs.pages, 0);
});

test('coverage: page-scoped categories are assessed once there are pages', () => {
  const c = coverageFor(facts({ sources: { html: ['site/index.html'], css: [], base: 'site', theme: null } }));
  for (const cat of ['content', 'social', 'legal', 'analytics', 'conversion', 'performance']) {
    assert.equal(c.assessed[cat], true);
  }
  assert.equal(c.inputs.pages, 1);
});

test('coverage: the live layer alone assesses discoverability and error states', () => {
  const c = coverageFor(facts());
  assert.equal(c.assessed.discoverability, true, 'the live layer probes robots/sitemap without any local page');
  assert.equal(c.assessed.errors, true, 'the live layer probes an unknown URL without any local page');
  assert.equal(c.assessed.content, false, 'but it says nothing about content');
});

test('coverage: carried-forward is NOT assessed when the harvest found no report', () => {
  assert.equal(coverageFor(facts()).assessed.carried, false);
  const withQa = facts({ harvest: { status: 'ok', qa: { present: true }, gaps: { present: false }, validations: [] } });
  assert.equal(coverageFor(withQa).assessed.carried, true);
});

test('coverage: operational is assessed by the live layer or by stored answers', () => {
  assert.equal(coverageFor(facts({ live: { status: 'skipped' } })).assessed.operational, false);
  assert.equal(coverageFor(facts()).assessed.operational, true);
  assert.equal(coverageFor(facts({ live: { status: 'skipped' }, answers: { 'Q-DNS-SSL': { answer: 'yes' } } })).assessed.operational, true);
});

// ---- what the reader sees ---------------------------------------------------

test('report: a category with no findings and no input renders NOT ASSESSED, not CLEAR', () => {
  const assessed = Object.fromEntries(['content', 'discoverability', 'social', 'legal', 'analytics',
    'conversion', 'errors', 'performance', 'hygiene', 'carried', 'operational'].map((c) => [c, false]));
  assessed.hygiene = true;
  const dir = render(doc({ coverage: { assessed, inputs: { pages: 0, theme: false, live: false, harvest: 0 } } }));
  const md = txt(dir, 'launch-report.md');
  const row = md.split('\n').find((l) => l.includes('Social & brand'));
  assert.match(row, /NOT ASSESSED/, `social had no input: ${row}`);
  const hyg = md.split('\n').find((l) => l.includes('Build hygiene'));
  assert.match(hyg, /CLEAR/, `hygiene did read the project root: ${hyg}`);
});

test('report: NOT ASSESSED is explained where it is used, not left as a bare word', () => {
  const assessed = Object.fromEntries(['content', 'discoverability', 'social', 'legal', 'analytics',
    'conversion', 'errors', 'performance', 'hygiene', 'carried', 'operational'].map((c) => [c, false]));
  const dir = render(doc({ coverage: { assessed, inputs: { pages: 0, theme: false, live: false, harvest: 0 } } }));
  const md = txt(dir, 'launch-report.md');
  assert.match(md, /NOT ASSESSED —/, 'the matrix needs a legend line for the state');
  assert.match(md, /0 pages/, 'and must say what the scan actually had to read');
  assert.match(txt(dir, 'launch-report.html'), /NOT ASSESSED/, 'the html renders the same state as the markdown');
});

test('report: a findings.json with no coverage block keeps the old CLEAR behaviour', () => {
  // Hand-written and pre-upgrade documents must still render. Absent coverage
  // means "unknown", and unknown must not be reported as a coverage failure.
  const dir = render(doc());
  const md = txt(dir, 'launch-report.md');
  assert.ok(!md.includes('NOT ASSESSED'), 'no coverage block means no coverage claim either way');
  assert.match(md.split('\n').find((l) => l.includes('Social & brand')), /CLEAR/);
  assert.ok(existsSync(join(dir, 'launch-report.md')));
});
