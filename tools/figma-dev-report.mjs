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

// Caller (the CLI, via findings.json) always hands us findings pre-sorted by
// the engine as (severity, then category) - see figma-dev-audit.mjs's
// `findings.sort`. That ordering is what lets a flat per-category counter
// double as a severity-priority cap: within one category, every Blocker is
// encountered before any High, before any Medium, before any Low. If this
// function is ever called on an unsorted array, higher-severity findings
// could get pushed into `withheld` by earlier lower-severity ones - so this
// is not just a size limit, it is a priority queue that trusts its input.
export function applyCaps(findings) {
  const shown = [];
  const withheld = {};
  const lows = {};
  const seen = {};

  for (const f of findings) {
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

const block = (f) => [
  `#### ${f.title}`,
  '',
  `- **Category:** ${f.category}`,
  `- **Severity:** ${f.severity}  ·  **Confidence:** ${f.confidence}`,
  `- **Location:** ${f.location.page} / ${f.location.frame}${f.location.layers.length ? ` / ${f.location.layers.join(', ')}` : ''} — [open in Figma](${f.link})`,
  `- **Detected:** ${f.detected}`,
  `- **Development impact:** ${f.impact || '_not yet assessed_'}`,
  `- **Recommended action:** ${f.action || '_not yet assessed_'}`,
  `- **Owner:** ${f.owner}  ·  **Blocking:** ${f.blocking ? 'Yes' : 'No'}`,
  '',
].join('\n');

export function renderMarkdown(data) {
  const { meta, findings, decisions } = data;
  const { shown, withheld, lows } = applyCaps(findings);
  const rows = readiness(findings);
  const count = (s) => findings.filter((f) => f.severity === s).length;
  const L = [];

  L.push(`# Developer readiness — ${meta.file}`, '');
  L.push(`Platform: **${meta.platform}** · Scanned: ${meta.scannedAt} · ${meta.frameCount} frames, ${meta.nodeCount} nodes`, '');
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
  const blockers = shown.filter((f) => f.blocking);
  L.push(blockers.length ? blockers.map(block).join('\n') : '_None._');
  L.push('');

  L.push('## Decisions required', '');
  if (!decisions.length) L.push('_None._');
  for (const d of decisions) {
    L.push(`- **${d.question}**`, `  - Why it cannot be answered from the file: ${d.why}`, `  - Owner: ${d.owner}`);
  }
  L.push('');

  L.push('## All issues', '');
  const shownNonBlocking = shown.filter((f) => !f.blocking);
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
      const ex = v.examples.map((f) => `[${f.location.layers[0] || f.nodeIds[0]}](${f.link})`).join(', ');
      L.push(`| ${cat} | ${v.count} | ${ex} |`);
    }
    L.push('', '_Complete list in `findings.json`._', '');
  }

  return L.join('\n');
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

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'readiness-report.md'), renderMarkdown(data), 'utf8');
  console.log(`wrote ${join(outDir, 'readiness-report.md')}`);
}

if (process.argv[1]?.endsWith('figma-dev-report.mjs')) main();
