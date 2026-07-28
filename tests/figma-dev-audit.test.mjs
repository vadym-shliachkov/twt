import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, finding, CATEGORIES, SEVERITIES, OWNERS } from '../tools/figma-dev-audit.mjs';

// This fixture mirrors the frozen Task 1 facts contract field-for-field.
// Tasks 3-6 all build their rule tests on it, so a field that drifts from
// what collectFacts() actually emits produces rules that pass their tests
// and do nothing on a real file.
// NOTE ON layoutMode BELOW: collectFacts() normalises Figma's 'NONE' string
// to null, so null here is what the emitter really produces. It was not
// always: the rule that reads it was written against a fixture that guessed,
// and never fired on a real frame. tests/figma-dev-integration.test.mjs now
// joins the emitter to the rules with no fixture in between, which is what
// actually pins this. Keep both.
export const facts = (nodes, extra = {}) => ({
  file: { name: 'T', url: 'https://figma.com/design/K/T', scope: null, pages: ['P'], fonts: [], componentNames: [] },
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

test('deep links survive a Figma URL copied from the browser', () => {
  // "?node-id=0-1&t=..." is the NORMAL form of a copied Figma URL. Appending
  // a second "?" made the browser read the whole tail as one parameter
  // value, so every finding in the report navigated to the same wrong node.
  const out = evaluate(
    facts([{ id: '1:6', type: 'TEXT', textAutoResize: 'NONE', charCount: 40 }], { frames: [
      { id: '1:2', name: 'Home / Desktop', page: 'P', width: 1440, height: 900 },
      { id: '1:3', name: 'Home / Mobile', page: 'P', width: 390, height: 900 },
    ] }),
    { platform: 'web', url: 'https://www.figma.com/design/K/T?node-id=0-1&t=xyz-0#frame' },
  );
  assert.equal(out.findings[0].link, 'https://www.figma.com/design/K/T?node-id=1-6');
});

test('every colon in a node id becomes a dash, not just the first', () => {
  // Instance descendants carry ids like "I423:12;9:8". AL001, A11Y001, CM004
  // and HY002 all commonly fire inside instances, so a single-colon replace
  // mislinks a large share of a real report's findings.
  const out = evaluate(
    facts([{ id: 'I423:12;9:8', type: 'TEXT', textAutoResize: 'NONE', charCount: 40 }], { frames: [
      { id: '1:2', name: 'Home / Desktop', page: 'P', width: 1440, height: 900 },
      { id: '1:3', name: 'Home / Mobile', page: 'P', width: 390, height: 900 },
    ] }),
    { platform: 'web', url: 'https://figma.com/design/K/T' },
  );
  assert.equal(out.findings[0].link, 'https://figma.com/design/K/T?node-id=I423-12;9-8');
});

test('a file-level finding gets the bare file URL, not a dangling ?node-id=', () => {
  const f = facts([], { frames: [
    { id: '1:2', name: 'Home / Desktop', page: 'P', width: 1440, height: 900 },
    { id: '1:3', name: 'Home / Mobile', page: 'P', width: 390, height: 900 },
  ] });
  f.file.fonts = [{ family: 'A', style: 'R' }, { family: 'B', style: 'R' },
                  { family: 'C', style: 'R' }, { family: 'D', style: 'R' }];
  const out = evaluate(f, { url: 'https://figma.com/design/K/T?node-id=0-1' });
  const hit = out.findings.find((x) => x.rule === 'FN002');
  assert.deepEqual(hit.nodeIds, []);
  assert.equal(hit.link, 'https://figma.com/design/K/T');
});

test('meta.scope falls back to the scope the scan actually walked', () => {
  const f = facts([]);
  f.file.scope = 'Pricing';
  assert.equal(evaluate(f, {}).meta.scope, 'Pricing');
  assert.equal(evaluate(f, { scope: 'Home' }).meta.scope, 'Home', 'an explicit flag still wins');
  assert.equal(evaluate(facts([]), {}).meta.scope, null);
});

test('validateFinding is the single implementation both layers call', async () => {
  const { validateFinding } = await import('../tools/figma-dev-audit.mjs');
  assert.throws(() => validateFinding({ id: 'M-1', severity: 'High', confidence: 'Low',
    owner: 'Designer', category: CATEGORIES[0] }), /M-1: bad confidence/);
  assert.throws(() => validateFinding({ id: 'M-2', severity: 'Urgent', confidence: 'High',
    owner: 'Designer', category: CATEGORIES[0] }), /M-2: bad severity/);
  assert.doesNotThrow(() => validateFinding({ id: 'M-3', severity: 'High', confidence: 'Medium',
    owner: 'Developer', category: CATEGORIES[0] }));
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

test('AL002 flags a multi-child frame with no Auto Layout, whichever shape "no Auto Layout" arrives in', () => {
  // scan.js normalises Figma's 'NONE' to null, but the rule must be correct
  // against a facts.json written by any version of the scan. Asserting only
  // the normalised shape is how this rule shipped able to match nothing but
  // GROUPs: 'NONE' is truthy, so !n.layoutMode was false on every frame.
  const kidsOf = (parentId, ids) => ids.map((id) => ({ id, parentId, type: 'FRAME' }));
  const out = ev2(twoTierFacts([
    { id: '1:9', name: 'Card row', type: 'FRAME', layoutMode: null },
    ...kidsOf('1:9', ['1:10', '1:11', '1:12']),
    { id: '1:40', name: 'Legacy row', type: 'FRAME', layoutMode: 'NONE' },
    ...kidsOf('1:40', ['1:41', '1:42', '1:43']),
  ]));
  assert.deepEqual(byRule(out, 'AL002').map((f) => f.nodeIds[0]).sort(), ['1:40', '1:9']);
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

test('AS001 flags image fills with no export settings', () => {
  const out = ev2(twoTierFacts([
    { id: '3:1', name: 'Photo', hasImageFill: true, exportSettings: [] },
    { id: '3:2', name: 'Photo ok', hasImageFill: true,
      exportSettings: [{ format: 'PNG', constraintType: 'SCALE', constraintValue: 2 }] },
  ]));
  assert.deepEqual(byRule(out, 'AS001').map((f) => f.nodeIds[0]), ['3:1']);
});

test('AS002 flags vectors exported as raster', () => {
  const out = ev2(twoTierFacts([
    { id: '3:3', name: 'Logo', type: 'VECTOR',
      exportSettings: [{ format: 'PNG', constraintType: 'SCALE', constraintValue: 1 }] },
    { id: '3:4', name: 'Icon', type: 'VECTOR',
      exportSettings: [{ format: 'SVG', constraintType: 'SCALE', constraintValue: 1 }] },
  ]));
  assert.deepEqual(byRule(out, 'AS002').map((f) => f.nodeIds[0]), ['3:3']);
});

test('FX001 flags blur effects as implementation cost', () => {
  const out = ev2(twoTierFacts([
    { id: '3:5', name: 'Glass panel', effects: [{ type: 'BACKGROUND_BLUR', radius: 24, spread: null, blendMode: null }] },
    { id: '3:6', name: 'Card', effects: [{ type: 'DROP_SHADOW', radius: 8, spread: 0, blendMode: 'NORMAL' }] },
  ]));
  assert.deepEqual(byRule(out, 'FX001').map((f) => f.nodeIds[0]), ['3:5']);
  assert.equal(byRule(out, 'FX001')[0].category, 'Effects & implementation cost');
});

test('FX002 flags blend modes and masks as High', () => {
  const out = ev2(twoTierFacts([
    { id: '3:7', name: 'Overlay', blendMode: 'MULTIPLY' },
    { id: '3:8', name: 'Masked art', type: 'VECTOR', isMask: true },
    { id: '3:9', name: 'Plain', blendMode: 'PASS_THROUGH' },
  ]));
  assert.deepEqual(byRule(out, 'FX002').map((f) => f.nodeIds[0]).sort(), ['3:7', '3:8']);
  assert.equal(byRule(out, 'FX002')[0].severity, 'High');
});

test('HY001 flags hidden layers that still carry export settings', () => {
  const out = ev2(twoTierFacts([
    { id: '3:10', name: 'Old hero', visible: false,
      exportSettings: [{ format: 'PNG', constraintType: 'SCALE', constraintValue: 2 }] },
    { id: '3:11', name: 'Old note', visible: false, exportSettings: [] },
  ]));
  assert.deepEqual(byRule(out, 'HY001').map((f) => f.nodeIds[0]), ['3:10']);
});

test('HY002 flags fractional geometry as Low', () => {
  const out = ev2(twoTierFacts([{ id: '3:12', name: 'Nudged', fractional: true }]));
  assert.equal(byRule(out, 'HY002').length, 1);
  assert.equal(byRule(out, 'HY002')[0].severity, 'Low');
});

test('FN001 emits a licensing decision per non-system font family, never a finding', () => {
  const f = twoTierFacts([]);
  f.file.fonts = [
    { family: 'Inter', style: 'Regular' },
    { family: 'Inter', style: 'Bold' },
    { family: 'Neue Haas Grotesk', style: 'Medium' },
    { family: 'Arial', style: 'Regular' },
  ];
  const out = ev2(f);

  assert.equal(byRule(out, 'FN001').length, 0, 'licensing is never a finding');
  const fams = out.decisions.map((d) => d.question);
  assert.equal(out.decisions.length, 2, 'one decision each for Inter and Neue Haas Grotesk, none for Arial');
  assert.ok(fams.some((q) => /Neue Haas Grotesk/.test(q)));
  assert.ok(!fams.some((q) => /Arial/.test(q)), 'system fonts need no licence question');
  assert.equal(out.decisions[0].owner, 'Client');

  // A decision is a QUESTION, not a graded finding. The moment it carries a
  // severity or a confidence it starts reading as a detected fact, which is
  // exactly the failure this rule exists to prevent - so pin their absence.
  for (const d of out.decisions) {
    assert.ok(!('severity' in d), 'a decision carries no severity');
    assert.ok(!('confidence' in d), 'a decision carries no confidence');
  }
});

test('FN002 flags an oversized type inventory', () => {
  const f = twoTierFacts([]);
  f.file.fonts = [
    { family: 'A', style: 'R' }, { family: 'B', style: 'R' },
    { family: 'C', style: 'R' }, { family: 'D', style: 'R' },
  ];
  const out = ev2(f);
  assert.equal(byRule(out, 'FN002').length, 1);
  assert.equal(byRule(out, 'FN002')[0].severity, 'Medium');
});

test('A11Y001 flags low-contrast body text and respects the large-text threshold', () => {
  const bg = { id: '4:1', name: 'Panel', parentId: '1:2',
    fills: [{ type: 'SOLID', hex: '#ffffff', opacity: 1, boundVariable: false }] };
  const small = { id: '4:2', name: 'Caption', type: 'TEXT', parentId: '4:1', fontSize: 14,
    fills: [{ type: 'SOLID', hex: '#aaaaaa', opacity: 1, boundVariable: false }] };
  const large = { id: '4:3', name: 'Display', type: 'TEXT', parentId: '4:1', fontSize: 48,
    fills: [{ type: 'SOLID', hex: '#767676', opacity: 1, boundVariable: false }] };
  const out = ev2(twoTierFacts([bg, small, large]));

  const hits = byRule(out, 'A11Y001').map((f) => f.nodeIds[0]);
  assert.ok(hits.includes('4:2'), '#aaaaaa on white is below 4.5 at 14px');
  assert.ok(!hits.includes('4:3'), '#767676 on white clears 3.0 at 48px');
});

test('A11Y001 makes no contrast claim when node opacity is not 1', () => {
  // solidHex reads FILL opacity. NODE opacity multiplies on top of it, so a
  // 100%-opacity fill on a 40%-opacity node does NOT render at the ratio
  // computed from its hex - and this rule stamps Confidence: High, a
  // measurement claim. An unmeasured measurement is the one thing this
  // report may never print.
  const white = [{ type: 'SOLID', hex: '#ffffff', opacity: 1, boundVariable: false }];
  const grey = [{ type: 'SOLID', hex: '#aaaaaa', opacity: 1, boundVariable: false }];
  const out = ev2(twoTierFacts([
    { id: '5:1', name: 'Panel', parentId: '1:2', fills: white },
    { id: '5:2', name: 'Solid caption', type: 'TEXT', parentId: '5:1', fontSize: 14, fills: grey },
    { id: '5:3', name: 'Faded caption', type: 'TEXT', parentId: '5:1', fontSize: 14, fills: grey, opacity: 0.4 },
    // The text is fully opaque but sits on a translucent panel, so the
    // background hex is not what renders behind it either.
    { id: '5:4', name: 'Ghost panel', parentId: '1:2', fills: white, opacity: 0.5 },
    { id: '5:5', name: 'Caption on ghost', type: 'TEXT', parentId: '5:4', fontSize: 14, fills: grey },
  ]));
  const hits = byRule(out, 'A11Y001').map((f) => f.nodeIds[0]);
  assert.deepEqual(hits, ['5:2'], 'only the fully-opaque text on a fully-opaque background is measurable');
});

test('A11Y002 flags undersized touch targets', () => {
  const out = ev2(twoTierFacts([
    { id: '4:4', name: 'Close button', width: 24, height: 24 },
    { id: '4:5', name: 'Menu icon', width: 48, height: 48 },
    { id: '4:6', name: 'Hero', width: 20, height: 20 },
  ]));
  assert.deepEqual(byRule(out, 'A11Y002').map((f) => f.nodeIds[0]), ['4:4']);
});

test('A11Y002 does not flag an icon inside an adequately sized button', () => {
  // A 24x24 layer named "icon" inside a 48x48 button IS a correctly sized
  // touch target - the user hits the button. Flagging the icon fires on
  // every icon in the file, eats the accessibility category's cap of 5, and
  // grades the row down on evidence that is simply wrong.
  const out = ev2(twoTierFacts([
    { id: '6:1', name: 'Menu button', width: 48, height: 48, parentId: '1:2' },
    { id: '6:2', name: 'icon', width: 24, height: 24, parentId: '6:1' },
    // Same icon, but its button is itself too small: both are real findings.
    { id: '6:3', name: 'Close button', width: 32, height: 32, parentId: '1:2' },
    { id: '6:4', name: 'icon / close', width: 16, height: 16, parentId: '6:3' },
    // A small control whose parent is not a control at all still fires.
    { id: '6:5', name: 'Card', width: 300, height: 200, parentId: '1:2' },
    { id: '6:6', name: 'toggle', width: 20, height: 20, parentId: '6:5' },
  ]));
  const hits = byRule(out, 'A11Y002').map((f) => f.nodeIds[0]).sort();
  assert.deepEqual(hits, ['6:3', '6:4', '6:6']);
  assert.ok(!hits.includes('6:2'), 'the icon inside a 48x48 button is not an undersized target');
});
