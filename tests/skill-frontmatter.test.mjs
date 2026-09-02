// The three fields that decide packaging.
//
// A skill missing one is invisible to the build's gates, which is the failure
// that ships a plugin with half a family in it. These run against the real
// repo rather than a fixture on purpose: the fixture proves the RULES work,
// this proves the repo actually obeys them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skillFiles } from '../tools/lib/plugin-roots.mjs';
import { loadUnits } from '../tools/lib/units.mjs';

const ROLES = new Set(['orchestrator', 'pipeline', 'fetch', 'define', 'validate', 'measure', 'audit', 'tool']);
const field = (t, k) => (t.match(new RegExp(`^${k}:\\s*(\\S+)\\s*$`, 'm')) || [])[1];

const skills = skillFiles(process.cwd()).map((f) => ({
  name: f.expectedName,
  text: readFileSync(f.path, 'utf8'),
}));

test('the repo has the skills we think it has', () => {
  assert.ok(skills.length >= 80, `expected the full set, got ${skills.length}`);
});

test('every skill declares family, role and unit', () => {
  const missing = skills
    .filter((s) => !field(s.text, 'family') || !field(s.text, 'role') || !field(s.text, 'unit'))
    .map((s) => s.name);
  assert.deepEqual(missing, []);
});

test('every role is one of the eight known values', () => {
  const bad = skills.map((s) => [s.name, field(s.text, 'role')]).filter(([, r]) => !ROLES.has(r));
  assert.deepEqual(bad, []);
});

test('every family is a kebab-case token', () => {
  const bad = skills.map((s) => [s.name, field(s.text, 'family')]).filter(([, f]) => !/^[a-z0-9-]+$/.test(f));
  assert.deepEqual(bad, []);
});

test('every unit exists in the registry', () => {
  const known = new Set(Object.keys(loadUnits(process.cwd()).units));
  const bad = skills.map((s) => [s.name, field(s.text, 'unit')]).filter(([, u]) => !known.has(u));
  assert.deepEqual(bad, []);
});

test('every registered unit has at least one member', () => {
  const used = new Set(skills.map((s) => field(s.text, 'unit')));
  const empty = Object.keys(loadUnits(process.cwd()).units).filter((u) => !used.has(u));
  assert.deepEqual(empty, []);
});

test('define and validate skills are internal', () => {
  // Both are dispatch-only by definition. A user-facing define would bypass the
  // orchestrator that is supposed to sequence it against its validator.
  const bad = skills
    .filter((s) => ['define', 'validate'].includes(field(s.text, 'role')))
    .filter((s) => field(s.text, 'surface') !== 'internal')
    .map((s) => s.name);
  assert.deepEqual(bad, []);
});

test('an orchestrator is named twt-<family>', () => {
  const bad = skills
    .filter((s) => field(s.text, 'role') === 'orchestrator')
    .filter((s) => s.name !== `twt-${field(s.text, 'family')}`)
    .map((s) => s.name);
  assert.deepEqual(bad, []);
});

test('every family lands in exactly one unit', () => {
  const byFamily = new Map();
  for (const s of skills) {
    const f = field(s.text, 'family');
    if (!byFamily.has(f)) byFamily.set(f, new Set());
    byFamily.get(f).add(field(s.text, 'unit'));
  }
  const split = [...byFamily].filter(([, u]) => u.size > 1).map(([f, u]) => `${f}: ${[...u].join(', ')}`);
  assert.deepEqual(split, []);
});

test('the packaging fields sit together, right after category', () => {
  // Purely so a human scanning frontmatter finds them as a block. Cheap to
  // keep, and it makes a hand-added field in the wrong place obvious.
  const bad = skills
    .filter((s) => !/^category:.*\r?\nfamily:.*\r?\nrole:.*\r?\nunit:/m.test(s.text))
    .map((s) => s.name);
  assert.deepEqual(bad, []);
});
