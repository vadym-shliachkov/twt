import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not a manual .pathname regex: this repo lives under
// "C:\Work\~marketplace" and Node percent-encodes "~" in import.meta.url.
const SCAN = fileURLToPath(new URL('../tools/figma-dev-audit/scan.js', import.meta.url));

// scan.js is stringified into the Figma sandbox, so it cannot use ESM.
// We load it the same way the sandbox does: as a function body.
function loadScan() {
  const src = readFileSync(SCAN, 'utf8');
  return new Function('figma', `${src}\nreturn collectFacts(figma.root);`);
}

// Minimal duck-typed Figma node tree.
const node = (o) => ({
  id: '0:0', name: 'n', type: 'FRAME', visible: true, opacity: 1,
  x: 0, y: 0, width: 100, height: 100, children: [],
  fills: [], strokes: [], effects: [], exportSettings: [],
  blendMode: 'PASS_THROUGH', ...o,
});

function fakeFigma(pages) {
  return {
    root: { name: 'Test File', type: 'DOCUMENT', children: pages },
    loadAllPagesAsync: async () => {},
  };
}

test('collectFacts records frames with their page and size', () => {
  const frame = node({ id: '1:2', name: 'Homepage / Desktop', width: 1440, height: 3000 });
  const page = node({ id: '1:1', name: 'Website', type: 'PAGE', children: [frame] });
  const facts = loadScan()(fakeFigma([page]));

  assert.deepEqual(facts.file.pages, ['Website']);
  assert.equal(facts.frames.length, 1);
  assert.equal(facts.frames[0].name, 'Homepage / Desktop');
  assert.equal(facts.frames[0].page, 'Website');
  assert.equal(facts.frames[0].width, 1440);
});

test('collectFacts flags fractional geometry and out-of-bounds nodes', () => {
  const inside = node({ id: '1:3', name: 'ok', x: 10, y: 10, width: 50, height: 50 });
  const spill = node({ id: '1:4', name: 'spill', x: 900, y: 10, width: 300, height: 50 });
  const frac = node({ id: '1:5', name: 'frac', x: 10.5, y: 10, width: 50, height: 50 });
  const frame = node({ id: '1:2', name: 'F', width: 1000, height: 500, children: [inside, spill, frac] });
  const page = node({ id: '1:1', name: 'P', type: 'PAGE', children: [frame] });
  const facts = loadScan()(fakeFigma([page]));
  const by = (id) => facts.nodes.find((n) => n.id === id);

  assert.equal(by('1:3').outOfBounds, false);
  assert.equal(by('1:4').outOfBounds, true);
  assert.equal(by('1:5').fractional, true);
  assert.equal(by('1:3').fractional, false);
});

test('outOfBounds compares canvas coordinates via absoluteBoundingBox, not parent-relative x/y', () => {
  // A frame is not necessarily at canvas origin - e.g. a Tablet frame placed
  // to the right of a Desktop frame on the same page. A child's x/y are
  // relative to its immediate parent (the frame), so comparing them
  // directly against the frame's canvas box would falsely flag every child
  // in a non-origin frame as out of bounds. absoluteBoundingBox puts both
  // sides of the comparison in canvas space.
  const inside = node({
    id: '1:3', name: 'inside', x: 10, y: 10, width: 50, height: 50,
    absoluteBoundingBox: { x: 1510, y: 10, width: 50, height: 50 },
  });
  const escapes = node({
    id: '1:4', name: 'escapes', x: 10, y: 10, width: 50, height: 50,
    absoluteBoundingBox: { x: 100, y: 10, width: 50, height: 50 },
  });
  const frame = node({
    id: '1:2', name: 'Tablet', x: 1500, y: 0, width: 1000, height: 500,
    absoluteBoundingBox: { x: 1500, y: 0, width: 1000, height: 500 },
    children: [inside, escapes],
  });
  const page = node({ id: '1:1', name: 'P', type: 'PAGE', children: [frame] });
  const facts = loadScan()(fakeFigma([page]));
  const by = (id) => facts.nodes.find((n) => n.id === id);

  assert.equal(by('1:3').outOfBounds, false, 'fully inside the frame in canvas space');
  assert.equal(by('1:4').outOfBounds, true, 'genuinely escapes the frame in canvas space');
});

test('outOfBounds never mixes coordinate spaces when only one side has absoluteBoundingBox', () => {
  // The frame is at a non-zero canvas x and exposes absoluteBoundingBox; the
  // child does not. Comparing the child's local box against the frame's
  // canvas box would be a mixed-space comparison - wrongly flagging a child
  // that is fully inside the frame. The space must be decided jointly: since
  // one side lacks absoluteBoundingBox, BOTH sides must fall back to local
  // coordinates, under which this child (frame-relative x:10) is inside a
  // frame whose local x defaults to 0.
  const inside = node({ id: '1:3', name: 'inside', x: 10, y: 10, width: 50, height: 50 });
  const frame = node({
    id: '1:2', name: 'Tablet', x: 1500, y: 0, width: 1000, height: 500,
    absoluteBoundingBox: { x: 1500, y: 0, width: 1000, height: 500 },
    children: [inside],
  });
  const page = node({ id: '1:1', name: 'P', type: 'PAGE', children: [frame] });
  const facts = loadScan()(fakeFigma([page]));
  const by = (id) => facts.nodes.find((n) => n.id === id);

  assert.equal(by('1:3').outOfBounds, false, 'child without absoluteBoundingBox must not be compared against the frame\'s canvas box');
});

test('collectFacts captures layout, text and instance facts', () => {
  const text = node({
    id: '1:6', name: 'Title', type: 'TEXT', textAutoResize: 'NONE',
    characters: 'Hello', fontName: { family: 'Inter', style: 'Bold' }, fontSize: 32,
  });
  const inst = node({
    id: '1:7', name: 'Button', type: 'INSTANCE',
    mainComponent: { id: '9:1', name: 'Button/Primary' },
    componentProperties: { Label: {}, Size: {} },   // INSTANCE-side property
    overrides: [{ id: '1:7' }, { id: '1:8' }, { id: '1:9' }],
  });
  const frame = node({
    id: '1:2', name: 'F', layoutMode: 'VERTICAL', itemSpacing: 16,
    layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG',
    children: [text, inst],
  });
  const page = node({ id: '1:1', name: 'P', type: 'PAGE', children: [frame] });
  const facts = loadScan()(fakeFigma([page]));
  const by = (id) => facts.nodes.find((n) => n.id === id);

  assert.equal(by('1:2').layoutMode, 'VERTICAL');
  assert.equal(by('1:2').layoutSizingVertical, 'HUG');
  assert.equal(by('1:6').textAutoResize, 'NONE');
  assert.equal(by('1:6').fontFamily, 'Inter');
  assert.equal(by('1:6').charCount, 5);
  assert.equal(by('1:7').isInstance, true);
  assert.equal(by('1:7').mainComponentName, 'Button/Primary');
  assert.equal(by('1:7').overrideCount, 3);
  assert.equal(by('1:7').componentPropertyCount, 2);
  assert.deepEqual(facts.file.fonts, [{ family: 'Inter', style: 'Bold' }]);
});

test('componentPropertyCount reads componentPropertyDefinitions on COMPONENT nodes', () => {
  // COMPONENT and COMPONENT_SET expose componentPropertyDefinitions, NOT
  // componentProperties. Reading the wrong one reports 0 on every component.
  const withDefs = node({
    id: '1:8', name: 'Button/Primary', type: 'COMPONENT',
    componentPropertyDefinitions: { Label: {}, State: {} },
  });
  const without = node({ id: '1:9', name: 'Card', type: 'COMPONENT' });
  const frame = node({ id: '1:2', name: 'F', children: [withDefs, without] });
  const page = node({ id: '1:1', name: 'P', type: 'PAGE', children: [frame] });
  const facts = loadScan()(fakeFigma([page]));
  const by = (id) => facts.nodes.find((n) => n.id === id);

  assert.equal(by('1:8').componentPropertyCount, 2);
  assert.equal(by('1:9').componentPropertyCount, 0);
});

test('nameMatchesComponent marks frames sharing a component name, and lists component names', () => {
  // There is no wasInstance property in the Plugin API, so this is the fact
  // the detached-instance rule interprets. Layer 1 records; Layer 2 judges.
  const comp = node({ id: '9:1', name: 'Button/Primary', type: 'COMPONENT' });
  const suspect = node({ id: '1:5', name: 'Button/Primary', type: 'FRAME' });
  const innocent = node({ id: '1:6', name: 'Hero', type: 'FRAME' });
  const live = node({ id: '1:7', name: 'Button/Primary', type: 'INSTANCE',
                      mainComponent: { id: '9:1', name: 'Button/Primary' } });
  const frame = node({ id: '1:2', name: 'F', children: [comp, suspect, innocent, live] });
  const page = node({ id: '1:1', name: 'P', type: 'PAGE', children: [frame] });
  const facts = loadScan()(fakeFigma([page]));
  const by = (id) => facts.nodes.find((n) => n.id === id);

  assert.deepEqual(facts.file.componentNames, ['Button/Primary']);
  assert.equal(by('1:5').nameMatchesComponent, true, 'frame sharing a component name');
  assert.equal(by('1:6').nameMatchesComponent, false);
  assert.equal(by('1:7').nameMatchesComponent, false, 'a live instance is not a suspect');
  assert.equal(by('9:1').nameMatchesComponent, false, 'the component itself is not a suspect');
});

test('collectFacts normalises solid fills to hex and records variable binding', () => {
  const box = node({
    id: '1:3', name: 'Box',
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1,
              boundVariables: { color: { id: 'V:1' } } }],
  });
  const frame = node({ id: '1:2', name: 'F', children: [box] });
  const page = node({ id: '1:1', name: 'P', type: 'PAGE', children: [frame] });
  const facts = loadScan()(fakeFigma([page]));
  const fill = facts.nodes.find((n) => n.id === '1:3').fills[0];

  assert.equal(fill.hex, '#ff0000');
  assert.equal(fill.boundVariable, true);
});

test('collectFacts skips invisible subtrees but records the hidden node itself', () => {
  const child = node({ id: '1:4', name: 'inner' });
  const hidden = node({ id: '1:3', name: 'Old version', visible: false, children: [child] });
  const frame = node({ id: '1:2', name: 'F', children: [hidden] });
  const page = node({ id: '1:1', name: 'P', type: 'PAGE', children: [frame] });
  const facts = loadScan()(fakeFigma([page]));

  assert.ok(facts.nodes.find((n) => n.id === '1:3'), 'hidden node itself is recorded');
  assert.equal(facts.nodes.find((n) => n.id === '1:4'), undefined, 'hidden subtree is not walked');
});

// --- Reduction. The scan returns only nodes a rule could fire on, because
// returning all of them is what broke on the first real file: 84,704 nodes
// serialise to roughly 75 MB, use_figma never came back, and the audit
// silently continued on model judgment with a clean-looking report. ---

import { evaluate } from '../tools/figma-dev-audit.mjs';

function loadScanWith(optsLiteral) {
  const src = readFileSync(SCAN, 'utf8');
  return new Function('figma', `${src}\nreturn collectFacts(figma.root, ${optsLiteral});`);
}

// A tree that trips most of the rule set, with the trigger nodes buried deep
// enough that reduction has real work to do.
function richTree(noiseCount) {
  const noise = [];
  for (let i = 0; i < noiseCount; i += 1) {
    noise.push(node({ id: `9:${i}`, name: 'Vector', type: 'VECTOR', width: 8, height: 8 }));
  }
  const deep = node({
    id: '1:90', name: 'Wrapper', type: 'FRAME', width: 400, height: 400,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
    children: [
      node({ id: '1:91', name: 'Body copy', type: 'TEXT', textAutoResize: 'NONE',
        characters: 'A sentence long enough to wrap when the copy changes.',
        fontName: { family: 'Inter', style: 'Regular' }, fontSize: 16,
        fills: [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 }, opacity: 1 }] }),
      node({ id: '1:92', name: 'icon-close', width: 20, height: 20 }),
      node({ id: '1:93', name: 'Frame 12', width: 10, height: 10 }),
      node({ id: '1:94', name: 'blurred', effects: [{ type: 'BACKGROUND_BLUR', radius: 8 }] }),
      node({ id: '1:95', name: 'masked', type: 'VECTOR', isMask: true }),
      node({ id: '1:96', name: 'photo', width: 20.5, height: 30,
        fills: [{ type: 'IMAGE' }] }),
      node({ id: '1:97', name: 'logo', type: 'VECTOR',
        exportSettings: [{ format: 'PNG' }] }),
      node({ id: '1:98', name: 'Spacer', type: 'RECTANGLE' }),
      node({ id: '1:99', name: 'grouped', children: [
        node({ id: '1:99a' }), node({ id: '1:99b' }), node({ id: '1:99c' }),
      ] }),
      ...noise,
    ],
  });
  const section = node({ id: '1:80', name: 'Section', width: 1440, height: 900, children: [deep] });
  const desktop = node({ id: '1:2', name: 'Home / Desktop', width: 1440, height: 3000, children: [section] });
  const mobile = node({ id: '1:3', name: 'Home / Mobile', width: 390, height: 2400 });
  return [node({ id: '1:1', name: 'Page 1', type: 'PAGE', children: [desktop, mobile] })];
}

const fingerprint = (out) => out.findings
  .map((f) => `${f.rule}|${f.nodeIds.join(',')}`).sort();

test('reduction changes what is returned, never what is found', () => {
  // The keep predicate in scan.js mirrors the rule predicates in rules/*.
  // Nothing but this test keeps the two in step: drift a threshold on either
  // side and the reduced run stops producing a finding the full run does.
  const pages = richTree(300);
  const full = loadScanWith('{ reduce: false }')(fakeFigma(pages));
  const reduced = loadScanWith('{}')(fakeFigma(pages));

  assert.ok(reduced.nodes.length < full.nodes.length / 3,
    `reduction should drop most nodes (kept ${reduced.nodes.length} of ${full.nodes.length})`);
  assert.equal(reduced.totals.nodes, full.totals.nodes, 'both walked the same file');

  const opts = { platform: 'web', url: 'https://figma.com/design/K/T' };
  assert.deepEqual(fingerprint(evaluate(reduced, opts)), fingerprint(evaluate(full, opts)));
});

test('the returned payload stays small enough to cross the use_figma boundary', () => {
  // The regression this whole mechanism exists for. 100k nodes is the scale
  // of a real illustrated landing page; unreduced it serialises to tens of MB.
  const facts = loadScanWith('{}')(fakeFigma(richTree(100000)));
  const bytes = JSON.stringify(facts).length;

  assert.ok(facts.totals.nodes > 100000, `walked the whole file (${facts.totals.nodes})`);
  assert.ok(bytes < 4 * 1024 * 1024, `payload is ${(bytes / 1048576).toFixed(1)} MB, budget is 4 MB`);
  assert.ok(facts.totals.kept < 2000, `kept ${facts.totals.kept} nodes`);
});

test('a rule that matched more nodes than were returned says so', () => {
  // 300 identical fractional vectors, sampled at 100. Silently reporting 100
  // would understate the file by two thirds, and the roll-up count a reader
  // sees is the sample.
  const many = [];
  for (let i = 0; i < 300; i += 1) {
    many.push(node({ id: `8:${i}`, name: 'Vector', type: 'VECTOR', x: 0.5, width: 8, height: 8 }));
  }
  const inner = node({ id: '1:70', name: 'Art', width: 400, height: 400, children: many });
  const frame = node({ id: '1:2', name: 'F', width: 1440, height: 900, children: [inner] });
  const facts = loadScanWith('{}')(fakeFigma([
    node({ id: '1:1', name: 'P', type: 'PAGE', children: [frame] })]));

  assert.equal(facts.limits.sampled.HY002.matched, 300);
  assert.equal(facts.limits.sampled.HY002.kept, 100);
  assert.equal(facts.limits.truncated, false);

  const meta = evaluate(facts, { platform: 'web', url: 'https://figma.com/design/K/T' }).meta;
  assert.equal(meta.sampling.HY002.matched, 300, 'the engine carries it into the report');
  assert.equal(meta.nodeCount, facts.totals.nodes, 'nodeCount is the file, not the sample');
});

test('a walk that hits its node budget reports truncation instead of a short file', () => {
  const many = [];
  for (let i = 0; i < 500; i += 1) many.push(node({ id: `7:${i}`, name: 'Vector', type: 'VECTOR' }));
  const frame = node({ id: '1:2', name: 'F', width: 1440, height: 900, children: many });
  const facts = loadScanWith('{ maxNodes: 50 }')(fakeFigma([
    node({ id: '1:1', name: 'P', type: 'PAGE', children: [frame] })]));

  assert.equal(facts.limits.truncated, true);
  assert.equal(facts.totals.nodes, 50);
  assert.equal(evaluate(facts, { platform: 'web', url: 'https://figma.com/design/K/T' }).meta.truncated, true);
});
