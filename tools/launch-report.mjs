#!/usr/bin/env node
// launch-report.mjs — findings.json in, the client-facing documents out.
//
// Owns the failure discipline and the two anti-noise mechanics. Prose asking
// for restraint does not survive a thirty-page site; these do:
//   1. layers.scan !== 'ok' → the provisional filenames, never launch-report.md.
//      A report under the measured name asserts a scan that happened.
//   2. Max 5 issue blocks per category, withheld counts always stated, and
//      NICE-TO-HAVE never rendered as a block — roll-up only.
//
// Usage: node tools/launch-report.mjs <findings.json> --out <dir>
// Exit 0 on success, 2 on a missing or unreadable findings file.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, CATEGORY_TITLES, SEVERITIES, OWNERS } from './launch-audit.mjs';
import { readHouseCss } from './house-style.mjs';

const MAX_BLOCKS = 5;

const src = process.argv[2];
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx > -1 ? process.argv[outIdx + 1] : null;
if (!src || !outDir) { console.error('usage: launch-report.mjs <findings.json> --out <dir>'); process.exit(2); }

let doc;
try { doc = JSON.parse(readFileSync(src, 'utf8')); }
catch (e) { console.error(`launch-report: cannot read ${src} — ${e.message}`); process.exit(2); }

const findings = doc.findings || [];
const complete = doc.layers?.scan === 'ok';
const byCat = (c) => findings.filter((f) => f.category === c);
const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);

// Findings quote real file content verbatim — a scan rule's evidence is
// routinely a literal fragment like `no non-empty <title>`, `empty <h1>`, or
// `og:image ... resolves to no file` copied straight out of the markup it
// found. In CommonMark a bare `<title>` is inline raw HTML passthrough, and
// an HTML5 parser reading the rendered output switches into RAWTEXT mode the
// instant it sees that tag name — regardless of context — and treats
// everything up to the next `</title>` as inert text. This document has no
// such closing tag anywhere else in it, so on a real run the client-facing
// report silently lost everything after the first `<title>` mention when
// opened through any HTML-aware markdown viewer (GitHub, VS Code preview,
// this repo's own markdown→HTML export path). Backslash-escaping `<` keeps
// the character visible in the rendered output while stopping it from ever
// being read as a tag opener.
const mdEsc = (s) => String(s).replace(/</g, '\\<');

// ---- readiness matrix --------------------------------------------------------
function matrixRows() {
  return CATEGORIES.map((c) => {
    const items = byCat(c);
    const b = items.filter((f) => f.severity === 'LAUNCH-BLOCKER').length;
    const w = items.filter((f) => f.severity === 'FIX-WEEK-ONE').length;
    const u = items.filter((f) => f.severity === 'UNVERIFIED').length;
    const state = b ? 'BLOCKED' : u ? 'UNVERIFIED' : w ? 'AT RISK' : 'CLEAR';
    return { c, title: CATEGORY_TITLES[c], state, b, w, u, n: items.length };
  });
}

// ---- issue blocks ------------------------------------------------------------
// Shared by BOTH the markdown and the html builders. The brief's sample code
// re-implemented this filter/cap inline inside the html template literal —
// same NICE-TO-HAVE exclusion and same MAX_BLOCKS slice, but it never computed
// (or printed) the withheld count, so a category capped at 5-of-9 in the
// markdown silently showed 5-of-5 in the html with no "4 further" notice
// anywhere on the page. One function, used by both renderers, makes that
// divergence impossible instead of merely unlikely.
function sectionItems(c) {
  // NICE-TO-HAVE never becomes a block: it appears in the roll-up row only.
  const items = byCat(c).filter((f) => f.severity !== 'NICE-TO-HAVE');
  const shown = items.slice(0, MAX_BLOCKS);
  const withheld = items.length - shown.length;
  return { shown, withheld };
}

function categorySection(c) {
  const { shown, withheld } = sectionItems(c);
  if (!shown.length) return '';
  const blocks = shown.map((f) => [
    `### ${f.severity} — ${mdEsc(f.where)}`,
    `- **Owner:** ${f.owner}`,
    `- **Evidence:** ${mdEsc(f.evidence)}`,
    `- **Impact:** ${mdEsc(f.impact)}`,
    `- **Action:** ${mdEsc(f.action)}`,
    `- **Rule:** ${f.rule}`,
  ].join('\n')).join('\n\n');
  const tail = withheld ? `\n\n_${withheld} further ${c} item${withheld === 1 ? '' : 's'} withheld — see findings.json for the complete list._` : '';
  return `\n## ${CATEGORY_TITLES[c]}\n\n${blocks}${tail}\n`;
}

// ---- markdown ----------------------------------------------------------------
const counts = doc.counts || {};
const tally = SEVERITIES.map((s) => `${s}: ${counts[s] ?? 0}`).join(' · ');
const rows = matrixRows();

const md = [
  '---',
  `generated: ${(doc.generated || '').slice(0, 10)}`,
  'phase: launch',
  `mode: ${doc.mode || 'local'}`,
  doc.url ? `url: ${doc.url}` : null,
  `verdict: ${doc.verdict}`,
  `scan: ${doc.layers?.scan}`,
  `harvest: ${doc.layers?.harvest}`,
  `live: ${doc.layers?.live}`,
  '---',
  '',
  `# Launch readiness${complete ? '' : ' (provisional)'}`,
  '',
  '## Verdict',
  '',
  `**${doc.verdict}** · ${tally}`,
  '',
  complete
    ? ''
    : `> The deterministic scan did not complete (\`layers.scan: ${doc.layers?.scan}\`), so this document is provisional and cannot clear a launch. Absence of findings below is not evidence of readiness — re-run \`launch-scan.mjs\` and regenerate.\n`,
  '## Readiness matrix',
  '',
  '| # | Category | State | Blockers | Fix week one | Unverified |',
  '|---|---|---|---|---|---|',
  ...rows.map((r, i) => `| ${i + 1} | ${r.title} | ${r.state} | ${r.b} | ${r.w} | ${r.u} |`),
  '',
  ...CATEGORIES.map(categorySection),
  findings.some((f) => f.severity === 'UNVERIFIED')
    ? `\n## Open questions\n\nEach item below could not be verified and no answer was given. None of them can be closed by the build alone.\n\n${
      findings.filter((f) => f.severity === 'UNVERIFIED')
        .map((f) => `- **${f.owner}** — ${mdEsc(f.evidence)} (${mdEsc(f.where)})`).join('\n')}\n`
    : '',
  findings.some((f) => f.severity === 'NICE-TO-HAVE')
    ? `\n## Backlog (NICE-TO-HAVE)\n\n${
      findings.filter((f) => f.severity === 'NICE-TO-HAVE')
        .map((f) => `- ${mdEsc(f.where)} — ${mdEsc(f.evidence)} (${f.rule}, ${f.owner})`).join('\n')}\n`
    : '',
]
  .filter((x) => x !== null)
  .join('\n')
  // categorySection() and the Open-questions/Backlog ternaries can each
  // contribute an empty string back to back (a category with nothing to
  // show, immediately followed by another with nothing to show, immediately
  // followed by a ternary that also has nothing to add) — a real run with a
  // 9-category, 2-category-empty document produced FOUR consecutive blank
  // lines ahead of "## Backlog". A markdown renderer collapses that
  // visually, but a reader looking at the raw file — a diff, a plain-text
  // viewer, this report pasted into a chat — sees a gap that reads as
  // something went missing. One blank line is a paragraph break; more than
  // one is never meaningful here.
  .replace(/\n{3,}/g, '\n\n');

// ---- punch list --------------------------------------------------------------
// Grouped by OWNER, not by page: this is the document each party receives, and
// nobody should have to read another party's items to find their three.
const open = findings.filter((f) => f.severity !== 'NICE-TO-HAVE');
const punch = [
  '---',
  `generated: ${(doc.generated || '').slice(0, 10)}`,
  'phase: launch',
  '---',
  '',
  '# Launch punch list',
  '',
  `Every open item, grouped by who can close it. Verdict: **${doc.verdict}**.`,
  '',
  // A scan that did not complete can leave `findings` empty or thin — not
  // because there is nothing to do, but because nothing was measured. Without
  // this line an incomplete run renders as "No open items", which reads as
  // "you're clear to launch" to a reader who never opens findings.json to
  // check `layers.scan`. This is the same filename-carries-an-assertion
  // failure the reports guard against, applied to the one document that
  // actually gets forwarded to each party.
  complete ? '' : `> The deterministic scan did not complete (\`layers.scan: ${doc.layers?.scan}\`). This list reflects only what could be measured — it is not evidence the site is ready.\n`,
  ...OWNERS.flatMap((o) => {
    const mine = open.filter((f) => f.owner === o);
    if (!mine.length) return [];   // an owner with no items is noise
    return [
      `## ${o}`,
      '',
      ...mine.map((f) => `- [ ] **${f.severity}** — ${mdEsc(f.action)} _(${mdEsc(f.where)} · ${mdEsc(f.evidence)})_`),
      '',
    ];
  }),
  open.length ? '' : 'No open items. Only backlog entries remain.',
]
  .filter((x) => x !== null)
  .join('\n')
  .replace(/\n{3,}/g, '\n\n');

// ---- html --------------------------------------------------------------------
const badge = doc.verdict.startsWith('GO WITH') ? 'risk' : doc.verdict.startsWith('GO') ? 'go' : 'nogo';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Launch readiness — ${esc(doc.verdict)}</title>
<style>${readHouseCss()}
.verdict{display:inline-block;padding:.4em 1em;border-radius:.4em;font-weight:700}
.verdict.go{background:#e6f4ea}.verdict.risk{background:#fdf3d8}.verdict.nogo{background:#fbe4e4}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4em .6em;text-align:left}
.wrap{overflow-x:auto}
.withheld{color:#666;font-style:italic}</style></head><body>
<h1>Launch readiness${complete ? '' : ' (provisional)'}</h1>
<p><span class="verdict ${badge}">${esc(doc.verdict)}</span> &nbsp; ${esc(tally)}</p>
${complete ? '' : `<p><strong>The deterministic scan did not complete (layers.scan: ${esc(doc.layers?.scan)}).</strong> This page is provisional and cannot clear a launch.</p>`}
<h2>Readiness matrix</h2>
<div class="wrap"><table><tr><th>#</th><th>Category</th><th>State</th><th>Blockers</th><th>Fix week one</th><th>Unverified</th></tr>
${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.title)}</td><td>${esc(r.state)}</td><td>${r.b}</td><td>${r.w}</td><td>${r.u}</td></tr>`).join('\n')}
</table></div>
${CATEGORIES.map((c) => {
    // Reuses sectionItems() — the exact same filter and cap the markdown uses
    // — so the html and md renderings of a category can never disagree on
    // what is shown or how many were withheld.
    const { shown, withheld } = sectionItems(c);
    if (!shown.length) return '';
    const tail = withheld
      ? `<p class="withheld">${withheld} further ${esc(c)} item${withheld === 1 ? '' : 's'} withheld — see findings.json for the complete list.</p>`
      : '';
    return `<h2>${esc(CATEGORY_TITLES[c])}</h2>` + shown.map((f) =>
      `<h3>${esc(f.severity)} — ${esc(f.where)}</h3><ul><li><strong>Owner:</strong> ${esc(f.owner)}</li><li><strong>Evidence:</strong> ${esc(f.evidence)}</li><li><strong>Impact:</strong> ${esc(f.impact)}</li><li><strong>Action:</strong> ${esc(f.action)}</li></ul>`).join('\n') + tail;
  }).join('\n')}
${findings.some((f) => f.severity === 'UNVERIFIED') ? `<h2>Open questions</h2><p>Each item below could not be verified and no answer was given. None of them can be closed by the build alone.</p><ul>${
    findings.filter((f) => f.severity === 'UNVERIFIED')
      .map((f) => `<li><strong>${esc(f.owner)}</strong> — ${esc(f.evidence)} (${esc(f.where)})</li>`).join('\n')}</ul>` : ''}
${findings.some((f) => f.severity === 'NICE-TO-HAVE') ? `<h2>Backlog (NICE-TO-HAVE)</h2><ul>${
    findings.filter((f) => f.severity === 'NICE-TO-HAVE')
      .map((f) => `<li>${esc(f.where)} — ${esc(f.evidence)} (${esc(f.rule)}, ${esc(f.owner)})</li>`).join('\n')}</ul>` : ''}
</body></html>`;

// ---- write, guarding against a stale report under the other filename --------
// A prior successful run in this same output directory left a launch-report.md
// that says GO. If the scan fails on a later run, writing only the provisional
// pair is not enough — the earlier launch-report.md is still sitting right
// next to it, still claims to be the measured report, and nothing about its
// mtime tells a reader it predates a failed re-scan. Whichever pair we are
// NOT writing this run must not be left behind under a name that asserts a
// scan it does not reflect.
mkdirSync(outDir, { recursive: true });
const stem = complete ? 'launch-report' : 'launch-report-provisional';
const staleStem = complete ? 'launch-report-provisional' : 'launch-report';
for (const ext of ['md', 'html']) {
  const stale = join(outDir, `${staleStem}.${ext}`);
  if (existsSync(stale)) rmSync(stale);
}
writeFileSync(join(outDir, `${stem}.md`), md, 'utf8');
writeFileSync(join(outDir, `${stem}.html`), html, 'utf8');
writeFileSync(join(outDir, 'punch-list.md'), punch, 'utf8');
console.log(`launch-report: ${doc.verdict} → ${stem}.md, ${stem}.html, punch-list.md`);
process.exit(0);
