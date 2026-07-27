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
