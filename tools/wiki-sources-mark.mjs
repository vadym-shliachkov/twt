#!/usr/bin/env node
// wiki-sources-mark.mjs — deterministic "synthesized" stamp for sources.md.
//
// sources.md registers every piece of evidence. Its fifth column, Synthesized,
// records which registered sources have been folded into curated pages:
//   n/a          link-only pointer, never synthesized (harvester artifact rows)
//   —            a synthesis candidate not yet reflected on any page
//   YYYY-MM-DD   synthesized on that date
//
// Candidate-vs-link-only is derived from the Where column, never Kind: a Where
// under `.twt-artifacts/` is link-only; anything else (raw/… or a repo path) is
// a candidate. This tool stamps candidate rows (called by the curator after it
// synthesizes a source) and lazily migrates a legacy 4-column table to 5 columns
// on first touch. Everything outside the table is preserved byte-for-byte;
// untouched rows stay byte-identical.
//
// Usage:
//   node tools/wiki-sources-mark.mjs <projectDir> --where <path> [--where <path> …]
// Exit 1 on bad input, a missing table, or an unknown --where path.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const PENDING = '—'; // em-dash — the "not yet synthesized" sentinel

function fail(msg) { console.error(`wiki-sources-mark: ${msg}`); process.exit(1); }

const isPipe = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const stripCell = (c) => String(c || '').replace(/`/g, '').trim();
const isPlaceholder = (source) => source === '' || /^_.*_$/.test(source);
const classify = (whereKey) => (whereKey.startsWith('.twt-artifacts/') ? 'n/a' : PENDING);

// Pure transform. Returns { text, stamped, migrated }.
export function markSources(text, wheres, today) {
  const lines = text.split(/\r?\n/);
  let headerAt = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (isPipe(lines[i]) && !isSep(lines[i]) && /source/i.test(lines[i]) && /ingested/i.test(lines[i]) && isSep(lines[i + 1])) {
      headerAt = i; break;
    }
  }
  if (headerAt === -1) throw new Error('no sources table found in sources.md');
  const migrated = !/synthesized/i.test(lines[headerAt]);

  let end = headerAt + 2;
  while (end < lines.length && isPipe(lines[end]) && !isSep(lines[end])) end++;

  const want = new Set(wheres.map(stripCell));
  const seen = new Set();
  const out = lines.slice();

  if (migrated) {
    // append the column to the header and rebuild the separator to N+1 cells
    const headerCells = splitRow(lines[headerAt]).length;
    out[headerAt] = lines[headerAt].replace(/\s*\|\s*$/, ' | Synthesized |');
    out[headerAt + 1] = '|' + '---|'.repeat(headerCells + 1);
  }

  for (let i = headerAt + 2; i < end; i++) {
    const cells = splitRow(lines[i]);
    const source = cells[0] || '';
    const whereKey = stripCell(cells[2]);
    const stampable = !isPlaceholder(source) && want.has(whereKey);
    if (stampable) seen.add(whereKey);

    if (migrated) {
      let cell;
      if (isPlaceholder(source)) cell = '';
      else if (stampable) cell = today;
      else cell = classify(whereKey);
      out[i] = lines[i].replace(/\s*\|\s*$/, ` | ${cell} |`);
    } else if (stampable) {
      const c = cells.slice();
      c[4] = today; // Source|Kind|Where|Ingested|Synthesized
      out[i] = '| ' + c.join(' | ') + ' |';
    } // else: leave the row byte-identical
  }

  const missing = [...want].filter((w) => !seen.has(w));
  if (missing.length) throw new Error(`no sources.md row with Where = ${missing.join(', ')}`);
  return { text: out.join('\n'), stamped: [...seen], migrated };
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (_isMain && process.argv.includes('--self-test')) {
  const today = '2026-07-20';
  const base = ['# Sources', '',
    '| Source | Kind | Where | Ingested |', '|---|---|---|---|',
    '| Brand book | asset | raw/brand.pdf | 2026-07-11 |',
    '| tokens.css | stylesheet | .twt-artifacts/design/tokens.css | 2026-07-11 |',
    '', 'after'].join('\n');
  // migration + stamp
  const r1 = markSources(base, ['raw/brand.pdf'], today);
  assert.equal(r1.migrated, true);
  assert.match(r1.text, /Ingested \| Synthesized \|/);
  assert.match(r1.text, /raw\/brand.pdf \| .* \| 2026-07-20 \|/);
  assert.match(r1.text, /tokens\.css \| 2026-07-11 \| n\/a \|/);
  assert.match(r1.text, /after$/, 'content outside the table survives');
  // second stamp on the now-5-col table, other rows byte-identical
  const r2 = markSources(r1.text, ['.twt-artifacts/design/tokens.css'], today);
  assert.equal(r2.migrated, false);
  assert.match(r2.text, /tokens\.css \| .* \| 2026-07-20 \|/);
  assert.match(r2.text, /raw\/brand.pdf \| .* \| 2026-07-20 \|/, 'the earlier stamp is preserved');
  // unknown where throws
  assert.throws(() => markSources(r1.text, ['raw/nope.pdf'], today), /no sources\.md row/);
  console.log('wiki-sources-mark self-test: OK');
} else if (_isMain) {
  const args = process.argv.slice(2);
  const projectDir = args.find((a) => !a.startsWith('--'));
  if (!projectDir) fail('usage: node tools/wiki-sources-mark.mjs <projectDir> --where <path> [--where …]');
  const wheres = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--where') wheres.push(args[++i]);
  if (!wheres.length) fail('no --where given');
  const file = join(projectDir, '.project-wiki', 'sources.md');
  if (!existsSync(file)) fail(`sources.md not found: ${file} (run /twt-wiki first)`);
  let result;
  try {
    result = markSources(readFileSync(file, 'utf8'), wheres, new Date().toISOString().slice(0, 10));
  } catch (e) { fail(e.message); }
  writeFileSync(file, result.text, 'utf8');
  console.log(`wiki-sources-mark: stamped ${result.stamped.length} row(s)${result.migrated ? ' (migrated table to 5 columns)' : ''} in ${file}`);
}
