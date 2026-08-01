// tests/launch-regressions.test.mjs
//
// The final whole-branch review of /twt-launch-audit returned NOT READY: on a
// realistic, correctly built 8-page site the tool answered NO-GO, and 13 of
// its 14 findings were wrong. Separately, on the unattended path the same tool
// answered a clean GO without checking anything it could not mechanically see.
//
// Every test in this file pins one of those defects. Each was verified to FAIL
// against the pre-fix code by reverting the fix and re-running — the mutation
// evidence is recorded per test in
// .superpowers/sdd/2026-07-30-twt-launch-audit/final-fix-report.md. Two tasks
// on this branch shipped "regression tests" that passed against the very bug
// they were written to catch; that is why the mutation step is not optional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RULES } from '../tools/launch-audit/rules/index.mjs';
import { QUESTIONS } from '../tools/launch-audit/rules/questions.mjs';
import { verdictFor } from '../tools/launch-audit.mjs';
import { runChild } from '../tools/launch-audit/harvest.mjs';

const T = (n) => fileURLToPath(new URL(`../tools/${n}`, import.meta.url));
const SCAN = T('launch-scan.mjs');
const AUDIT = T('launch-audit.mjs');
const REPORT = T('launch-report.mjs');
const run = (args) => execFileSync(process.execPath, [SCAN, ...args], { encoding: 'utf8' });
const newProject = () => mkdtempSync(join(tmpdir(), 'twt-launch-reg-'));
function put(p, content) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content, 'utf8'); }
const facts = (dir) => JSON.parse(readFileSync(join(dir, '.twt-artifacts', 'launch', 'facts.json'), 'utf8'));

const HEAD = (head, body = '<h1>x</h1>') =>
  `<html lang="en"><head>${head}</head><body>${body}</body></html>`;

function siteProject(files) {
  const dir = newProject();
  for (const [name, body] of Object.entries(files)) put(join(dir, 'site', name), body);
  return dir;
}
function themeProject(files) {
  const dir = newProject();
  for (const [name, body] of Object.entries(files)) {
    put(join(dir, 'wp-content', 'themes', 'hello-elementor-acme', name), body);
  }
  return dir;
}

const allRules = (facts) => RULES.flatMap((r) => r.run(facts));
const baseFacts = { layers: { scan: 'ok', harvest: 'ok', live: 'skipped' }, checks: {}, harvest: null, live: null, answers: null };
const withCheck = (name, findings) => ({ ...baseFacts, checks: { [name]: { counts: {}, findings } } });

// =============================================================================
// C1 — the interview must materialize on EVERY path, not only the watched one
// =============================================================================
//
// The instructions that turned unanswered blocking questions into UNVERIFIED
// findings lived inside the command file's Step 5 — the step that is skipped
// by design under --skip-interview and under subagent dispatch. QUESTIONS was
// serialized into findings.json.interview[] and read by nothing, so a silent
// run reached a clean GO having verified no backup, no rollback, no DNS, no
// form destination and no content sign-off.

test('C1: with no answers, the rules alone make a clean GO impossible', () => {
  const found = allRules(baseFacts);
  const intv = found.filter((f) => f.rule === 'INTV001');
  assert.ok(intv.length > 0, 'the safety property cannot depend on a step that is skipped by design');
  assert.ok(intv.every((f) => f.severity === 'UNVERIFIED'));
  assert.notEqual(verdictFor(found, { scan: 'ok' }).verdict, 'GO');
  assert.equal(verdictFor(found, { scan: 'ok' }).verdict, 'GO WITH RISKS');
});

test('C1: exactly the blocking questions are materialized — non-blocking ones never inflate the count', () => {
  const intv = allRules(baseFacts).filter((f) => f.rule === 'INTV001');
  const blocking = QUESTIONS.filter((q) => q.blocking);
  assert.equal(intv.length, blocking.length);
  for (const q of blocking) {
    const f = intv.find((x) => x.where === `interview: ${q.id}`);
    assert.ok(f, `${q.id} must appear`);
    assert.equal(f.owner, q.owner, 'the owner comes from the question, so the punch list can hand it over');
    assert.equal(f.category, q.category);
  }
  for (const q of QUESTIONS.filter((q) => !q.blocking)) {
    assert.ok(!intv.some((x) => x.where === `interview: ${q.id}`), `${q.id} is not blocking and must not appear`);
  }
});

test('C1: answering a question REMOVES its finding — the interview subtracts, it no longer creates', () => {
  const answers = Object.fromEntries(
    QUESTIONS.filter((q) => q.blocking).map((q) => [q.id, { answer: 'Yes — verified 2026-07-30', asked: '2026-07-30' }]));
  const found = allRules({ ...baseFacts, answers });
  assert.deepEqual(found.filter((f) => f.rule === 'INTV001'), []);
  assert.equal(verdictFor(found, { scan: 'ok' }).verdict, 'GO', 'a fully answered clean project CAN reach GO');
});

test('C1: a blank or whitespace-only answer does not count as answered', () => {
  const answers = { 'Q-BACKUP-ROLLBACK': { answer: '   ', asked: '2026-07-30' } };
  const intv = allRules({ ...baseFacts, answers }).filter((f) => f.rule === 'INTV001');
  assert.ok(intv.some((f) => f.where === 'interview: Q-BACKUP-ROLLBACK'));
});

test('C1: the interview findings have unique ids and name their question in the evidence', () => {
  const intv = allRules(baseFacts).filter((f) => f.rule === 'INTV001');
  assert.equal(new Set(intv.map((f) => f.id)).size, intv.length);
  for (const f of intv) assert.match(f.evidence, /^not answered — .+\?$/);
});

test('C1 (CLI): a run with no answers.json writes UNVERIFIED findings and never verdicts GO', () => {
  const dir = siteProject({ 'index.html': HEAD('<title>Home</title>') });
  run([dir]);
  const out = join(dir, '.twt-artifacts', 'launch');
  execFileSync(process.execPath, [AUDIT, join(out, 'facts.json'), '--out', out], { encoding: 'utf8' });
  const doc = JSON.parse(readFileSync(join(out, 'findings.json'), 'utf8'));
  assert.notEqual(doc.verdict, 'GO');
  assert.ok(doc.counts.UNVERIFIED >= QUESTIONS.filter((q) => q.blocking).length);
});

test('C1 (CLI): a stored answers.json clears the questions it answers', () => {
  const dir = siteProject({ 'index.html': HEAD('<title>Home</title>') });
  run([dir]);
  const out = join(dir, '.twt-artifacts', 'launch');
  writeFileSync(join(out, 'answers.json'), JSON.stringify({
    'Q-BACKUP-ROLLBACK': { answer: 'Nightly snapshots, restore tested', asked: '2026-07-30' },
  }), 'utf8');
  execFileSync(process.execPath, [AUDIT, join(out, 'facts.json'), '--out', out], { encoding: 'utf8' });
  const doc = JSON.parse(readFileSync(join(out, 'findings.json'), 'utf8'));
  const ids = doc.findings.filter((f) => f.rule === 'INTV001').map((f) => f.where);
  assert.ok(!ids.includes('interview: Q-BACKUP-ROLLBACK'));
  assert.ok(ids.includes('interview: Q-DNS-SSL'), 'the other questions stand');
});

test('C1 (CLI): an unreadable answers.json fails toward over-reporting and says so', () => {
  const dir = siteProject({ 'index.html': HEAD('<title>Home</title>') });
  run([dir]);
  const out = join(dir, '.twt-artifacts', 'launch');
  writeFileSync(join(out, 'answers.json'), '{ not json', 'utf8');
  const r = spawnSync(process.execPath, [AUDIT, join(out, 'facts.json'), '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'a corrupt answers file degrades the run, it does not abort it');
  assert.match(r.stderr, /unreadable/, 'silently reading it as "no answers" and as "all answered" look identical from outside');
  const doc = JSON.parse(readFileSync(join(out, 'findings.json'), 'utf8'));
  assert.equal(doc.findings.filter((f) => f.rule === 'INTV001').length, QUESTIONS.filter((q) => q.blocking).length);
});

// =============================================================================
// C2 — an Elementor-theme or URL-only project must actually be scanned
// =============================================================================

test('C2: an Elementor theme with no built HTML still produces facts.json and a complete scan layer', () => {
  const dir = themeProject({ 'functions.php': '<?php define( "WP_DEBUG", true );', 'style.css': 'body{color:#000}' });
  const out = run([dir]);
  assert.doesNotMatch(out, /nothing to audit/i, 'a theme IS something to audit');
  const f = facts(dir);
  assert.equal(f.layers.scan, 'ok', 'no local HTML is not a partial scan — the page modules no-op cleanly');
  assert.equal(f.sources.base, null);
  assert.match(f.sources.theme, /hello-elementor-acme$/);
});

test('C2: the reproduction case — a committed .env and WP_DEBUG in the theme are BOTH detected with no built site', () => {
  const dir = themeProject({ 'functions.php': '<?php\ndefine( "WP_DEBUG", true );\n' });
  put(join(dir, '.env'), 'STRIPE_SECRET=sk_live_51H8xYzABCDEFGHIJKLMNOP\n');
  run([dir]);
  const h = facts(dir).checks.hygiene;
  assert.ok(h.findings.some((x) => x.kind === 'secret_file' && x.file === '.env'), 'the committed .env must be found');
  assert.ok(h.findings.some((x) => x.kind === 'wp_debug_on'), 'WP_DEBUG in the theme must be found');
});

test('C2: the .env and WP_DEBUG facts reach the rules as LAUNCH-BLOCKERs', () => {
  const dir = themeProject({ 'functions.php': '<?php define( "WP_DEBUG", true );' });
  put(join(dir, '.env'), 'STRIPE_SECRET=sk_live_51H8xYzABCDEFGHIJKLMNOP\n');
  run([dir]);
  const out = join(dir, '.twt-artifacts', 'launch');
  execFileSync(process.execPath, [AUDIT, join(out, 'facts.json'), '--out', out], { encoding: 'utf8' });
  const doc = JSON.parse(readFileSync(join(out, 'findings.json'), 'utf8'));
  const rules = doc.findings.filter((f) => f.blocking).map((f) => f.rule);
  assert.ok(rules.includes('HYG001'), 'a committed .env is unrecoverable once pushed');
  assert.ok(rules.includes('HYG004'), 'WP_DEBUG leaks paths and queries publicly');
  assert.equal(doc.verdict, 'NO-GO');
});

test('C2: with no built HTML the page-scoped modules stay silent instead of inventing findings', () => {
  const dir = themeProject({ 'functions.php': '<?php // clean' });
  run([dir]);
  const c = facts(dir).checks;
  assert.deepEqual(c.legal.findings, [], 'no pages means no missing_privacy_page — and LEGL001 is a LAUNCH-BLOCKER');
  assert.deepEqual(c.discoverability.findings, [], 'no build root means no "robots.txt missing beside the build"');
  assert.deepEqual(c.social.findings, [], 'no pages means no missing favicon');
});

test('C2: a URL-only project (no build, no theme) is scanned rather than refused', () => {
  const dir = newProject();
  const out = run([dir, '--url', 'http://127.0.0.1:1']);
  assert.doesNotMatch(out, /nothing to audit/i);
  const f = facts(dir);
  assert.equal(f.mode, 'local+live');
  assert.equal(f.layers.scan, 'ok');
  assert.equal(f.layers.live, 'failed', 'the live layer ran — a refused connection is a result, not a crash');
});

test('C2: a genuinely empty project is still refused, writing nothing', () => {
  const dir = newProject();
  assert.match(run([dir]), /nothing to audit/i);
  assert.throws(() => facts(dir), /ENOENT/);
});

// =============================================================================
// C3 — DISC001 must not fire on correctly-excluded pages
// =============================================================================

test('C3: a noindex on 404.html is not a finding — this tool REQUIRES that page to exist', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>Home</title>'),
    '404.html': HEAD('<title>Not found</title><meta name="robots" content="noindex,follow">'),
  });
  run([dir]);
  const d = facts(dir).checks.discoverability;
  assert.deepEqual(d.findings.filter((x) => x.kind === 'noindex'), [],
    'noindexing the 404 page is the recommended configuration, not a LAUNCH-BLOCKER');
  assert.equal(d.counts.noindex_pages, 0);
  assert.equal(d.counts.noindex_excluded, 1, 'the observation survives in facts.json — it is exempted, not discarded');
});

test('C3: thank-you and search pages are exempt too, for both noindex and nofollow', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>Home</title>'),
    'thank-you.html': HEAD('<title>Thanks</title><meta name="robots" content="noindex,nofollow">'),
    'search.html': HEAD('<title>Search</title><meta name="robots" content="none">'),
  });
  run([dir]);
  const c = facts(dir).checks.discoverability.counts;
  assert.equal(c.noindex_pages, 0);
  assert.equal(c.nofollow_pages, 0);
  assert.equal(c.noindex_excluded, 2);
  assert.equal(c.nofollow_excluded, 2);
});

test('C3: a noindex on a REAL page is still found — the exemption must not silence the check', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>Home</title>'),
    'about.html': HEAD('<title>About</title><meta name="robots" content="noindex">'),
    '404.html': HEAD('<title>Not found</title><meta name="robots" content="noindex">'),
  });
  run([dir]);
  const noindex = facts(dir).checks.discoverability.findings.filter((x) => x.kind === 'noindex');
  assert.equal(noindex.length, 1);
  assert.equal(noindex[0].file, 'site/about.html');
});

// ---- C3 on a directory-per-page build ---------------------------------------
//
// Found by running the FIXED scanner against an independently built 8-page
// site: the first cut of this exemption matched on basename, and on a
// directory-per-page build (WordPress, Next.js, Astro, Hugo — i.e. most of
// them) every file is literally `index.html`, so it exempted nothing and a
// correctly noindexed `thank-you/` page was still the sole LAUNCH-BLOCKER.

test('C3: the exemption survives a directory-per-page build (thank-you/index.html)', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>Home</title>'),
    'thank-you/index.html': HEAD('<title>Thanks</title><meta name="robots" content="noindex, follow">'),
  });
  run([dir]);
  const d = facts(dir).checks.discoverability;
  assert.deepEqual(d.findings.filter((x) => x.kind === 'noindex'), []);
  assert.equal(d.counts.noindex_excluded, 1);
});

test('C3: an excluded page missing from sitemap.xml is not an orphan — listing it is the mistake', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>Home</title>'),
    'about/index.html': HEAD('<title>About</title>'),
    '404.html': HEAD('<title>Not found</title>'),
    'thank-you/index.html': HEAD('<title>Thanks</title>'),
  });
  put(join(dir, 'site', 'sitemap.xml'),
    '<urlset><url><loc>https://acme.com/</loc></url><url><loc>https://acme.com/about/</loc></url></urlset>');
  run([dir]);
  const d = facts(dir).checks.discoverability;
  assert.equal(d.counts.sitemap_orphans, 0);
  assert.equal(d.counts.sitemap_excluded, 2);
});

test('C3: a real page missing from sitemap.xml is still an orphan on a directory-per-page build', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>Home</title>'),
    'about/index.html': HEAD('<title>About</title>'),
    'fleet/index.html': HEAD('<title>Fleet</title>'),
  });
  put(join(dir, 'site', 'sitemap.xml'),
    '<urlset><url><loc>https://acme.com/</loc></url><url><loc>https://acme.com/about/</loc></url></urlset>');
  const d = (run([dir]), facts(dir).checks.discoverability);
  assert.equal(d.counts.sitemap_orphans, 1, 'directory pages must not all collapse to one key and mask each other');
  assert.equal(d.findings.find((x) => x.kind === 'sitemap_orphan').file, 'site/fleet/index.html');
});

// =============================================================================
// MUST-FIX A — the child processes must not overflow Node's 1MB default buffer
// =============================================================================
//
// checklist-xlsx.py read prints every row's prose at ~1.5KB/row, and the
// checklist skill expands collections into extra worksheets. Past ~700 rows
// execFileSync THREW, the probe recorded reader:'failed', HARV005 raised
// UNVERIFIED, and a FULLY SIGNED-OFF workbook dropped the verdict from GO to
// GO WITH RISKS — on exactly the largest projects.

test('MUST-FIX A: runChild() survives a child that prints far more than 1MB', () => {
  const dir = newProject();
  const script = join(dir, 'chatty.mjs');
  writeFileSync(script, "process.stdout.write('x'.repeat(3 * 1024 * 1024));\n", 'utf8');
  const out = runChild(process.execPath, [script]);
  assert.equal(out.length, 3 * 1024 * 1024, 'Node\'s 1MB default would have thrown ENOBUFS here');
});

// =============================================================================
// MUST-FIX B — belt-and-braces robots + googlebot is ONE decision
// =============================================================================

test('MUST-FIX B: robots+googlebot noindex on one page is ONE DISC001, not two', () => {
  const found = allRules(withCheck('discoverability', [
    { kind: 'noindex', file: 'site/a.html', line: 4, detail: 'meta robots="noindex"' },
    { kind: 'noindex', file: 'site/a.html', line: 4, detail: 'meta googlebot="noindex"' },
  ])).filter((f) => f.rule === 'DISC001');
  assert.equal(found.length, 1);
  assert.match(found[0].evidence, /robots/);
  assert.match(found[0].evidence, /googlebot/, 'both tags must survive into the evidence');
});

test('MUST-FIX B: the same collapse applies to DISC012 (nofollow)', () => {
  const found = allRules(withCheck('discoverability', [
    { kind: 'nofollow', file: 'site/a.html', line: 4, detail: 'meta robots="nofollow"' },
    { kind: 'nofollow', file: 'site/a.html', line: 4, detail: 'meta googlebot="nofollow"' },
  ])).filter((f) => f.rule === 'DISC012');
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'FIX-WEEK-ONE');
});

test('MUST-FIX B: no two findings share an id on a robots+googlebot page', () => {
  const found = allRules(withCheck('discoverability', [
    { kind: 'noindex', file: 'site/a.html', line: 4, detail: 'meta robots="noindex, nofollow"' },
    { kind: 'nofollow', file: 'site/a.html', line: 4, detail: 'meta robots="noindex, nofollow"' },
    { kind: 'noindex', file: 'site/a.html', line: 4, detail: 'meta googlebot="noindex, nofollow"' },
    { kind: 'nofollow', file: 'site/a.html', line: 4, detail: 'meta googlebot="noindex, nofollow"' },
  ]));
  assert.equal(found.filter((f) => f.rule.startsWith('DISC')).length, 2, 'four scanner findings, one page, two problems');
  assert.equal(new Set(found.map((f) => f.id)).size, found.length, 'duplicate ids make findings unaddressable');
});

test('MUST-FIX B: two different pages stay two findings', () => {
  const found = allRules(withCheck('discoverability', [
    { kind: 'noindex', file: 'site/a.html', line: 4, detail: 'meta robots="noindex"' },
    { kind: 'noindex', file: 'site/b.html', line: 4, detail: 'meta robots="noindex"' },
  ])).filter((f) => f.rule === 'DISC001');
  assert.equal(found.length, 2);
});

// =============================================================================
// I4 — legal links on a pretty-URL site
// =============================================================================

test('I4: a footer linking the pretty URL /privacy/ satisfies privacy_linked', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title>', '<footer><a href="/privacy/">Privacy</a> <a href="/terms/">Terms</a></footer>'),
    'privacy.html': HEAD('<title>Privacy</title>'),
    'terms.html': HEAD('<title>Terms of Service</title>'),
  });
  run([dir]);
  const l = facts(dir).checks.legal;
  assert.equal(l.counts.privacy_linked, true, 'basename("/privacy/") can never equal "privacy.html"');
  assert.equal(l.counts.terms_linked, true);
  assert.deepEqual(l.findings.filter((f) => /not_linked/.test(f.kind)), []);
});

test('I4: an absolute pretty URL and a case-mismatched href both count as linked', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title>', '<a href="https://acme.com/privacy/">Privacy</a><a href="/TERMS.HTML">Terms</a>'),
    'privacy.html': HEAD('<title>Privacy</title>'),
    'terms.html': HEAD('<title>Terms</title>'),
  });
  run([dir]);
  const c = facts(dir).checks.legal.counts;
  assert.equal(c.privacy_linked, true);
  assert.equal(c.terms_linked, true, 'a case-mismatched link works on every case-insensitive host');
});

test('I4: a genuinely unlinked legal page is still flagged, and named by its path', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title>', '<a href="/about/">About</a>'),
    'legal/privacy.html': HEAD('<title>Privacy</title>'),
  });
  run([dir]);
  const f = facts(dir).checks.legal.findings.find((x) => x.kind === 'privacy_not_linked');
  assert.ok(f, 'normalization must not silence the check');
  assert.match(f.detail, /legal\/privacy\.html/, 'the evidence names the path, not a bare basename');
});

test('I4: a directory-per-page legal section resolves — /privacy/ links privacy/index.html', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>Home</title>', '<footer><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/cookies/">Cookies</a></footer>'),
    'privacy/index.html': HEAD('<title>Privacy policy | Acme</title>'),
    'terms/index.html': HEAD('<title>Terms of service | Acme</title>'),
    'cookies/index.html': HEAD('<title>Cookie policy | Acme</title>'),
  });
  run([dir]);
  const c = facts(dir).checks.legal.counts;
  assert.deepEqual([c.privacy_page, c.terms_page, c.cookie_page], [true, true, true],
    'every file is literally index.html — the page must be identified by its directory');
  assert.deepEqual([c.privacy_linked, c.terms_linked, c.cookie_linked], [true, true, true]);
  assert.deepEqual(facts(dir).checks.legal.findings, []);
});

test('I4: a document-relative href is resolved against the page it appears on', () => {
  // The ONLY link to legal/privacy.html is a sibling-relative one from inside
  // legal/. Resolving it against the referring page's directory is the only
  // way it can match; treating it as root-relative yields "privacy", which is
  // a different page.
  const dir = siteProject({
    'index.html': HEAD('<title>Home</title>', '<a href="/about/">About</a>'),
    'about/index.html': HEAD('<title>About</title>'),
    'legal/privacy.html': HEAD('<title>Privacy</title>'),
    'legal/index.html': HEAD('<title>Legal notices</title>', '<a href="privacy.html">Privacy</a>'),
  });
  run([dir]);
  const l = facts(dir).checks.legal;
  assert.equal(l.counts.privacy_linked, true);
  assert.deepEqual(l.findings.filter((f) => f.kind === 'privacy_not_linked'), []);
});

test('I4: a page linking only to itself still does not count as linked', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title>'),
    'privacy.html': HEAD('<title>Privacy</title>', '<a href="/privacy/">this page</a>'),
  });
  run([dir]);
  assert.equal(facts(dir).checks.legal.counts.privacy_linked, false);
});

// =============================================================================
// I6 — one definition of "non-production URL", and it guards the blocker
// =============================================================================

test('I6: a form posting to http://0.0.0.0:8080 is a nonprod_action, not just a hygiene note', () => {
  const dir = siteProject({
    'a.html': HEAD('<title>A</title>', '<form action="http://0.0.0.0:8080/post"><input name="e" aria-label="e"><button>Go</button></form>'),
  });
  run([dir]);
  const c = facts(dir).checks.conversion;
  assert.equal(c.counts.nonprod_actions, 1, 'CONV001\'s own comment describes exactly this failure');
  assert.ok(c.findings.some((x) => x.kind === 'nonprod_action'));
});

test('I6: a form posting to a .local host is a nonprod_action', () => {
  const dir = siteProject({
    'a.html': HEAD('<title>A</title>', '<form action="http://acme.local/post"><input name="e" aria-label="e"><button>Go</button></form>'),
  });
  run([dir]);
  assert.equal(facts(dir).checks.conversion.counts.nonprod_actions, 1);
});

test('I6: a real production endpoint is still not a nonprod_action', () => {
  const dir = siteProject({
    'a.html': HEAD('<title>A</title>', '<form action="https://forms.acme.com/contact"><input name="e" aria-label="e"><button>Go</button></form>'),
  });
  run([dir]);
  assert.equal(facts(dir).checks.conversion.counts.nonprod_actions, 0);
});

// =============================================================================
// I7 — one definition of "consent banner", and `gdpr` needs a qualifier
// =============================================================================

test('I7: <div id="consentmanager"> is a consent banner to legal.mjs as well as analytics.mjs', () => {
  const dir = siteProject({ 'index.html': HEAD('<title>A</title>', '<div id="consentmanager">Manage cookies</div>') });
  run([dir]);
  assert.equal(facts(dir).checks.legal.counts.cookie_banner, true);
});

test('I7: the bare word GDPR before a tracker no longer suppresses ANLY001', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title><meta name="description" content="Our GDPR commitments"><script async src="https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF"></script>'),
  });
  run([dir]);
  assert.equal(facts(dir).checks.analytics.counts.tracker_before_consent, 1,
    'a word in body copy is not a consent gate — this was a false negative on the module\'s headline blocker');
});

test('I7: a real consent gate before the tracker still suppresses ANLY001', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title><div id="cookie-consent">Accept?</div><script async src="https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF"></script>'),
  });
  run([dir]);
  assert.equal(facts(dir).checks.analytics.counts.tracker_before_consent, 0);
});

test('I7: a named CMP (Cookiebot) is a gate to both modules', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title><script src="https://consent.cookiebot.com/uc.js"></script><script async src="https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF"></script>'),
  });
  run([dir]);
  assert.equal(facts(dir).checks.analytics.counts.tracker_before_consent, 0);
  assert.equal(facts(dir).checks.legal.counts.cookie_banner, true);
});

// =============================================================================
// I8 — PERF002 must not recommend a performance anti-pattern
// =============================================================================

test('I8: an LCP hero with fetchpriority=high is not told to lazy-load', () => {
  const dir = siteProject({
    'a.html': HEAD('<title>A</title>', '<img src="/i/logo.svg" alt="l" loading="lazy"><img src="/i/hero.jpg" alt="h" fetchpriority="high">'),
  });
  run([dir]);
  const c = facts(dir).checks.performance.counts;
  assert.equal(c.missing_lazy, 0, 'lazy-loading the LCP image measurably slows the site');
  assert.equal(c.deliberate_eager, 1);
});

test('I8: loading="eager" and the first image in the document are both exempt', () => {
  const dir = siteProject({
    'a.html': HEAD('<title>A</title>', '<img src="/i/hero.jpg" alt="h"><img src="/i/b.jpg" alt="b" loading="eager">'),
  });
  run([dir]);
  const c = facts(dir).checks.performance.counts;
  assert.equal(c.images, 2);
  assert.equal(c.missing_lazy, 0);
  assert.equal(c.deliberate_eager, 2);
});

test('I8: a below-the-fold image with no lazy attribute is STILL flagged', () => {
  const dir = siteProject({
    'a.html': HEAD('<title>A</title>', '<img src="/i/hero.jpg" alt="h" fetchpriority="high"><img src="/i/b.jpg" alt="b"><img src="/i/c.jpg" alt="c">'),
  });
  run([dir]);
  assert.equal(facts(dir).checks.performance.counts.missing_lazy, 2,
    'the exemption is for the hero, not for the whole page');
});

// =============================================================================
// I11 — a placeholder analytics id does not stop a launch
// =============================================================================

test('I11: ANLY002 is FIX-WEEK-ONE / developer, one tier below a form that cannot be submitted', () => {
  const found = allRules(withCheck('analytics', [
    { kind: 'placeholder_id', file: 'site/a.html', line: 8, detail: 'G-XXXXXXXXXX is a placeholder, not a real property' },
  ])).find((f) => f.rule === 'ANLY002');
  assert.equal(found.severity, 'FIX-WEEK-ONE');
  assert.equal(found.owner, 'developer');
  assert.equal(found.blocking, false, 'launch-week analytics is a cost, not a stop');
});

// =============================================================================
// launch-report.mjs — a parseable non-findings document exits 2, never throws
// =============================================================================

test('report: a JSON file with no verdict exits 2 as the header promises, rather than throwing', () => {
  const dir = newProject();
  const p = join(dir, 'notfindings.json');
  writeFileSync(p, JSON.stringify({ hello: 'world' }), 'utf8');
  const r = spawnSync(process.execPath, [REPORT, p, '--out', dir], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr, /TypeError/, 'an uncaught TypeError is not an exit code');
  assert.match(r.stderr, /not a findings document/);
});

test('report: a document whose findings is not an array exits 2', () => {
  const dir = newProject();
  const p = join(dir, 'bad.json');
  writeFileSync(p, JSON.stringify({ verdict: 'GO', findings: { a: 1 } }), 'utf8');
  assert.equal(spawnSync(process.execPath, [REPORT, p, '--out', dir], { encoding: 'utf8' }).status, 2);
});
