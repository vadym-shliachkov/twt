import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, QUESTIONS } from '../skills/twt-launch-audit/tools/launch-audit/rules/index.mjs';
import { SEVERITIES, OWNERS, CATEGORIES, validateFinding, verdictFor } from '../skills/twt-launch-audit/tools/launch-audit.mjs';

const base = {
  layers: { scan: 'ok', harvest: 'ok', live: 'skipped' },
  checks: {}, harvest: null, live: null,
};
const withCheck = (name, counts, findings = []) => ({ ...base, checks: { [name]: { counts, findings } } });
const all = (facts) => RULES.flatMap((r) => r.run(facts));

test('every rule output validates against the schema', () => {
  const facts = {
    ...base,
    checks: {
      discoverability: { counts: { noindex_pages: 1, missing_title: 1, robots_txt: false }, findings: [{ kind: 'noindex', file: 'site/a.html', line: 3, detail: 'meta robots noindex' }] },
      hygiene: { counts: { committed_secret_files: 1, debug_statements: 2 }, findings: [{ kind: 'secret_file', file: '.env', line: 0, detail: '.env present' }] },
      conversion: { counts: { dead_actions: 1 }, findings: [{ kind: 'dead_action', file: 'site/a.html', line: 9, detail: 'action="#"' }] },
    },
  };
  const out = all(facts);
  assert.ok(out.length > 0);
  for (const f of out) {
    validateFinding(f);
    assert.ok(SEVERITIES.includes(f.severity));
    assert.ok(OWNERS.includes(f.owner));
    assert.ok(CATEGORIES.includes(f.category));
    assert.equal(f.blocking, f.severity === 'LAUNCH-BLOCKER');
  }
});

test('a noindex page is a LAUNCH-BLOCKER owned by the developer', () => {
  const f = all(withCheck('discoverability', { noindex_pages: 1 },
    [{ kind: 'noindex', file: 'site/a.html', line: 3, detail: 'meta robots noindex' }]))
    .find((x) => x.rule === 'DISC001');
  assert.equal(f.severity, 'LAUNCH-BLOCKER');
  assert.equal(f.owner, 'developer');
  assert.equal(f.category, 'discoverability');
  assert.equal(f.where, 'site/a.html:3');
});

test('a committed secret is a LAUNCH-BLOCKER and never quotes the key', () => {
  const f = all(withCheck('hygiene', { committed_secret_files: 1, inline_secrets: 1 }, [
    { kind: 'secret_file', file: '.env', line: 0, detail: '.env is present in the project root' },
    { kind: 'inline_secret', file: 'site/a.html', line: 4, detail: 'sk_live_51H8… (redacted)' },
  ])).filter((x) => x.category === 'hygiene' && x.blocking);
  assert.equal(f.length, 2);
  assert.ok(f.every((x) => !/sk_live_51H8RANDOM/.test(JSON.stringify(x))), 'a full key must never reach a finding');
});

test('a dead form action is a LAUNCH-BLOCKER owned by the developer', () => {
  const f = all(withCheck('conversion', { dead_actions: 1 },
    [{ kind: 'dead_action', file: 'site/a.html', line: 9, detail: 'action="#"' }]))
    .find((x) => x.category === 'conversion');
  assert.equal(f.severity, 'LAUNCH-BLOCKER');
  assert.equal(f.owner, 'developer');
});

test('a tracker before consent is owned by client-decision, not the developer', () => {
  const f = all(withCheck('analytics', { tracker_before_consent: 1, placeholder_ids: 0 },
    [{ kind: 'tracker_before_consent', file: 'site/a.html', line: 2, detail: 'gtag loads with no consent gate' }]))
    .find((x) => x.rule === 'ANLY001');
  assert.equal(f.severity, 'LAUNCH-BLOCKER');
  assert.equal(f.owner, 'client-decision');
});

test('debug statements are NICE-TO-HAVE, not a blocker', () => {
  const f = all(withCheck('hygiene', { debug_statements: 3 },
    [{ kind: 'debug_statement', file: 'site/a.html', line: 1, detail: 'console.log' }]))
    .find((x) => x.rule === 'HYG003');
  assert.equal(f.severity, 'NICE-TO-HAVE');
  assert.equal(f.blocking, false);
});

test('a clean facts object produces no MEASURED findings — only the unanswered interview', () => {
  const facts = {
    ...base,
    checks: {
      discoverability: { counts: { pages: 1, noindex_pages: 0, missing_title: 0, missing_description: 0, robots_txt: true, sitemap_xml: true, sitemap_orphans: 0 }, findings: [] },
      hygiene: { counts: { committed_secret_files: 0, inline_secrets: 0, debug_statements: 0, nonprod_urls: 0, wp_debug_on: 0 }, findings: [] },
      conversion: { counts: { forms: 0, dead_actions: 0, nonprod_actions: 0 }, findings: [] },
    },
  };
  const out = all(facts);
  assert.deepEqual(out.filter((f) => f.rule !== 'INTV001'), [],
    'a clean scan must trip no measured rule');
  assert.ok(out.length > 0, 'and the unanswered blocking questions must still be there');
});

// ---- harvested rules --------------------------------------------------------

test('an absent qa-report is UNVERIFIED, never a silent pass', () => {
  const facts = { ...base, harvest: { status: 'ok', qa: { present: false, path: '.twt-artifacts/qa/qa-report.md' }, gaps: { present: false }, validations: [], approval: { present: false }, staleness: { status: 'ok', stale: 0, stale_paths: [] }, notes: [] } };
  const f = all(facts).find((x) => x.rule === 'HARV001');
  assert.equal(f.severity, 'UNVERIFIED');
  assert.equal(f.category, 'carried');
});

test('qa blockers are cited with the report path, not re-derived', () => {
  const facts = { ...base, harvest: { status: 'ok', qa: { present: true, path: '.twt-artifacts/qa/qa-report.md', verdict: 'FAIL', blockers: 3 }, gaps: { present: false }, validations: [], approval: { present: false }, staleness: { status: 'ok', stale: 0, stale_paths: [] }, notes: [] } };
  const f = all(facts).find((x) => x.rule === 'HARV002');
  assert.equal(f.severity, 'LAUNCH-BLOCKER');
  assert.match(f.evidence, /qa-report\.md/, 'the citation must name the source report');
  assert.match(f.where, /qa-report\.md/);
});

test('unapproved content rows are a LAUNCH-BLOCKER owned by the content owner', () => {
  const facts = { ...base, harvest: { status: 'ok', qa: { present: false }, gaps: { present: false }, validations: [], approval: { present: true, path: 'x.xlsx', reader: 'ok', total: 40, ready: 31, not_ready: 9 }, staleness: { status: 'ok', stale: 0, stale_paths: [] }, notes: [] } };
  const f = all(facts).find((x) => x.rule === 'HARV004');
  assert.equal(f.severity, 'LAUNCH-BLOCKER');
  assert.equal(f.owner, 'content-owner');
  assert.match(f.evidence, /9 of 40/);
});

test('an unreadable approval workbook is UNVERIFIED, not clean', () => {
  const facts = { ...base, harvest: { status: 'partial', qa: { present: false }, gaps: { present: false }, validations: [], approval: { present: true, path: 'x.xlsx', reader: 'failed' }, staleness: { status: 'ok', stale: 0, stale_paths: [] }, notes: ['unreadable'] } };
  const f = all(facts).find((x) => x.rule === 'HARV005');
  assert.equal(f.severity, 'UNVERIFIED');
});

// ---- interview catalogue ----------------------------------------------------

test('every interview question is well formed and category-bound', () => {
  assert.ok(QUESTIONS.length >= 8);
  for (const q of QUESTIONS) {
    assert.ok(CATEGORIES.includes(q.category), q.id);
    assert.ok(OWNERS.includes(q.owner), q.id);
    assert.match(q.question, /\?$/, `${q.id} must end in a question mark`);
    assert.ok(q.why.length > 10, `${q.id} needs a why`);
    assert.equal(typeof q.blocking, 'boolean');
  }
  assert.ok(QUESTIONS.some((q) => q.category === 'operational' && q.blocking), 'operational readiness must be able to block');
});

test('question ids are unique', () => {
  assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, QUESTIONS.length);
});

// ---- ANLY002 de-duplication --------------------------------------------------
//
// The scanner's ID regex matches every occurrence of a placeholder id in the
// page source, and a canonical GA4/GTM snippet legitimately repeats the SAME
// id twice (loader <script src>, then gtag('config', id) / the noscript
// fallback). Two scanner findings for one id on one page is one problem, not
// two — a rule that reports both is exactly the noise this design exists to
// avoid. Different ids (or the same id on different pages) are genuinely
// distinct problems and must stay separate.

test('two occurrences of the SAME placeholder id on ONE page collapse into one ANLY002 finding', () => {
  const facts = withCheck('analytics', { placeholder_ids: 2 }, [
    { kind: 'placeholder_id', file: 'site/a.html', line: 8, detail: 'G-XXXXXXXXXX is a placeholder, not a real property' },
    { kind: 'placeholder_id', file: 'site/a.html', line: 12, detail: 'G-XXXXXXXXXX is a placeholder, not a real property' },
  ]);
  const found = all(facts).filter((x) => x.rule === 'ANLY002');
  assert.equal(found.length, 1, 'one placeholder id referenced twice on one page is one problem, not two');
  assert.equal(found[0].severity, 'FIX-WEEK-ONE');
  assert.equal(found[0].owner, 'developer');
  assert.match(found[0].evidence, /8/);
  assert.match(found[0].evidence, /12/);
});

test('two DIFFERENT placeholder ids on one page are two distinct ANLY002 findings', () => {
  const facts = withCheck('analytics', { placeholder_ids: 2 }, [
    { kind: 'placeholder_id', file: 'site/a.html', line: 8, detail: 'G-XXXXXXXXXX is a placeholder, not a real property' },
    { kind: 'placeholder_id', file: 'site/a.html', line: 20, detail: 'GTM-XXXX is a placeholder, not a real property' },
  ]);
  const found = all(facts).filter((x) => x.rule === 'ANLY002');
  assert.equal(found.length, 2);
});

test('the same placeholder id on two DIFFERENT pages is two distinct ANLY002 findings', () => {
  const facts = withCheck('analytics', { placeholder_ids: 2 }, [
    { kind: 'placeholder_id', file: 'site/a.html', line: 8, detail: 'G-XXXXXXXXXX is a placeholder, not a real property' },
    { kind: 'placeholder_id', file: 'site/b.html', line: 8, detail: 'G-XXXXXXXXXX is a placeholder, not a real property' },
  ]);
  const found = all(facts).filter((x) => x.rule === 'ANLY002');
  assert.equal(found.length, 2);
});

// ---- regression: the interview must know what it is looking at -------------
// On a site that had been publicly serving traffic for weeks, the audit still
// asked "Who presses the button, when, and who is available for the hour
// after?" and rendered it as an open question — while its own finding text said
// there was no cutover left to staff. A question about an event that already
// happened cannot be answered, so it stays UNVERIFIED forever and reads as an
// audit that did not look at what it was auditing.
test('interview: a site already serving traffic is asked about monitoring, not about a cutover', () => {
  const live = { layers: { scan: 'ok' }, checks: {}, answers: null, live: { status: 'ok', checks: { reachable: true } } };
  const f = RULES.flatMap((r) => r.run(live)).find((x) => x.where === 'interview: Q-LAUNCH-WINDOW');
  assert.ok(f, 'the question is still asked — it is still blocking');
  assert.doesNotMatch(f.evidence, /presses the button/, 'the cutover wording is wrong for a live site');
  assert.match(f.evidence, /after each of these fixes ships|watches the site/i);
});

test('interview: a site that is not live keeps the cutover wording', () => {
  const pre = { layers: { scan: 'ok' }, checks: {}, answers: null, live: { status: 'skipped' } };
  const f = RULES.flatMap((r) => r.run(pre)).find((x) => x.where === 'interview: Q-LAUNCH-WINDOW');
  assert.match(f.evidence, /presses the button/);
});

test('interview: the live variant changes wording only — never the id, owner, or count', () => {
  const shape = (facts) => RULES.flatMap((r) => r.run(facts))
    .filter((x) => x.rule === 'INTV001')
    .map((x) => `${x.where}|${x.owner}|${x.severity}`).sort();
  assert.deepEqual(
    shape({ layers: { scan: 'ok' }, checks: {}, answers: null, live: { status: 'ok', checks: { reachable: true } } }),
    shape({ layers: { scan: 'ok' }, checks: {}, answers: null, live: { status: 'skipped' } }),
    'one rule per blocking question, whatever the site state',
  );
});
