import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (e.g. this repo lives under "C:\Work\~marketplace", and
// Node percent-encodes "~" to "%7E" in import.meta.url) are decoded correctly.
const TOOL = fileURLToPath(new URL('../tools/wiki-index.mjs', import.meta.url));
const WIKI_INIT = fileURLToPath(new URL('../tools/wiki-init.mjs', import.meta.url));

const run = (dir) => execFileSync(process.execPath, [TOOL, dir], { encoding: 'utf8' });

function newWiki() {
  const dir = mkdtempSync(join(tmpdir(), 'twt-wiki-index-'));
  execFileSync(process.execPath, [WIKI_INIT, dir, '--name', 'Acme'], { encoding: 'utf8' });
  return dir;
}

function putPage(dir, relPath, fm) {
  const abs = join(dir, '.project-wiki', relPath);
  mkdirSync(dirname(abs), { recursive: true });
  const head = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  writeFileSync(abs, `---\n${head}\n---\n\n# ${fm.title || relPath}\n`, 'utf8');
}

const index = (dir) => readFileSync(join(dir, '.project-wiki', 'index.md'), 'utf8');

test('catalogs a curated page with its title, summary, status, and updated date', () => {
  const dir = newWiki();
  putPage(dir, 'decisions/2026-07-11-cta-color.md', {
    title: 'Primary CTA is orange',
    type: 'decision',
    status: 'current',
    updated: '2026-07-11',
    summary: 'navy failed hero contrast; orange clears AA',
  });
  run(dir);
  const text = index(dir);
  assert.match(text, /- `decisions\/` - what was decided, and why \(1 page\)/);
  assert.match(text, /^\s+- \[Primary CTA is orange\]\(decisions\/2026-07-11-cta-color\.md\) - navy failed hero contrast; orange clears AA \(current, 2026-07-11\)$/m);
});

test('a page without frontmatter falls back to its filename and is never dropped', () => {
  const dir = newWiki();
  writeFileSync(join(dir, '.project-wiki', 'ideas', 'dark-mode.md'), 'no frontmatter here\n', 'utf8');
  run(dir);
  assert.match(index(dir), /- \[dark-mode\]\(ideas\/dark-mode\.md\)/, 'the catalog must list every page, frontmatter or not');
});

test('empty collections read as 0 pages and .gitkeep is never cataloged', () => {
  const dir = newWiki();
  run(dir);
  const text = index(dir);
  assert.match(text, /- `entities\/` - .* \(0 pages\)/);
  assert.equal(/\.gitkeep/.test(text), false);
});

test('core and machinery pages are always present, with core status pulled from frontmatter', () => {
  const dir = newWiki();
  run(dir);
  const text = index(dir);
  // wiki-init seeds overview.md as a draft - the index must reflect that.
  assert.match(text, /- \[Acme\]\(overview\.md\) - the project in one page \(draft, \d{4}-\d{2}-\d{2}\)/);
  assert.match(text, /- \[Inbox\]\(inbox\.md\)/);
  assert.match(text, /- \[Operating manual\]\(AGENTS\.md\)/);
});

test('regeneration is deterministic: two runs produce identical output', () => {
  const dir = newWiki();
  putPage(dir, 'entities/acme-corp.md', {
    title: 'Acme Corp', type: 'entity', status: 'current', updated: '2026-07-12',
  });
  run(dir);
  const first = index(dir);
  run(dir);
  assert.equal(index(dir), first);
});

test('collections are sorted by filename so diffs stay stable', () => {
  const dir = newWiki();
  putPage(dir, 'decisions/2026-07-12-b.md', { title: 'B', status: 'current', updated: '2026-07-12' });
  putPage(dir, 'decisions/2026-07-11-a.md', { title: 'A', status: 'current', updated: '2026-07-11' });
  run(dir);
  const text = index(dir);
  assert.ok(text.indexOf('2026-07-11-a.md') < text.indexOf('2026-07-12-b.md'));
});

test('refuses to run without a wiki', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-wiki-index-'));
  assert.throws(() => run(dir), /no \.project-wiki/);
});
