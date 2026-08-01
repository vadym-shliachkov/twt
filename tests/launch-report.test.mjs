// tests/launch-report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPORT = fileURLToPath(new URL('../tools/launch-report.mjs', import.meta.url));
const newOut = () => mkdtempSync(join(tmpdir(), 'twt-rep-'));
const has = (dir, f) => existsSync(join(dir, f));
const txt = (dir, f) => readFileSync(join(dir, f), 'utf8');

function render(doc) {
  const dir = newOut();
  const p = join(dir, 'findings.json');
  writeFileSync(p, JSON.stringify(doc, null, 2), 'utf8');
  execFileSync(process.execPath, [REPORT, p, '--out', dir], { encoding: 'utf8' });
  return dir;
}
const f = (over = {}) => ({
  rule: 'DISC001', id: 'DISC001-site/a.html:3', category: 'discoverability',
  severity: 'LAUNCH-BLOCKER', owner: 'developer', where: 'site/a.html:3',
  evidence: 'meta robots noindex', impact: 'The site will not appear in search.',
  action: 'Remove the tag.', blocking: true, source: 'rule', ...over,
});
const doc = (findings, over = {}) => ({
  tool: 'launch-audit', generated: '2026-07-30T00:00:00.000Z',
  layers: { scan: 'ok', harvest: 'ok', live: 'skipped' }, mode: 'local', url: null,
  verdict: 'NO-GO', counts: { 'LAUNCH-BLOCKER': findings.filter((x) => x.blocking).length, 'FIX-WEEK-ONE': 0, 'NICE-TO-HAVE': 0, UNVERIFIED: 0 },
  findings, interview: [], ...over,
});

test('report: writes md, html, and punch-list on a complete scan', () => {
  const dir = render(doc([f()]));
  assert.ok(has(dir, 'launch-report.md'));
  assert.ok(has(dir, 'launch-report.html'));
  assert.ok(has(dir, 'punch-list.md'));
  assert.ok(!has(dir, 'launch-report-provisional.md'), 'no provisional file on a complete run');
});

test('report: an incomplete scan writes ONLY the provisional pair', () => {
  const dir = render(doc([], {
    layers: { scan: 'failed', harvest: 'ok', live: 'skipped' },
    verdict: 'NO-GO — evidence incomplete',
    counts: { 'LAUNCH-BLOCKER': 0, 'FIX-WEEK-ONE': 0, 'NICE-TO-HAVE': 0, UNVERIFIED: 0 },
  }));
  assert.ok(!has(dir, 'launch-report.md'), 'the measured filename asserts a scan that did not happen');
  assert.ok(!has(dir, 'launch-report.html'));
  assert.ok(has(dir, 'launch-report-provisional.md'));
  assert.ok(has(dir, 'launch-report-provisional.html'));
  assert.match(txt(dir, 'launch-report-provisional.md'), /evidence incomplete/);
  assert.match(txt(dir, 'launch-report-provisional.md'), /scan/i);
});

test('report: the verdict and counts lead the document', () => {
  const dir = render(doc([f()]));
  const md = txt(dir, 'launch-report.md');
  assert.match(md, /^---[\s\S]*?verdict: NO-GO[\s\S]*?---/, 'verdict must be in the frontmatter');
  assert.match(md, /LAUNCH-BLOCKER: 1/);
});

test('report: renders the eleven-row readiness matrix', () => {
  const dir = render(doc([f()]));
  const md = txt(dir, 'launch-report.md');
  for (const t of ['Content complete', 'Discoverability', 'Social & brand', 'Legal & compliance',
    'Analytics & tracking', 'Conversion paths', 'Error & edge', 'Performance & weight',
    'Build hygiene', 'Carried-forward', 'Operational readiness']) {
    assert.ok(md.includes(t), `matrix must list ${t}`);
  }
});

test('report: caps issue blocks at five per category and states the withheld count', () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    f({ id: `DISC003-site/p${i}.html:1`, rule: 'DISC003', severity: 'FIX-WEEK-ONE', blocking: false, where: `site/p${i}.html:1` }));
  const dir = render(doc(many, { verdict: 'GO WITH RISKS', counts: { 'LAUNCH-BLOCKER': 0, 'FIX-WEEK-ONE': 9, 'NICE-TO-HAVE': 0, UNVERIFIED: 0 } }));
  const md = txt(dir, 'launch-report.md');
  assert.equal((md.match(/site\/p\d\.html:1/g) || []).length, 5, 'exactly five blocks rendered');
  assert.match(md, /4 further/, 'the withheld count must be stated');
});

test('report: NICE-TO-HAVE never renders as an issue block, only in the backlog', () => {
  const dir = render(doc([f({ severity: 'NICE-TO-HAVE', blocking: false, rule: 'PERF002', id: 'PERF002-x:1', where: 'site/x.html:1' })],
    { verdict: 'GO', counts: { 'LAUNCH-BLOCKER': 0, 'FIX-WEEK-ONE': 0, 'NICE-TO-HAVE': 1, UNVERIFIED: 0 } }));
  const md = txt(dir, 'launch-report.md');
  const [beforeBacklog, backlog] = md.split('## Backlog');
  assert.ok(!/^### /m.test(beforeBacklog), 'no issue block anywhere above the backlog');
  assert.ok(backlog.includes('site/x.html:1'), 'the item appears in the backlog roll-up');
});

test('report: an item is never listed in both an issue block and the backlog', () => {
  const dir = render(doc([
    f(),
    f({ severity: 'NICE-TO-HAVE', blocking: false, rule: 'PERF002', id: 'PERF002-x:1', where: 'site/x.html:1' }),
  ], { verdict: 'NO-GO', counts: { 'LAUNCH-BLOCKER': 1, 'FIX-WEEK-ONE': 0, 'NICE-TO-HAVE': 1, UNVERIFIED: 0 } }));
  const md = txt(dir, 'launch-report.md');
  assert.equal((md.match(/site\/a\.html:3/g) || []).length, 1, 'the blocker appears once');
  assert.equal((md.match(/site\/x\.html:1/g) || []).length, 1, 'the backlog item appears once');
});

test('punch-list: groups by owner, not by page, and cites gaps.md rather than restating it', () => {
  const dir = render(doc([
    f(),
    f({ rule: 'HARV003', id: 'HARV003-gaps', category: 'content', owner: 'content-owner',
      where: '.twt-artifacts/qa/gaps.md', evidence: '12 open items in .twt-artifacts/qa/gaps.md',
      impact: 'Placeholder copy ships.', action: 'Resolve the listed items.' }),
  ]));
  const pl = txt(dir, 'punch-list.md');
  assert.match(pl, /## developer/);
  assert.match(pl, /## content-owner/);
  assert.match(pl, /- \[ \] /, 'items must be checkboxes');
  assert.match(pl, /gaps\.md/, 'the content row cites gaps.md');
});

test('punch-list: an owner with no items is omitted entirely', () => {
  const pl = txt(render(doc([f()])), 'punch-list.md');
  assert.ok(!pl.includes('## designer'), 'empty owner sections are noise');
});

test('report: html is self-contained and carries the house style', () => {
  const html = txt(render(doc([f()])), 'launch-report.html');
  assert.match(html, /<style>/);
  assert.ok(!/<link[^>]+stylesheet/.test(html), 'no external stylesheet');
  assert.match(html, /NO-GO/);
});

test('report: a missing findings file exits 2', () => {
  try {
    execFileSync(process.execPath, [REPORT, join(newOut(), 'nope.json'), '--out', newOut()], { encoding: 'utf8' });
    assert.fail('should exit 2');
  } catch (e) { assert.equal(e.status, 2); }
});

test('report: unanswered interview questions render as an open-questions section', () => {
  const dir = render(doc([f({ severity: 'UNVERIFIED', blocking: false, rule: 'Q-BACKUP-ROLLBACK',
    id: 'Q-BACKUP-ROLLBACK-interview', category: 'operational', owner: 'hosting-ops',
    where: 'interview: Q-BACKUP-ROLLBACK', evidence: 'not answered',
    impact: 'No rollback path is known.', action: 'Confirm a tested rollback before launch.' })],
    { verdict: 'GO WITH RISKS', counts: { 'LAUNCH-BLOCKER': 0, 'FIX-WEEK-ONE': 0, 'NICE-TO-HAVE': 0, UNVERIFIED: 1 } }));
  assert.match(txt(dir, 'launch-report.md'), /Open questions/i);
});

// --- regression tests added while implementing this task -------------------

test('regression: the html states the withheld count, same as the markdown', () => {
  // The brief's sample html builder re-implemented the cap/filter inline
  // instead of reusing categorySection() and never computed a withheld count,
  // so a category capped 5-of-9 in the markdown rendered as an uncaveated
  // 5-of-5 in the html — the two documents disagreed about how much was cut.
  const many = Array.from({ length: 9 }, (_, i) =>
    f({ id: `DISC003-site/p${i}.html:1`, rule: 'DISC003', severity: 'FIX-WEEK-ONE', blocking: false, where: `site/p${i}.html:1` }));
  const dir = render(doc(many, { verdict: 'GO WITH RISKS', counts: { 'LAUNCH-BLOCKER': 0, 'FIX-WEEK-ONE': 9, 'NICE-TO-HAVE': 0, UNVERIFIED: 0 } }));
  const html = txt(dir, 'launch-report.html');
  assert.equal((html.match(/site\/p\d\.html:1/g) || []).length, 5, 'exactly five blocks rendered in html');
  assert.match(html, /4 further/, 'the withheld count must be stated in the html too');
});

test('regression: an evidence string containing a raw HTML tag does not swallow the rest of the markdown document', () => {
  // Real scan rules quote markup verbatim — e.g. discoverability.mjs emits
  // evidence like "no non-empty <title>" and legal.mjs emits "no privacy page
  // found by filename or <title>". A bare `<title>` is inline raw HTML in
  // CommonMark, and any HTML5-parsing renderer (GitHub, VS Code preview,
  // this repo's own markdown export) switches into RAWTEXT mode on that tag
  // name regardless of context, silently consuming everything up to the next
  // `</title>` — which, with none elsewhere in the document, means the rest
  // of the client-facing report.
  const dir = render(doc([f({ evidence: 'no privacy page found by filename or <title>' })]));
  const md = txt(dir, 'launch-report.md');
  assert.match(md, /\\<title>/, 'the tag must be neutralized, not passed through raw');
  assert.ok(!/[^\\]<title>/.test(md), 'no unescaped <title> tag anywhere in the document');
  // Prove the rest of the document actually survives past the tag.
  assert.match(md, /## Backlog|Readiness matrix/);
});

test('regression: no run of more than one blank line, even when several sections are empty back to back', () => {
  // categorySection() returns '' for a category with nothing to show, and the
  // Open-questions/Backlog sections are ternaries that also resolve to ''.
  // On a real document covering 9 of 11 categories with no UNVERIFIED
  // findings, those empty strings landed back to back in the array and the
  // join produced FOUR consecutive blank lines ahead of "## Backlog" — a raw
  // reader (a diff, this file pasted into a chat) sees a gap that looks like
  // content went missing.
  const dir = render(doc([
    f({ category: 'hygiene', rule: 'HYG001', id: 'HYG001-x', where: '.env', evidence: '.env is present' }),
    f({ severity: 'NICE-TO-HAVE', blocking: false, rule: 'PERF002', id: 'PERF002-x:1', where: 'site/x.html:1', category: 'performance' }),
  ], { verdict: 'NO-GO', counts: { 'LAUNCH-BLOCKER': 1, 'FIX-WEEK-ONE': 0, 'NICE-TO-HAVE': 1, UNVERIFIED: 0 } }));
  const md = txt(dir, 'launch-report.md');
  assert.ok(!/\n{3,}/.test(md), 'no run of more than one blank line anywhere in the document');
});

test('regression: a stale launch-report.md from a previous good run does not survive a later failed scan', () => {
  // A prior successful run in this output directory produced launch-report.md
  // claiming GO. If the scan then fails on a re-run, writing only the
  // provisional pair is not enough: the old launch-report.md is still sitting
  // right there under the name that asserts a scan happened, and nothing
  // about it signals it predates the failed re-scan.
  const dir = newOut();
  const good = join(dir, 'findings.json');
  writeFileSync(good, JSON.stringify(doc([f()])), 'utf8');
  execFileSync(process.execPath, [REPORT, good, '--out', dir], { encoding: 'utf8' });
  assert.ok(has(dir, 'launch-report.md'), 'sanity: the good run wrote the measured report');

  const bad = join(dir, 'findings2.json');
  writeFileSync(bad, JSON.stringify(doc([], {
    layers: { scan: 'failed', harvest: 'ok', live: 'skipped' },
    verdict: 'NO-GO — evidence incomplete',
    counts: { 'LAUNCH-BLOCKER': 0, 'FIX-WEEK-ONE': 0, 'NICE-TO-HAVE': 0, UNVERIFIED: 0 },
  })), 'utf8');
  execFileSync(process.execPath, [REPORT, bad, '--out', dir], { encoding: 'utf8' });

  assert.ok(!has(dir, 'launch-report.md'), 'the stale measured report must not survive a failed re-scan');
  assert.ok(!has(dir, 'launch-report.html'), 'the stale measured html must not survive a failed re-scan');
  assert.ok(has(dir, 'launch-report-provisional.md'));
});
