#!/usr/bin/env node
// wiki-facts-merge.mjs — deterministic row merge for the facts ledger.
//
// facts.md is the one curated file with TWO sanctioned writers (CONVENTIONS
// §17): the wiki curator promoting inbox entries, and the pipeline's fact
// reconciliation (twt-curation-define Step 3.5). Both were prose-instructed
// to "merge by fact key and never silently flip a value the other resolved" —
// the riskiest LLM file-edit left in the wiki after drain/index were scripted.
// This makes the rule mechanical:
//
//   - new fact                                → row appended
//   - same fact, same canonical               → sources merged (union)
//   - same fact, both RESOLVED, DIFFERENT     → row becomes CONFLICT with
//     canonical TBD and both values in sources — NEVER a silent flip
//   - existing CONFLICT/TBD + incoming RESOLVED → resolved (callers pass
//     RESOLVED only when a human ruled, or sources genuinely agree)
//   - incoming TBD/UNVERIFIED-ATTR over an existing RESOLVED → kept (a weaker
//     claim never degrades a settled one); sources merged
//
// Targets the wiki's curated ledger at .project-wiki/facts.md — its only
// caller, twt-wiki-define, runs with a wiki present. (The pipeline keeps its
// own ledger in .twt-artifacts/ and never calls this.) Everything outside the
// Canonical-facts table is preserved byte-for-byte.
//
// Usage:
//   node tools/wiki-facts-merge.mjs <projectDir> --row "fact|canonical|status|sources" [--row ...]
// Status ∈ RESOLVED | CONFLICT | UNVERIFIED-ATTR | TBD. Exit 1 on bad input.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const STATUSES = new Set(['RESOLVED', 'CONFLICT', 'UNVERIFIED-ATTR', 'TBD']);

function fail(msg) { console.error(`wiki-facts-merge: ${msg}`); process.exit(1); }

export function resolveLedger(projectDir) {
  const wiki = join(projectDir, '.project-wiki', 'facts.md');
  if (existsSync(join(projectDir, '.project-wiki'))) return wiki;
  return join(projectDir, '.twt-artifacts', 'pre-design', 'curation', 'facts.md');
}

function mergeSources(a, b) {
  const parts = [...String(a || '').split('·'), ...String(b || '').split('·')]
    .map((s) => s.trim()).filter(Boolean);
  return [...new Set(parts)].join(' · ');
}

// Merge one incoming row into the parsed row map. Returns 'added' | 'merged'
// | 'conflicted' | 'resolved' | 'kept'.
export function mergeRow(rows, inc) {
  const key = inc.fact.trim().toLowerCase();
  const cur = rows.get(key);
  if (!cur) { rows.set(key, { ...inc }); return 'added'; }
  const same = cur.canonical.trim().toLowerCase() === inc.canonical.trim().toLowerCase();
  if (same) {
    cur.sources = mergeSources(cur.sources, inc.sources);
    if (cur.status !== 'RESOLVED' && inc.status === 'RESOLVED') { cur.status = 'RESOLVED'; return 'resolved'; }
    return 'merged';
  }
  if (cur.status === 'RESOLVED' && inc.status === 'RESOLVED') {
    cur.sources = mergeSources(cur.sources, inc.sources);
    cur.canonical = 'TBD';
    cur.status = 'CONFLICT';
    return 'conflicted';
  }
  if (inc.status === 'RESOLVED') { // existing CONFLICT/TBD/UNVERIFIED + a ruling
    cur.canonical = inc.canonical;
    cur.status = 'RESOLVED';
    cur.sources = mergeSources(cur.sources, inc.sources);
    return 'resolved';
  }
  // weaker incoming claim never degrades the existing row
  cur.sources = mergeSources(cur.sources, inc.sources);
  return 'kept';
}

export function mergeIntoLedger(text, incoming) {
  const lines = text.split(/\r?\n/);
  const isPipe = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  // find the canonical-facts table: header row containing 'canonical' followed by a separator
  let headerAt = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (isPipe(lines[i]) && !isSep(lines[i]) && /canonical/i.test(lines[i]) && isSep(lines[i + 1])) { headerAt = i; break; }
  }
  if (headerAt === -1) throw new Error('no canonical-facts table found in the ledger');
  let end = headerAt + 2;
  while (end < lines.length && isPipe(lines[end]) && !isSep(lines[end])) end++;

  const rows = new Map(); const order = [];
  for (let i = headerAt + 2; i < end; i++) {
    const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (!cells[0] || /^_.*_$/.test(cells[0])) continue; // scaffold placeholder drops once real rows exist
    const key = cells[0].toLowerCase();
    rows.set(key, { fact: cells[0], canonical: cells[1] || '', status: (cells[2] || '').toUpperCase(), sources: cells[3] || '' });
    order.push(key);
  }
  const outcomes = [];
  for (const inc of incoming) {
    const before = rows.has(inc.fact.trim().toLowerCase());
    outcomes.push({ fact: inc.fact, outcome: mergeRow(rows, inc) });
    if (!before) order.push(inc.fact.trim().toLowerCase());
  }
  const rendered = order.map((k) => {
    const r = rows.get(k);
    return `| ${r.fact} | ${r.canonical} | ${r.status} | ${r.sources} |`;
  });
  if (!rendered.length) rendered.push('| _none yet_ | | | |');
  const next = [...lines.slice(0, headerAt + 2), ...rendered, ...lines.slice(end)];
  return { text: next.join('\n'), outcomes };
}

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes('--self-test')) {
  const ledger = ['## Canonical facts',
    '| fact | canonical | status | sources (value@source) |', '|---|---|---|---|',
    '| _none yet_ | | | |', '', 'after'].join('\n');
  const r1 = mergeIntoLedger(ledger, [{ fact: 'firm-tenure', canonical: '20+ years', status: 'RESOLVED', sources: '20+@book' }]);
  assert.match(r1.text, /\| firm-tenure \| 20\+ years \| RESOLVED \| 20\+@book \|/);
  assert.equal(/_none yet_/.test(r1.text), false, 'placeholder drops once a real row exists');
  assert.match(r1.text, /after$/, 'content outside the table survives');
  // never silently flip: two RESOLVED values disagree -> CONFLICT with both sources
  const r2 = mergeIntoLedger(r1.text, [{ fact: 'firm-tenure', canonical: '25+ years', status: 'RESOLVED', sources: '25+@site' }]);
  assert.match(r2.text, /\| firm-tenure \| TBD \| CONFLICT \| 20\+@book · 25\+@site \|/);
  assert.equal(r2.outcomes[0].outcome, 'conflicted');
  // a ruling settles a CONFLICT
  const r3 = mergeIntoLedger(r2.text, [{ fact: 'firm-tenure', canonical: '25+ years', status: 'RESOLVED', sources: 'ruling@user' }]);
  assert.match(r3.text, /\| firm-tenure \| 25\+ years \| RESOLVED \|/);
  // a weaker claim never degrades a settled row
  const r4 = mergeIntoLedger(r3.text, [{ fact: 'firm-tenure', canonical: 'thirty years', status: 'TBD', sources: 'x@y' }]);
  assert.match(r4.text, /\| firm-tenure \| 25\+ years \| RESOLVED \|/);
  assert.equal(r4.outcomes[0].outcome, 'kept');
  // same value merges sources without duplicating the row
  const r5 = mergeIntoLedger(r3.text, [{ fact: 'firm-tenure', canonical: '25+ years', status: 'RESOLVED', sources: '25+@brandbook' }]);
  assert.equal((r5.text.match(/firm-tenure/g) || []).length, 1);
  assert.match(r5.text, /25\+@brandbook/);
  console.log('wiki-facts-merge self-test: OK');
} else if (_isMain) {
  const args = process.argv.slice(2);
  const projectDir = args.find((a) => !a.startsWith('--'));
  if (!projectDir) fail('usage: node tools/wiki-facts-merge.mjs <projectDir> --row "fact|canonical|status|sources" [--row ...]');
  const incoming = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--row') continue;
    const parts = String(args[++i] || '').split('|').map((s) => s.trim());
    if (parts.length < 3) fail(`--row needs "fact|canonical|status|sources", got: ${args[i]}`);
    const status = (parts[2] || '').toUpperCase();
    if (!STATUSES.has(status)) fail(`status \`${parts[2]}\` is not RESOLVED|CONFLICT|UNVERIFIED-ATTR|TBD`);
    incoming.push({ fact: parts[0], canonical: parts[1], status, sources: parts[3] || '' });
  }
  if (!incoming.length) fail('no --row given');
  const ledger = resolveLedger(projectDir);
  if (!existsSync(ledger)) fail(`ledger not found: ${ledger} (run the scaffolder / curation first)`);
  const { text, outcomes } = mergeIntoLedger(readFileSync(ledger, 'utf8'), incoming);
  writeFileSync(ledger, text, 'utf8');
  for (const o of outcomes) console.log(`${o.outcome}: ${o.fact}`);
  console.log(`wiki-facts-merge: ${outcomes.length} row(s) into ${ledger}`);
}
