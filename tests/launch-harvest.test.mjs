// tests/launch-harvest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { harvest } from '../skills/twt-launch-audit/tools/launch-audit/harvest.mjs';

const CHECKLIST_XLSX = fileURLToPath(new URL('../tools/checklist-xlsx.py', import.meta.url));
// The workbook read path needs python + openpyxl; self-skip rather than fail
// where absent (mirrors tests/checklist-xlsx.test.mjs's own convention).
function python() {
  for (const bin of ['python', 'python3', 'py']) {
    try { execFileSync(bin, ['-c', 'import openpyxl'], { stdio: 'ignore' }); return bin; } catch { /* try next */ }
  }
  return null;
}

const newProject = () => mkdtempSync(join(tmpdir(), 'twt-harv-'));
function put(p, content) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content, 'utf8'); }
// harvest() reads files itself (its own readOr), so the ctx it needs is only
// projectDir + rel. Do not add a `read` here — an ESM test file has no
// `require`, and a ctx that carries unused keys hides what the module depends on.
const ctx = (dir) => ({
  projectDir: dir,
  rel: (p) => p.replace(dir, '').replace(/^[\\/]/, '').replace(/\\/g, '/'),
});

test('harvest: an empty project reports every artifact absent, status ok', () => {
  const h = harvest(ctx(newProject()));
  assert.equal(h.status, 'ok', 'absence is not an error');
  assert.equal(h.qa.present, false);
  assert.equal(h.gaps.present, false);
  assert.equal(h.approval.present, false);
  assert.deepEqual(h.validations, []);
});

test('harvest: qa-report.md verdict and counts are parsed from the report', () => {
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'qa', 'qa-report.md'), [
    '---', 'generated: 2026-07-20', 'phase: qa', 'verdict: FAIL', '---', '',
    '# QA report', '', '## Verdict',
    'FAIL  ·  BLOCKER: 3 · WARNING: 7 · SUGGESTION: 2', '',
  ].join('\n'));
  const h = harvest(ctx(dir));
  assert.equal(h.qa.present, true);
  assert.equal(h.qa.verdict, 'FAIL');
  assert.equal(h.qa.blockers, 3);
  assert.equal(h.qa.warnings, 7);
  assert.equal(h.qa.generated, '2026-07-20');
});

test('harvest: a PASS qa-report with zero blockers parses to 0', () => {
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'qa', 'qa-report.md'),
    '---\nverdict: PASS\n---\n\n## Verdict\nPASS  ·  BLOCKER: 0 · WARNING: 1 · SUGGESTION: 0\n');
  const h = harvest(ctx(dir));
  assert.equal(h.qa.verdict, 'PASS');
  assert.equal(h.qa.blockers, 0);
});

test('harvest: gaps.md open checkbox items are counted, closed ones are not', () => {
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'qa', 'gaps.md'), [
    '# Outstanding items', '', '## Home',
    '- [ ] LOREM — .hero p — placeholder text',
    '- [ ] DEAD-LINK — /careers — points nowhere',
    '- [x] EMPTY — .about p — resolved',
  ].join('\n'));
  const h = harvest(ctx(dir));
  assert.equal(h.gaps.present, true);
  assert.equal(h.gaps.open_items, 2);
});

test('harvest: gaps.md with the no-gaps sentence reports zero open items', () => {
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'qa', 'gaps.md'),
    '# Outstanding items\n\nNo outstanding content or link items — all real.\n');
  assert.equal(harvest(ctx(dir)).gaps.open_items, 0);
});

test('harvest: every validation-report.md is found with its BLOCKER count', () => {
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'pre-design', 'brand', 'validation-report.md'),
    '# Validation\n\n### BLOCKER — voice undefined\nWhere: brand-brief.md\n');
  put(join(dir, '.twt-artifacts', 'design', 'design-system', 'validation-report.md'),
    '# Validation\n\nNo blockers found.\n');
  const h = harvest(ctx(dir));
  assert.equal(h.validations.length, 2);
  const brand = h.validations.find((v) => v.path.includes('brand'));
  assert.equal(brand.blockers, 1);
  const ds = h.validations.find((v) => v.path.includes('design-system'));
  assert.equal(ds.blockers, 0);
});

test('harvest: seo-map page count and assets-manifest unfilled pools are read', () => {
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'pre-design', 'seo', 'seo-map.md'),
    '# SEO map\n\n## /\nkeywords: a\n\n## /about\nkeywords: b\n\n## /contact\nkeywords: c\n');
  put(join(dir, '.twt-artifacts', 'design', 'assets', 'manifest.md'),
    '# Manifest\n\n| slot | status |\n| hero | TBD |\n| logo | provided |\n| og | TBD |\n');
  const h = harvest(ctx(dir));
  assert.equal(h.seo_map.present, true);
  assert.equal(h.seo_map.pages, 3);
  assert.equal(h.assets_manifest.unfilled, 2);
});

test('harvest: a missing approval workbook is absent, not an error', () => {
  const h = harvest(ctx(newProject()));
  assert.equal(h.approval.present, false);
  assert.equal(h.status, 'ok');
});

test('harvest: an unreadable approval workbook degrades to partial with a note', () => {
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'content-approval', 'content-approval-checklist.xlsx'), 'not really a workbook');
  const h = harvest(ctx(dir));
  assert.equal(h.approval.present, true);
  assert.equal(h.approval.reader, 'failed');
  assert.equal(h.status, 'partial');
  assert.ok(h.notes.some((n) => /workbook/i.test(n)), 'the failure must be named in notes');
});

test('harvest: staleness comes from status-scan and never throws', () => {
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'pre-design', 'brand', 'brand-brief.md'), '# brief');
  const h = harvest(ctx(dir));
  assert.ok(['ok', 'failed'].includes(h.staleness.status));
  assert.equal(typeof h.staleness.stale, 'number');
});

// ---- regression tests: real artifact formats, found while verifying the plan's
// ---- sample regexes/field names against the actual producers in this repo ----

test('regression: BLOCKER count matches the canonical "### N. [TIER] title" heading every *-validate skill emits', () => {
  // Every skills/twt-*-validate/SKILL.md finding template (and the repo's own
  // .twt-artifacts/self-test fixture) writes "### 1. [BLOCKER] <title>" — a
  // numbered heading with the tier bracketed. A regex that requires BLOCKER
  // immediately after the "#"s never matches this, so a real project's
  // validation-report.md would always harvest blockers:0 even when full of
  // BLOCKER findings — a false-clean read, exactly what "absence is not an
  // error" is supposed to guard against for genuine absence, not this.
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'pre-design', 'brand', 'validation-report.md'), [
    '# Validation report — brand', '',
    '## Findings',
    '### 1. [BLOCKER] voice undefined',
    '- **Where:** brand-brief.md',
    '- **Problem:** no voice section',
    '- **Recommendation:** add one',
    '### 2. [WARNING] logo usage thin',
    '- **Where:** brand-brief.md',
  ].join('\n'));
  const h = harvest(ctx(dir));
  assert.equal(h.validations.length, 1);
  assert.equal(h.validations[0].blockers, 1, 'must count the canonical numbered/bracketed BLOCKER heading, not just a bare "### BLOCKER" one');
});

test('regression: seo-map page count is scoped to the "## Pages" section, not every "##" heading', () => {
  // twt-seo-define's real seo-map.md nests "### <page> (`/<slug>`)" per page
  // under "## Pages", alongside sibling "## Keyword themes" and "## Redirects"
  // sections. Counting every "##" heading in the document counts those three
  // wrapper sections as if each were a page, regardless of how many real
  // pages exist.
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'pre-design', 'seo', 'seo-map.md'), [
    '# SEO map', '',
    '## Keyword themes',
    '| Theme | Source | Pages |',
    '|-------|--------|-------|', '',
    '## Pages',
    '### Home (`/`)',
    '- **Primary keyword:** acme', '',
    '### About (`/about`)',
    '- **Primary keyword:** acme team', '',
    '## Redirects',
    '| Old URL | Action | Target | Why |',
    '|---------|--------|--------|-----|',
  ].join('\n'));
  const h = harvest(ctx(dir));
  assert.equal(h.seo_map.pages, 2, 'must count the 2 real "### <page>" entries under ## Pages, not the 3 "##" wrapper sections');
});

test('regression: assets-manifest unfilled count reads the real status vocabulary (planned/pending-*/missing-provided), not the literal word TBD', () => {
  // twt-assets-produce's manifest.md status column vocabulary is planned /
  // provided / generated / pending-stock / pending-video / missing-provided —
  // never the free-text words TBD/TODO/pending/missing the plan's original
  // regex searched the whole document for. A real manifest full of "planned"
  // rows would harvest unfilled:0 every time.
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'design', 'assets', 'manifest.md'), [
    '| id | type | filename | placement | spec | alt | source | generation_prompt | status |',
    '|----|------|----------|-----------|------|-----|--------|--------------------|--------|',
    '| hero-1 | image | hero.png | home hero | 1600x900 | Team at work | stock | wide shot, natural light | pending-stock |',
    '| logo | image | logo.svg | header | 200x60 | Acme logo | provided | — | provided |',
    '| og-default | meta | og-default.png | og | 1200x630 | — | generated | brand card | generated |',
    '| icon-1 | icon | check.svg | features | 24x24 | — | generated | check icon | planned |',
  ].join('\n'));
  const h = harvest(ctx(dir));
  assert.equal(h.assets_manifest.unfilled, 2, 'pending-stock and planned rows are unfilled; provided and generated rows are not');
});

test('regression: staleness stale_paths names the actual stale artifact, reading status-scan\'s real "rows[].label/status" shape', () => {
  // status-scan.mjs's real machine block is { stale, rows: [{ label, status,
  // because }] } — not { artifacts: [{ path, state }] }. The top-level
  // `stale` count happened to already line up with the plan's assumption, so
  // this bug never throws and never trips the "stale" number check — only a
  // check against stale_paths' actual contents catches it.
  const dir = newProject();
  const brandPath = join(dir, '.twt-artifacts', 'pre-design', 'brand', 'brand-brief.md');
  const posPath = join(dir, '.twt-artifacts', 'pre-design', 'positioning', 'positioning.md');
  put(posPath, '# old positioning');
  put(brandPath, '# brief');
  const past = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(posPath, past, past);  // positioning now predates brand-brief -> STALE
  const h = harvest(ctx(dir));
  assert.equal(h.staleness.status, 'ok');
  assert.equal(h.staleness.stale, 1);
  assert.equal(h.staleness.stale_paths.length, 1, 'stale_paths must name the stale artifact, not stay empty');
  assert.match(h.staleness.stale_paths[0], /positioning/);
});

test('regression: a valid approval workbook is read via checklist-xlsx.py\'s real "summary.total_rows" shape, not "totals.total"', () => {
  const bin = python();
  if (!bin) { console.log('  (skipped: python/openpyxl unavailable)'); return; }
  const dir = newProject();
  const specPath = join(dir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({
    worksheets: [{ name: 'Home', blocks: [{ name: 'Hero', rows: [
      { field_type: 'text:headline', current: 'Lorem', recommended: 'Real copy', approved: 'Real copy', ready: true },
      { field_type: 'text:sub', current: '', recommended: 'x', approved: '', ready: false },
    ] }] }],
  }));
  const wbPath = join(dir, '.twt-artifacts', 'content-approval', 'content-approval-checklist.xlsx');
  mkdirSync(dirname(wbPath), { recursive: true });
  execFileSync(bin, [CHECKLIST_XLSX, 'build', '--spec', specPath, '--out', wbPath]);
  const h = harvest(ctx(dir));
  assert.equal(h.approval.present, true);
  assert.equal(h.approval.reader, 'ok');
  assert.equal(h.approval.total, 2);
  assert.equal(h.approval.ready, 1);
  assert.equal(h.approval.not_ready, 1);
  assert.equal(h.approval.ready_but_blank, 0);
});
