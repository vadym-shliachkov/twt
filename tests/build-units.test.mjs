// The build turns declared membership into installable plugins.
//
// Every gate here exists because the failure it catches produces a plugin that
// INSTALLS CLEANLY and then breaks at runtime, which is the worst possible time
// to find out. A missing script, a family shipped without its define, a hard
// dependency on a skill the user did not install - none of those are visible
// until someone runs the thing.
//
// All of it runs against a disposable copy of tests/fixtures/units, never the
// live repo, so a test can freely break the tree it is given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildUnits } from '../tools/build-units.mjs';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'units');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'twt-build-'));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}

function edit(root, rel, fn) {
  const p = join(root, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

// ---- happy path -------------------------------------------------------------

test('builds a unit with its members, closure, hooks and manifests', () => {
  const root = sandbox();
  const res = buildUnits(root);
  assert.deepEqual(res.errors, []);
  const u = join(root, 'plugins', 'twt-alpha');
  assert.ok(existsSync(join(u, 'skills/twt-alpha/SKILL.md')), 'member skill');
  assert.ok(existsSync(join(u, 'skills/twt-alpha-define/SKILL.md')), 'second member');
  assert.ok(!existsSync(join(u, 'skills/twt-beta/SKILL.md')), 'a non-member must not appear');
  assert.ok(existsSync(join(u, 'tools/shared.mjs')), 'declared ref');
  assert.ok(existsSync(join(u, 'tools/lib/helper.mjs')), 'transitive import');
  assert.ok(existsSync(join(u, 'templates/themes/css/doc.css')), 'computed data path, expanded');
  assert.ok(existsSync(join(u, 'hooks/hooks.json')), 'hooks travel whole');
  assert.ok(existsSync(join(u, '.twt-generated')), 'generated marker');
  assert.ok(existsSync(join(u, '.claude-plugin/plugin.json')), 'manifest');
  assert.ok(existsSync(join(u, 'VENDORED.md')), 'do-not-edit note');
});

test('the generated plugin.json takes metadata from the registry and identity from the root manifest', () => {
  const root = sandbox();
  buildUnits(root);
  const m = JSON.parse(readFileSync(join(root, 'plugins/twt-alpha/.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(m.name, 'twt-alpha');
  assert.equal(m.version, '1.0.0');
  assert.match(m.description, /alpha unit/);
  assert.deepEqual(m.keywords, ['alpha']);
  assert.equal(m.license, 'MIT');
  assert.equal(m.author.email, 'fixture@example.com');
});

test('marketplace.json lists the bundle and every READY unit, and no others', () => {
  const root = sandbox();
  buildUnits(root);
  const mp = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.deepEqual(mp.plugins.map((p) => p.name), ['twt', 'twt-alpha']);
  assert.equal(mp.plugins[0].source, './');
  assert.equal(mp.plugins[1].source, './plugins/twt-alpha');
  assert.equal(mp.metadata.version, '1.0.0');
});

test('a non-ready unit is built on disk but stays out of marketplace.json', () => {
  // Building it is what keeps its closure honest while its skills are still
  // being taught to run alone; listing it would promise something unfinished.
  const root = sandbox();
  buildUnits(root);
  assert.ok(existsSync(join(root, 'plugins/twt-beta/skills/twt-beta/SKILL.md')), 'built');
  const mp = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.ok(!mp.plugins.some((p) => p.name === 'twt-beta'), 'not listed');
});

// ---- the skill-local walk ---------------------------------------------------

test('a SKILL-LOCAL tool is walked, so the shared lib it imports IS vendored', () => {
  // The bug a naive build ships. Skill directories are copied whole, so it is
  // tempting to skip them when walking - and then twt-launch-audit's own
  // launch-scan.mjs, which imports tools/lib/sources.mjs, never reveals that
  // dependency, and the plugin installs and dies on its first run.
  const root = sandbox();
  const res = buildUnits(root);
  assert.deepEqual(res.errors, []);
  const u = join(root, 'plugins', 'twt-beta');
  assert.ok(existsSync(join(u, 'skills/twt-beta/tools/local.mjs')), 'the skill-local tool travels with its directory');
  // only-local.mjs is reachable from NOTHING but that skill-local tool. Assert
  // on it rather than on helper.mjs, which the unit also reaches through
  // tools/shared.mjs - that second path made an earlier version of this test
  // pass even with the skill-local walk disabled.
  assert.ok(existsSync(join(u, 'tools/lib/only-local.mjs')),
    'a dependency reachable ONLY through a skill-local file must still be vendored');
});

test('a skill-local file is copied but never listed as vendored', () => {
  const root = sandbox();
  buildUnits(root);
  const man = JSON.parse(readFileSync(join(root, 'plugins/twt-beta/.vendored.json'), 'utf8'));
  assert.ok(man.vendored.includes('tools/lib/only-local.mjs'), 'the skill-local dependency is vendored');
  assert.ok(!man.vendored.some((f) => f.startsWith('skills/')),
    'skill directories are copied whole; listing their files too would double-count');
});

test('.vendored.json records a hash per vendored file', () => {
  const root = sandbox();
  buildUnits(root);
  const man = JSON.parse(readFileSync(join(root, 'plugins/twt-alpha/.vendored.json'), 'utf8'));
  assert.ok(man.vendored.includes('tools/shared.mjs'));
  assert.match(man.hashes['tools/shared.mjs'], /^[0-9a-f]{64}$/);
});

// ---- determinism and drift --------------------------------------------------

test('building twice produces identical bytes', () => {
  const root = sandbox();
  buildUnits(root);
  const first = readFileSync(join(root, 'plugins/twt-alpha/.vendored.json'), 'utf8');
  const mp1 = readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8');
  buildUnits(root);
  assert.equal(readFileSync(join(root, 'plugins/twt-alpha/.vendored.json'), 'utf8'), first);
  assert.equal(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'), mp1);
});

test('--check passes on a fresh build and fails after a one-byte edit', () => {
  const root = sandbox();
  buildUnits(root);
  assert.deepEqual(buildUnits(root, { check: true }).drift, []);
  writeFileSync(join(root, 'plugins/twt-alpha/tools/shared.mjs'), 'tampered\n');
  const after = buildUnits(root, { check: true });
  assert.ok(after.drift.length > 0, 'a hand edit to generated output must be caught');
  assert.ok(after.drift.some((d) => d.includes('shared.mjs')));
});

test('--check does not write', () => {
  const root = sandbox();
  buildUnits(root);
  writeFileSync(join(root, 'plugins/twt-alpha/tools/shared.mjs'), 'tampered\n');
  buildUnits(root, { check: true });
  assert.equal(readFileSync(join(root, 'plugins/twt-alpha/tools/shared.mjs'), 'utf8'), 'tampered\n');
});

test('--check catches a stale file the build no longer emits', () => {
  const root = sandbox();
  buildUnits(root);
  writeFileSync(join(root, 'plugins/twt-alpha/tools/orphan.mjs'), 'x');
  const res = buildUnits(root, { check: true });
  assert.ok(res.drift.some((d) => d.includes('orphan.mjs')), `got ${JSON.stringify(res.drift)}`);
});

test('a stale directory under plugins/ that is not a unit is removed', () => {
  const root = sandbox();
  mkdirSync(join(root, 'plugins/twt-ghost'), { recursive: true });
  writeFileSync(join(root, 'plugins/twt-ghost/leftover.txt'), 'x');
  buildUnits(root);
  assert.ok(!existsSync(join(root, 'plugins/twt-ghost')),
    'the generated tree is a pure function of the authored tree and the registry');
});

test('a file left inside a unit that the build no longer emits is removed', () => {
  const root = sandbox();
  buildUnits(root);
  writeFileSync(join(root, 'plugins/twt-alpha/tools/orphan.mjs'), 'x');
  buildUnits(root);
  assert.ok(!existsSync(join(root, 'plugins/twt-alpha/tools/orphan.mjs')));
});

// ---- gates ------------------------------------------------------------------

test('G1: a family split across two units is refused, naming family and units', () => {
  const root = sandbox();
  edit(root, 'skills/twt-alpha-define/SKILL.md', (t) => t.replace('unit: twt-alpha', 'unit: twt-beta'));
  const res = buildUnits(root);
  assert.ok(res.errors.length > 0);
  const msg = res.errors.join('\n');
  assert.match(msg, /alpha/);
  assert.match(msg, /twt-beta/);
  assert.equal(res.written.length, 0, 'nothing is written when a gate fails');
});

test('G1b: an orchestrator whose define declares a different family is refused', () => {
  const root = sandbox();
  edit(root, 'skills/twt-alpha-define/SKILL.md', (t) => t.replace('family: alpha', 'family: gamma'));
  const res = buildUnits(root);
  assert.match(res.errors.join('\n'), /twt-alpha-define/);
});

test('G2: a hard dependency across units is refused', () => {
  const root = sandbox();
  edit(root, 'skills/twt-alpha/SKILL.md', (t) => t.replace('  hard: []', '  hard:\n    - twt-beta'));
  const res = buildUnits(root);
  const msg = res.errors.join('\n');
  assert.match(msg, /hard/i);
  assert.match(msg, /twt-beta/);
});

test('G2 allows a hard dependency INSIDE a unit', () => {
  const root = sandbox();
  edit(root, 'skills/twt-alpha/SKILL.md', (t) => t.replace('  hard: []', '  hard:\n    - twt-alpha-define'));
  assert.deepEqual(buildUnits(root).errors, []);
});

test('G3: a unit with no command and no model trigger is refused', () => {
  const root = sandbox();
  edit(root, 'skills/twt-beta/SKILL.md', (t) => t.replace('surface: command', 'surface: internal'));
  const res = buildUnits(root);
  assert.match(res.errors.join('\n'), /twt-beta/);
  assert.match(res.errors.join('\n'), /entry point/i);
});

test('G3: a trigger: model skill satisfies the entry-point gate', () => {
  const root = sandbox();
  edit(root, 'skills/twt-beta/SKILL.md', (t) =>
    t.replace('surface: command', 'surface: internal\ntrigger: model'));
  assert.deepEqual(buildUnits(root).errors, []);
});

test('G4: a skill reaching into another skill directory is refused', () => {
  const root = sandbox();
  edit(root, 'skills/twt-alpha/SKILL.md', (t) =>
    t + '\nAlso runs `node "${CLAUDE_PLUGIN_ROOT}/skills/twt-beta/tools/local.mjs"`.\n');
  const res = buildUnits(root);
  const msg = res.errors.join('\n');
  assert.match(msg, /twt-alpha/);
  assert.match(msg, /twt-beta/);
});

test('G4 allows a skill referencing its OWN directory', () => {
  // twt-beta already does exactly this in the fixture.
  const root = sandbox();
  assert.deepEqual(buildUnits(root).errors, []);
  assert.ok(existsSync(join(root, 'plugins/twt-beta/skills/twt-beta/tools/local.mjs')));
});

test('G5: a reference that resolves nowhere is refused, naming skill and path', () => {
  const root = sandbox();
  edit(root, 'skills/twt-alpha/SKILL.md', (t) => t.replace('tools/shared.mjs', 'tools/does-not-exist.mjs'));
  const res = buildUnits(root);
  const msg = res.errors.join('\n');
  assert.match(msg, /twt-alpha/);
  assert.match(msg, /does-not-exist\.mjs/);
});

test('G6: a unit: value absent from the registry is refused', () => {
  const root = sandbox();
  edit(root, 'skills/twt-beta/SKILL.md', (t) => t.replace('unit: twt-beta', 'unit: twt-nope'));
  assert.match(buildUnits(root).errors.join('\n'), /twt-nope/);
});

test('a failing gate writes nothing at all, not even a partial unit', () => {
  const root = sandbox();
  edit(root, 'skills/twt-alpha-define/SKILL.md', (t) => t.replace('unit: twt-alpha', 'unit: twt-beta'));
  buildUnits(root);
  assert.ok(!existsSync(join(root, 'plugins')), 'no plugins directory is created on failure');
});

// ---- line endings -----------------------------------------------------------

test('--check tolerates CRLF in a SYNTHESIZED file, but still catches a real edit', () => {
  // The fresh-clone failure. Copied files are fine: git converts source and
  // vendored copy identically, so they still match each other. But plugin.json,
  // .vendored.json, VENDORED.md and marketplace.json are BUILT from an in-memory
  // string with LF, and git hands them back as CRLF on checkout - so every unit
  // reported three drifted files on a clean clone and CI failed on 50 of them.
  const root = sandbox();
  buildUnits(root);
  const note = join(root, 'plugins/twt-alpha/VENDORED.md');
  const manifest = join(root, 'plugins/twt-alpha/.claude-plugin/plugin.json');
  const mkt = join(root, '.claude-plugin/marketplace.json');
  for (const f of [note, manifest, mkt]) {
    writeFileSync(f, readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
  }
  assert.deepEqual(buildUnits(root, { check: true }).drift, [],
    'a checkout line-ending difference is not drift');

  // The tolerance must not swallow a genuine change.
  writeFileSync(note, readFileSync(note, 'utf8').replace('Generated', 'Handwritten'));
  const after = buildUnits(root, { check: true });
  assert.ok(after.drift.some((d) => d.includes('VENDORED.md')), `got ${JSON.stringify(after.drift)}`);
});

test('--check still catches a CRLF-only edit to a COPIED file', () => {
  // Copied files are compared byte-for-byte on purpose: source and copy get the
  // same treatment from git, so a line-ending difference between them is real
  // drift, not a checkout artifact.
  const root = sandbox();
  buildUnits(root);
  const copied = join(root, 'plugins/twt-alpha/tools/shared.mjs');
  writeFileSync(copied, readFileSync(copied, 'utf8').replace(/\n/g, '\r\n'));
  const res = buildUnits(root, { check: true });
  assert.ok(res.drift.some((d) => d.includes('shared.mjs')), `got ${JSON.stringify(res.drift)}`);
});
