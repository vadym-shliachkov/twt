#!/usr/bin/env node
// manifest-update.mjs — row-level updates to the asset manifest table.
//
// /twt-assets-produce used to rewrite the manifest table by hand ("Edit tool —
// preserve all other columns byte-for-byte"), which is exactly the failure mode
// that motivated wiki-facts-merge.mjs for facts.md: freehand table surgery is
// how a column silently drifts or a row gets lost. This tool owns the mechanics:
// it touches ONLY the named rows' status cells (or appends rows), preserving
// every other line of the file byte-for-byte.
//
//   node manifest-update.mjs <manifest.md> --set-status <id>=<status> [...]
//   node manifest-update.mjs <manifest.md> --add-row "id|type|filename|placement|spec|alt|source|generation_prompt|status" [...]
//
// - The manifest table is the first markdown table whose header has an `id`
//   column. A missing `status` column is added (header + separator + every
//   existing row defaulting to `planned`) before updates apply.
// - --set-status: an unknown id aborts the whole run without writing anything
//   (wiki-drain semantics — never guess).
// - --add-row: deduped by `filename` — a row whose filename already exists is
//   skipped and reported, never duplicated.
// - Valid statuses: planned, provided, generated, pending-stock, pending-video,
//   missing-provided.
//
// Output: one summary line + ```json { updated[], added[], skipped[] }.
// Exit 0 ok, 1 unknown id / no table, 2 usage error.
'use strict';

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const STATUSES = new Set(['planned', 'provided', 'generated', 'pending-stock', 'pending-video', 'missing-provided']);

const argv = process.argv.slice(2);
const file = argv[0];
const setStatus = [];
const addRows = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--set-status') {
    const m = /^([^=]+)=(.+)$/.exec(argv[++i] || '');
    if (!m) { console.error(`--set-status expects <id>=<status>, got: ${argv[i]}`); process.exit(2); }
    setStatus.push({ id: m[1].trim(), status: m[2].trim() });
  } else if (argv[i] === '--add-row') {
    addRows.push(argv[++i]);
  } else { console.error(`unknown argument: ${argv[i]}`); process.exit(2); }
}
if (!file || (!setStatus.length && !addRows.length)) {
  console.error('usage: manifest-update.mjs <manifest.md> --set-status <id>=<status> [...] --add-row "id|type|filename|..." [...]');
  process.exit(2);
}
if (!existsSync(file)) { console.error(`manifest not found: ${file}`); process.exit(2); }
for (const s of setStatus) {
  if (!STATUSES.has(s.status)) { console.error(`invalid status "${s.status}" — one of: ${[...STATUSES].join(', ')}`); process.exit(2); }
}

const text = readFileSync(file, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r\n|\n/);

const cellsOf = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
const isRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isSep = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

// Locate the first table whose header contains an `id` column.
let headerIdx = -1, sepIdx = -1, cols = null;
for (let i = 0; i < lines.length - 1; i++) {
  if (isRow(lines[i]) && isSep(lines[i + 1])) {
    const c = cellsOf(lines[i]).map((x) => x.toLowerCase());
    if (c.includes('id')) { headerIdx = i; sepIdx = i + 1; cols = c; break; }
  }
}
if (headerIdx === -1) { console.error('no manifest table (header with an `id` column) found — nothing changed'); process.exit(1); }

// Table body = contiguous | rows after the separator.
let endIdx = sepIdx + 1;
while (endIdx < lines.length && isRow(lines[endIdx]) && !isSep(lines[endIdx])) endIdx++;

// Add a status column if the header lacks one (every existing row → planned).
let statusCol = cols.indexOf('status');
if (statusCol === -1) {
  lines[headerIdx] = lines[headerIdx].replace(/\|\s*$/, '| status |');
  lines[sepIdx] = lines[sepIdx].replace(/\|\s*$/, '|--------|');
  for (let i = sepIdx + 1; i < endIdx; i++) lines[i] = lines[i].replace(/\|\s*$/, '| planned |');
  cols.push('status');
  statusCol = cols.length - 1;
}
const idCol = cols.indexOf('id');
const fileCol = cols.indexOf('filename');

// Index body rows by id and filename.
const rowsById = new Map(), filenames = new Set();
for (let i = sepIdx + 1; i < endIdx; i++) {
  const c = cellsOf(lines[i]);
  if (c[idCol]) rowsById.set(c[idCol], i);
  if (fileCol !== -1 && c[fileCol]) filenames.add(c[fileCol]);
}

// Validate every id BEFORE writing anything (abort-whole-run semantics).
for (const s of setStatus) {
  if (!rowsById.has(s.id)) {
    console.error(`unknown id "${s.id}" — known: ${[...rowsById.keys()].join(', ') || 'none'}. Nothing changed.`);
    process.exit(1);
  }
}

const updated = [], added = [], skipped = [];

for (const s of setStatus) {
  const i = rowsById.get(s.id);
  const c = cellsOf(lines[i]);
  const old = c[statusCol] || '';
  c[statusCol] = s.status;
  lines[i] = `| ${c.join(' | ')} |`;
  updated.push({ id: s.id, from: old, to: s.status });
}

let insertAt = endIdx;
for (const raw of addRows) {
  const c = raw.split('|').map((x) => x.trim());
  if (c.length !== cols.length) {
    console.error(`--add-row has ${c.length} cells but the table has ${cols.length} columns (${cols.join(' | ')}). Nothing changed.`);
    process.exit(1);
  }
  const fname = fileCol !== -1 ? c[fileCol] : null;
  if (fname && filenames.has(fname)) { skipped.push({ filename: fname, reason: 'filename already present' }); continue; }
  if (c[statusCol] && !STATUSES.has(c[statusCol])) {
    console.error(`--add-row status "${c[statusCol]}" invalid — one of: ${[...STATUSES].join(', ')}. Nothing changed.`);
    process.exit(1);
  }
  if (!c[statusCol]) c[statusCol] = 'planned';
  lines.splice(insertAt, 0, `| ${c.join(' | ')} |`);
  insertAt++;
  if (fname) filenames.add(fname);
  added.push({ id: c[idCol], filename: fname });
}

writeFileSync(file, lines.join(eol), 'utf8');
console.log(`manifest-update: ${updated.length} status update(s), ${added.length} row(s) added, ${skipped.length} skipped`);
console.log('```json');
console.log(JSON.stringify({ updated, added, skipped }, null, 2));
console.log('```');
