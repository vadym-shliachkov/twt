import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readiness, applyCaps, renderMarkdown, renderHtml, verdict, provenance, ROW_CATEGORIES, ROW_LABELS } from '../skills/twt-figma-dev-audit/tools/figma-dev-report.mjs';

const TOOL = fileURLToPath(new URL('../skills/twt-figma-dev-audit/tools/figma-dev-report.mjs', import.meta.url));

const f = (o) => ({
  id: o.id || 'X-1', rule: o.rule || 'X', title: o.title || 'T',
  category: o.category, severity: o.severity, confidence: o.confidence || 'High',
  nodeIds: ['1:1'], location: { page: 'P', frame: 'F', layers: ['L'] },
  link: 'https://figma.com/design/K/T?node-id=1-1',
  detected: 'd', impact: 'i', action: 'a', owner: 'Designer',
  blocking: o.severity === 'Blocker', source: 'rule', ...o,
});

const envelope = (findings, decisions = []) => ({
  meta: { file: 'T', url: 'https://figma.com/design/K/T', platform: 'web', scope: null,
          scannedAt: '2026-07-27T00:00:00.000Z', dsAuditReport: null, nodeCount: 10, frameCount: 2 },
  findings, decisions,
});

test('readiness returns exactly the six spec rows', () => {
  assert.deepEqual(Object.keys(readiness([])),
    ['responsive', 'components', 'states', 'assets', 'accessibility', 'platform']);
});

test('readiness: one Blocker makes its row Not ready', () => {
  const r = readiness([f({ category: 'Responsive coverage', severity: 'Blocker' })]);
  assert.equal(r.responsive.status, 'Not ready');
  assert.equal(r.responsive.blocker, 1);
  assert.equal(r.components.status, 'Ready');
});

test('readiness: three Highs make a row Not ready, one makes it Ready with assumptions', () => {
  const one = readiness([f({ category: 'Components & code mapping', severity: 'High' })]);
  assert.equal(one.components.status, 'Ready with assumptions');

  const three = readiness(Array.from({ length: 3 },
    (_, i) => f({ id: `X-${i}`, category: 'Components & code mapping', severity: 'High' })));
  assert.equal(three.components.status, 'Not ready');
});

test('readiness: three Mediums make a row Ready with assumptions', () => {
  const r = readiness(Array.from({ length: 3 },
    (_, i) => f({ id: `X-${i}`, category: 'States', severity: 'Medium' })));
  assert.equal(r.states.status, 'Ready with assumptions');
});

test('Handoff hygiene never affects the readiness matrix', () => {
  const r = readiness([f({ category: 'Handoff hygiene', severity: 'Blocker' })]);
  assert.ok(Object.values(r).every((row) => row.status === 'Ready'));
  assert.ok(!Object.values(ROW_CATEGORIES).flat().includes('Handoff hygiene'));
});

test('applyCaps limits each category to 5 issue blocks and counts the rest', () => {
  const many = Array.from({ length: 9 },
    (_, i) => f({ id: `X-${i}`, category: 'Auto Layout & sizing', severity: 'Medium' }));
  const { shown, withheld } = applyCaps(many);
  assert.equal(shown.length, 5);
  assert.equal(withheld['Auto Layout & sizing'], 4);
});

test('applyCaps routes every Low into the roll-up, never into shown', () => {
  const mixed = [
    f({ id: 'a', category: 'Handoff hygiene', severity: 'Low' }),
    f({ id: 'b', category: 'Handoff hygiene', severity: 'Low' }),
    f({ id: 'c', category: 'Handoff hygiene', severity: 'Medium' }),
  ];
  const { shown, lows } = applyCaps(mixed);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, 'c');
  assert.equal(lows['Handoff hygiene'].count, 2);
  assert.equal(lows['Handoff hygiene'].examples.length, 2);
});

test('applyCaps caps roll-up examples at two per category', () => {
  const lots = Array.from({ length: 40 },
    (_, i) => f({ id: `L-${i}`, category: 'Handoff hygiene', severity: 'Low' }));
  const { lows } = applyCaps(lots);
  assert.equal(lows['Handoff hygiene'].count, 40);
  assert.equal(lows['Handoff hygiene'].examples.length, 2);
});

test('renderMarkdown emits the five spec sections in order', () => {
  const md = renderMarkdown(envelope([f({ category: 'Responsive coverage', severity: 'Blocker' })]));
  const order = ['## Summary', '## Development readiness', '## Blocking issues',
                 '## Decisions required', '## All issues'];
  let at = -1;
  for (const h of order) {
    const i = md.indexOf(h);
    assert.ok(i > at, `${h} present and after the previous section`);
    at = i;
  }
});

test('renderMarkdown states the ds-audit boundary when no report exists', () => {
  const md = renderMarkdown(envelope([]));
  assert.match(md, /no design-system audit on record/i);
});

test('renderMarkdown cites the ds-audit report when one exists', () => {
  const e = envelope([]);
  e.meta.dsAuditReport = '.twt-artifacts/design/design-system-audit/audit-report.md';
  const md = renderMarkdown(e);
  assert.match(md, /Related:/);
  assert.match(md, /design-system-audit\/audit-report\.md/);
});

test('renderMarkdown reports withheld counts rather than silently truncating', () => {
  const many = Array.from({ length: 9 },
    (_, i) => f({ id: `X-${i}`, category: 'Auto Layout & sizing', severity: 'Medium' }));
  const md = renderMarkdown(envelope(many));
  assert.match(md, /4 further/i);
  assert.match(md, /findings\.json/);
});

test('renderMarkdown lists decisions and never renders them as findings', () => {
  const md = renderMarkdown(envelope([], [{
    id: 'FN001-Inter', question: 'Is there a webfont licence for Inter?',
    why: 'Not recorded in the file.', owner: 'Client',
  }]));
  assert.match(md, /Is there a webfont licence for Inter\?/);
  assert.match(md, /Client/);
  assert.doesNotMatch(md, /Severity:/, 'a decision carries no severity');
});

// --- Additional regression coverage found while tracing the caps/render
// interaction per the task-7 review checklist (not in the brief's Step-1
// list) ---

test('applyCaps keeps high-severity findings over lower ones when a category spans severities and exceeds the cap', () => {
  // Mirrors the engine's real sort order: findings arrive sorted by
  // (severity, then category), so all Blockers for a category precede its
  // Mediums. This locks that priority-queue behaviour in as a contract.
  const mixed = [
    ...Array.from({ length: 3 }, (_, i) => f({ id: `B-${i}`, category: 'States', severity: 'Blocker' })),
    ...Array.from({ length: 7 }, (_, i) => f({ id: `M-${i}`, category: 'States', severity: 'Medium' })),
  ];
  const { shown, withheld } = applyCaps(mixed);
  assert.equal(shown.filter((x) => x.severity === 'Blocker').length, 3);
  assert.equal(shown.filter((x) => x.severity === 'Medium').length, 2);
  assert.equal(withheld['States'], 5);
});

test('renderMarkdown states a withheld count even when a category\'s cap overflow is entirely Blockers', () => {
  // 6 Blockers in one category: cap shows 5, withholds 1. The withheld
  // Blocker must not vanish silently - it has no home in "Blocking issues"
  // (that section has no withheld notice) and, before the fix, the
  // category wouldn't appear in "All issues" either because every shown
  // finding in it is blocking (filtered out of that section's category
  // list). The withheld count must be stated somewhere.
  const many = Array.from({ length: 6 }, (_, i) => f({ id: `B-${i}`, category: 'States', severity: 'Blocker' }));
  const md = renderMarkdown(envelope(many));
  assert.match(md, /1 further States issue\(s\) withheld/i);
  const blockingSection = md.slice(md.indexOf('## Blocking issues'), md.indexOf('## Decisions required'));
  assert.equal((blockingSection.match(/^#### /gm) || []).length, 5, 'exactly 5 Blocker blocks rendered');
});

test('renderHtml is a self-contained page with no external requests', () => {
  const html = renderHtml(envelope([f({ category: 'Responsive coverage', severity: 'Blocker' })]));
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script\s+src=/i, 'no external scripts');
  assert.doesNotMatch(html, /<link[^>]+stylesheet/i, 'no external stylesheets');
});

test('renderHtml renders the readiness matrix with status classes', () => {
  const html = renderHtml(envelope([f({ category: 'Responsive coverage', severity: 'Blocker' })]));
  assert.match(html, /class="status not-ready"/);
  assert.match(html, /responsive/);
});

test('renderHtml embeds a screenshot only when the finding carries one', () => {
  const withShot = renderHtml(envelope([
    f({ id: 'a', category: 'Responsive coverage', severity: 'High', shot: 'shots/1-1.png' }),
  ]));
  assert.match(withShot, /<img src="shots\/1-1\.png"/);

  const without = renderHtml(envelope([f({ id: 'b', category: 'Responsive coverage', severity: 'High' })]));
  assert.doesNotMatch(without, /<img/);
});

test('renderHtml escapes finding text so a layer name cannot inject markup', () => {
  const html = renderHtml(envelope([
    f({ category: 'Responsive coverage', severity: 'High', detected: '<script>alert(1)</script>' }),
  ]));
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('renderHtml keeps Low findings out of the issue list', () => {
  const html = renderHtml(envelope([
    f({ id: 'a', category: 'Handoff hygiene', severity: 'Low', title: 'Fractional coordinates' }),
  ]));
  assert.match(html, /Low-severity roll-up/);
  assert.doesNotMatch(html, /<h4[^>]*>Fractional coordinates/);
});

test('renderHtml states a withheld count even when a category\'s cap overflow is entirely Blockers', () => {
  // Same bug class as renderMarkdown originally had: building the "All
  // issues" category list from only the shown non-blocking findings misses
  // a category whose overflow was entirely Blockers. 6 Blockers in one
  // category: cap shows 5 (rendered in "Blocking issues"), withholds 1 -
  // that withheld Blocker must be stated somewhere in the HTML.
  const many = Array.from({ length: 6 }, (_, i) => f({ id: `B-${i}`, category: 'States', severity: 'Blocker' }));
  const html = renderHtml(envelope(many));
  assert.match(html, /1 further States issue\(s\) withheld/i);
});

// --- The Layer 3 boundary. Everything below concerns findings the MODEL
// wrote straight into findings.json, bypassing the engine's finding()
// constructor entirely. This renderer is the last reader before a client,
// so it is where the contract has to actually hold. ---

test('applyCaps re-sorts by severity instead of trusting its caller', () => {
  // The model pass appends its findings to the END of findings.json with no
  // re-sort. A model-authored High landing after five rule Mediums in one
  // category used to be the one withheld, while the Mediums rendered - the
  // cap silently inverted its own priority order.
  const mixed = [
    ...Array.from({ length: 5 }, (_, i) => f({ id: `M-${i}`, category: 'States', severity: 'Medium' })),
    f({ id: 'model-high', category: 'States', severity: 'High', source: 'model', confidence: 'Medium' }),
  ];
  const { shown, withheld } = applyCaps(mixed);
  assert.ok(shown.some((x) => x.id === 'model-high'), 'the High is shown, whatever order it arrived in');
  assert.equal(shown.length, 5);
  assert.equal(withheld['States'], 1);
  assert.equal(shown[0].severity, 'High');
});

test('applyCaps leaves an already-sorted array in its original order', () => {
  const sorted = [
    f({ id: 'b', category: 'States', severity: 'Blocker' }),
    f({ id: 'h1', category: 'States', severity: 'High' }),
    f({ id: 'h2', category: 'Forms', severity: 'High' }),
    f({ id: 'm', category: 'States', severity: 'Medium' }),
  ];
  assert.deepEqual(applyCaps(sorted).shown.map((x) => x.id), ['b', 'h1', 'h2', 'm']);
});

test('a model-authored finding with no location renders instead of throwing', () => {
  // Probed against the pre-fix renderer: no `location` threw "Cannot read
  // properties of undefined (reading 'page')", and a `location` with no
  // `layers` threw on `.length`. The model writes this file by hand; the
  // renderer must survive an incomplete one rather than produce nothing.
  const bare = { id: 'M-1', rule: 'MODEL', title: 'Missing empty state',
    category: 'States', severity: 'High', confidence: 'Medium',
    nodeIds: [], link: '', detected: 'd', impact: 'i', action: 'a',
    owner: 'Designer', source: 'model' };
  const md = renderMarkdown(envelope([bare]));
  assert.match(md, /Missing empty state/);
  assert.match(md, /whole file/, 'a finding with no page states so rather than printing " / "');
  assert.doesNotMatch(md, /\[open in Figma\]\(\)/, 'no link to nowhere');

  const partial = { ...bare, id: 'M-2', location: { page: 'Screens', frame: 'Home' } };
  const md2 = renderMarkdown(envelope([partial]));
  assert.match(md2, /Screens \/ Home/);
  assert.doesNotThrow(() => renderHtml(envelope([bare, partial])));
});

test('a model-authored Blocker without a blocking flag still appears under Blocking issues', () => {
  // The Summary counted it and the matrix read "Not ready", but "Blocking
  // issues" said "None." - the single most misleading state this report can
  // be in. Severity is the authority; blocking follows from it.
  const modelBlocker = { id: 'M-3', rule: 'MODEL', title: 'No mobile checkout flow',
    category: 'Forms', severity: 'Blocker', confidence: 'Medium', nodeIds: ['1:1'],
    location: { page: 'P', frame: 'F', layers: [] }, link: 'https://figma.com/design/K/T?node-id=1-1',
    detected: 'd', impact: 'i', action: 'a', owner: 'Designer', source: 'model' };
  const md = renderMarkdown(envelope([modelBlocker]));
  const blocking = md.slice(md.indexOf('## Blocking issues'), md.indexOf('## Decisions required'));
  assert.match(blocking, /No mobile checkout flow/);
  assert.doesNotMatch(blocking, /_None\._/);
  assert.match(md, /\*\*Blocking:\*\* Yes/);

  const html = renderHtml(envelope([modelBlocker]));
  assert.match(html, /Blocking: Yes/);

  // An explicit "blocking": false on a Blocker is the same contradiction, not
  // a different one - the Summary and all six matrix rows count it as a
  // Blocker either way, so this section must too.
  const contradictory = { ...modelBlocker, id: 'M-4', blocking: false };
  const md2 = renderMarkdown(envelope([contradictory]));
  assert.doesNotMatch(md2.slice(md2.indexOf('## Blocking issues'), md2.indexOf('## Decisions required')), /_None\._/);

  // A non-Blocker may still opt in to the section by setting the flag.
  const opted = { ...modelBlocker, id: 'M-5', severity: 'High', blocking: true };
  const md3 = renderMarkdown(envelope([opted]));
  assert.doesNotMatch(md3.slice(md3.indexOf('## Blocking issues'), md3.indexOf('## Decisions required')), /_None\._/);
});

test('renderHtml embeds a screenshot only from the report\'s own shots/ directory', () => {
  // f.shot is model-written. A remote URL would make this client-facing page
  // issue an external request; a traversal would point outside the report.
  const ok = renderHtml(envelope([f({ category: 'Responsive coverage', severity: 'High', shot: 'shots/1-1.png' })]));
  assert.match(ok, /<img src="shots\/1-1\.png"/);

  for (const bad of ['https://evil.example/x.png', '/etc/passwd', 'shots/../../secret.png', '../x.png']) {
    const html = renderHtml(envelope([f({ category: 'Responsive coverage', severity: 'High', shot: bad })]));
    assert.doesNotMatch(html, /<img/, `${bad} must not render`);
  }
});

test('both renderers state the scope, so a scoped report cannot read as a whole-file one', () => {
  const e = envelope([f({ category: 'Responsive coverage', severity: 'High' })]);
  e.meta.scope = 'Pricing';
  assert.match(renderMarkdown(e), /\*\*Scope:\*\* `Pricing`/);
  assert.match(renderMarkdown(e), /the rest of the file is not covered/i);
  assert.match(renderHtml(e), /<strong>Scope:<\/strong> <code>Pricing<\/code>/);
  assert.match(renderHtml(e), /the rest of the file is not covered/i);

  const whole = envelope([f({ category: 'Responsive coverage', severity: 'High' })]);
  assert.doesNotMatch(renderMarkdown(whole), /Scope:/);
});

test('the CLI refuses to render a findings file containing Confidence: Low', () => {
  // finding() rejects Confidence: Low, but the model pass never calls
  // finding() - it writes findings.json directly, and this renderer is the
  // last reader. Without a gate here, a guess reaches the client wearing the
  // shape of a measured fact, which is the failure mode the whole feature
  // exists to prevent.
  const dir = mkdtempSync(join(tmpdir(), 'twt-fdr-'));
  const bad = {
    meta: { file: 'T', url: '', platform: 'web', scope: null, scannedAt: 'now',
            dsAuditReport: null, nodeCount: 1, frameCount: 1 },
    findings: [{ id: 'MODEL-guess', rule: 'MODEL', title: 'Probably unlicensed font',
      category: 'Fonts', severity: 'High', confidence: 'Low', nodeIds: [],
      location: { page: '', frame: '', layers: [] }, link: '', detected: 'd',
      impact: 'i', action: 'a', owner: 'Client', blocking: false, source: 'model' }],
    decisions: [],
  };
  const src = join(dir, 'findings.json');
  writeFileSync(src, JSON.stringify(bad), 'utf8');

  const r = spawnSync(process.execPath, [TOOL, src, '--out', dir], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'must exit non-zero');
  assert.match(r.stderr, /MODEL-guess/, 'names the offending finding');
  assert.match(r.stderr, /confidence/i);
  for (const name of ['readiness-report.md', 'readiness-report-provisional.md']) {
    assert.throws(() => readFileSync(join(dir, name), 'utf8'),
      'no report is written from an invalid findings file');
  }
});

// --- Presentation contract. A report nobody can read is a report nobody acts
// on, and all three of these came back as user feedback on a real 24-finding
// run against an 84,704-node file. ---

test('every outbound link in the HTML opens in a new tab', () => {
  // The reader's place in a 24-finding review is the report. Navigating the
  // tab away to Figma and expecting them back via the Back button loses the
  // scroll position they spent the review building.
  const e = envelope([f({ category: 'Responsive coverage', severity: 'High', shot: 'shots/1-1.png' })],
    [{ id: 'D1', question: 'q', why: 'w', owner: 'Client' }]);
  e.findings.push(f({ id: 'L-1', category: 'Handoff hygiene', severity: 'Low' }));
  const html = renderHtml(e);
  const anchors = html.match(/<a\s[^>]*>/g) || [];
  assert.ok(anchors.length >= 3, `expected several links, got ${anchors.length}`);
  for (const a of anchors) {
    assert.match(a, /target="_blank"/, `link without target=_blank: ${a}`);
    assert.match(a, /rel="noopener"/, `link without rel=noopener: ${a}`);
  }
});

test('a screenshot renders as a bounded thumbnail linking to the full-size file', () => {
  // get_screenshot returns the node's whole render bounds; on a frame that
  // overflows its own height that is mostly empty canvas, and an uncapped
  // <img> reserved 900px of page for ~350px of content.
  const html = renderHtml(envelope([
    f({ category: 'Responsive coverage', severity: 'High', shot: 'shots/1-1.png' }),
  ]));
  assert.match(html, /<a href="shots\/1-1\.png"[^>]*><img src="shots\/1-1\.png"/,
    'the thumbnail is wrapped in a link to the untouched capture');
  assert.match(html, /\.shot a\{[^}]*height:150px/, 'the preview area is a fixed window, not the image size');
  assert.match(html, /\.shot img\{[^}]*object-fit:cover;object-position:top center/,
    'the window shows the top of the capture, where the content is');
});

test('an issue card ranks impact and action above the evidence that supports them', () => {
  // Every field used to be one bullet in a flat list, so "Category: Fonts"
  // carried the same weight as the paragraph saying the build cannot start.
  const html = renderHtml(envelope([f({
    category: 'Fonts', severity: 'High',
    title: 'TITLE_X', impact: 'IMPACT_X', action: 'ACTION_X', detected: 'DETECTED_X',
    owner: 'Designer', confidence: 'High',
  })]));
  const at = (s) => html.indexOf(s);
  assert.ok(at('TITLE_X') < at('IMPACT_X'), 'title first');
  assert.ok(at('IMPACT_X') < at('ACTION_X'), 'impact before action');
  assert.ok(at('ACTION_X') < at('DETECTED_X'), 'action before the evidence');
  assert.ok(at('DETECTED_X') < at('Confidence High'), 'confidence and owner last');
  assert.match(html, /<span class="pill serious">High<\/span>/, 'severity is a labelled pill, never colour alone');

  const md = renderMarkdown(envelope([f({
    category: 'Fonts', severity: 'High',
    title: 'TITLE_X', impact: 'IMPACT_X', action: 'ACTION_X', detected: 'DETECTED_X',
  })]));
  assert.ok(md.indexOf('IMPACT_X') < md.indexOf('DETECTED_X'), 'markdown ranks the same way');
});

test('verdict states the outcome in one line, derived from the same counts as the matrix', () => {
  const none = verdict([]);
  assert.equal(none.status, 'Ready');

  const soft = verdict([f({ category: 'States', severity: 'High' })]);
  assert.equal(soft.status, 'Ready with assumptions');
  assert.match(soft.line, /No blockers/);
  assert.match(soft.line, new RegExp(ROW_LABELS.states));

  const hard = verdict([f({ category: 'Responsive coverage', severity: 'Blocker' })]);
  assert.equal(hard.status, 'Not ready');
  assert.match(hard.line, /1 blocker\b/);
  assert.match(hard.line, new RegExp(ROW_LABELS.responsive));

  // Handoff hygiene has no matrix ROW - but a Blocker is a Blocker, and this
  // assertion used to demand the opposite: a file with a blocking issue
  // rendering "Ready - the file can be handed to development as it stands",
  // while the Summary counted the blocker one heading above. Excluding a
  // category from the readiness ROWS must not exclude its blockers from the
  // VERDICT; the report says where it sits instead.
  const stranded = verdict([f({ category: 'Handoff hygiene', severity: 'Blocker' })]);
  assert.equal(stranded.status, 'Not ready');
  assert.match(stranded.line, /1 blocker outside the readiness matrix, in Handoff hygiene/);

  // Non-blocking hygiene findings still never move the verdict.
  assert.equal(verdict([f({ category: 'Handoff hygiene', severity: 'High' })]).status, 'Ready');

  // The verdict's blocker numbers must add up to the Summary's Blocker tile.
  // The old line printed the FILE's total and then listed the "Not ready"
  // rows, which are a different set: a row goes Not ready on three Highs and
  // no blocker at all. "3 blockers - 3 areas cannot be built as designed"
  // named an area holding zero of them.
  const mixed = [
    f({ id: 'a', category: 'Handoff hygiene', severity: 'Blocker' }),
    f({ id: 'b', category: 'Components & code mapping', severity: 'Blocker' }),
    ...Array.from({ length: 3 }, (_, i) => f({ id: `c${i}`, category: 'Responsive coverage', severity: 'High' })),
  ];
  const vm = verdict(mixed);
  assert.equal(vm.status, 'Not ready');
  assert.match(vm.line, /1 blocker in Components & code mapping/);
  assert.match(vm.line, /1 blocker outside the readiness matrix/);
  assert.match(vm.line, /Also: Responsive & Auto Layout carries three or more high-severity/);
  assert.doesNotMatch(vm.line, /2 blockers/, 'the two blockers are in different places and are never summed');

  const html = renderHtml(envelope([f({ category: 'Responsive coverage', severity: 'Blocker' })]));
  assert.match(html, /class="verdict not-ready"/);
  assert.match(renderMarkdown(envelope([])), /## Verdict: Ready/);
});

test('the readiness matrix names each area instead of printing its internal key', () => {
  const html = renderHtml(envelope([f({ category: 'Responsive coverage', severity: 'High' })]));
  for (const label of Object.values(ROW_LABELS)) {
    assert.ok(html.includes(label.replace(/&/g, '&amp;')), `${label} rendered`);
  }
  assert.match(html, /id="row-responsive"/, 'the key survives as an anchor');
  assert.match(renderMarkdown(envelope([])), /\| Responsive & Auto Layout \|/);
});

test('a long prose scope note is not set in monospace', () => {
  // The scope field is sometimes a short expression ("Pricing") and sometimes
  // a paragraph of method notes. Setting the paragraph in <code> made the most
  // important caveat on the page the hardest line to read.
  const e = envelope([]);
  e.meta.scope = 'D_Landing Page_V5 (198:3) and M_Landing Page (159:3) only. '
    + 'File-wide structural counts cover all 23 top-level items.';
  const html = renderHtml(e);
  assert.match(html, /<strong>Scope:<\/strong>/);
  assert.doesNotMatch(html, /<code>D_Landing/);
  assert.doesNotMatch(renderMarkdown(e), /`D_Landing/, 'the markdown copy is not fenced either');
  assert.ok(html.includes('File-wide structural counts'), 'the note is still stated in full');

  // A scope ending in a full stop must not run into the em-dash clause that
  // follows it, and trimming must not eat a trailing letter.
  e.meta.scope = 'Cards';
  assert.match(renderHtml(e), /<code>Cards<\/code>/);
  e.meta.scope = 'Pricing.';
  assert.match(renderHtml(e), /<code>Pricing<\/code> &mdash;/);
});

// --- Provenance. A report produced without the rule engine used to be
// indistinguishable from one produced with it. That is the failure this
// section exists to make impossible. ---

const measured = (findings, decisions = []) => {
  const e = envelope(findings, decisions);
  e.meta.method = 'rule-engine';
  e.meta.truncated = false;
  e.meta.sampling = {};
  return e;
};

test('a report with no rule-engine provenance says so in both renderers', () => {
  // The real case: findings.json hand-written after the scan failed to
  // return, rendered into a page that looked exactly like a measured audit.
  const e = envelope([f({ category: 'States', severity: 'High', source: 'model' })]);
  const notices = provenance(e);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, 'warning');
  assert.match(notices[0].text, /model judgment/i);

  assert.match(renderHtml(e), /class="callout warning"/);
  assert.match(renderHtml(e), /Method warning/);
  assert.match(renderMarkdown(e), /> \*\*Method warning:\*\*/);
});

test('a report the engine did produce carries no method warning', () => {
  const e = measured([f({ category: 'States', severity: 'High', source: 'rule' })]);
  assert.deepEqual(provenance(e), []);
  assert.doesNotMatch(renderHtml(e), /Method warning/);
  assert.doesNotMatch(renderMarkdown(e), /Method warning/);
});

test('meta claiming the engine ran while no finding came from a rule is still flagged', () => {
  // Copying `"method": "rule-engine"` onto a hand-written findings.json must
  // not buy a clean-looking report.
  const e = measured([f({ category: 'States', severity: 'High', source: 'model' })]);
  const notices = provenance(e);
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /No finding in this report came from the rule engine/);

  // An empty file is not the same claim - there is nothing to be suspicious of.
  assert.deepEqual(provenance(measured([])), []);
});

test('truncation and sampling are disclosed, with the true counts', () => {
  const e = measured([f({ category: 'Handoff hygiene', severity: 'Low', source: 'rule' })]);
  e.meta.truncated = true;
  e.meta.sampling = { HY002: { matched: 12431, kept: 100 } };
  const notices = provenance(e);
  assert.equal(notices.length, 2);
  assert.equal(notices[0].level, 'warning');
  assert.match(notices[0].text, /node budget/);
  assert.equal(notices[1].level, 'note');
  assert.match(notices[1].text, /HY002 matched 12,431 nodes, 100 sampled/);

  assert.match(renderHtml(e), /12,431/);
  assert.match(renderMarkdown(e), /Method note/);
});

test('the CLI renders a measured findings file under the measured filenames', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-fdr-'));
  const src = join(dir, 'findings.json');
  writeFileSync(src, JSON.stringify(measured([f({ category: 'States', severity: 'High', source: 'rule' })])), 'utf8');

  const r = spawnSync(process.execPath, [TOOL, src, '--out', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `exit ${r.status}\n${r.stderr}`);
  assert.match(readFileSync(join(dir, 'readiness-report.md'), 'utf8'), /^# Developer readiness/);
  assert.match(readFileSync(join(dir, 'readiness-report.html'), 'utf8'), /<!doctype html>/i);
  assert.throws(() => readFileSync(join(dir, 'readiness-report-provisional.md'), 'utf8'));
});

test('a model-only run is degraded in the filename, the title and the header', () => {
  // A callout under the verdict does not survive the ways this document
  // actually travels - forwarded as an attachment, screenshotted from the top,
  // skimmed for the verdict, filed under its filename. The three labels that
  // do survive all of that carry it instead.
  const dir = mkdtempSync(join(tmpdir(), 'twt-fdr-'));
  const src = join(dir, 'findings.json');
  const e = envelope([f({ category: 'States', severity: 'High', source: 'model' })]);
  e.meta.method = 'model-only';
  writeFileSync(src, JSON.stringify(e), 'utf8');

  const r = spawnSync(process.execPath, [TOOL, src, '--out', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `exit ${r.status}\n${r.stderr}`);
  assert.match(r.stdout, /PROVISIONAL/, 'the CLI says which kind of report it wrote');

  assert.throws(() => readFileSync(join(dir, 'readiness-report.md'), 'utf8'),
    'a model-only run must never occupy the measured run\'s filename');

  const md = readFileSync(join(dir, 'readiness-report-provisional.md'), 'utf8');
  assert.match(md, /^# Provisional developer readiness/);
  assert.match(md, /Method: \*\*model-only\*\* — no deterministic scan backs this report/);

  const html = readFileSync(join(dir, 'readiness-report-provisional.html'), 'utf8');
  assert.match(html, /<title>Provisional developer readiness/);
  assert.match(html, /method <strong>model-only<\/strong>/);
});

test('the matrix Blocker column reconciles with the Summary count', () => {
  // 3 blockers in the Summary above six rows summing to 2, with nothing on the
  // page explaining the third, is an error any client finds by adding up a
  // column. The unrowed categories get their own row so the arithmetic closes.
  const e = measured([
    f({ id: 'a', category: 'Handoff hygiene', severity: 'Blocker', source: 'rule' }),
    f({ id: 'b', category: 'Components & code mapping', severity: 'Blocker', source: 'rule' }),
    f({ id: 'c', category: 'Forms', severity: 'Blocker', source: 'rule' }),
  ]);
  const md = renderMarkdown(e);
  assert.match(md, /\| Blockers \| 3 \|/);
  assert.match(md, /\| Handoff hygiene _\(excluded\)_ \| Not assessed \| 1 \|/);

  const rows = [...md.matchAll(/^\| (?!Area)(?!---).+? \| (?:\*\*)?[\w ]+(?:\*\*)? \| (\d+) \| \d+ \| \d+ \| \d+ \|$/gm)];
  assert.equal(rows.length, 7, 'six readiness rows plus the excluded row');
  assert.equal(rows.reduce((s, m) => s + Number(m[1]), 0), 3);

  const html = renderHtml(e);
  assert.match(html, /<tr id="row-excluded">/);
  assert.match(html, /Its 1 blocker\(s\) are still counted in the Summary above/);
});

test('an audit with no unrowed findings prints no excluded row', () => {
  const md = renderMarkdown(measured([f({ category: 'States', severity: 'High', source: 'rule' })]));
  assert.doesNotMatch(md, /_\(excluded\)_/);
  assert.match(md, /Handoff hygiene is excluded from the readiness verdict/);
});
