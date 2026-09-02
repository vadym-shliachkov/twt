// The registry holds what a skill cannot know about its own plugin: the
// description and keywords its manifest needs, the version the bump hook
// advances, and the `ready` flag that decides whether the unit is listed for
// install at all.
//
// Membership itself is NOT here - it lives in each skill's `unit:` frontmatter,
// so a skill and its packaging cannot drift apart. What this must catch is the
// reverse: a `unit:` value that names nothing, or a registered unit nothing
// names, both of which would otherwise produce an empty plugin nobody notices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadUnits, validateRegistry } from '../tools/lib/units.mjs';

const reg = {
  marketplace: { name: 'twt-marketplace', version: '1.0.0', description: 'd' },
  bundle: { name: 'twt', description: 'everything' },
  units: {
    'twt-export': { version: '1.0.0', ready: true, description: 'e', keywords: ['pdf'] },
    'twt-wiki': { version: '1.0.0', ready: false, description: 'w', keywords: [] },
  },
};

test('a valid registry with every unit populated reports no errors', () => {
  const skills = [
    { name: 'twt-export', unit: 'twt-export' },
    { name: 'twt-wiki', unit: 'twt-wiki' },
  ];
  assert.deepEqual(validateRegistry(reg, skills), []);
});

test('a unit: value absent from the registry is an error naming both', () => {
  const skills = [
    { name: 'twt-export', unit: 'twt-export' },
    { name: 'twt-wiki', unit: 'twt-wki' },   // typo
    { name: 'twt-x', unit: 'twt-wiki' },
  ];
  const errs = validateRegistry(reg, skills);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /twt-wiki/, 'names the skill');
  assert.match(errs[0], /twt-wki/, 'names the bad value');
});

test('a skill with no unit at all is an error', () => {
  const skills = [
    { name: 'twt-export', unit: 'twt-export' },
    { name: 'twt-wiki', unit: 'twt-wiki' },
    { name: 'twt-orphan', unit: undefined },
  ];
  const errs = validateRegistry(reg, skills);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /twt-orphan/);
});

test('a registered unit with no members is an error naming the unit', () => {
  const skills = [{ name: 'twt-export', unit: 'twt-export' }];
  const errs = validateRegistry(reg, skills);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /twt-wiki/);
  assert.match(errs[0], /no members/i);
});

test('a unit named the same as the bundle is an error', () => {
  // Both would claim the same plugin name in marketplace.json.
  const clash = {
    ...reg,
    units: { ...reg.units, twt: { version: '1.0.0', ready: false, description: 'x', keywords: [] } },
  };
  const skills = [
    { name: 'twt-export', unit: 'twt-export' },
    { name: 'twt-wiki', unit: 'twt-wiki' },
    { name: 'twt-a', unit: 'twt' },
  ];
  const errs = validateRegistry(clash, skills);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /bundle/i);
});

test('loadUnits throws with the path when the file is unreadable', () => {
  assert.throws(() => loadUnits('/definitely/not/a/repo'), /units\.json/);
});

test('the real registry loads and every declared unit is well formed', () => {
  const r = loadUnits(process.cwd());
  assert.ok(Object.keys(r.units).length > 0, 'at least one unit');
  assert.match(r.marketplace.version, /^\d+\.\d+\.\d+$/);
  assert.ok(r.bundle.name, 'the bundle is named');
  for (const [name, u] of Object.entries(r.units)) {
    assert.match(name, /^twt-[a-z0-9-]+$/, `unit name ${name}`);
    assert.match(u.version, /^\d+\.\d+\.\d+$/, `${name} version`);
    assert.equal(typeof u.ready, 'boolean', `${name} ready`);
    assert.ok(u.description && u.description.length > 10, `${name} description`);
    assert.ok(Array.isArray(u.keywords), `${name} keywords`);
  }
});

test('the real registry keeps the marketplace version that marketplace.json has today', () => {
  // The bump hook will own this field once marketplace.json is generated. If
  // the two disagree at handover the version silently rolls backwards.
  const mp = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
  const r = loadUnits(process.cwd());
  assert.equal(r.marketplace.version, mp.metadata.version);
});
