#!/usr/bin/env node
/**
 * wiki-harvest - pull decision-bearing content already on disk in
 * .twt-artifacts/ into .project-wiki/inbox.md, without ever curating it.
 *
 * This is CAPTURE, not curation: it only ever appends to inbox.md and adds
 * rows to sources.md. It never writes decisions/, entities/, ideas/,
 * facts.md, index.md, or overview.md - only twt-wiki-define (the curator)
 * writes those.
 *
 * A harvester that summarizes generated files into the wiki is the exact
 * failure this system exists to avoid. tokens.css, mockups, and reports are
 * regenerable - they get a one-line sources.md row pointing at their path
 * and nothing else. Only genuinely decision-bearing content (a choice, a
 * reason, a conflict, an open question) becomes an inbox entry - plus every
 * facts-ledger row, because reconciled facts are human-sourced knowledge the
 * wiki must keep even after the artifacts folder is deleted.
 *
 * INERT BY DEFAULT: no .project-wiki/ -> writes nothing, exits 0.
 * No .twt-artifacts/ -> writes nothing, exits 0. This runs at the end of
 * every pipeline phase - it must never affect a project that hasn't opted
 * into the wiki, and must never break a pipeline run. Exits 0 on every path.
 *
 * Idempotent, including after the curator drains the inbox: harvested item
 * IDs are tracked in .project-wiki/.harvest-state.json so a re-scan never
 * re-harvests an entry that has already been promoted (and so no longer
 * appears in inbox.md).
 *
 * Usage: node tools/wiki-harvest.mjs <projectDir> [--dry-run]
 */
import {
  existsSync, readdirSync, readFileSync, appendFileSync, writeFileSync,
} from 'node:fs';
import { join, relative, basename, extname, dirname } from 'node:path';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function sha1_12(s) {
  return createHash('sha1').update(String(s), 'utf8').digest('hex').slice(0, 12);
}

function toPosix(p) {
  return String(p).split('\\').join('/');
}

// The inbox entry timestamp stamp: ISO-8601 UTC with milliseconds stripped.
function nowStamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walk(dir) {
  let out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out = out.concat(walk(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parsers - one per harvestable artifact shape. Each returns plain data;
// entry text is built separately so parsing stays independently testable.
// ---------------------------------------------------------------------------

// Return the body of a "## <heading>" section (up to the next "## " heading,
// or end of file), or null if the heading is absent. Matches
// templates/decisions.md's exact section titles.
function getSection(text, heading) {
  const re = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const nextIdx = rest.search(/^##\s/m);
  return (nextIdx === -1 ? rest : rest.slice(0, nextIdx)).trim();
}

// Scan a section body for top-level "- " bullets, folding any indented
// continuation lines (e.g. decisions.md's "  - why it matters: ...") into
// the same item. Returns an array of raw item text blocks (verbatim, joined
// by \n), used both for display and for stable-ID hashing.
function scanBullets(sectionText) {
  const lines = sectionText.split('\n');
  const items = [];
  let cur = null;
  for (const raw of lines) {
    if (/^-\s/.test(raw)) {
      if (cur !== null) items.push(cur.join('\n').trim());
      cur = [raw];
    } else if (/^\s+-\s/.test(raw) && cur !== null) {
      cur.push(raw);
    } else if (raw.trim() === '') {
      continue;
    } else if (cur !== null) {
      items.push(cur.join('\n').trim());
      cur = null;
    }
  }
  if (cur !== null) items.push(cur.join('\n').trim());
  return items;
}

// decisions.md (templates/decisions.md): one item per bullet under each of
// the three sections. Returns { section, raw } entries.
function parseDecisions(text) {
  const sections = [
    'Open questions',
    'Model-decided assumptions (review)',
    'Proposed rules (confirm before binding)',
  ];
  const out = [];
  for (const section of sections) {
    const body = getSection(text, section);
    if (!body) continue;
    for (const raw of scanBullets(body)) out.push({ section, raw });
  }
  return out;
}

// facts.md (skills/twt-curation-define/SKILL.md Step 3.5): a pipe table
// whose header includes "canonical". The artifact ledger at
// .twt-artifacts/pre-design/curation/facts.md is always the pipeline's
// canonical ledger — the pipeline never writes .project-wiki/facts.md — so
// harvesting it on demand is the only path its rows have into the wiki.
// EVERY status row is harvested, not just CONFLICT - it is a special basename
// (no sources.md row, so the curator never reads it as a source), so if
// resolved facts aren't pulled into the inbox they have no path into the
// wiki at all and die with `rm -rf .twt-artifacts/`, violating the wiki's
// core survival guarantee. CONFLICT rows stay the same shape as before (both
// values, canonical TBD, never silently picked); the other statuses carry
// their canonical value and status so the curator can route them (RESOLVED /
// UNVERIFIED-ATTR -> a facts.md row, TBD -> open-questions.md).
function parseFactRows(text) {
  const lines = text.split('\n');
  const isPipeRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSeparator = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const out = [];
  let header = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isPipeRow(line)) { header = null; continue; }
    if (isSeparator(line)) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const next = lines[i + 1] || '';
    if (header === null && isSeparator(next)) {
      header = cells.map((c) => c.toLowerCase().split(' ')[0]);
      continue;
    }
    if (!header) continue;
    const row = {};
    header.forEach((h, idx) => { row[h] = cells[idx]; });
    if (!header.includes('canonical') || !row.status) continue;
    if (!/^(RESOLVED|CONFLICT|UNVERIFIED-ATTR|TBD)$/i.test(row.status.trim())) continue;
    if (!row.fact || /^_/.test(row.fact)) continue; // "_none yet_" scaffold placeholder
    out.push({
      raw: line.trim(), fact: row.fact, canonical: row.canonical,
      sources: row.sources, status: row.status.trim().toUpperCase(),
    });
  }
  return out;
}

// validation-report.md (CONVENTIONS.md §12 / templates/validation-report.md):
// one item per "### N. [BLOCKER] <title>" finding.
function parseBlockers(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^###\s*\d+\.\s*\[BLOCKER\]\s*(.+)$/.exec(lines[i]);
    if (!m) continue;
    const title = m[1].trim();
    const block = [lines[i]];
    let j = i + 1;
    while (
      j < lines.length
      && !/^##\s/.test(lines[j])
      && !/^###\s*\d+\.\s*\[/.test(lines[j])
    ) { block.push(lines[j]); j++; }
    const blockText = block.join('\n').trim();
    const where = /\*\*Where:\*\*\s*(.+)/i.exec(blockText);
    const problem = /\*\*Problem:\*\*\s*(.+)/i.exec(blockText);
    const rec = /\*\*Recommendation:\*\*\s*(.+)/i.exec(blockText);
    out.push({
      title,
      itemText: blockText,
      where: where ? where[1].trim() : null,
      why: problem ? problem[1].trim() : null,
      recommendation: rec ? rec[1].trim() : null,
    });
  }
  return out;
}

// site-log.md / site-dev-log.md (commands/twt-site.md Step 0a): the
// "### Timeline" section's numbered "[question] <header>: <text>" entries.
// The Timeline's exact question/answer punctuation is prose-described, not
// pinned by a literal worked example anywhere in the repo; this harvester
// expects the header:text form the prose describes, with the answer
// separated by an arrow ("→" or "->"). A line that doesn't fit is left
// alone rather than guessed at. "[step]" lines are dispatch narrative, not
// a Q&A pair, and are never harvested.
function parseTimelineQA(text) {
  const secMatch = /^###\s+Timeline\s*$/m.exec(text);
  if (!secMatch) return [];
  const start = secMatch.index + secMatch[0].length;
  const rest = text.slice(start);
  const endIdx = rest.search(/^###\s/m);
  const section = endIdx === -1 ? rest : rest.slice(0, endIdx);
  const out = [];
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    const m = /^\d+\.\s*\[question\]\s*([^:]+):\s*(.+)$/.exec(line);
    if (!m) continue;
    const header = m[1].trim();
    const restText = m[2].trim();
    const parts = restText.split(/\s(?:→|->)\s/);
    const question = parts[0].trim();
    const answer = parts.length > 1 ? parts.slice(1).join(' → ').trim() : null;
    out.push({ header, question, answer, itemText: line });
  }
  return out;
}

function extToKind(ext) {
  const map = {
    '.css': 'stylesheet', '.html': 'html', '.htm': 'html', '.md': 'doc',
    '.json': 'data', '.jsonl': 'data', '.png': 'image', '.jpg': 'image',
    '.jpeg': 'image', '.svg': 'image', '.pdf': 'doc', '.xlsx': 'workbook',
    '.docx': 'doc', '.pptx': 'deck',
  };
  return map[ext.toLowerCase()] || 'file';
}

// ---------------------------------------------------------------------------
// Entry builders - each renders the inbox entry contract:
// "## <ISO-8601 UTC> · <kind> · <source>" then
// "- **key:** value" lines. Never invent a `why` - an absent rationale is
// written as the literal string "_not recorded_", never guessed at.
// ---------------------------------------------------------------------------

function entryHeader(kind, source) {
  return `\n## ${nowStamp()} · ${kind} · ${source}\n`;
}

function buildDecisionEntry(relPath, section, raw, id) {
  let out = entryHeader('reason', relPath);
  if (section === 'Open questions') {
    const question = raw.split('\n')[0].replace(/^-\s*/, '').trim();
    const whyM = /why it matters:\s*(.+)/i.exec(raw);
    out += `- **kind:** open-question\n`;
    out += `- **question:** ${question}\n`;
    out += `- **why:** ${whyM ? whyM[1].trim() : '_not recorded_'}\n`;
  } else if (section === 'Model-decided assumptions (review)') {
    const body = raw.replace(/^-\s*/, '').trim();
    const basisM = /basis:\s*([\s\S]*?)(?:\s—\s*reversible:|$)/i.exec(body);
    const decision = body.split(/\s—\s*basis:/i)[0].trim();
    const revM = /reversible:\s*(\w+)/i.exec(body);
    out += `- **kind:** model-decided-assumption\n`;
    out += `- **decision:** ${decision}\n`;
    out += `- **why:** ${basisM ? basisM[1].trim() : '_not recorded_'}\n`;
    if (revM) out += `- **reversible:** ${revM[1]}\n`;
  } else {
    const rule = raw.replace(/^-\s*/, '').trim();
    out += `- **kind:** proposed-rule\n`;
    out += `- **decision:** ${rule}\n`;
    out += `- **why:** _not recorded_\n`;
  }
  out += `- **harvested-id:** ${id}\n`;
  return out;
}

function buildFactsEntry(relPath, row, id) {
  let out = entryHeader('reason', relPath);
  out += `- **fact:** ${row.fact}\n`;
  if (row.status === 'CONFLICT') {
    // Both values, canonical TBD - a conflict is never silently resolved.
    out += `- **canonical:** TBD\n`;
    out += `- **values:** ${row.sources}\n`;
    out += `- **why:** _not recorded_\n`;
  } else {
    // A settled (or pending) fact row: no rationale to record - its
    // provenance IS its sources column. The status line tells the curator
    // where it goes (RESOLVED/UNVERIFIED-ATTR -> facts.md, TBD -> open-questions.md).
    out += `- **canonical:** ${row.canonical || 'TBD'}\n`;
    if (row.sources) out += `- **sources:** ${row.sources}\n`;
  }
  out += `- **status:** ${row.status}\n`;
  out += `- **harvested-id:** ${id}\n`;
  return out;
}

function buildBlockerEntry(relPath, b, id) {
  let out = entryHeader('reason', relPath);
  out += `- **finding:** ${b.title}\n`;
  if (b.where) out += `- **where:** ${b.where}\n`;
  out += `- **why:** ${b.why || '_not recorded_'}\n`;
  if (b.recommendation) out += `- **recommendation:** ${b.recommendation}\n`;
  out += `- **harvested-id:** ${id}\n`;
  return out;
}

function buildSiteLogEntry(relPath, qa, id) {
  let out = entryHeader('decision', relPath);
  out += `- **question:** ${qa.header}: ${qa.question}\n`;
  out += `- **chosen:** ${qa.answer || '_not recorded_'}\n`;
  out += `- **harvested-id:** ${id}\n`;
  return out;
}

// ---------------------------------------------------------------------------
// sources.md - a row-only registration for every artifact that isn't
// decision-bearing. Never remove or rewrite an existing row (mirrors
// twt-wiki-fetch/SKILL.md Step 3); insert new rows right after the last
// existing table row.
// ---------------------------------------------------------------------------

function appendSourceRows(path, rows) {
  if (!rows.length) return;
  if (!existsSync(path)) return; // never create sources.md ourselves
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  let lastPipe = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) lastPipe = i;
  }
  if (lastPipe === -1) {
    writeFileSync(path, content.replace(/\n?$/, '\n') + rows.join('\n') + '\n', 'utf8');
    return;
  }
  const newLines = [...lines.slice(0, lastPipe + 1), ...rows, ...lines.slice(lastPipe + 1)];
  writeFileSync(path, newLines.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// Harvest-state - tracks stable IDs already harvested, so a re-scan after
// the curator drains inbox.md never re-adds an entry that's already been
// promoted out of it.
// ---------------------------------------------------------------------------

function loadState(path) {
  if (!existsSync(path)) return { harvested: [] };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (data && Array.isArray(data.harvested)) return data;
  } catch (e) { /* fall through to empty state */ }
  return { harvested: [] };
}

function saveState(path, harvestedArray) {
  writeFileSync(path, JSON.stringify({ harvested: harvestedArray }, null, 2) + '\n', 'utf8');
}

// Artifacts with their own dedicated parser - every other file under
// .twt-artifacts/ is "everything else" and gets only a sources.md row.
const SPECIAL_BASENAMES = new Set([
  'decisions.md', 'facts.md', 'validation-report.md', 'site-log.md', 'site-dev-log.md',
]);

// ---------------------------------------------------------------------------
// Core harvest pass
// ---------------------------------------------------------------------------

function harvest(projectDir, { dryRun = false } = {}) {
  const wikiDir = join(projectDir, '.project-wiki');
  if (!existsSync(wikiDir)) return { skipped: 'no-wiki' };
  const artifactsDir = join(projectDir, '.twt-artifacts');
  if (!existsSync(artifactsDir)) return { skipped: 'no-artifacts' };

  const statePath = join(wikiDir, '.harvest-state.json');
  const state = loadState(statePath);
  const alreadyHarvested = new Set(state.harvested);
  const seenThisRun = new Set();

  const lines = [];
  const newIds = [];
  const inboxChunks = [];
  const sourceRows = [];
  let harvestedCount = 0;
  let alreadyCount = 0;

  // Returns true if this id is new this run (and records the harvest); false
  // if already known (persisted, or a duplicate within this same run).
  function record(id) {
    if (alreadyHarvested.has(id) || seenThisRun.has(id)) {
      alreadyCount++;
      lines.push(`already: ${id}`);
      return false;
    }
    seenThisRun.add(id);
    harvestedCount++;
    lines.push(`harvested: ${id}`);
    newIds.push(id);
    return true;
  }

  for (const file of walk(artifactsDir)) {
    const relPath = toPosix(relative(projectDir, file));
    const bn = basename(file);

    // Only the special basenames are ever decision-bearing; check the name
    // FIRST so every other file (images, PDFs, DOCX/PPTX/XLSX exports, ...)
    // gets a sources.md row from its path/extension alone, with no read.
    if (!SPECIAL_BASENAMES.has(bn)) {
      const id = `${relPath}#source#${sha1_12(relPath)}`;
      if (record(id)) {
        const kind = extToKind(extname(file));
        sourceRows.push(`| ${bn} | ${kind} | ${relPath} | ${today()} |`);
      }
      continue;
    }

    let content;
    try { content = readFileSync(file, 'utf8'); } catch (e) { continue; }

    if (bn === 'decisions.md') {
      for (const { section, raw } of parseDecisions(content)) {
        const id = `${relPath}#${section}#${sha1_12(raw)}`;
        if (record(id)) inboxChunks.push(buildDecisionEntry(relPath, section, raw, id));
      }
      continue;
    }

    if (bn === 'facts.md') {
      for (const row of parseFactRows(content)) {
        // CONFLICT keeps its historical tag so existing .harvest-state.json
        // files stay valid; the other statuses are new and get their own.
        const tag = row.status === 'CONFLICT' ? 'CONFLICT' : 'FACT';
        const id = `${relPath}#${tag}#${sha1_12(row.raw)}`;
        if (record(id)) inboxChunks.push(buildFactsEntry(relPath, row, id));
      }
      continue;
    }

    if (bn === 'validation-report.md') {
      for (const b of parseBlockers(content)) {
        const id = `${relPath}#BLOCKER#${sha1_12(b.itemText)}`;
        if (record(id)) inboxChunks.push(buildBlockerEntry(relPath, b, id));
      }
      continue;
    }

    if (bn === 'site-log.md' || bn === 'site-dev-log.md') {
      for (const qa of parseTimelineQA(content)) {
        const id = `${relPath}#Timeline#${sha1_12(qa.itemText)}`;
        if (record(id)) inboxChunks.push(buildSiteLogEntry(relPath, qa, id));
      }
      continue;
    }
  }

  if (!dryRun) {
    if (inboxChunks.length) appendFileSync(join(wikiDir, 'inbox.md'), inboxChunks.join(''), 'utf8');
    if (sourceRows.length) appendSourceRows(join(wikiDir, 'sources.md'), sourceRows);
    if (newIds.length) saveState(statePath, [...state.harvested, ...newIds]);
  }

  // How many inbox entries now await curation - the nudge the phase report
  // carries so a growing inbox never goes unnoticed. Entries start with "## "
  // at column 0; the scaffold's format comment is indented, so it never counts.
  let pendingCount = 0;
  try {
    const inboxText = readFileSync(join(wikiDir, 'inbox.md'), 'utf8');
    pendingCount = (inboxText.match(/^## /gm) || []).length;
    if (dryRun) pendingCount += inboxChunks.length; // what a real run would have appended
  } catch (e) { /* no inbox.md - leave 0 */ }

  return { lines, harvestedCount, alreadyCount, pendingCount };
}

// ---------------------------------------------------------------------------
// CLI - never throws out of top level, always exits 0. A phase orchestrator
// runs this at the end of every phase; it must never break a pipeline run.
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const projectDir = args.find((a) => a !== '--dry-run');
  if (!projectDir) {
    console.error('usage: node tools/wiki-harvest.mjs <projectDir> [--dry-run]');
    return;
  }

  const result = harvest(projectDir, { dryRun });
  if (result.skipped) {
    console.log(`wiki-harvest: inert (${result.skipped})`);
    return;
  }
  for (const l of result.lines) console.log(l);
  const prefix = dryRun ? '(dry-run) ' : '';
  const pending = result.pendingCount === 1 ? '1 inbox entry' : `${result.pendingCount} inbox entries`;
  console.log(`${prefix}${result.harvestedCount} harvested, ${result.alreadyCount} already present. ${pending} pending curation.`);
}

try { main(); } catch (e) { try { console.error(String((e && e.stack) || e)); } catch (_) { /* never block */ } }
process.exit(0);
