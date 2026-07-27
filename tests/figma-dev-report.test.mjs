import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readiness, applyCaps, renderMarkdown, ROW_CATEGORIES } from '../tools/figma-dev-report.mjs';

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
