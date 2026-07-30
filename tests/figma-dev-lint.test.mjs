import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalise, lint } from '../tools/figma-dev-lint.mjs';
import { evaluate } from '../tools/figma-dev-audit.mjs';

const TOOL = fileURLToPath(new URL('../tools/figma-dev-lint.mjs', import.meta.url));
const URL_ = 'https://figma.com/design/K/T';

// A finding as the model writes one: judgment fields only.
const judged = (o = {}) => ({
  title: 'Fixed-height text box', category: 'Auto Layout & sizing',
  severity: 'High', confidence: 'High', nodeIds: ['1:23'],
  detected: 'The box is 40px tall and holds 120 characters', impact: 'i', action: 'a',
  owner: 'Designer', ...o,
});

const envelope = (findings, decisions = [], meta = {}) => ({
  meta: { file: 'T', url: URL_, platform: 'web', method: 'rule-engine', ...meta },
  findings, decisions,
});

const errors = (problems) => problems.filter((p) => p.level === 'error');

// --- normalise: the six fields nobody should be typing -----------------------

test('normalise derives id, link, location, blocking, source and sort order', () => {
  const facts = { nodes: [{ id: '1:23', name: 'Body copy', page: 'Page 1', frame: 'Home' }] };
  const data = envelope([
    judged({ severity: 'Medium', category: 'States', title: 'later' }),
    judged({ severity: 'Blocker', category: 'Forms', title: 'first' }),
  ]);
  const counts = normalise(data, facts);

  assert.deepEqual(data.findings.map((f) => f.title), ['first', 'later'], 'sorted by severity');
  const f = data.findings[0];
  assert.equal(f.id, 'MODEL-1:23');
  assert.equal(f.rule, 'MODEL');
  assert.equal(f.source, 'model');
  assert.equal(f.link, `${URL_}?node-id=1-23`);
  assert.equal(f.blocking, true, 'a Blocker is blocking without being told twice');
  assert.deepEqual(f.location, { page: 'Page 1', frame: 'Home', layers: ['Body copy'] });
  assert.equal(data.findings[1].blocking, false);
  assert.ok(counts.link >= 2 && counts.sorted === 1);
});

test('normalise replaces every colon in an instance node id', () => {
  // "I423:12;9:8" -> "I423-12;9-8". One missed colon and the link silently
  // resolves to nothing.
  const data = envelope([judged({ nodeIds: ['I423:12;9:8'] })]);
  normalise(data);
  assert.equal(data.findings[0].link, `${URL_}?node-id=I423-12;9-8`);
});

test('normalise keeps a link that targets a cited node other than the first', () => {
  // Observed in a real run: the model listed the containing section first and
  // linked to the specific control. That is a better target for a reader than
  // nodeIds[0], and rewriting it would retarget a correct link.
  const data = envelope([judged({ nodeIds: ['198:11048', '64:11402'], link: `${URL_}?node-id=64-11402` })]);
  const counts = normalise(data);
  assert.equal(data.findings[0].link, `${URL_}?node-id=64-11402`);
  assert.equal(counts.link, 0);
});

test('normalise rebuilds a link that points at a node the finding does not cite', () => {
  const data = envelope([judged({ nodeIds: ['1:23'], link: `${URL_}?node-id=9-99` })]);
  normalise(data);
  assert.equal(data.findings[0].link, `${URL_}?node-id=1-23`);
});

test('normalise gives a file-level finding the bare file link, never a dangling node-id', () => {
  const data = envelope([judged({ nodeIds: [], link: '' })]);
  normalise(data);
  assert.equal(data.findings[0].link, URL_);
});

test('normalise never lets two findings share an id', () => {
  const data = envelope([judged({ title: 'a' }), judged({ title: 'b' }), judged({ title: 'c' })]);
  normalise(data);
  const ids = data.findings.map((f) => f.id);
  assert.equal(new Set(ids).size, 3, `ids collide: ${ids.join(', ')}`);
});

test('normalise leaves a hand-written location alone when the node is outside the sample', () => {
  // The scan returns only rule-relevant nodes, so a model finding can cite a
  // node facts.json never carried. Its hand-written location is then the only
  // one there is.
  const data = envelope([judged({ nodeIds: ['7:7'], location: { page: 'P', frame: 'Hero', layers: ['Art'] } })]);
  normalise(data, { nodes: [] });
  assert.deepEqual(data.findings[0].location, { page: 'P', frame: 'Hero', layers: ['Art'] });
});

// --- lint: the checks validateFinding() does not make ------------------------

test('lint rejects the empty impact and action the report would print as "not yet assessed"', () => {
  const data = envelope([judged({ impact: '', action: null })]);
  normalise(data);
  const msgs = errors(lint(data)).map((p) => p.msg).join(' | ');
  assert.match(msgs, /impact is empty/);
  assert.match(msgs, /action is empty/);
});

test('lint rejects a location missing its keys', () => {
  const data = envelope([{ ...judged(), id: 'X', rule: 'MODEL', source: 'model',
    link: `${URL_}?node-id=1-23`, blocking: false, location: { page: 'P' } }]);
  assert.match(errors(lint(data))[0].msg, /page, frame and layers/);
});

test('lint rejects a Blocker whose blocking flag disagrees', () => {
  const data = envelope([judged({ severity: 'Blocker' })]);
  normalise(data);
  data.findings[0].blocking = false;       // the contradiction, reintroduced
  assert.match(errors(lint(data))[0].msg, /Summary would count a Blocker/);
});

test('lint rejects a shot that resolves to no file, and one outside shots/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-lint-'));
  const data = envelope([judged({ shot: 'shots/1-23.png' })]);
  normalise(data);
  assert.match(errors(lint(data, { outDir: dir }))[0].msg, /resolves to no file/);

  mkdirSync(join(dir, 'shots'), { recursive: true });
  writeFileSync(join(dir, 'shots', '1-23.png'), 'x');
  assert.deepEqual(errors(lint(data, { outDir: dir })), []);

  const traversal = envelope([judged({ shot: '../secret.png' })]);
  normalise(traversal);
  assert.match(errors(lint(traversal, { outDir: dir }))[0].msg, /relative path inside shots\//);
});

test('lint checks decisions as strictly as findings', () => {
  const data = envelope([], [{ question: 'q', why: '', owner: 'Nobody' }]);
  const msgs = errors(lint(data)).map((p) => p.msg).join(' | ');
  assert.match(msgs, /why is empty/);
  assert.match(msgs, /bad owner "Nobody"/);
});

test('lint requires meta.url, because every deep link derives from it', () => {
  assert.match(errors(lint(envelope([], [], { url: '' })))[0].msg, /meta\.url is missing/);
});

test('a node missing from a reduced facts.json is a warning, never an error', () => {
  // Reduction means facts.json holds a sample. Erroring here would make every
  // model finding about a vector-heavy frame unfixable.
  const data = envelope([judged({ nodeIds: ['7:7'], location: { page: 'P', frame: 'F', layers: [] } })]);
  normalise(data, { nodes: [] });
  const problems = lint(data, { facts: { nodes: [] } });
  assert.deepEqual(errors(problems), []);
  assert.match(problems.find((p) => p.level === 'warning').msg, /not in facts\.json/);
});

test('lint flags a model finding claiming High confidence with no measured number', () => {
  const data = envelope([judged({ confidence: 'High', detected: 'the states look incomplete' })]);
  normalise(data);
  const problems = lint(data);
  assert.deepEqual(errors(problems), []);
  assert.match(problems.map((p) => p.msg).join(' '), /confidence follows the evidence/);
});

test('lint warns when the run will render as a provisional report', () => {
  // The warning names the consequence, not the flag: what the author needs to
  // know is that this run produces readiness-report-provisional.md under a
  // different title, not that a field is set to a different string.
  const data = envelope([], [], { method: 'model-only' });
  const at = lint(data).find((p) => p.where === 'meta');
  assert.equal(at.level, 'warning');
  assert.match(at.msg, /readiness-report-provisional\.md/);
  assert.match(at.msg, /Provisional developer readiness/);
});

// --- the seam: the engine's own output must satisfy the linter ---------------

test('an engine-produced envelope passes lint once Step 4a has filled impact and action', () => {
  // Two files that must agree about the finding shape, checked rather than
  // assumed - this is the seam the model writes across.
  const facts = {
    file: { name: 'T', fonts: [] },
    frames: [{ id: '1:2', name: 'Home', page: 'P', width: 1440, height: 3000 }],
    nodes: [{ id: '1:23', name: 'Body', type: 'TEXT', page: 'P', frame: 'Home',
      textAutoResize: 'NONE', charCount: 120, fills: [], effects: [], exportSettings: [],
      visible: true, opacity: 1, width: 200, height: 40, childCount: 0, absChildCount: 0 }],
    totals: { nodes: 2, kept: 2, byType: {} },
    limits: { truncated: false, sampled: {} },
  };
  const data = evaluate(facts, { platform: 'web', url: URL_ });
  assert.ok(data.findings.length, 'the fixture fires at least one rule');
  for (const f of data.findings) { f.impact = 'costs the build time'; f.action = 'fix it'; }

  assert.deepEqual(errors(lint(data, { facts })), []);
  const counts = normalise(data, facts);
  assert.deepEqual(counts, { id: 0, link: 0, location: 0, blocking: 0, source: 0, sorted: 0 },
    'normalise has nothing to derive on engine output');
});

// --- CLI ---------------------------------------------------------------------

test('the CLI exits 1 on an error, 0 on warnings alone, and --fix writes the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-lint-'));
  const path = join(dir, 'findings.json');
  writeFileSync(path, JSON.stringify(envelope([judged({ severity: 'Blocker', impact: '' })])), 'utf8');

  const bad = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /impact is empty/);

  writeFileSync(path, JSON.stringify(envelope([judged({ severity: 'Blocker' })])), 'utf8');
  const fixed = spawnSync(process.execPath, [TOOL, dir, '--fix'], { encoding: 'utf8' });
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.match(fixed.stdout, /--fix:/);

  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(written.findings[0].blocking, true, 'the fix is on disk, not just in memory');
  assert.equal(written.findings[0].link, `${URL_}?node-id=1-23`);
});

test('the CLI reports a missing findings.json rather than writing one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-lint-'));
  const r = spawnSync(process.execPath, [TOOL, dir, '--fix'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read/);
});

// --- the three gates a real run walked straight through ----------------------

// The model writes judgment and Step 4c derives the rest, so every gate below
// is checked on a normalised envelope - the same shape lint() sees in a run.
const ready = (findings, decisions = [], meta = {}) => {
  const data = envelope(findings, decisions, meta);
  normalise(data);
  return data;
};
const msgs = (problems) => problems.map((p) => p.msg).join(' | ');

test('lint rejects a meta.scope that is a list or a method note', () => {
  // What a real run wrote, and what both renderers then printed it as:
  // "only pages and frames matching this were scanned". The scan matches ONE
  // case-insensitive substring, so four comma-separated frame names match
  // nothing and the coverage sentence is simply false. The skill says "never
  // put a method note in --scope" twice, in bold; prose did not hold it down.
  const listed = ready([], [], {
    scope: 'D_Landing Page_V5 (198:3), M_Landing Page (159:3), Thankyou Pop Up (64:11356).',
  });
  assert.match(msgs(errors(lint(listed))), /it lists several names/);

  const prose = ready([], [], {
    scope: 'Landing page. File-wide structural counts cover all 23 top-level items.',
  });
  assert.match(msgs(errors(lint(prose))), /it contains prose/);

  // A real scope, and no scope at all, both pass.
  assert.deepEqual(errors(lint(ready([], [], { scope: 'Pricing' }))), []);
  assert.deepEqual(errors(lint(ready([], [], { scope: null }))), []);
});

test('lint rejects High confidence when no facts.json exists to check it against', () => {
  // 24 findings citing "84,704 nodes" and "73,556 vectors" with no facts.json
  // on disk: every number unreproducible, and the only signal was one callout.
  // Confidence follows the evidence, and with no evidence file there is none.
  const high = ready([judged({ confidence: 'High' })], [], { method: 'model-only' });
  assert.match(msgs(errors(lint(high, { facts: null }))), /nothing in this report can be reproduced/);

  // Step 2b's counts-only probe file is the way to keep High legitimately.
  assert.deepEqual(errors(lint(high, { facts: { totals: { nodes: 84704 }, nodes: [] } })), []);

  // Medium needs no evidence file.
  const medium = ready([judged({ confidence: 'Medium' })], [], { method: 'model-only' });
  assert.deepEqual(errors(lint(medium, { facts: null })), []);

  // And a measured run is unaffected.
  assert.deepEqual(errors(lint(ready([judged({ confidence: 'High' })]), { facts: null })), []);
});

test('lint rejects a font-licensing finding wherever it is filed', () => {
  // FN001 returns [] for licensing because it is a commercial fact held
  // outside the file - "the single rule that keeps the report honest". That
  // invariant lived only in a comment inside a rule file the model-only path
  // never executes, so a run produced a High finding claiming two fonts had
  // no licence AND the same question as a decision.
  const asFont = ready([judged({
    category: 'Fonts', title: 'Two typefaces with no web licence or fallback decided',
  })]);
  assert.match(msgs(errors(lint(asFont))), /font-licensing claim/);

  // Re-filing it under another category does not launder it.
  const asHygiene = ready([judged({
    category: 'Handoff hygiene', title: 'Font inventory',
    detected: 'Akzidenz-Grotesk Next requires a paid webfont licence',
  })]);
  assert.match(msgs(errors(lint(asHygiene))), /font-licensing claim/);

  // The load-cost finding the file CAN support is untouched.
  const inventory = ready([judged({
    category: 'Fonts', title: 'Large type inventory',
    detected: 'The file uses 4 font families across 8 family/style pairs.',
  })]);
  assert.deepEqual(errors(lint(inventory)), []);
});

test('lint warns when a finding strays into design-system territory', () => {
  const data = ready([judged({ title: 'Spacing scale is inconsistent across sections' })]);
  assert.deepEqual(errors(lint(data)), [], 'a warning, not an error - the call is the author\'s');
  assert.match(msgs(lint(data)), /twt-design-system-audit/);
});
