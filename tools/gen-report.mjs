#!/usr/bin/env node
// gen-report.mjs — consolidate the pipeline's review artifacts into ONE on-brand,
// browser-openable dashboard at .twt-artifacts/reports/index.html, plus copies of
// the headline reports, so a human can review everything from a single folder.
//
//   node gen-report.mjs <projectDir> [--check]
//     <projectDir>  target project root (reads .twt-artifacts/)
//     --check       compute + print the summary JSON only; do NOT write anything
//
// It renders each phase's phase-review.md (and the QA report) with the
// "⚠ Needs your decision" block surfaced first — and aggregates EVERY open
// decision across all phases into one master checklist at the very top, so the
// user sees in one place exactly what still needs an answer. The dashboard links
// ../design/design-system/tokens.css when present, so it inherits the project's
// look for free (neutral fallback colors otherwise). Deterministic, no deps.
//
// Exit 0 always (it's a convenience view, never a gate); exit 2 on bad usage.
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readHouseCss } from './house-style.mjs';

const projectDir = process.argv[2];
const checkOnly = process.argv.includes('--check');
if (!projectDir) { console.error('usage: gen-report.mjs <projectDir> [--check]'); process.exit(2); }

const ART = join(projectDir, '.twt-artifacts');
const REPORTS = join(ART, 'reports');

// ---- discover report sources ------------------------------------------------
// Phase reviews (the decision-bearing reports) + the QA report (informational).
const SOURCES = [
  { phase: 'pre-design', title: 'Pre-design', file: join(ART, 'pre-design', 'phase-review.md') },
  { phase: 'design', title: 'Design', file: join(ART, 'design', 'phase-review.md') },
  { phase: 'html-site', title: 'Development — HTML', file: join(ART, 'html-site', 'phase-review.md') },
  { phase: 'elementor-theme', title: 'Development — Elementor', file: join(ART, 'elementor-theme', 'phase-review.md') },
  { phase: 'qa', title: 'QA', file: join(ART, 'qa', 'qa-report.md') },
];
const found = SOURCES.filter((s) => existsSync(s.file)).map((s) => ({ ...s, md: readFileSync(s.file, 'utf8') }));

// Extra reports to gather (link + copy) without full inline rendering.
const EXTRAS = [
  { title: 'QA gaps', file: join(ART, 'qa', 'gaps.md') },
  { title: 'Content-approval report', file: join(ART, 'content-approval', 'content-approval-checklist-report.md') },
  { title: 'Run log', file: join(ART, 'site-log.md') },
  { title: 'Run log (dev)', file: join(ART, 'site-dev-log.md') },
].filter((e) => existsSync(e.file));

// ---- tiny markdown -> HTML (headings, tables, lists, bold, code, links) ------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\bBLOCKER?\b|\bBLOCKING\b/g, '<span class="gr-sev gr-block">$&</span>')
    .replace(/\bWARNING\b/g, '<span class="gr-sev gr-warn">$&</span>')
    .replace(/\bOPTIONAL\b|\bSUGGESTION\b/g, '<span class="gr-sev gr-opt">$&</span>');
}
function renderTable(rows) {
  const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  if (rows.length < 2) return '';
  const head = cells(rows[0]);
  const body = rows.slice(2); // skip the |---| separator row
  let h = '<table class="gr-tbl"><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of body) h += '<tr>' + cells(r).map((x) => `<td>${inline(x)}</td>`).join('') + '</tr>';
  return h + '</tbody></table>\n';
}
function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>\n`; i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const tbl = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { tbl.push(lines[i]); i++; }
      html += renderTable(tbl); continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      html += '<ul>\n';
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { html += `<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>\n`; i++; }
      html += '</ul>\n'; continue;
    }
    let para = line; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|\s*\||\s*[-*]\s)/.test(lines[i])) { para += ' ' + lines[i]; i++; }
    html += `<p>${inline(para)}</p>\n`;
  }
  return html;
}

// Pull the "Needs your decision" section (heading + body until the next ##).
function decisionSection(md) {
  // No /m flag: `$` must mean end-of-string, else it would match the first line end
  // and capture nothing. Stops at the next `## ` heading or the end of the file.
  const m = md.match(/##[^\n]*Needs your decision[^\n]*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/);
  return m ? m[1].trim() : '';
}
// Count rows in the first table of a decision section (rough open-item count).
function decisionRowCount(section) {
  const rows = section.split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l));
  return Math.max(0, rows.length - 2); // minus header + separator
}

// ---- build the dashboard ----------------------------------------------------
let totalOpen = 0;
const masterBlocks = [];
const phaseSections = [];
for (const s of found) {
  const sec = decisionSection(s.md);
  if (sec) {
    const n = decisionRowCount(sec);
    totalOpen += n;
    masterBlocks.push(`<h3 class="gr-ph">${esc(s.title)} <span class="gr-count">${n} open</span></h3>\n${mdToHtml(sec)}`);
  }
  phaseSections.push(
    `<section class="gr-card" id="gr-${s.phase}">\n<h2>${esc(s.title)}</h2>\n${mdToHtml(s.md)}\n` +
    `<p class="gr-src">source: <code>.twt-artifacts/${s.phase}/${basename(s.file)}</code></p>\n</section>`
  );
}

const nav = found.map((s) => `<a href="#gr-${s.phase}">${esc(s.title)}</a>`).join(' · ');
const extrasList = EXTRAS.length
  ? `<section class="gr-card"><h2>More reports</h2><ul>` +
    EXTRAS.map((e) => `<li><a href="./${basename(e.file)}">${esc(e.title)}</a> — copied into this folder</li>`).join('') +
    `</ul></section>`
  : '';
const masterHtml = masterBlocks.length
  ? `<section class="gr-card gr-master"><h2>⚠ Open decisions across all phases <span class="gr-count">${totalOpen}</span></h2>` +
    `<p class="gr-legend">Everything still waiting on your answer. <strong class="gr-sev gr-block">BLOCKING</strong> items gate the next phase; <strong class="gr-sev gr-opt">OPTIONAL</strong> ones can be deferred. Answer them at the run's approval gate (the picker), not in this file.</p>` +
    masterBlocks.join('\n') + `</section>`
  : `<section class="gr-card gr-master"><h2>✅ No open decisions</h2><p class="gr-legend">Every phase reviewed so far has no items awaiting your answer.</p></section>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Project review — twt reports</title>
<style>${readHouseCss()}</style>
<style>
  /* gen-report.mjs — gr- namespaced; doc-hub-light via shared house-style.css */
  .gr-wrap{max-width:960px;margin:0 auto;padding:0 20px 64px}
  .gr-head{padding:40px 0 8px}
  .gr-head h1{margin:0 0 6px;font-size:1.9rem;font-family:var(--hs-font-heading);color:var(--hs-ink)}
  .gr-head h1::after{content:"";display:block;width:72px;height:4px;margin:14px 0 0;border-radius:999px;background:linear-gradient(90deg,var(--hs-accent-red) 0 33%,var(--hs-accent-blue) 33% 66%,var(--hs-accent-yellow) 66% 100%)}
  .gr-nav{font-size:.85rem;color:var(--hs-muted);margin:4px 0 8px}
  .gr-nav a{color:var(--hs-accent-blue);text-decoration:none}
  .gr-card{background:var(--hs-surface);border:1px solid var(--hs-rule);border-radius:var(--hs-radius);padding:20px 24px;margin:18px 0;box-shadow:var(--hs-shadow)}
  .gr-master{border-color:var(--hs-accent-blue)}
  .gr-card h2{margin:0 0 12px;font-size:1.3rem;font-family:var(--hs-font-heading);color:var(--hs-ink)}
  .gr-card h3,.gr-ph{margin:18px 0 8px;font-size:1.02rem;font-family:var(--hs-font-heading);color:var(--hs-ink)}
  .gr-count{font-size:.72rem;font-weight:600;color:var(--hs-muted)}
  .gr-legend{font-size:.85rem;color:var(--hs-muted)}
  .gr-tbl{border-collapse:collapse;width:100%;font-size:.85rem;margin:8px 0 14px}
  .gr-tbl th,.gr-tbl td{border:1px solid var(--hs-rule);padding:7px 10px;text-align:left;vertical-align:top}
  .gr-tbl th{background:var(--hs-panel-soft);font-weight:600}
  .gr-sev{font-size:.72rem;font-weight:700;padding:1px 6px;border-radius:6px}
  .gr-block{color:var(--hs-danger);background:rgba(202,34,31,.10)}
  .gr-warn{color:var(--hs-warning);background:rgba(154,103,0,.10)}
  .gr-opt{color:var(--hs-ok);background:rgba(26,127,55,.10)}
  .gr-src{font-size:.74rem;color:var(--hs-muted);margin:10px 0 0}
  code{font-family:var(--hs-font-mono);font-size:.85em;background:var(--hs-panel-soft);padding:1px 4px;border-radius:4px}
  a{color:var(--hs-accent-blue)}
</style>
</head>
<body>
<div class="gr-wrap">
  <header class="gr-head">
    <h1>Project review</h1>
    <p class="gr-legend">Consolidated review of every phase. Generated by <code>gen-report.mjs</code> — regenerated each phase.</p>
    <p class="gr-nav">${nav || '(no phase reviews yet)'}</p>
  </header>
  ${masterHtml}
  ${phaseSections.join('\n  ') || '<section class="gr-card"><p class="gr-legend">No phase-review.md files found yet — run a phase first.</p></section>'}
  ${extrasList}
</div>
</body>
</html>`;

// ---- write outputs (copies + dashboard) -------------------------------------
if (!checkOnly) {
  mkdirSync(REPORTS, { recursive: true });
  for (const s of found) { try { copyFileSync(s.file, join(REPORTS, `${s.phase}-${basename(s.file)}`)); } catch {} }
  for (const e of EXTRAS) { try { copyFileSync(e.file, join(REPORTS, basename(e.file))); } catch {} }
  writeFileSync(join(REPORTS, 'index.html'), html);
}

// ---- machine-readable summary (qa-scan style) -------------------------------
const summary = {
  tool: 'gen-report',
  mode: checkOnly ? 'check' : 'write',
  out: checkOnly ? null : join(REPORTS, 'index.html'),
  phases_rendered: found.map((s) => s.phase),
  extras_gathered: EXTRAS.map((e) => basename(e.file)),
  open_decisions: totalOpen,
};
console.log(`gen-report${checkOnly ? ' (check)' : ': wrote reports/index.html'} — ${found.length} phase report(s), ${totalOpen} open decision(s), ${EXTRAS.length} extra(s) gathered.`);
console.log('```json');
console.log(JSON.stringify(summary, null, 2));
console.log('```');
process.exit(0);
