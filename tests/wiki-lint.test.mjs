import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, appendFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (e.g. this repo lives under "C:\Work\~marketplace", and
// Node percent-encodes "~" to "%7E" in import.meta.url) are decoded correctly.
const TOOL = fileURLToPath(new URL('../tools/wiki-lint.mjs', import.meta.url));
const WIKI_INIT = fileURLToPath(new URL('../tools/wiki-init.mjs', import.meta.url));
const WIKI_INDEX = fileURLToPath(new URL('../tools/wiki-index.mjs', import.meta.url));

const run = (dir, args = []) =>
  execFileSync(process.execPath, [TOOL, dir, ...args], { encoding: 'utf8' });

const lintJson = (dir, args = []) => JSON.parse(run(dir, ['--json', ...args]));

function newWiki() {
  const dir = mkdtempSync(join(tmpdir(), 'twt-wiki-lint-'));
  execFileSync(process.execPath, [WIKI_INIT, dir, '--name', 'Acme'], { encoding: 'utf8' });
  return dir;
}

function putPage(dir, relPath, fmLines, body = '') {
  const abs = join(dir, '.project-wiki', relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `---\n${fmLines.join('\n')}\n---\n\n${body}\n`, 'utf8');
}

const reindex = (dir) => execFileSync(process.execPath, [WIKI_INDEX, dir], { encoding: 'utf8' });

const DECISION_FM = [
  'title: CTA color', 'type: decision', 'status: current',
  'updated: 2026-07-11', 'summary: contrast forced orange', 'sources: []', 'tags: []',
];

test('a fresh scaffolded wiki lints clean', () => {
  const dir = newWiki();
  const r = lintJson(dir);
  assert.equal(r.blockers, 0, JSON.stringify(r.findings));
  assert.equal(r.warnings, 0, JSON.stringify(r.findings));
});

test('lint is strictly read-only', () => {
  const dir = newWiki();
  const wiki = join(dir, '.project-wiki');
  const before = new Map(readdirSync(wiki).map((f) => {
    const st = statSync(join(wiki, f));
    return [f, st.isFile() ? readFileSync(join(wiki, f), 'utf8') : 'dir'];
  }));
  run(dir);
  const after = readdirSync(wiki);
  assert.deepEqual(after.sort(), [...before.keys()].sort(), 'no file created or removed');
  for (const f of after) {
    if (before.get(f) === 'dir') continue;
    assert.equal(readFileSync(join(wiki, f), 'utf8'), before.get(f), `${f} must be untouched`);
  }
});

test('missing core machinery is a BLOCKER; a missing seeded page is a WARNING', () => {
  const dir = newWiki();
  rmSync(join(dir, '.project-wiki', 'index.md'));
  rmSync(join(dir, '.project-wiki', 'glossary.md'));
  const r = lintJson(dir);
  assert.ok(r.findings.some((f) => f.tier === 'BLOCKER' && f.where === 'index.md'));
  assert.ok(r.findings.some((f) => f.tier === 'WARNING' && f.where === 'glossary.md'));
});

test('an index link to a nonexistent page is a BLOCKER', () => {
  const dir = newWiki();
  appendFileSync(join(dir, '.project-wiki', 'index.md'), '\n- [Ghost](decisions/ghost.md)\n');
  const r = lintJson(dir);
  assert.ok(r.findings.some((f) => f.tier === 'BLOCKER' && /ghost\.md/.test(f.where)));
});

test('a page missing from the index is a WARNING (stale index)', () => {
  const dir = newWiki();
  putPage(dir, 'decisions/2026-07-11-cta.md', DECISION_FM, '# CTA color');
  const r = lintJson(dir);
  assert.ok(r.findings.some((f) => f.tier === 'WARNING' && /not in index\.md/.test(f.problem)));
  // ...and regenerating the index clears it
  reindex(dir);
  const r2 = lintJson(dir);
  assert.equal(r2.findings.some((f) => /not in index\.md/.test(f.problem)), false);
});

test('a dead citation is a WARNING; a URL citation is not checked', () => {
  const dir = newWiki();
  putPage(dir, 'decisions/2026-07-11-cta.md', [
    'title: CTA color', 'type: decision', 'status: current', 'updated: 2026-07-11',
    'summary: s', 'sources:', '  - .twt-artifacts/design/tokens.css', '  - https://example.com/brand', 'tags: []',
  ], '# CTA color');
  reindex(dir);
  const r = lintJson(dir);
  const dead = r.findings.filter((f) => /cites/.test(f.problem));
  assert.equal(dead.length, 1, 'only the local path should be flagged');
  assert.match(dead[0].problem, /tokens\.css/);
});

test('a cited source that changed after the page updated date is a stale WARNING', () => {
  const dir = newWiki();
  mkdirSync(join(dir, '.twt-artifacts', 'design'), { recursive: true });
  writeFileSync(join(dir, '.twt-artifacts', 'design', 'tokens.css'), ':root{}', 'utf8'); // mtime = today
  putPage(dir, 'decisions/2020-01-01-cta.md', [
    'title: CTA color', 'type: decision', 'status: current', 'updated: 2020-01-01',
    'summary: s', 'sources:', '  - .twt-artifacts/design/tokens.css', 'tags: []',
  ], '# CTA color');
  reindex(dir);
  const r = lintJson(dir);
  assert.ok(r.findings.some((f) => f.tier === 'WARNING' && /changed on/.test(f.problem)));
});

test('a superseded page with no living successor is a BLOCKER', () => {
  const dir = newWiki();
  putPage(dir, 'decisions/2026-07-01-old.md',
    ['title: Old', 'type: decision', 'status: superseded', 'updated: 2026-07-01', 'summary: s', 'sources: []', 'tags: []'],
    '# Old\n\n**Superseded by:** _none_');
  reindex(dir);
  const r = lintJson(dir);
  assert.ok(r.findings.some((f) => f.tier === 'BLOCKER' && /superseded/.test(f.problem)));
});

test('a superseded page linking a real successor is clean', () => {
  const dir = newWiki();
  putPage(dir, 'decisions/2026-07-10-new.md', DECISION_FM, '# New');
  putPage(dir, 'decisions/2026-07-01-old.md',
    ['title: Old', 'type: decision', 'status: superseded', 'updated: 2026-07-01', 'summary: s', 'sources: []', 'tags: []'],
    '# Old\n\n**Superseded by:** [New](decisions/2026-07-10-new.md)');
  reindex(dir);
  const r = lintJson(dir);
  assert.equal(r.blockers, 0, JSON.stringify(r.findings));
});

test('an unknown status is a WARNING, but the idea lifecycle vocabulary is legal on ideas', () => {
  const dir = newWiki();
  putPage(dir, 'ideas/dark-mode.md',
    ['title: Dark mode', 'type: idea', 'status: shaped', 'updated: 2026-07-11', 'summary: s', 'sources: []', 'tags: []'],
    '# Dark mode');
  putPage(dir, 'decisions/2026-07-11-cta.md',
    ['title: CTA', 'type: decision', 'status: shaped', 'updated: 2026-07-11', 'summary: s', 'sources: []', 'tags: []'],
    '# CTA');
  reindex(dir);
  const r = lintJson(dir);
  const bad = r.findings.filter((f) => /status `shaped`/.test(f.problem));
  assert.equal(bad.length, 1, 'only the decision page should be flagged');
  assert.match(bad[0].where, /decisions/);
});

test('a needs-review page with an uncaptured why is a WARNING', () => {
  const dir = newWiki();
  putPage(dir, 'decisions/2026-07-11-font.md',
    ['title: Font', 'type: decision', 'status: needs-review', 'updated: 2026-07-11', 'summary: s', 'sources: []', 'tags: []'],
    '# Font\n\n**Why:** _not captured — the choice was recorded, the reason was not._');
  reindex(dir);
  const r = lintJson(dir);
  assert.ok(r.findings.some((f) => f.tier === 'WARNING' && /why was never captured/.test(f.problem)));
});

test('CONFLICT fact rows warn; TBD rows suggest; placeholder rows are ignored', () => {
  const dir = newWiki();
  writeFileSync(join(dir, '.project-wiki', 'facts.md'), [
    '---', 'title: Facts', 'type: concept', 'status: current', 'updated: 2026-07-12', 'sources: []', 'tags: []', '---',
    '', '# Facts', '',
    '| Fact | Canonical value | Status | Sources |',
    '|---|---|---|---|',
    '| _none yet_ | | | |',
    '| firm-tenure | TBD | CONFLICT | 20+@book · 25+@site |',
    '| founding-year | TBD | TBD | |',
    '',
  ].join('\n'), 'utf8');
  const r = lintJson(dir);
  assert.ok(r.findings.some((f) => f.tier === 'WARNING' && /firm-tenure/.test(f.where)));
  assert.ok(r.findings.some((f) => f.tier === 'SUGGESTION' && /founding-year/.test(f.where)));
  assert.equal(r.findings.some((f) => /_none yet_/.test(f.where)), false);
});

test('old undrained inbox entries warn; fresh ones only suggest', () => {
  const dir = newWiki();
  const inbox = join(dir, '.project-wiki', 'inbox.md');
  appendFileSync(inbox, '\n## 2020-01-01T00:00:00Z · decision · AskUserQuestion\n- **question:** Old?\n');
  const r = lintJson(dir);
  assert.ok(r.findings.some((f) => f.tier === 'WARNING' && /pending curation/.test(f.problem)));

  const dir2 = newWiki();
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  appendFileSync(join(dir2, '.project-wiki', 'inbox.md'),
    `\n## ${stamp} · decision · AskUserQuestion\n- **question:** Fresh?\n`);
  const r2 = lintJson(dir2);
  assert.ok(r2.findings.some((f) => f.tier === 'SUGGESTION' && /pending curation/.test(f.problem)));
  assert.equal(r2.findings.some((f) => f.tier === 'WARNING' && /pending curation/.test(f.problem)), false);
});

test('human-readable output ends with a tier count summary', () => {
  const dir = newWiki();
  assert.match(run(dir), /lint: 0 blocker\(s\), 0 warning\(s\), \d+ suggestion\(s\)\./);
});

test('refuses to run without a wiki', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-wiki-lint-'));
  assert.throws(() => run(dir), /no \.project-wiki/);
});
