#!/usr/bin/env node
// status-scan.mjs — deterministic freshness check for the twt pipeline.
//
// The twt pipeline is a fixed DAG: an output is STALE when any input it derives
// from has a later mtime. /twt-status used to make the MODEL read every artifact
// mtime into context and compute this in-prompt; this script does it in code and
// emits a ready-to-relay report, so the model only narrates + plans re-runs.
//
//   node status-scan.mjs <projectDir> [scope]
//     <projectDir>  the target project root (contains .twt-artifacts/, maybe site/)
//     [scope]       optional phase (pre-design|design|develop|qa) or artifact path
//                   substring — limits the check to matching nodes + everything
//                   downstream of them. Omitted → whole pipeline.
//
// Output: a human table + a re-run plan on stdout (the skill relays it verbatim),
// then a machine block fenced as ```json for any programmatic consumer.
// Exits 0 always (a freshness report is not a failure); exits 2 only on bad usage.
'use strict';

import { statSync, readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

// ---- the canonical DAG (mirrors the table in commands/twt-status.md) ---------
// Each node: outputs[] (one logical artifact, possibly multiple paths/dirs),
// from[] (input paths it derives from), rerun (the skill that rebuilds it),
// phase (for scoping), and optional external:true (no local input mtime).
const NODES = [
  { phase: 'pre-design', rerun: '/twt-positioning',
    outputs: ['pre-design/positioning/positioning.md'],
    from: ['pre-design/brand/brand-brief.md', 'pre-design/content-fetch'] },
  { phase: 'pre-design', rerun: '/twt-ia',
    outputs: ['pre-design/ia/sitemap.md', 'pre-design/ia/functional-scope.md'],
    from: ['pre-design/positioning/positioning.md', 'pre-design/content-fetch'] },
  { phase: 'pre-design', rerun: '/twt-curation',
    outputs: ['pre-design/curation/inventory.md', 'pre-design/curation/outlines'],
    from: ['pre-design/content-fetch', 'pre-design/brand/brand-brief.md', 'pre-design/ia/sitemap.md'] },
  { phase: 'pre-design', rerun: '/twt-pre-design (synthesis)',
    outputs: ['pre-design/pre-design-brief.md'],
    from: ['pre-design/brand/brand-brief.md', 'pre-design/positioning/positioning.md',
           'pre-design/ia/sitemap.md', 'pre-design/ia/functional-scope.md',
           'pre-design/curation/inventory.md', 'pre-design/curation/outlines'] },
  { phase: 'design', rerun: '/twt-design-system', external: true,
    outputs: ['design/design-system/tokens.md', 'design/design-system/tokens.css'],
    from: ['pre-design/brand/brand-brief.md'] },
  { phase: 'design', rerun: '/twt-component',
    outputs: ['design/component/components.md'],
    from: ['design/design-system/tokens.md', 'pre-design/ia/sitemap.md', 'pre-design/curation/outlines'] },
  { phase: 'design', rerun: '/twt-layout',
    outputs: ['design/layout/layouts'],
    from: ['pre-design/ia/sitemap.md', 'pre-design/curation/outlines', 'design/component/components.md'] },
  { phase: 'design', rerun: '/twt-mockup',
    outputs: ['design/mockup/pages', 'design/mockup/styles.css'],
    from: ['design/layout/layouts', 'design/component/components.md', 'design/design-system/tokens.css',
           'pre-design/curation/inventory.md', 'pre-design/curation/outlines'] },
  { phase: 'design', rerun: '/twt-design (synthesis)',
    outputs: ['design/design-brief.md'],
    from: ['design/design-system/tokens.md', 'design/component/components.md',
           'design/layout/layouts', 'design/mockup/index.html'] },
  { phase: 'develop', rerun: '/twt-develop (or /twt-site-dev)',
    outputs: ['site'], rootRelative: true,
    from: ['design/design-brief.md', 'design/mockup/pages', 'design/layout/layouts',
           'design/component/components.md', 'design/design-system/tokens.css'] },
  { phase: 'develop', rerun: '/twt-develop (or /twt-site-dev)',
    outputs: ['wp-content/themes'], rootRelative: true, themeGlob: true,
    from: ['design/design-brief.md', 'design/mockup/pages', 'design/layout/layouts',
           'design/component/components.md', 'design/design-system/tokens.css'] },
  { phase: 'qa', rerun: '/twt-qa',
    outputs: ['qa/qa-report.md', 'qa/gaps.md'],
    from: ['site', 'wp-content/themes'], fromRootRelative: ['site', 'wp-content/themes'] },
];

// ---- arg parsing -------------------------------------------------------------
const projectDir = process.argv[2];
const scope = (process.argv[3] || '').trim();
if (!projectDir) { console.error('usage: status-scan.mjs <projectDir> [scope]'); process.exit(2); }
const ART = join(projectDir, '.twt-artifacts');

// ---- mtime helpers -----------------------------------------------------------
// Resolve a node path to an absolute path. Most live under .twt-artifacts/;
// rootRelative paths (site/, wp-content/) live at the project root.
function resolvePath(p, rootRelative) { return rootRelative ? join(projectDir, p) : join(ART, p); }

function walkFiles(abs) {
  // Yield every file mtime under abs (recursive). Returns [] if missing.
  const out = [];
  let st; try { st = statSync(abs); } catch { return out; }
  if (st.isFile()) { out.push(st.mtimeMs); return out; }
  if (st.isDirectory()) {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      out.push(...walkFiles(join(abs, e.name)));
    }
  }
  return out;
}

// Output (artifact) effective mtime = OLDEST contained file, so a partially
// regenerated directory still trips as potentially stale. Returns null if absent.
function outputMtime(absPaths) {
  const all = absPaths.flatMap(walkFiles);
  return all.length ? Math.min(...all) : null;
}
// Input effective mtime = NEWEST contained file, so any edit to the input counts.
function inputMtime(abs) {
  const all = walkFiles(abs);
  return all.length ? Math.max(...all) : null;
}

// Expand a themeGlob output (wp-content/themes/hello-elementor-*) to real dirs.
function expandOutputs(node) {
  const paths = [];
  for (const o of node.outputs) {
    const abs = resolvePath(o, node.rootRelative);
    if (node.themeGlob) {
      let entries = []; try { entries = readdirSync(abs, { withFileTypes: true }); } catch {}
      for (const e of entries) if (e.isDirectory() && e.name.startsWith('hello-elementor-')) paths.push(join(abs, e.name));
    } else {
      paths.push(abs);
    }
  }
  return paths;
}

function fmtAge(ms) {
  const s = Math.round(ms / 1000);
  if (s < 90) return s + 's';
  const m = Math.round(s / 60); if (m < 90) return m + 'm';
  const h = Math.round(m / 60); if (h < 36) return h + 'h';
  return Math.round(h / 24) + 'd';
}

// ---- scoping -----------------------------------------------------------------
// A node is in scope if no scope given, or scope matches its phase, or matches
// one of its output path substrings. Downstream inclusion is implicit because a
// re-staled child will simply also test stale on its own inputs.
function inScope(node) {
  if (!scope) return true;
  if (node.phase === scope) return true;
  return node.outputs.some((o) => o.includes(scope)) || (node.from || []).some((f) => f.includes(scope));
}

// ---- compute -----------------------------------------------------------------
const rows = [];
const rerunNeeded = [];
for (const node of NODES) {
  if (!inScope(node)) continue;
  const outAbs = expandOutputs(node);
  const outMt = outputMtime(outAbs);
  if (outMt == null) continue; // artifact not present → nothing to report

  const label = node.outputs.join(', ');
  if (node.external) {
    rows.push({ label, status: 'FRESH', because: 'external source — can’t verify mtime' });
    continue;
  }

  let stalest = null; // {name, ageMs}
  let anyInputPresent = false;
  for (const f of node.from || []) {
    const fRoot = (node.fromRootRelative || []).includes(f);
    const fAbs = resolvePath(f, fRoot);
    const inMt = inputMtime(fAbs);
    if (inMt == null) continue;
    anyInputPresent = true;
    if (inMt > outMt) {
      const ageMs = inMt - outMt;
      if (!stalest || ageMs > stalest.ageMs) stalest = { name: f, ageMs };
    }
  }

  if (!anyInputPresent) {
    rows.push({ label, status: 'NO-INPUTS-PRESENT', because: 'no declared inputs exist on disk' });
  } else if (stalest) {
    rows.push({ label, status: 'STALE', because: `${stalest.name} is ${fmtAge(stalest.ageMs)} newer` });
    rerunNeeded.push(node.rerun);
  } else {
    rows.push({ label, status: 'FRESH', because: '—' });
  }
}

// ---- render ------------------------------------------------------------------
if (rows.length === 0) {
  console.log(`No twt artifacts found under ${ART}${scope ? ` for scope "${scope}"` : ''}.`);
  process.exit(0);
}

const wL = Math.max(8, ...rows.map((r) => r.label.length));
const wS = Math.max(6, ...rows.map((r) => r.status.length));
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
console.log(`Freshness — ${ART}${scope ? `  (scope: ${scope})` : ''}\n`);
console.log(`${pad('Artifact', wL)}  ${pad('Status', wS)}  Stale because`);
console.log(`${'-'.repeat(wL)}  ${'-'.repeat(wS)}  ${'-'.repeat(13)}`);
for (const r of rows) console.log(`${pad(r.label, wL)}  ${pad(r.status, wS)}  ${r.because}`);

const staleCount = rows.filter((r) => r.status === 'STALE').length;
console.log('');
if (staleCount === 0) {
  console.log('All artifacts are fresh relative to their inputs.');
} else {
  // De-dup re-run skills, preserving pipeline (upstream→downstream) order.
  const seen = new Set(); const plan = [];
  for (const s of rerunNeeded) if (!seen.has(s)) { seen.add(s); plan.push(s); }
  console.log(`Re-run plan (upstream→downstream) — ${staleCount} stale:`);
  for (const s of plan) console.log(`  ${s}`);
  console.log('  Note: re-running an upstream artifact re-stales its descendants — work top-down.');
}

// Machine block for any programmatic consumer (the model can ignore it).
console.log('\n```json');
console.log(JSON.stringify({ projectDir, scope: scope || null, stale: staleCount, rows }, null, 2));
console.log('```');
process.exit(0);
