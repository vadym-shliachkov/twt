import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (e.g. this repo lives under "C:\Work\~marketplace", and
// Node percent-encodes "~" to "%7E" in import.meta.url) are decoded correctly.
const TOOL = fileURLToPath(new URL('../tools/seed-permissions.js', import.meta.url));

const run = (dir, args = []) => execFileSync(process.execPath, [TOOL, dir, ...args], { encoding: 'utf8' });

function newProject() {
  const dir = mkdtempSync(join(tmpdir(), 'twt-seed-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  return dir;
}
const readme = (dir) => join(dir, '.twt-artifacts', 'README.md');

test('seeds the permission allowlist and the .twt-artifacts orientation README', () => {
  const dir = newProject();
  const out = run(join(dir, '.claude'));
  assert.match(out, /Seeded \d+ permission entr/);
  const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.ok(settings.permissions.allow.includes('Bash(node:*)'));
  assert.ok(existsSync(readme(dir)), 'README seeded alongside permissions');
  assert.match(readFileSync(readme(dir), 'utf8'), /generated and regenerable/);
});

test('a hand-edited README is never overwritten, even on re-runs', () => {
  const dir = newProject();
  run(join(dir, '.claude'));
  writeFileSync(readme(dir), 'HAND EDIT');
  run(join(dir, '.claude')); // permissions already present -> early-exit path
  assert.equal(readFileSync(readme(dir), 'utf8'), 'HAND EDIT');
});

test('a deleted README reappears on re-run even when permissions are already seeded', () => {
  const dir = newProject();
  run(join(dir, '.claude'));
  rmSync(readme(dir));
  const out = run(join(dir, '.claude'));
  assert.match(out, /already present/);
  assert.ok(existsSync(readme(dir)), 'the no-change early exit must still seed the README');
});

test('--remove takes entries out and never seeds a README', () => {
  const dir = newProject();
  run(join(dir, '.claude'));
  rmSync(readme(dir));
  const out = run(join(dir, '.claude'), ['--remove']);
  assert.match(out, /Removed \d+ permission entr/);
  assert.equal(existsSync(readme(dir)), false);
});

test('a directory not named .claude gets permissions but no README (global-style seeding)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-seed-global-'));
  run(dir); // e.g. ~/.claude passed as a bare dir in other layouts
  assert.equal(existsSync(join(dir, '..', '.twt-artifacts')), false);
});

test('seeding is idempotent for permissions (second run adds nothing)', () => {
  const dir = newProject();
  run(join(dir, '.claude'));
  const first = readFileSync(join(dir, '.claude', 'settings.json'), 'utf8');
  const out = run(join(dir, '.claude'));
  assert.match(out, /already present/);
  assert.equal(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'), first);
});
