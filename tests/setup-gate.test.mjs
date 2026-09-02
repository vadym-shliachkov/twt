// The Step 0 gate runs at the start of every pipeline entry point.
//
// It used to offer to dispatch /twt-setup. That is fine in the bundle, where
// the setup skill is present, and a dead dispatch in a unit that does not ship
// it - twt-setup lives in twt-site, so a lone twt-design or twt-qa install
// would hit it on the very first thing it does. The gate now runs the bundled
// seeder directly, which every unit vendors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { skillFiles } from '../tools/lib/plugin-roots.mjs';
import { loadUnits } from '../tools/lib/units.mjs';

const gate = readFileSync('templates/blocks/setup-gate.md', 'utf8');

test('the canonical gate seeds directly and never dispatches /twt-setup', () => {
  assert.match(gate, /seed-permissions\.js/, 'it runs the seeder');
  assert.ok(!/dispatch\s+`?\/twt-setup/i.test(gate),
    'it must not dispatch a skill a standalone unit may not ship');
});

test('the gate still refuses to block a run when the seeder is absent', () => {
  assert.match(gate, /never block/i);
});

test('every gated skill carries the canonical block verbatim', () => {
  // gen-docs stamps this from the one canonical copy; a hand-edited inline copy
  // is exactly the drift the stamping exists to prevent.
  const marker = gate.split('\n')[0].trim();
  const stale = [];
  for (const f of skillFiles(process.cwd())) {
    const text = readFileSync(f.path, 'utf8').replace(/\r\n/g, '\n');
    if (!text.includes(marker)) continue;
    if (!text.includes(gate.replace(/\r\n/g, '\n').trim())) stale.push(f.expectedName);
  }
  assert.deepEqual(stale, [], 'run node tools/gen-docs.mjs to re-stamp');
});

test('every unit that carries a gated skill also ships the seeder', () => {
  // The gate names ${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js, so the
  // build must have vendored it into each unit that needs it. If it had not,
  // the gate would warn and continue on every single run of that unit.
  const marker = gate.split('\n')[0].trim();
  const gatedUnits = new Set();
  for (const f of skillFiles(process.cwd())) {
    const text = readFileSync(f.path, 'utf8');
    if (!text.includes(marker)) continue;
    const unit = (text.match(/^unit:\s*(\S+)\s*$/m) || [])[1];
    if (unit) gatedUnits.add(unit);
  }
  assert.ok(gatedUnits.size > 0, 'some skills are gated');
  const missing = [...gatedUnits].filter(
    (u) => !existsSync(join('plugins', u, 'tools', 'seed-permissions.js')),
  );
  assert.deepEqual(missing, []);
});

test('twt-setup still exists as a command for the people who want it', () => {
  // Removing the dispatch is not removing the skill: running /twt-setup by hand
  // stays the documented way to seed a project up front.
  const reg = loadUnits(process.cwd());
  const setup = skillFiles(process.cwd()).find((f) => f.expectedName === 'twt-setup');
  assert.ok(setup, 'twt-setup is still a skill');
  const unit = (readFileSync(setup.path, 'utf8').match(/^unit:\s*(\S+)\s*$/m) || [])[1];
  assert.ok(reg.units[unit], `twt-setup ships in a registered unit (${unit})`);
});
