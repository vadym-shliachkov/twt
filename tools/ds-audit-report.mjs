#!/usr/bin/env node
// ds-audit-report.mjs — the human-readable HTML deliverable for
// /twt-design-system-audit (v2). Turns audit.json (+ optional visuals.json,
// quality.json, tokens.css) into one self-contained, dependency-free
// audit-report.html: scorecard, design-system review, a canonical-component
// gallery, the full every-page/every-block matrix, tiered findings with the
// drift shown next to its canonical example, and a "unify these" list.
//
// Inputs (only audit.json is required — everything else degrades gracefully):
//   <OUT>/audit.json     deterministic backbone (Unit 1)
//   <OUT>/visuals.json   block thumbnails (Unit 2)            [optional]
//   <OUT>/quality.json   model's 10-metric DS scorecard       [optional]
//   --tokens <css>       resolved tokens.css for a swatch row  [optional]
//
// Usage: node ds-audit-report.mjs --out <auditDir> [--tokens <tokens.css>]

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i++; }
  }
}
const OUT = flags.out ? String(flags.out) : '.twt-artifacts/design/design-system-audit';
const TOKENS_PATH = flags.tokens ? String(flags.tokens) : null;

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function slugify(s) {
  return String(s).replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'index';
}
const vid = (page, block) => slugify(page) + '##' + block;

const auditPath = path.join(OUT, 'audit.json');
if (!fs.existsSync(auditPath)) { console.error('ds-audit-report: audit.json not found in ' + OUT); process.exit(1); }
const audit = readJson(auditPath) || {};
const visuals = readJson(path.join(OUT, 'visuals.json')) || {};
const quality = readJson(path.join(OUT, 'quality.json')); // may be null
const tokensCss = TOKENS_PATH && fs.existsSync(TOKENS_PATH) ? fs.readFileSync(TOKENS_PATH, 'utf8') : null;

const summary = audit.summary || {};
const dsStats = audit.ds_stats || { source: 'none' };
const clusters = audit.canonical_blocks || [];
const deviations = audit.deviations || [];
const blockStatus = audit.block_status || [];
const signals = audit.quality_signals || {};

// ── small render helpers ──────────────────────────────────────────────────────
const TIER_ORDER = ['BLOCKER', 'WARNING', 'SUGGESTION'];
function tierClass(t) { return 'tier-' + String(t || 'OK').toLowerCase(); }
function statusBadge(b) {
  if (b.tier === 'OK') return '<span class="badge tier-ok">OK</span>';
  return `<span class="badge ${tierClass(b.tier)}">${esc(b.tier)} · ${b.match}%</span>`;
}
function reasonChips(types) {
  return (types || []).map((t) => `<span class="chip chip-${esc(t)}">${esc(t)}</span>`).join('');
}
function thumb(v, cls) {
  if (!v) return '<div class="noimg">no preview</div>';
  if (v.kind === 'png') return `<img class="${cls || ''}" loading="lazy" src="${esc(v.path)}" alt="block preview">`;
  return `<iframe class="embed ${cls || ''}" src="${esc(v.path)}" sandbox loading="lazy" title="block preview"></iframe>`;
}
function clusterCanonVisual(clusterId) {
  const cl = clusters.find((c) => c.id === clusterId);
  if (!cl || !cl.example) return null;
  return visuals[vid(cl.example.page, cl.example.block)] || null;
}
// Deterministic fix hint derived from a delta's reason category.
const FIX_BY_TYPE = {
  color: 'Replace the raw value with the canonical color token.',
  spacing: 'Snap to the nearest step on the --space-* scale.',
  'font-size': 'Use a defined --text-* / type-scale size.',
  radius: 'Use a defined --radius-* token.',
  structure: 'Restore the missing region/element so the block matches the canonical structure.',
};
function fixHint(reasonTypes) {
  const hints = (reasonTypes || []).map((t) => FIX_BY_TYPE[t]).filter(Boolean);
  return hints.length ? hints.join(' ') : 'Converge this instance on the canonical block.';
}

// ── section: scorecard header ────────────────────────────────────────────────
const sourceLabel = dsStats.source === 'synthesized'
  ? 'synthesized by this audit'
  : dsStats.source === 'provided' ? 'provided' : 'none';
const qScore = quality && typeof quality.weighted_overall === 'number' ? quality.weighted_overall : null;

function scorecard() {
  const cards = [
    qScore != null ? `<div class="metric"><div class="num">${qScore}<span class="den">/100</span></div><div class="lbl">DS quality</div></div>` : '',
    `<div class="metric"><div class="num">${summary.consistency_pct != null ? summary.consistency_pct + '%' : '—'}</div><div class="lbl">Consistency</div></div>`,
    `<div class="metric"><div class="num ${summary.deviating_instances ? 'warnnum' : ''}">${summary.deviating_instances || 0}</div><div class="lbl">Drifting blocks</div></div>`,
    `<div class="metric"><div class="num">${summary.pages || 0}</div><div class="lbl">Pages</div></div>`,
    `<div class="metric"><div class="num">${summary.clusters || clusters.length}</div><div class="lbl">Components</div></div>`,
  ].filter(Boolean).join('');
  return `<section class="card scorecard">
    <div class="meta">
      <span><b>Baseline:</b> ${esc(sourceLabel)}</span>
      <span><b>Confidence:</b> ${esc(summary.confidence || 'static')}</span>
      ${summary.crawled ? `<span><b>Crawled:</b> ${summary.crawled} page(s)</span>` : ''}
    </div>
    <div class="metrics">${cards}</div>
  </section>`;
}

// ── section: design-system review ────────────────────────────────────────────
function dsLine() {
  if (dsStats.source === 'none') return 'No design system was provided or synthesized — consistency measured against each component’s own dominant pattern.';
  const where = dsStats.source === 'synthesized' ? '<em>synthesized by this audit</em>' : '<em>provided</em>';
  return `Design system: ${where} — <b>${dsStats.token_count}</b> tokens · `
    + `${dsStats.color_count} colors · ${dsStats.type_size_count} type sizes · `
    + `${dsStats.space_count} spacings · ${dsStats.radius_count} radii · `
    + `${dsStats.component_count} components`;
}
function swatches() {
  if (!tokensCss) return '';
  const re = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))\s*;/gi;
  const out = []; const seen = new Set(); let m;
  while ((m = re.exec(tokensCss)) && out.length < 24) {
    const name = m[1].toLowerCase(); if (seen.has(name)) continue; seen.add(name);
    out.push(`<div class="swatch" title="${esc(name)}: ${esc(m[2])}"><span style="background:${esc(m[2])}"></span><code>${esc(name)}</code></div>`);
  }
  return out.length ? `<div class="swatches">${out.join('')}</div>` : '';
}
function qualityTable() {
  if (quality && Array.isArray(quality.metrics) && quality.metrics.length) {
    const rows = quality.metrics.map((q) => `<tr>
      <td>${esc(q.name)}</td><td class="r">${esc(q.weight)}</td>
      <td class="r ${Number(q.score) < 60 ? 'low' : ''}">${esc(q.score)}%</td>
      <td>${esc(q.evidence || '')}${q.note ? ' — ' + esc(q.note) : ''}</td></tr>`).join('');
    const ca = quality.critical_assessment || {};
    const caHtml = (ca.strength || ca.weakness || ca.fix)
      ? `<div class="assess"><b>Critical assessment.</b>
          ${ca.strength ? '<div><b>Strength:</b> ' + esc(ca.strength) + '</div>' : ''}
          ${ca.weakness ? '<div><b>Weakness:</b> ' + esc(ca.weakness) + '</div>' : ''}
          ${ca.fix ? '<div><b>Highest-impact fix:</b> ' + esc(ca.fix) + '</div>' : ''}</div>` : '';
    return `<table class="grid"><thead><tr><th>Metric</th><th class="r">Weight</th><th class="r">Score</th><th>Evidence / note</th></tr></thead><tbody>${rows}</tbody></table>${caHtml}`;
  }
  // Fallback: the 6 deterministic quality signals.
  const sig = [
    ['Token coverage', (signals.token_coverage_pct || 0) + '%'],
    ['Undefined var refs', signals.undefined_var_refs || 0],
    ['Distinct colors', signals.distinct_colors || 0],
    ['Distinct lengths', signals.distinct_lengths || 0],
    ['Breakpoints', signals.breakpoint_count || 0],
    ['Duplicate token defs', signals.duplicate_token_defs || 0],
  ].map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('');
  return `<p class="note">No model scorecard (quality.json) found — showing deterministic signals only.</p>
    <table class="grid"><thead><tr><th>Signal</th><th class="r">Value</th></tr></thead><tbody>${sig}</tbody></table>`;
}

// ── section: canonical component gallery ─────────────────────────────────────
function gallery() {
  const cards = clusters.map((cl) => {
    const v = cl.example ? visuals[vid(cl.example.page, cl.example.block)] : null;
    return `<div class="gcard" id="canon-${esc(cl.id)}">
      <div class="ghead"><b>${esc(cl.id)}</b> · ${esc(cl.role)} <span class="muted">×${cl.instances}</span></div>
      <div class="gthumb">${thumb(v, 'gimg')}</div>
      ${cl.example ? `<code class="muted">${esc(cl.example.block)}</code>` : ''}
    </div>`;
  }).join('');
  return `<div class="grid-cards">${cards}</div>`;
}

// ── section: full page matrix ────────────────────────────────────────────────
function matrix() {
  const byPage = new Map();
  for (const b of blockStatus) {
    if (!byPage.has(b.page)) byPage.set(b.page, []);
    byPage.get(b.page).push(b);
  }
  if (!byPage.size) return '<p class="note">No block-status matrix in audit.json.</p>';
  const sections = [];
  for (const [page, blocks] of byPage) {
    const rows = blocks.map((b) => {
      const own = visuals[vid(b.page, b.block)];
      const thumbCell = own
        ? thumb(own, 'tiny')
        : `<a class="canonlink" href="#canon-${esc(b.cluster)}">↳ ${esc(b.cluster)}</a>`;
      return `<tr class="${tierClass(b.tier)}row">
        <td><code>${esc(b.block)}</code></td>
        <td>${statusBadge(b)}</td>
        <td>${reasonChips(b.reason_types)}</td>
        <td class="thumbcell">${thumbCell}</td></tr>`;
    }).join('');
    sections.push(`<details class="pageblock" open>
      <summary><a href="${esc(page)}" target="_blank" rel="noopener">${esc(page)}</a>
        <span class="muted">${blocks.length} block(s)</span></summary>
      <table class="grid matrix"><thead><tr><th>Block</th><th>Status</th><th>Reasons</th><th>Preview</th></tr></thead>
      <tbody>${rows}</tbody></table></details>`);
  }
  return sections.join('');
}

// ── section: findings ────────────────────────────────────────────────────────
function findings() {
  if (!deviations.length) return '<p class="ok">No block-level drift — the design follows its system consistently.</p>';
  const groups = TIER_ORDER.map((tier) => {
    const items = deviations.filter((d) => (d.tier || 'WARNING') === tier);
    if (!items.length) return '';
    const cards = items.map((d) => {
      const own = visuals[vid(d.page, d.block)];
      const canon = clusterCanonVisual(d.cluster);
      const reasons = (d.deltas || []).map((x) => `<li>${esc(x)}</li>`).join('');
      return `<div class="finding ${tierClass(tier)}">
        <div class="fhead"><span class="badge ${tierClass(tier)}">${esc(tier)}</span>
          <b>${esc(d.role)}</b> drifts on
          <a href="${esc(d.page)}" target="_blank" rel="noopener">${esc(d.page)}</a>
          <span class="muted">· ${esc(d.cluster)} · match ${d.match}%</span></div>
        <div class="fbody">
          <div class="fmeta">
            <div><b>Where:</b> <code>${esc(d.block)}</code></div>
            <div><b>Reason:</b> ${reasonChips(d.reason_types)}<ul>${reasons}</ul></div>
            <div><b>Fix:</b> ${esc(fixHint(d.reason_types))}</div>
          </div>
          <div class="fpreview">
            <figure><figcaption>this instance</figcaption>${thumb(own, 'tiny')}</figure>
            <figure><figcaption>canonical</figcaption>${thumb(canon, 'tiny')}</figure>
          </div>
        </div></div>`;
    }).join('');
    return `<h3 class="${tierClass(tier)}">${tier} (${items.length})</h3>${cards}`;
  }).join('');
  return groups;
}

// ── section: unify ───────────────────────────────────────────────────────────
function unify() {
  const driftClusters = new Set(deviations.map((d) => d.cluster));
  const rows = clusters
    .filter((cl) => cl.instances > 1 && driftClusters.has(cl.id))
    .map((cl) => `<li><b>${esc(cl.id)}</b> ${esc(cl.role)} — appears on ${cl.pages.length} page(s) with drift; converge on the canonical (<a href="#canon-${esc(cl.id)}">example</a>).</li>`)
    .join('');
  return rows ? `<ul>${rows}</ul>` : '<p class="ok">No near-duplicate components need converging.</p>';
}

// ── assemble ─────────────────────────────────────────────────────────────────
const CSS = `
:root{--ink:#16181d;--muted:#6b7280;--line:#e5e7eb;--bg:#fff;--soft:#f7f8fa;
  --blocker:#dc2626;--warning:#d97706;--suggestion:#2563eb;--ok:#059669;--accent:#4f46e5}
*{box-sizing:border-box}
body{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--soft)}
.wrap{max-width:1100px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:26px;margin:0 0 4px} h2{font-size:19px;margin:36px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}
h3{font-size:15px;margin:22px 0 8px} a{color:var(--accent)} code{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;background:#eef0f4;padding:1px 5px;border-radius:4px}
.muted{color:var(--muted);font-weight:400}.note{color:var(--muted);font-size:13px}.ok{color:var(--ok)}
.card{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:14px 0}
.scorecard .meta{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin-bottom:14px}
.metrics{display:flex;gap:14px;flex-wrap:wrap}
.metric{flex:1;min-width:120px;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center}
.metric .num{font-size:30px;font-weight:700}.metric .den{font-size:15px;color:var(--muted)}.metric .lbl{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.warnnum{color:var(--warning)}
table.grid{width:100%;border-collapse:collapse;font-size:13px;background:var(--bg);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.grid th,.grid td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.grid th{background:var(--soft);font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
.grid .r{text-align:right}.grid .low{color:var(--blocker);font-weight:700}
.assess{margin-top:10px;font-size:13px;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.assess>div{margin-top:3px}
.swatches{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.swatch{display:flex;align-items:center;gap:6px;font-size:11px;border:1px solid var(--line);border-radius:6px;padding:3px 7px;background:var(--bg)}
.swatch span{width:14px;height:14px;border-radius:3px;border:1px solid var(--line);display:inline-block}
.badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;color:#fff}
.tier-blocker{background:var(--blocker)} .tier-warning{background:var(--warning)} .tier-suggestion{background:var(--suggestion)} .tier-ok{background:var(--ok)}
h3.tier-blocker{color:var(--blocker)} h3.tier-warning{color:var(--warning)} h3.tier-suggestion{color:var(--suggestion)}
.chip{display:inline-block;font-size:10px;padding:1px 6px;border-radius:999px;margin:0 3px 3px 0;background:#eef0f4;color:#374151}
.chip-color{background:#fde7e7;color:#b91c1c}.chip-spacing{background:#fef3c7;color:#92400e}.chip-font-size{background:#dbeafe;color:#1d4ed8}.chip-radius{background:#e0e7ff;color:#4338ca}.chip-structure{background:#f3e8ff;color:#7e22ce}
.grid-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.gcard{border:1px solid var(--line);border-radius:10px;background:var(--bg);padding:10px;scroll-margin-top:16px}
.ghead{font-size:13px;margin-bottom:6px}.gthumb{height:120px;overflow:hidden;border:1px solid var(--line);border-radius:6px;background:var(--soft)}
.gimg,img.tiny,iframe.tiny{width:100%;height:100%;object-fit:cover;border:0;display:block}
iframe.embed{width:100%;border:0;background:#fff}.gthumb iframe.embed{height:118px}
.tiny{width:160px;height:100px}iframe.tiny{width:160px;height:100px}
.noimg{display:flex;align-items:center;justify-content:center;height:100%;min-height:60px;color:var(--muted);font-size:11px;background:var(--soft)}
.pageblock{background:var(--bg);border:1px solid var(--line);border-radius:10px;margin:10px 0;padding:6px 12px}
.pageblock>summary{cursor:pointer;font-weight:600;padding:6px 0}
.matrix .thumbcell{width:180px}.canonlink{font-size:12px}
.finding{border:1px solid var(--line);border-left-width:4px;border-radius:8px;background:var(--bg);padding:12px 14px;margin:10px 0}
.finding.tier-blocker{border-left-color:var(--blocker)}.finding.tier-warning{border-left-color:var(--warning)}.finding.tier-suggestion{border-left-color:var(--suggestion)}
.fhead{margin-bottom:8px}.fbody{display:flex;gap:18px;flex-wrap:wrap}.fmeta{flex:1;min-width:260px;font-size:13px}.fmeta ul{margin:4px 0 0 16px;padding:0}
.fpreview{display:flex;gap:12px}.fpreview figure{margin:0;text-align:center}.fpreview figcaption{font-size:10px;color:var(--muted);margin-bottom:3px}
.fpreview img.tiny,.fpreview iframe.tiny{border:1px solid var(--line);border-radius:6px}
`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Design-system audit</title>
<style>${CSS}</style></head>
<body><div class="wrap">
  <h1>Design-system audit</h1>
  <div class="note">${esc(new Date().toISOString().slice(0, 10))} · ${esc(summary.source || (dsStats.source === 'synthesized' ? 'audited design' : ''))}</div>
  ${scorecard()}

  <h2>Design-system review</h2>
  <p>${dsLine()}</p>
  ${swatches()}
  ${qualityTable()}

  <h2>Canonical components</h2>
  ${gallery()}

  <h2>Pages — full matrix</h2>
  <p class="note">Every page, every block. OK blocks link to their canonical example; drifting blocks show their own preview.</p>
  ${matrix()}

  <h2>Findings</h2>
  ${findings()}

  <h2>Unify these</h2>
  ${unify()}
</div></body></html>`;

fs.writeFileSync(path.join(OUT, 'audit-report.html'), html);
console.error('ds-audit-report: wrote ' + path.join(OUT, 'audit-report.html')
  + ` (${clusters.length} clusters, ${deviations.length} findings, ${blockStatus.length} matrix rows)`);
