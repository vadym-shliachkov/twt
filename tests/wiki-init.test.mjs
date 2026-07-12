import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (e.g. this repo lives under "C:\Work\~marketplace", and
// Node percent-encodes "~" to "%7E" in import.meta.url) are decoded correctly.
const TOOL = fileURLToPath(new URL('../tools/wiki-init.mjs', import.meta.url));

const run = (dir, args = []) =>
  execFileSync(process.execPath, [TOOL, dir, ...args], { encoding: 'utf8' });

const newProject = () => mkdtempSync(join(tmpdir(), 'twt-wiki-init-'));
const wiki = (dir, ...p) => join(dir, '.project-wiki', ...p);

const REQUIRED = [
  'AGENTS.md', 'index.md', 'overview.md', 'log.md', 'inbox.md',
  'facts.md', 'open-questions.md', 'glossary.md', 'sources.md',
  'decisions/.gitkeep', 'ideas/.gitkeep', 'entities/.gitkeep',
  'analyses/.gitkeep', 'raw/assets/.gitkeep', 'raw/assets.md',
  'raw/meetings/.gitkeep',
];

test('creates every required file and folder', () => {
  const dir = newProject();
  run(dir);
  for (const f of REQUIRED) {
    assert.equal(existsSync(wiki(dir, f)), true, `missing ${f}`);
  }
});

test('AGENTS.md is copied with real content, not a placeholder', () => {
  const dir = newProject();
  run(dir);
  const agents = readFileSync(wiki(dir, 'AGENTS.md'), 'utf8');
  assert.match(agents, /inbox\.md/, 'AGENTS.md documents the inbox');
  assert.equal(agents.includes('TODO'), false, 'AGENTS.md has no placeholders');
});

test('stamps the project name into overview.md', () => {
  const dir = newProject();
  run(dir, ['--name', 'Acme Rebrand']);
  assert.match(readFileSync(wiki(dir, 'overview.md'), 'utf8'), /Acme Rebrand/);
});

test('is idempotent and never overwrites an existing file', () => {
  const dir = newProject();
  run(dir);
  writeFileSync(wiki(dir, 'overview.md'), 'HAND-EDITED, DO NOT CLOBBER');
  writeFileSync(wiki(dir, 'AGENTS.md'), 'HAND-EDITED');
  const out = run(dir);
  assert.equal(readFileSync(wiki(dir, 'overview.md'), 'utf8'), 'HAND-EDITED, DO NOT CLOBBER');
  assert.match(out, /exists: .*overview\.md/);
  // AGENTS.md is copied via a separate copyFileSync code path that does not
  // share the put() guard - assert it independently so that path is proven safe.
  // A hand-written manual has no version stamp (counts as v1), so a plain
  // re-run reports it outdated - but still never overwrites it.
  assert.equal(readFileSync(wiki(dir, 'AGENTS.md'), 'utf8'), 'HAND-EDITED');
  assert.match(out, /outdated: .*AGENTS\.md/);
});

test('--upgrade-manual re-stamps an outdated AGENTS.md and touches nothing else', () => {
  const dir = newProject();
  run(dir);
  writeFileSync(wiki(dir, 'AGENTS.md'), 'HAND-EDITED OLD MANUAL');
  writeFileSync(wiki(dir, 'overview.md'), 'HAND-EDITED, DO NOT CLOBBER');
  const out = run(dir, ['--upgrade-manual']);
  assert.match(out, /upgraded: .*AGENTS\.md \(manual v1 -> v\d+\)/);
  assert.match(readFileSync(wiki(dir, 'AGENTS.md'), 'utf8'), /manual-version:/, 'manual re-stamped from the template');
  assert.equal(readFileSync(wiki(dir, 'overview.md'), 'utf8'), 'HAND-EDITED, DO NOT CLOBBER', 'only the manual is touched');
  // Re-running with the flag when already current is a no-op.
  assert.match(run(dir, ['--upgrade-manual']), /exists: .*AGENTS\.md/);
});

test('normalizes nested-folder log output to forward slashes', () => {
  const dir = newProject();
  const out = run(dir);
  assert.match(out, /created: \.project-wiki\/decisions\/\.gitkeep/);
});

test('starter pages carry the required frontmatter fields', () => {
  const dir = newProject();
  run(dir);
  const idx = readFileSync(wiki(dir, 'index.md'), 'utf8');
  for (const key of ['title:', 'type:', 'status:', 'updated:']) {
    assert.match(idx, new RegExp(`^${key}`, 'm'), `index.md frontmatter missing ${key}`);
  }
});
