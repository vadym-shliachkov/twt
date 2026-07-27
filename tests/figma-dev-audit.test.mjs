import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, finding, CATEGORIES, SEVERITIES, OWNERS } from '../tools/figma-dev-audit.mjs';

export const facts = (nodes, extra = {}) => ({
  file: { name: 'T', url: 'https://figma.com/design/K/T', pages: ['P'], fonts: [], variableCollections: [] },
  frames: [{ id: '1:2', name: 'F', page: 'P', width: 1440, height: 900 }],
  nodes: nodes.map((n) => ({
    id: '1:9', name: 'n', type: 'FRAME', page: 'P', frame: 'F', parentId: '1:2', depth: 1,
    x: 0, y: 0, width: 10, height: 10, visible: true, opacity: 1,
    layoutMode: null, layoutSizingHorizontal: null, layoutSizingVertical: null,
    layoutPositioning: 'AUTO', constraints: null, textAutoResize: null, charCount: null,
    fontFamily: null, fontStyle: null, fontSize: null,
    isInstance: false, mainComponentId: null, mainComponentName: null, detached: false,
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
  const out = evaluate(facts([]), { platform: 'web', url: 'https://figma.com/design/K/T' });
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
