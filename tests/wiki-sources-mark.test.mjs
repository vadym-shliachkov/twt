import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (this repo lives under "C:\\Work\\~marketplace") decode.
const TOOL = fileURLToPath(new URL('../tools/wiki-sources-mark.mjs', import.meta.url));

const run = (dir, args) =>
  execFileSync(process.execPath, [TOOL, dir, ...args], { encoding: 'utf8' });

const PENDING = '—'; // em-dash

const HEADER5 = '| Source | Kind | Where | Ingested | Synthesized |';
const SEP5 = '|---|---|---|---|---|';
const HEADER4 = '| Source | Kind | Where | Ingested |';
const SEP4 = '|---|---|---|---|';

function newSources(bodyLines, { five = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'twt-wiki-mark-'));
  mkdirSync(join(dir, '.project-wiki'));
  const lines = five ? [HEADER5, SEP5, ...bodyLines] : [HEADER4, SEP4, ...bodyLines];
  const text = `# Sources\n\nRegistry of all evidence.\n\n${lines.join('\n')}\n\ntrailing prose\n`;
  writeFileSync(join(dir, '.project-wiki', 'sources.md'), text, 'utf8');
  return dir;
}
const sources = (dir) => readFileSync(join(dir, '.project-wiki', 'sources.md'), 'utf8');

test('stamps a candidate row with today and leaves other rows byte-identical', () => {
  const today = new Date().toISOString().slice(0, 10);
  const rowA = `| Brand book | asset | raw/brand.pdf | 2026-07-11 | ${PENDING} |`;
  const rowB = `| tokens.css | stylesheet | \`.twt-artifacts/design/tokens.css\` | 2026-07-11 | n/a |`;
  const dir = newSources([rowA, rowB]);
  run(dir, ['--where', 'raw/brand.pdf']);
  const text = sources(dir);
  assert.match(text, new RegExp(`raw/brand.pdf \\| .* \\| ${today} \\|`));
  assert.match(text, /tokens\.css.*\| n\/a \|/, 'the link-only row is untouched');
  assert.match(text, /trailing prose/, 'content after the table survives');
});

test('an unknown --where aborts and writes nothing', () => {
  const rowA = `| Brand book | asset | raw/brand.pdf | 2026-07-11 | ${PENDING} |`;
  const dir = newSources([rowA]);
  const before = sources(dir);
  assert.throws(() => run(dir, ['--where', 'raw/missing.pdf']), /no sources\.md row/);
  assert.equal(sources(dir), before, 'a failed mark must not partially apply');
});

test('migrates a 4-column table: appends the column and backfills by the Where heuristic', () => {
  const today = new Date().toISOString().slice(0, 10);
  const rowA = '| Brand book | asset | raw/brand.pdf | 2026-07-11 |';
  const rowB = '| tokens.css | stylesheet | .twt-artifacts/design/tokens.css | 2026-07-11 |';
  const dir = newSources([rowA, rowB], { five: false });
  run(dir, ['--where', 'raw/brand.pdf']);
  const text = sources(dir);
  assert.match(text, /Ingested \| Synthesized \|/, 'header gains the column');
  assert.match(text, new RegExp(`raw/brand.pdf \\| .* \\| ${today} \\|`), 'requested row stamped today');
  assert.match(text, /tokens\.css \| 2026-07-11 \| n\/a \|/, 'artifact row backfilled n/a');
});

test('refuses to run without a sources table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-wiki-mark-'));
  mkdirSync(join(dir, '.project-wiki'));
  writeFileSync(join(dir, '.project-wiki', 'sources.md'), '# Sources\n\nno table here\n', 'utf8');
  assert.throws(() => run(dir, ['--where', 'raw/x.pdf']), /no sources table/);
});
