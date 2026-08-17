import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeElement, makeSpec } from '../tools/fidelity/spec.mjs';
import { diffSpec } from '../tools/fidelity/diff.mjs';
import { renderValidationReport, renderHtml } from '../tools/fidelity/report.mjs';

const el = (id, over = {}) => makeElement({ id, ...over });

function fixture(mode = 'system') {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', ref: 'https://x.test' }, widths: [1440],
    elements: [el('hero.title.0', { type: { size: 56, lineHeight: 64 } })],
  });
  const got = [el('hero.title.0', { type: { size: 48, lineHeight: 64 } })];
  return { spec, diff: diffSpec(spec, got, { mode, width: 1440 }) };
}

const META = {
  target: 'hero', source: { kind: 'url', ref: 'https://x.test' }, widths: [1440],
  provenance: { measured: 1, estimated: 0 }, mode: 'system', iteration: 1,
  pixdiff: { mismatch: 4.2, reported: true },
  images: { reference: 'reference/1440.png', built: 'built/iter-1-1440.png', diff: 'diff/iter-1-1440.png' },
};

test('the report opens with a weighted scorecard summing to 100', () => {
  const { diff } = fixture();
  const md = renderValidationReport(diff, META);
  assert.match(md, /## Scorecard/);
  assert.match(md, /Geometry\s*\|\s*30/);
  assert.match(md, /Typography\s*\|\s*25/);
  assert.match(md, /Structure\s*\|\s*25/);
  assert.match(md, /Colour\s*\|\s*20/);
  assert.match(md, /\*\*Health:\*\*/);
  assert.match(md, /\*\*Band:\*\*/);
});

test('an unassessed category renders as not-assessed, never as a score', () => {
  // scoreOf returns per[g] === null for a group with no comparable rows, and
  // Health is renormalized over the assessed groups only. The renderer must not
  // print "null" — or worse, a number — for a category nobody measured.
  const { diff } = fixture();
  const md = renderValidationReport(diff, META);
  assert.doesNotMatch(md, /\|\s*null\s*\|/, 'a null group score must never reach the table');
  if (diff.score.per.structure === null) {
    assert.match(md, /Structure\s*\|\s*25\s*\|\s*—/);
    assert.match(md, /not assessed/);
  }
  assert.match(md, /weighted over assessed categories only/);
});

test('a diff with nothing comparable reports no Health number at all', () => {
  const empty = { rows: [], counts: { pass: 0, warn: 0, fail: 0 }, mode: 'system',
    score: { per: { geometry: null, typography: null, structure: null, colour: null },
             health: null, band: 'Not assessed',
             weights: { geometry: 30, typography: 25, structure: 25, colour: 20 } } };
  const md = renderValidationReport(empty, META);
  assert.match(md, /\*\*Health:\*\* not assessed/);
  assert.doesNotMatch(md, /\*\*Health:\*\* \d/);
});

test('the report carries the three required sections in order', () => {
  const { diff } = fixture();
  const md = renderValidationReport(diff, META);
  const iScore = md.indexOf('## Scorecard');
  const iDec = md.indexOf('## Decisions to confirm');
  const iFind = md.indexOf('## Findings');
  const iSum = md.indexOf('## Summary');
  assert.ok(iScore < iDec && iDec < iFind && iFind < iSum, 'section order must match CONVENTIONS 12');
});

test('each finding states Where / Problem / Recommendation', () => {
  const { diff } = fixture();
  const md = renderValidationReport(diff, META);
  assert.match(md, /BLOCKER/);
  assert.match(md, /\*\*Where:\*\* `hero\.title\.0` @1440/);
  assert.match(md, /\*\*Problem:\*\*/);
  assert.match(md, /\*\*Recommendation:\*\*/);
  assert.match(md, /type\.size/);
  assert.match(md, /56/);
  assert.match(md, /48/);
});

test('system-mode snaps render as WARNING; strict-mode snaps render as BLOCKER', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
    elements: [el('hero.0', { spacing: { padding: [92, 0, 92, 0] } })],
  });
  const got = [el('hero.0', {
    spacing: { padding: [96, 0, 96, 0] }, tokens: { 'spacing.padding': '--space-6' },
  })];
  const soft = renderValidationReport(diffSpec(spec, got, { mode: 'system', width: 1440 }),
    { ...META, mode: 'system' });
  const hard = renderValidationReport(diffSpec(spec, got, { mode: 'strict', width: 1440 }),
    { ...META, mode: 'strict' });
  assert.match(soft, /WARNING[\s\S]*--space-6/);
  assert.match(hard, /BLOCKER[\s\S]*--space-6/);
  assert.match(hard, /tokens\.css/, 'strict mode must prescribe adding the token');
  assert.doesNotMatch(hard, /inline a literal/i);
});

test('an estimated run is labelled everywhere it could mislead', () => {
  const { diff } = fixture();
  const md = renderValidationReport(diff,
    { ...META, provenance: { measured: 0, estimated: 1 } });
  assert.match(md, /ESTIMATED/);
  assert.match(md, /0 measured \/ 1 estimated/);
});

test('a mixed run states the mix rather than claiming measurement', () => {
  const { diff } = fixture();
  const md = renderValidationReport(diff,
    { ...META, provenance: { measured: 38, estimated: 6 } });
  assert.match(md, /38 measured \/ 6 estimated/);
});

test('an unverified Elementor run reports no score at all', () => {
  const md = renderValidationReport(null, { ...META, unverified: 'no WordPress URL supplied' });
  assert.match(md, /NOT VERIFIED/);
  assert.match(md, /no WordPress URL supplied/);
  assert.doesNotMatch(md, /\*\*Health:\*\* \d/, 'must not emit a score it never measured');
});

test('the HTML report embeds the three images and escapes text content', () => {
  const { diff } = fixture();
  const html = renderHtml(diff, META);
  assert.match(html, /reference\/1440\.png/);
  assert.match(html, /built\/iter-1-1440\.png/);
  assert.match(html, /diff\/iter-1-1440\.png/);
  const withMarkup = renderHtml(diff, { ...META, target: '<script>x</script>' });
  assert.doesNotMatch(withMarkup, /<script>x<\/script>/);
});

// --- Extra coverage beyond the brief -----------------------------------
//
// The standing instruction on this plan: the brief's tests are a floor, not
// a ceiling. Five prior tasks each shipped a coverage hole the plan itself
// had authored. The three gaps below are named explicitly in the task
// brief's standing instruction; a fourth (the Summary line leaking a
// literal "null" health) was found by reading the given implementation
// against test 3, which only inspects the "**Health:**" line and never the
// "## Summary" paragraph a few lines later — the same score can still leak
// through there.

test('extra: a strict-mode snap fix never tells you to inline a literal, structurally', () => {
  // The brief's own test 6 already checks this on one fixture (padding).
  // This test pins the *rule*, not one instance of it: scan every BLOCKER
  // finding produced by a snap in strict mode and assert none of their
  // Recommendation lines contain "inline a literal" (the anti-pattern this
  // mode exists to prevent) — instead every one must point at tokens.css.
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
    elements: [
      el('hero.0', { spacing: { padding: [92, 0, 92, 0] } }),
      el('hero.1', { radius: [4, 4, 4, 4] }),
    ],
  });
  const got = [
    el('hero.0', { spacing: { padding: [96, 0, 96, 0] }, tokens: { 'spacing.padding': '--space-6' } }),
    el('hero.1', { radius: [8, 8, 8, 8], tokens: { radius: '--radius-2' } }),
  ];
  const diff = diffSpec(spec, got, { mode: 'strict', width: 1440 });
  const md = renderValidationReport(diff, { ...META, mode: 'strict' });
  const recBlocks = md.match(/\*\*Recommendation:\*\* .*/g) ?? [];
  assert.ok(recBlocks.length > 0, 'fixture must actually produce findings to check');
  for (const line of recBlocks) {
    assert.doesNotMatch(line, /inline a literal/i);
  }
  // Every snap-driven BLOCKER must prescribe growing the token system.
  const blockerSnapCount = (diff.rows.filter((r) => r.snapped && r.status === 'fail')).length;
  const tokensCssMentions = (md.match(/tokens\.css/g) ?? []).length;
  assert.ok(tokensCssMentions >= blockerSnapCount,
    'every strict-mode snap BLOCKER must prescribe tokens.css at least once');
});

test('extra: section order holds even with zero findings', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
    elements: [el('hero.0', { type: { size: 32, lineHeight: 40 } })],
  });
  const got = [el('hero.0', { type: { size: 32, lineHeight: 40 } })];
  const diff = diffSpec(spec, got, { mode: 'system', width: 1440 });
  assert.equal(diff.counts.fail, 0);
  assert.equal(diff.counts.warn, 0);
  const md = renderValidationReport(diff, META);
  const iScore = md.indexOf('## Scorecard');
  const iDec = md.indexOf('## Decisions to confirm');
  const iFind = md.indexOf('## Findings');
  const iSum = md.indexOf('## Summary');
  assert.ok(iScore >= 0 && iDec > iScore && iFind > iDec && iSum > iFind,
    'all four sections must be present, in order, even with nothing to report');
  assert.match(md, /_Every measured property is within tolerance\._/);
  assert.doesNotMatch(md, /BLOCKER/);
  assert.doesNotMatch(md, /WARNING/);
});

test('extra: every finding row carries a Where naming both the element id and the width', () => {
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', ref: 'x' }, widths: [1440],
    elements: [
      el('hero.title.0', { type: { size: 56, lineHeight: 64 } }),
      el('hero.box.1', { box: { x: 0, y: 0, w: 400, h: 100 } }),
    ],
  });
  const got = [
    el('hero.title.0', { type: { size: 48, lineHeight: 64 } }),
    el('hero.box.1', { box: { x: 0, y: 0, w: 300, h: 100 } }),
  ];
  const diff = diffSpec(spec, got, { mode: 'system', width: 1440 });
  const md = renderValidationReport(diff, META);
  const findingHeaders = md.match(/^### .+$/gm) ?? [];
  assert.ok(findingHeaders.length >= 2, 'fixture must produce more than one finding');
  const whereLines = md.match(/^\*\*Where:\*\* .+$/gm) ?? [];
  assert.equal(whereLines.length, findingHeaders.length,
    'every finding heading must be followed by exactly one Where line');
  for (const line of whereLines) {
    assert.match(line, /`[^`]+`\s+@1440/, `Where line must name an element id and width 1440: ${line}`);
  }
  assert.match(md, /`hero\.title\.0`\s+@1440/);
  assert.match(md, /`hero\.box\.1`\s+@1440/);
});

test('extra: an unassessed-only diff never leaks a literal null health into the Summary paragraph', () => {
  // Test 3 (from the brief) only inspects the "**Health:**" line. The same
  // null score also feeds the "## Summary" paragraph a few lines further
  // down — a naive template literal there would print "(null/100)".
  const empty = { rows: [], counts: { pass: 0, warn: 0, fail: 0 }, mode: 'system',
    score: { per: { geometry: null, typography: null, structure: null, colour: null },
             health: null, band: 'Not assessed',
             weights: { geometry: 30, typography: 25, structure: 25, colour: 20 } } };
  const md = renderValidationReport(empty, META);
  const summary = md.slice(md.indexOf('## Summary'));
  assert.doesNotMatch(summary, /null/i, `Summary must not leak a literal null: ${summary}`);
});
