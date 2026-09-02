// The docs are how a user finds out that a family can be installed on its own.
// If SKILLS.md never names the unit and README never prints the install line,
// the whole packaging effort is invisible to everyone but the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadUnits } from '../tools/lib/units.mjs';

const reg = loadUnits(process.cwd());
const readme = () => readFileSync('README.md', 'utf8');
const block = () => readme().split('<!-- TWT_SKILLS_TABLE_START -->')[1].split('<!-- TWT_SKILLS_TABLE_END -->')[0];

test('gen-docs --check passes on the committed docs', () => {
  execFileSync('node', ['tools/gen-docs.mjs', '--check'], { stdio: 'pipe' });
});

test('SKILLS.md carries Unit, Family and Role columns', () => {
  const md = readFileSync('SKILLS.md', 'utf8');
  assert.match(md, /\|\s*unit\s*\|/i, 'a unit column header');
  assert.match(md, /\|\s*family\s*\|/i, 'a family column header');
  assert.match(md, /\|\s*role\s*\|/i, 'a role column header');
});

test('SKILLS.md names every registered unit', () => {
  const md = readFileSync('SKILLS.md', 'utf8');
  for (const unit of Object.keys(reg.units)) {
    assert.ok(md.includes(unit), `SKILLS.md must mention ${unit}`);
  }
});

test('SKILLS.md says which units are installable and which are still in progress', () => {
  const md = readFileSync('SKILLS.md', 'utf8');
  assert.match(md, /installable/i);
  assert.match(md, /in progress/i);
});

test('the README block lists the bundle and every READY unit, and no unready one', () => {
  const b = block();
  assert.ok(b.includes(`/plugin install ${reg.bundle.name}@`), 'the bundle install line');
  for (const [name, u] of Object.entries(reg.units)) {
    const line = `/plugin install ${name}@`;
    if (u.ready) assert.ok(b.includes(line), `${name} is ready and must be listed`);
    else assert.ok(!b.includes(line), `${name} is not ready and must not be offered`);
  }
});

test('the README block warns that the bundle and units are mutually exclusive', () => {
  // Installing both registers the same skills twice. Nothing enforces this - a
  // skill may not read outside the project - so the docs are the only warning.
  assert.match(block(), /not.{0,60}both|either.{0,60}or|mutually exclusive/is);
});

test('the README block still lists every user-facing command with its unit', () => {
  const b = block();
  assert.ok(b.includes('/twt-site'), 'a command row survives');
  assert.match(b, /\|\s*unit\s*\|/i, 'and now carries its unit');
});
