#!/usr/bin/env node
// figma-dev-report.mjs - Layer 4 of /twt-figma-dev-audit: findings.json in,
// readiness-report.md (+ .html) out.
//
// Owns the three anti-noise mechanics. Prose asking for restraint does not
// survive a 400-frame file; these do:
//   1. Confidence: Low never reaches here (the engine rejects it) - such
//      concerns arrive as decisions[] instead.
//   2. Max 5 issue blocks per category, withheld counts always stated.
//   3. Low severity never renders as an issue block - roll-up table only.
//
// Usage:
//   node tools/figma-dev-report.mjs <findings.json> --out <dir>
//   node tools/figma-dev-report.mjs --self-test
//
// Exit 2 on a missing or unreadable findings file.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { validateFinding, SEVERITIES } from './figma-dev-audit.mjs';

// Layer 3 (the model pass) writes findings.json DIRECTLY - it never goes
// through finding(), so none of the engine's guards apply to what it wrote.
// This renderer is the last reader before a client sees the report, so it
// defends the boundary it does not control, twice over:
//
//   validateFinding()  rejects the file outright (Confidence: Low, an owner
//                      outside the vocabulary, an invented category)
//   the defaults below keep a merely INCOMPLETE finding renderable instead
//                      of throwing "Cannot read properties of undefined"
//
// Both are needed: validation catches the bad file, the defaults keep a
// partially-good one useful.
const locOf = (f) => {
  const l = f.location ?? {};
  return { page: l.page ?? '', frame: l.frame ?? '', layers: l.layers ?? [] };
};

// A model-authored `severity: "Blocker"` whose `blocking` field disagreed used
// to count as a Blocker in the Summary and read "Not ready" in the matrix
// while "Blocking issues" said "None." - the most misleading state this
// report can be in.
//
// Severity is the authority and blocking follows from it, because every other
// number on the page (the Summary counts, all six matrix rows) is already
// derived from severity alone. Deriving this one from `f.blocking ?? ...`
// would only cover a MISSING field and leave the identical contradiction
// reachable through an explicit `"blocking": false` - the same broken report,
// one keystroke away. A non-Blocker may still opt in by setting the flag.
const isBlocking = (f) => f.severity === 'Blocker' || f.blocking === true;

export const ROW_CATEGORIES = {
  responsive: ['Responsive coverage', 'Auto Layout & sizing'],
  components: ['Components & code mapping'],
  states: ['States', 'Forms', 'Interaction, flows & animation'],
  assets: ['Assets & exports', 'Effects & implementation cost', 'Fonts'],
  accessibility: ['Content flexibility & a11y risk'],
  platform: ['Platform/CMS risk'],
  // 'Handoff hygiene' is deliberately absent: it measures handoff quality,
  // not build readiness. Its findings still render in the report body.
};

const PER_CATEGORY_CAP = 5;
const ROLLUP_EXAMPLES = 2;

export function readiness(findings) {
  const out = {};
  for (const [row, cats] of Object.entries(ROW_CATEGORIES)) {
    const mine = findings.filter((f) => cats.includes(f.category));
    const n = (s) => mine.filter((f) => f.severity === s).length;
    const blocker = n('Blocker'), high = n('High'), medium = n('Medium'), low = n('Low');
    const status = blocker >= 1 || high >= 3 ? 'Not ready'
      : high >= 1 || medium >= 3 ? 'Ready with assumptions'
      : 'Ready';
    out[row] = { status, blocker, high, medium, low };
  }
  return out;
}

// This is not just a size limit, it is a severity priority queue: a flat
// per-category counter only keeps the right findings if, within a category,
// every Blocker is encountered before any High, before any Medium.
//
// It used to TRUST its caller for that ordering, on the grounds that the
// engine pre-sorts. But Layer 3 appends model-authored findings to the end of
// findings.json without re-sorting, so a model-authored High landing after
// five rule Mediums in one category was the one withheld while the Mediums
// rendered. The precondition is therefore removed rather than documented:
// sort here, defensively. A stable sort over four known values costs nothing
// and leaves an already-sorted array untouched.
export function applyCaps(findings) {
  const shown = [];
  const withheld = {};
  const lows = {};
  const seen = {};

  const rank = (f) => {
    const i = SEVERITIES.indexOf(f.severity);
    return i < 0 ? SEVERITIES.length : i;   // unknown severity sorts last
  };
  const ordered = [...findings].sort((a, b) => rank(a) - rank(b));

  for (const f of ordered) {
    if (f.severity === 'Low') {
      if (!lows[f.category]) lows[f.category] = { count: 0, examples: [] };
      lows[f.category].count += 1;
      if (lows[f.category].examples.length < ROLLUP_EXAMPLES) lows[f.category].examples.push(f);
      continue;
    }
    seen[f.category] = (seen[f.category] || 0) + 1;
    if (seen[f.category] <= PER_CATEGORY_CAP) shown.push(f);
    else withheld[f.category] = (withheld[f.category] || 0) + 1;
  }
  return { shown, withheld, lows };
}

const block = (f) => {
  const loc = locOf(f);
  return [
    `#### ${f.title}`,
    '',
    `- **Category:** ${f.category}`,
    `- **Severity:** ${f.severity}  ·  **Confidence:** ${f.confidence}`,
    // A file-level finding (FN002 counts fonts across the whole file) has no
    // page, no frame and no layers. Printing " / " with a link to nowhere
    // reads as a broken report; the link line below carries what there is.
    loc.page
      ? `- **Location:** ${loc.page} / ${loc.frame}${loc.layers.length ? ` / ${loc.layers.join(', ')}` : ''} — [open in Figma](${f.link})`
      : `- **Location:** whole file${f.link ? ` — [open in Figma](${f.link})` : ''}`,
    `- **Detected:** ${f.detected}`,
    `- **Development impact:** ${f.impact || '_not yet assessed_'}`,
    `- **Recommended action:** ${f.action || '_not yet assessed_'}`,
    `- **Owner:** ${f.owner}  ·  **Blocking:** ${isBlocking(f) ? 'Yes' : 'No'}`,
    '',
  ].join('\n');
};

export function renderMarkdown(data) {
  const { meta, findings, decisions } = data;
  const { shown, withheld, lows } = applyCaps(findings);
  const rows = readiness(findings);
  const count = (s) => findings.filter((f) => f.severity === s).length;
  const L = [];

  L.push(`# Developer readiness — ${meta.file}`, '');
  L.push(`Platform: **${meta.platform}** · Scanned: ${meta.scannedAt} · ${meta.frameCount} frames, ${meta.nodeCount} nodes`, '');
  // A scoped report covers part of the file. Saying so in the header is the
  // only thing standing between it and being read as a whole-file verdict.
  if (meta.scope) L.push(`**Scope: \`${meta.scope}\`** — only pages and frames matching this name were scanned; the rest of the file is not covered by this report.`, '');
  L.push(meta.dsAuditReport
    ? `Related: design-system findings live in \`${meta.dsAuditReport}\` and are not repeated here.`
    : 'There is no design-system audit on record — token, colour and spacing-consistency findings are out of scope for this report. Run `/twt-design-system-audit` for those.');
  L.push('');

  L.push('## Summary', '');
  L.push('| | Count |', '|---|---|');
  L.push(`| Total issues | ${findings.length} |`);
  L.push(`| Blockers | ${count('Blocker')} |`);
  L.push(`| High | ${count('High')} |`);
  L.push(`| Medium | ${count('Medium')} |`);
  L.push(`| Low | ${count('Low')} |`);
  L.push(`| Decisions required | ${decisions.length} |`, '');

  L.push('## Development readiness', '');
  L.push('| Area | Status | Blocker | High | Medium | Low |', '|---|---|---|---|---|---|');
  for (const [row, v] of Object.entries(rows)) {
    L.push(`| ${row} | **${v.status}** | ${v.blocker} | ${v.high} | ${v.medium} | ${v.low} |`);
  }
  L.push('', '_Handoff hygiene is excluded from this matrix — it measures handoff quality, not build readiness._', '');

  L.push('## Blocking issues', '');
  const blockers = shown.filter(isBlocking);
  L.push(blockers.length ? blockers.map(block).join('\n') : '_None._');
  L.push('');

  L.push('## Decisions required', '');
  if (!decisions.length) L.push('_None._');
  for (const d of decisions) {
    L.push(`- **${d.question}**`, `  - Why it cannot be answered from the file: ${d.why}`, `  - Owner: ${d.owner}`);
  }
  L.push('');

  L.push('## All issues', '');
  const shownNonBlocking = shown.filter((f) => !isBlocking(f));
  // Categories to render: every category with a shown non-blocking finding,
  // PLUS every category with a withheld count - even if every shown finding
  // in that category was a Blocker (already printed above) or the cap was
  // consumed entirely by higher-severity findings. Without the second half
  // of this union, a category whose cap overflow happened to be Blockers
  // (e.g. 6 Blockers, cap 5) would have its withheld count computed but
  // never printed anywhere: it doesn't appear in "Blocking issues" (that
  // section has no withheld notice of its own) and it wouldn't appear here
  // either, because the old code only visited categories that had a shown
  // *non-blocking* finding to key off. That silently truncates a Blocker
  // with no count stated, which is exactly what this report must never do.
  const cats = [...new Set([...shownNonBlocking.map((f) => f.category), ...Object.keys(withheld)])];
  if (!cats.length) L.push('_None._');
  for (const cat of cats) {
    L.push(`### ${cat}`, '');
    const items = shownNonBlocking.filter((x) => x.category === cat);
    if (items.length) {
      for (const f of items) L.push(block(f));
    } else {
      L.push('_All shown issues in this category are Blockers — see Blocking issues above._', '');
    }
    if (withheld[cat]) {
      L.push(`_${withheld[cat]} further ${cat} issue(s) withheld by the per-category cap — the complete set is in \`findings.json\`._`, '');
    }
  }

  if (Object.keys(lows).length) {
    L.push('## Low-severity roll-up', '');
    L.push('| Category | Count | Examples |', '|---|---|---|');
    for (const [cat, v] of Object.entries(lows)) {
      const ex = v.examples
        .map((f) => `[${locOf(f).layers[0] || f.nodeIds?.[0] || f.title}](${f.link || ''})`).join(', ');
      L.push(`| ${cat} | ${v.count} | ${ex} |`);
    }
    L.push('', '_Complete list in `findings.json`._', '');
  }

  return L.join('\n');
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

const CSS = `
:root{--bg:#fff;--fg:#16181d;--mut:#616a76;--line:#e3e6ea;--card:#f7f8fa;
--blocker:#b3261e;--high:#c2410c;--medium:#a16207;--low:#616a76}
@media(prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8eaed;--mut:#98a1ad;
--line:#2a2e35;--card:#1c1f25}}
*{box-sizing:border-box}body{margin:0;padding:2rem 1.25rem;background:var(--bg);color:var(--fg);
font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:60rem;margin:0 auto}h1{font-size:1.6rem;margin:0 0 .25rem}
h2{font-size:1.15rem;margin:2.5rem 0 .75rem;padding-bottom:.3rem;border-bottom:1px solid var(--line)}
h3{font-size:1rem;margin:1.75rem 0 .5rem;color:var(--mut)}
h4{font-size:.98rem;margin:0 0 .5rem}
.meta{color:var(--mut);font-size:.88rem;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse;margin:.5rem 0 1rem;font-size:.9rem}
.scroll{overflow-x:auto}
th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:600}
.status{font-weight:700}.status.not-ready{color:var(--blocker)}
.status.ready-with-assumptions{color:var(--medium)}.status.ready{color:#15803d}
.issue{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--mut);
border-radius:6px;padding:1rem;margin:0 0 1rem}
.issue.blocker{border-left-color:var(--blocker)}.issue.high{border-left-color:var(--high)}
.issue.medium{border-left-color:var(--medium)}
.issue dl{display:grid;grid-template-columns:auto 1fr;gap:.3rem .9rem;margin:0;font-size:.9rem}
.issue dt{color:var(--mut)}.issue dd{margin:0}
.issue img{display:block;max-width:100%;margin-top:.9rem;border:1px solid var(--line);border-radius:4px}
a{color:inherit}.none{color:var(--mut);font-style:italic}
`;

// f.shot is model-written, so it is checked rather than trusted: only a
// relative path inside the report's own shots/ directory renders. Anything
// else (an absolute path, a remote URL, a traversal) is dropped - this page
// is handed to clients and must make no external request.
const shotSrc = (f) => (typeof f.shot === 'string' && f.shot.startsWith('shots/') && !f.shot.includes('..')
  ? f.shot : null);

const issueHtml = (f) => {
  const loc = locOf(f);
  const shot = shotSrc(f);
  const where = loc.page
    ? `${esc(loc.page)} / ${esc(loc.frame)}${loc.layers.length ? ' / ' + esc(loc.layers.join(', ')) : ''}`
    : 'whole file';
  return `
<div class="issue ${slug(f.severity)}">
  <h4>${esc(f.title)}</h4>
  <dl>
    <dt>Category</dt><dd>${esc(f.category)}</dd>
    <dt>Severity</dt><dd>${esc(f.severity)} &middot; Confidence ${esc(f.confidence)}</dd>
    <dt>Location</dt><dd>${f.link ? `<a href="${esc(f.link)}">${where}</a>` : where}</dd>
    <dt>Detected</dt><dd>${esc(f.detected)}</dd>
    <dt>Impact</dt><dd>${esc(f.impact || 'not yet assessed')}</dd>
    <dt>Action</dt><dd>${esc(f.action || 'not yet assessed')}</dd>
    <dt>Owner</dt><dd>${esc(f.owner)} &middot; Blocking: ${isBlocking(f) ? 'Yes' : 'No'}</dd>
  </dl>
  ${shot ? `<img src="${esc(shot)}" alt="${esc(f.title)} in context">` : ''}
</div>`;
};

export function renderHtml(data) {
  const { meta, findings, decisions } = data;
  const { shown, withheld, lows } = applyCaps(findings);
  const rows = readiness(findings);
  const count = (s) => findings.filter((f) => f.severity === s).length;
  const blockers = shown.filter(isBlocking);
  const rest = shown.filter((f) => !isBlocking(f));
  // Union with withheld's keys - see the matching comment in renderMarkdown:
  // a category whose cap overflow is entirely Blockers has no shown
  // non-blocking finding to key off, so without this union its withheld
  // count would never be printed anywhere in the page.
  const cats = [...new Set([...rest.map((f) => f.category), ...Object.keys(withheld)])];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Developer readiness — ${esc(meta.file)}</title>
<style>${CSS}</style></head><body><main>
<h1>Developer readiness — ${esc(meta.file)}</h1>
<p class="meta">Platform <strong>${esc(meta.platform)}</strong> &middot; scanned ${esc(meta.scannedAt)} &middot; ${meta.frameCount} frames, ${meta.nodeCount} nodes<br>
${meta.scope ? `<strong>Scope: <code>${esc(meta.scope)}</code></strong> &mdash; only pages and frames matching this name were scanned; the rest of the file is not covered by this report.<br>` : ''}
${meta.dsAuditReport
  ? `Related: design-system findings live in <code>${esc(meta.dsAuditReport)}</code> and are not repeated here.`
  : 'There is no design-system audit on record — token, colour and spacing-consistency findings are out of scope for this report.'}</p>

<h2>Summary</h2>
<div class="scroll"><table><tr><th>Total</th><th>Blockers</th><th>High</th><th>Medium</th><th>Low</th><th>Decisions</th></tr>
<tr><td>${findings.length}</td><td>${count('Blocker')}</td><td>${count('High')}</td><td>${count('Medium')}</td><td>${count('Low')}</td><td>${decisions.length}</td></tr></table></div>

<h2>Development readiness</h2>
<div class="scroll"><table><tr><th>Area</th><th>Status</th><th>Blocker</th><th>High</th><th>Medium</th><th>Low</th></tr>
${Object.entries(rows).map(([row, v]) => `<tr><td>${esc(row)}</td><td class="status ${slug(v.status)}">${esc(v.status)}</td><td>${v.blocker}</td><td>${v.high}</td><td>${v.medium}</td><td>${v.low}</td></tr>`).join('')}
</table></div>
<p class="meta">Handoff hygiene is excluded from this matrix — it measures handoff quality, not build readiness.</p>

<h2>Blocking issues</h2>
${blockers.length ? blockers.map(issueHtml).join('') : '<p class="none">None.</p>'}

<h2>Decisions required</h2>
${decisions.length ? `<div class="scroll"><table><tr><th>Question</th><th>Why it is not in the file</th><th>Owner</th></tr>
${decisions.map((d) => `<tr><td>${esc(d.question)}</td><td>${esc(d.why)}</td><td>${esc(d.owner)}</td></tr>`).join('')}</table></div>`
  : '<p class="none">None.</p>'}

<h2>All issues</h2>
${cats.length ? cats.map((cat) => `<h3>${esc(cat)}</h3>${rest.filter((f) => f.category === cat).map(issueHtml).join('')}${withheld[cat] ? `<p class="meta">${withheld[cat]} further ${esc(cat)} issue(s) withheld by the per-category cap — complete set in <code>findings.json</code>.</p>` : ''}`).join('')
  : '<p class="none">None.</p>'}

${Object.keys(lows).length ? `<h2>Low-severity roll-up</h2>
<div class="scroll"><table><tr><th>Category</th><th>Count</th><th>Examples</th></tr>
${Object.entries(lows).map(([cat, v]) => `<tr><td>${esc(cat)}</td><td>${v.count}</td><td>${v.examples.map((f) => `<a href="${esc(f.link || '')}">${esc(locOf(f).layers[0] || f.nodeIds?.[0] || f.title)}</a>`).join(', ')}</td></tr>`).join('')}
</table></div><p class="meta">Complete list in <code>findings.json</code>.</p>` : ''}
</main></body></html>`;
}

function runSelfTest() {
  const r = readiness([{ category: 'Responsive coverage', severity: 'Blocker' }]);
  assert.equal(r.responsive.status, 'Not ready');
  assert.equal(r.components.status, 'Ready');
  assert.equal(Object.keys(r).length, 6);

  const many = Array.from({ length: 9 }, (_, i) => ({
    id: `X-${i}`, category: 'Auto Layout & sizing', severity: 'Medium',
  }));
  const caps = applyCaps(many);
  assert.equal(caps.shown.length, 5);
  assert.equal(caps.withheld['Auto Layout & sizing'], 4);

  const lowOnly = applyCaps([{ id: 'a', category: 'Handoff hygiene', severity: 'Low' }]);
  assert.equal(lowOnly.shown.length, 0);
  assert.equal(lowOnly.lows['Handoff hygiene'].count, 1);

  const html = renderHtml({
    meta: { file: 'T', url: '', platform: 'web', scannedAt: 'now', dsAuditReport: null,
            nodeCount: 1, frameCount: 1 },
    findings: [], decisions: [],
  });
  assert.match(html, /<!doctype html>/i);
  assert.doesNotMatch(html, /<script\s+src=/i);
  console.log('figma-dev-report self-test: OK');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return runSelfTest();

  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? argv[outIdx + 1] : null;
  const src = argv.find((a) => !a.startsWith('--') && a !== outDir);
  if (!src || !outDir) {
    console.error('usage: node tools/figma-dev-report.mjs <findings.json> --out <dir>');
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(src, 'utf8'));
  } catch (e) {
    console.error(`cannot read findings file ${src}: ${e.message}`);
    process.exit(2);
  }

  // The last gate before a client reads this. Layer 3 wrote straight into
  // findings.json without passing finding(), so "Confidence: Low is never a
  // finding" - the property this whole feature exists to hold - is only
  // actually enforced if it is checked HERE. Fail loudly and name the
  // finding; do not render a report that quietly launders a guess.
  for (const f of data.findings || []) {
    try {
      validateFinding(f);
    } catch (e) {
      console.error(`invalid finding in ${src}: ${e.message}`);
      console.error('Confidence: Low is never a finding - move it to decisions[] as a question.');
      process.exit(2);
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'readiness-report.md'), renderMarkdown(data), 'utf8');
  writeFileSync(join(outDir, 'readiness-report.html'), renderHtml(data), 'utf8');
  console.log(`wrote ${join(outDir, 'readiness-report.md')} and readiness-report.html`);
}

if (process.argv[1]?.endsWith('figma-dev-report.mjs')) main();
