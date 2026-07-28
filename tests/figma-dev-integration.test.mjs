// Integration test for /twt-figma-dev-audit: Layer 1 joined to Layer 2.
//
// WHY THIS FILE EXISTS. figma-dev-scan.test.mjs tests collectFacts() against a
// fake Figma tree; figma-dev-audit.test.mjs tests the rules against a
// hand-written facts fixture. Nothing tested the JOIN - so every time the
// fixture and the emitter disagreed about a field's shape, both suites stayed
// green while the rule silently never fired on a real file. That has happened
// four times in this feature's history (AL002's layoutMode 'NONE',
// facts.frames collecting non-frames, and two caught earlier).
//
// Therefore: build a fake Figma tree, run the REAL collectFacts() over it, and
// feed its output DIRECTLY into evaluate(). No hand-written facts fixture is
// allowed in this file - that is the entire point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../tools/figma-dev-audit.mjs';

// fileURLToPath, not a manual .pathname regex: this repo lives under
// "C:\Work\~marketplace" and Node percent-encodes "~" in import.meta.url.
const SCAN = fileURLToPath(new URL('../tools/figma-dev-audit/scan.js', import.meta.url));

// Loaded exactly as the Figma sandbox loads it: as a function body, no ESM.
function loadScan() {
  const src = readFileSync(SCAN, 'utf8');
  return new Function('figma', 'opts', `${src}\nreturn collectFacts(figma.root, opts);`);
}

const node = (o) => ({
  id: '0:0', name: 'n', type: 'FRAME', visible: true, opacity: 1,
  x: 0, y: 0, width: 100, height: 100, children: [],
  fills: [], strokes: [], effects: [], exportSettings: [],
  blendMode: 'PASS_THROUGH', ...o,
});

const fakeFigma = (pages) => ({
  root: { name: 'Test File', type: 'DOCUMENT', children: pages },
  loadAllPagesAsync: async () => {},
});

const scan = (pages, opts) => loadScan()(fakeFigma(pages), opts);
const byRule = (out, rule) => out.findings.filter((f) => f.rule === rule);

test('INTEGRATION AL002: a real scan of a frame with Auto Layout off fires AL002', () => {
  // The Figma Plugin API returns the STRING 'NONE' for a frame with Auto
  // Layout off - never null, never undefined. A rule testing !n.layoutMode
  // therefore never matched a frame; it only ever matched GROUPs. The old
  // unit fixture hand-wrote `layoutMode: null`, a value collectFacts() has
  // never emitted for a frame, so the unit test passed on a value that does
  // not exist. This test builds the node the way Figma does.
  const kids = ['1:10', '1:11', '1:12'].map((id, i) => node({
    id, name: `Card ${i}`, x: i * 20, y: 0, width: 20, height: 20, layoutMode: 'NONE',
  }));
  const row = node({ id: '1:9', name: 'Card row', width: 1440, height: 200, layoutMode: 'NONE', children: kids });
  const desktop = node({ id: '1:2', name: 'Home / Desktop', width: 1440, height: 900, layoutMode: 'NONE', children: [row] });
  const mobile = node({ id: '1:3', name: 'Home / Mobile', width: 390, height: 900, layoutMode: 'NONE' });
  const page = node({ id: '1:1', name: 'Screens', type: 'PAGE', children: [desktop, mobile] });

  const facts = scan([page]);
  assert.equal(facts.nodes.find((n) => n.id === '1:9').layoutMode, null,
    "collectFacts must normalise Figma's 'NONE' to null so the rule sees one shape");

  const out = evaluate(facts, { url: 'https://figma.com/design/K/T' });
  const hits = byRule(out, 'AL002');
  assert.deepEqual(hits.map((f) => f.nodeIds[0]), ['1:9'],
    'the 3-child row without Auto Layout fires; the 1-child desktop frame does not');
  assert.equal(hits[0].severity, 'Medium');
});

test('INTEGRATION RS002: component widths on a Components page never fake a breakpoint tier', () => {
  // facts.frames used to collect EVERY top-level page child. A Components
  // page holding a 200px Button and a 360px Card therefore contributed
  // "mobile" and "tablet" tiers, so a desktop-only file looked like it had
  // three tiers and the only Blocker rule in the engine went silent.
  const button = node({ id: '9:1', name: 'Button', type: 'COMPONENT_SET', width: 200, height: 48 });
  const card = node({ id: '9:2', name: 'Card', type: 'COMPONENT', width: 360, height: 200 });
  const components = node({ id: '1:1', name: 'Components', type: 'PAGE', children: [button, card] });

  const home = node({ id: '2:1', name: 'Home', width: 1440, height: 900 });
  const about = node({ id: '2:2', name: 'About', width: 1440, height: 900 });
  const screens = node({ id: '2:0', name: 'Screens', type: 'PAGE', children: [home, about] });

  const facts = scan([components, screens]);
  assert.deepEqual(facts.frames.map((f) => f.id), ['2:1', '2:2'],
    'only FRAME nodes are frames - a component set is not a screen');
  assert.ok(facts.nodes.some((n) => n.id === '9:1'),
    'components are still walked into facts.nodes - only facts.frames changes');

  const out = evaluate(facts, { url: 'https://figma.com/design/K/T' });
  const hits = byRule(out, 'RS002');
  assert.equal(hits.length, 1, 'a desktop-only file is Not ready, whatever widths the component library uses');
  assert.equal(hits[0].severity, 'Blocker');
});

test('INTEGRATION RS003: a desktop-width component set is not a screen missing its mobile layout', () => {
  // The inverse of the same bug: a 1440-wide component set became a "frame"
  // with no mobile counterpart and fired RS003 as a pure false positive.
  const wide = node({ id: '9:1', name: 'Page header', type: 'COMPONENT_SET', width: 1440, height: 96 });
  const components = node({ id: '1:1', name: 'Components', type: 'PAGE', children: [wide] });

  const desktop = node({ id: '2:1', name: 'Home / Desktop', width: 1440, height: 900 });
  const mobile = node({ id: '2:2', name: 'Home / Mobile', width: 390, height: 900 });
  const screens = node({ id: '2:0', name: 'Screens', type: 'PAGE', children: [desktop, mobile] });

  const out = evaluate(scan([components, screens]), { url: 'https://figma.com/design/K/T' });
  assert.deepEqual(byRule(out, 'RS003'), [], 'no screen is missing a mobile layout here');
});

test('INTEGRATION RS002: frames organised inside a SECTION are still frames', () => {
  // Filtering facts.frames to type === 'FRAME' without descending into
  // SECTIONs would leave a section-organised file with ZERO frames, and
  // RS002's `!facts.frames?.length` guard would silence the Blocker again -
  // the same silent miss, arrived at from the other direction.
  const home = node({ id: '2:1', name: 'Home', width: 1440, height: 900 });
  const about = node({ id: '2:2', name: 'About', width: 1440, height: 900 });
  const section = node({ id: '3:0', name: 'Marketing', type: 'SECTION', width: 4000, height: 2000, children: [home, about] });
  const page = node({ id: '1:1', name: 'Screens', type: 'PAGE', children: [section] });

  const facts = scan([page]);
  assert.deepEqual(facts.frames.map((f) => f.id), ['2:1', '2:2'], 'section children are collected as frames');

  const out = evaluate(facts, { url: 'https://figma.com/design/K/T' });
  assert.equal(byRule(out, 'RS002').length, 1, 'a section-organised desktop-only file still reports its Blocker');
});

test('INTEGRATION scope: --scope limits the walk and is recorded in facts', () => {
  const home = node({ id: '2:1', name: 'Home / Desktop', width: 1440, height: 900 });
  const pricing = node({ id: '2:2', name: 'Pricing / Desktop', width: 1440, height: 900 });
  const screens = node({ id: '2:0', name: 'Screens', type: 'PAGE', children: [home, pricing] });
  const archive = node({ id: '4:1', name: 'Old hero', width: 1440, height: 900 });
  const oldPage = node({ id: '4:0', name: 'Archive', type: 'PAGE', children: [archive] });

  const facts = scan([screens, oldPage], { scope: 'pricing' });
  assert.equal(facts.file.scope, 'pricing');
  assert.deepEqual(facts.frames.map((f) => f.name), ['Pricing / Desktop']);
  assert.deepEqual(facts.file.pages, ['Screens'], 'a page contributing nothing is not listed');

  const wholePage = scan([screens, oldPage], { scope: 'archive' });
  assert.deepEqual(wholePage.frames.map((f) => f.name), ['Old hero'],
    'a scope naming a page pulls in every frame on it');

  const unscoped = scan([screens, oldPage]);
  assert.equal(unscoped.file.scope, null);
  assert.equal(unscoped.frames.length, 3);
});

test('INTEGRATION link: a deep link survives a copied browser URL and an instance-descendant id', () => {
  // A URL copied from the browser carries ?node-id=0-1&t=..., and instance
  // descendants carry ids like I423:12;9:8. Both used to produce a link that
  // navigated to the wrong node - the same wrong node for every finding.
  const text = node({
    id: 'I423:12;9:8', name: 'Body', type: 'TEXT', textAutoResize: 'NONE',
    characters: 'x'.repeat(60), fontName: { family: 'Inter', style: 'Regular' },
  });
  const desktop = node({ id: '2:1', name: 'Home / Desktop', width: 1440, height: 900, children: [text] });
  const mobile = node({ id: '2:2', name: 'Home / Mobile', width: 390, height: 900 });
  const page = node({ id: '1:1', name: 'Screens', type: 'PAGE', children: [desktop, mobile] });

  const out = evaluate(scan([page]), { url: 'https://www.figma.com/design/K/T?node-id=0-1&t=abc123-0' });
  const hit = byRule(out, 'AL001')[0];
  assert.equal(hit.link, 'https://www.figma.com/design/K/T?node-id=I423-12;9-8');
});
