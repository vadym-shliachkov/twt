import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, finding, CATEGORIES, SEVERITIES, OWNERS } from '../tools/figma-dev-audit.mjs';

// This fixture mirrors the frozen Task 1 facts contract field-for-field.
// Tasks 3-6 all build their rule tests on it, so a field that drifts from
// what collectFacts() actually emits produces rules that pass their tests
// and do nothing on a real file.
export const facts = (nodes, extra = {}) => ({
  file: { name: 'T', url: 'https://figma.com/design/K/T', pages: ['P'], fonts: [], componentNames: [] },
  frames: [{ id: '1:2', name: 'F', page: 'P', width: 1440, height: 900 }],
  nodes: nodes.map((n) => ({
    id: '1:9', name: 'n', type: 'FRAME', page: 'P', frame: 'F', parentId: '1:2', depth: 1,
    x: 0, y: 0, width: 10, height: 10, visible: true, opacity: 1,
    layoutMode: null, layoutSizingHorizontal: null, layoutSizingVertical: null,
    layoutPositioning: 'AUTO', constraints: null,
    itemSpacing: null, paddingLeft: null, paddingRight: null, paddingTop: null, paddingBottom: null,
    textAutoResize: null, charCount: null,
    fontFamily: null, fontStyle: null, fontSize: null,
    isInstance: false, mainComponentId: null, mainComponentName: null,
    nameMatchesComponent: false,
    overrideCount: 0, componentPropertyCount: 0, variantProperties: null,
    fills: [], strokes: [], effects: [], blendMode: 'PASS_THROUGH', isMask: false,
    exportSettings: [], hasImageFill: false, outOfBounds: false, fractional: false,
    ...n,
  })),
  ...extra,
});

test('finding() rejects an unknown severity', () => {
  assert.throws(
    () => finding({ rule: 'X', title: 't', category: CATEGORIES[0], severity: 'Critical',
                    confidence: 'High', owner: 'Designer', nodeIds: ['1:9'], detected: 'd' }),
    /severity/i,
  );
});

test('finding() rejects Confidence: Low - it must become a decision instead', () => {
  assert.throws(
    () => finding({ rule: 'X', title: 't', category: CATEGORIES[0], severity: 'High',
                    confidence: 'Low', owner: 'Designer', nodeIds: ['1:9'], detected: 'd' }),
    /confidence/i,
  );
});

test('finding() rejects an owner outside the closed vocabulary', () => {
  assert.throws(
    () => finding({ rule: 'X', title: 't', category: CATEGORIES[0], severity: 'High',
                    confidence: 'High', owner: 'Team lead', nodeIds: ['1:9'], detected: 'd' }),
    /owner/i,
  );
});

test('finding() rejects an unknown category', () => {
  assert.throws(
    () => finding({ rule: 'X', title: 't', category: 'Vibes', severity: 'High',
                    confidence: 'High', owner: 'Designer', nodeIds: ['1:9'], detected: 'd' }),
    /category/i,
  );
});

test('finding() defaults impact and action to null for the model to fill', () => {
  const f = finding({ rule: 'X', title: 't', category: CATEGORIES[0], severity: 'High',
                      confidence: 'High', owner: 'Designer', nodeIds: ['1:9'], detected: 'd' });
  assert.equal(f.impact, null);
  assert.equal(f.action, null);
  assert.equal(f.source, 'rule');
  assert.equal(f.blocking, false);
});

test('finding() marks Blocker severity as blocking', () => {
  const f = finding({ rule: 'X', title: 't', category: CATEGORIES[0], severity: 'Blocker',
                      confidence: 'High', owner: 'Client', nodeIds: ['1:9'], detected: 'd' });
  assert.equal(f.blocking, true);
});

test('evaluate() returns the findings.json envelope with meta', () => {
  // Two tiers so this meta-shape check doesn't incidentally trip RS002
  // (Task 3): the default single-frame fixture is desktop-only.
  const out = evaluate(facts([], { frames: [
    { id: '1:2', name: 'Home / Desktop', page: 'P', width: 1440, height: 900 },
    { id: '1:3', name: 'Home / Mobile', page: 'P', width: 390, height: 900 },
  ] }), { platform: 'web', url: 'https://figma.com/design/K/T' });
  assert.equal(out.meta.platform, 'web');
  assert.equal(out.meta.url, 'https://figma.com/design/K/T');
  assert.ok(out.meta.scannedAt, 'scannedAt is stamped');
  assert.deepEqual(out.findings, []);
  assert.deepEqual(out.decisions, []);
});

test('evaluate() builds a node-id deep link on every finding', () => {
  // AL001 fires on a text node with textAutoResize NONE (Task 3 rule, but the
  // link contract is the engine's, so it is asserted here once the rule exists).
  const out = evaluate(
    facts([{ id: '1:6', type: 'TEXT', textAutoResize: 'NONE', charCount: 40 }]),
    { platform: 'web', url: 'https://figma.com/design/K/T' },
  );
  for (const f of out.findings) {
    assert.match(f.link, /^https:\/\/figma\.com\/design\/K\/T\?node-id=/);
  }
});

test('exported vocabularies are exactly the spec vocabularies', () => {
  assert.deepEqual(SEVERITIES, ['Blocker', 'High', 'Medium', 'Low']);
  assert.deepEqual(OWNERS, ['Designer', 'Client', 'Developer', 'Content team', 'Product owner']);
  assert.equal(CATEGORIES.length, 12);
});

import { evaluate as ev2 } from '../tools/figma-dev-audit.mjs';
import { screenKey } from '../tools/figma-dev-audit/rules/layout.mjs';

const byRule = (out, rule) => out.findings.filter((f) => f.rule === rule);

// Two tiers present by default, so RS002 stays quiet unless a test wants it.
const twoTierFacts = (nodes) => {
  const f = facts(nodes);
  f.frames = [
    { id: '1:2', name: 'Home / Desktop', page: 'P', width: 1440, height: 900 },
    { id: '1:3', name: 'Home / Mobile', page: 'P', width: 390, height: 900 },
  ];
  return f;
};

test('AL001 flags a fixed-height text container holding real copy', () => {
  const out = ev2(twoTierFacts([
    { id: '1:6', name: 'Body', type: 'TEXT', textAutoResize: 'NONE', charCount: 120 },
    { id: '1:7', name: 'Badge', type: 'TEXT', textAutoResize: 'NONE', charCount: 3 },
    { id: '1:8', name: 'Lead', type: 'TEXT', textAutoResize: 'HEIGHT', charCount: 120 },
  ]), { url: 'https://figma.com/design/K/T' });

  const hits = byRule(out, 'AL001');
  assert.equal(hits.length, 1, 'only the long fixed-height text fires');
  assert.equal(hits[0].nodeIds[0], '1:6');
  assert.equal(hits[0].severity, 'High');
  assert.equal(hits[0].confidence, 'High');
  assert.equal(hits[0].category, 'Auto Layout & sizing');
  assert.equal(hits[0].link, 'https://figma.com/design/K/T?node-id=1-6');
});

test('AL002 flags a multi-child frame with no Auto Layout', () => {
  const kids = ['1:10', '1:11', '1:12'].map((id) => ({ id, parentId: '1:9', type: 'FRAME' }));
  const out = ev2(twoTierFacts([{ id: '1:9', name: 'Card row', type: 'FRAME', layoutMode: null }, ...kids]));
  assert.equal(byRule(out, 'AL002').length, 1);
  assert.equal(byRule(out, 'AL002')[0].severity, 'Medium');
});

test('AL002 stays quiet when the frame has Auto Layout', () => {
  const kids = ['1:10', '1:11', '1:12'].map((id) => ({ id, parentId: '1:9', type: 'FRAME' }));
  const out = ev2(twoTierFacts([{ id: '1:9', name: 'Card row', layoutMode: 'HORIZONTAL' }, ...kids]));
  assert.equal(byRule(out, 'AL002').length, 0);
});

test('AL003 flags spacer rectangles', () => {
  const out = ev2(twoTierFacts([
    { id: '1:20', name: 'Spacer 24', type: 'RECTANGLE', fills: [] },
    { id: '1:21', name: 'Divider', type: 'RECTANGLE', fills: [{ type: 'SOLID', hex: '#eee', opacity: 1, boundVariable: false }] },
  ]));
  assert.deepEqual(byRule(out, 'AL003').map((f) => f.nodeIds[0]), ['1:20']);
  assert.equal(byRule(out, 'AL003')[0].severity, 'Low');
});

test('RS001 flags nodes escaping their frame', () => {
  const out = ev2(twoTierFacts([{ id: '1:30', name: 'Hero image', outOfBounds: true }]));
  assert.equal(byRule(out, 'RS001').length, 1);
  assert.equal(byRule(out, 'RS001')[0].severity, 'High');
});

test('RS002 is a Blocker when only one breakpoint tier exists', () => {
  const f = facts([]);
  f.frames = [
    { id: '1:2', name: 'Home', page: 'P', width: 1440, height: 900 },
    { id: '1:3', name: 'About', page: 'P', width: 1440, height: 900 },
  ];
  const out = ev2(f);
  assert.equal(byRule(out, 'RS002').length, 1);
  assert.equal(byRule(out, 'RS002')[0].severity, 'Blocker');
  assert.equal(byRule(out, 'RS002')[0].blocking, true);
  assert.equal(byRule(out, 'RS002')[0].owner, 'Designer');
});

test('RS002 stays quiet once two tiers exist', () => {
  assert.equal(byRule(ev2(twoTierFacts([])), 'RS002').length, 0);
});

test('RS003 flags a desktop screen with no mobile counterpart', () => {
  const f = facts([]);
  f.frames = [
    { id: '1:2', name: 'Home / Desktop', page: 'P', width: 1440, height: 900 },
    { id: '1:3', name: 'Home / Mobile', page: 'P', width: 390, height: 900 },
    { id: '1:4', name: 'Pricing / Desktop', page: 'P', width: 1440, height: 900 },
  ];
  const out = ev2(f);
  const hits = byRule(out, 'RS003');
  assert.equal(hits.length, 1);
  assert.match(hits[0].detected, /Pricing/);
});

test('screenKey never collapses a separator-plus-tier name to an empty key', () => {
  assert.equal(screenKey('Home / Desktop'), 'home');
  assert.equal(screenKey('Desktop'), 'desktop');
  assert.notEqual(screenKey('/Desktop'), '');
  assert.notEqual(screenKey('-Mobile'), '');
  assert.notEqual(screenKey('/Desktop'), screenKey('-Mobile'),
    'two unrelated tier-only names must not share a key');
});

test('CM001 flags likely-detached instances at Medium confidence', () => {
  // The Plugin API leaves no detachment marker, so this rule interprets a
  // name collision. It is inference, and its confidence must say so.
  const out = ev2(twoTierFacts([
    { id: '2:1', name: 'Button/Primary', type: 'FRAME', nameMatchesComponent: true },
    { id: '2:2', name: 'Button/Primary', isInstance: true, mainComponentId: '9:1' },
  ]));
  const hits = byRule(out, 'CM001');
  assert.deepEqual(hits.map((f) => f.nodeIds[0]), ['2:1']);
  assert.equal(hits[0].severity, 'High');
  assert.equal(hits[0].confidence, 'Medium', 'inference, not measurement');
  assert.match(hits[0].detected, /detach/i);
});

test('CM002 flags instances carrying a heavy override load', () => {
  const out = ev2(twoTierFacts([
    { id: '2:3', name: 'Card', isInstance: true, overrideCount: 11 },
    { id: '2:4', name: 'Card', isInstance: true, overrideCount: 2 },
  ]));
  assert.deepEqual(byRule(out, 'CM002').map((f) => f.nodeIds[0]), ['2:3']);
  assert.match(byRule(out, 'CM002')[0].detected, /11/);
});

test('CM003 flags interactive components with no variants or properties', () => {
  const out = ev2(twoTierFacts([
    { id: '2:5', name: 'Button/Primary', type: 'COMPONENT', componentPropertyCount: 0, variantProperties: null },
    { id: '2:6', name: 'Button/Secondary', type: 'COMPONENT', componentPropertyCount: 0, variantProperties: { State: 'Hover' } },
    { id: '2:7', name: 'Hero illustration', type: 'COMPONENT', componentPropertyCount: 0, variantProperties: null },
  ]));
  assert.deepEqual(byRule(out, 'CM003').map((f) => f.nodeIds[0]), ['2:5']);
});

test('CM004 flags default layer names as Low', () => {
  const out = ev2(twoTierFacts([
    { id: '2:8', name: 'Frame 123' },
    { id: '2:9', name: 'Copy 7' },
    { id: '2:10', name: 'Hero' },
  ]));
  assert.deepEqual(byRule(out, 'CM004').map((f) => f.nodeIds[0]).sort(), ['2:8', '2:9']);
  assert.equal(byRule(out, 'CM004')[0].severity, 'Low');
  assert.equal(byRule(out, 'CM004')[0].category, 'Handoff hygiene');
});
