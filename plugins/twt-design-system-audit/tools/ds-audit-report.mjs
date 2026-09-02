#!/usr/bin/env node
// ds-audit-report.mjs — the human-readable HTML deliverable for
// /twt-design-system-audit (v3). Turns audit.json (+ optional visuals.json,
// quality.json, tokens.css) into a MULTI-FILE, self-contained, dependency-free
// report:
//
//   audit-report.html      — the homepage: scorecard, design-system review,
//                            and a list of every page with its per-page
//                            BLOCKER/WARNING/SUGGESTION/OK counts (linked).
//   audit-<page-slug>.html — one file per page, containing ONLY that page's
//                            blocks. Each block is a single fused card: literal
//                            name + selector + status + reasons + the block as
//                            it looks now next to how it should look (canonical),
//                            both full-width.
//
// The canonical component catalog is NOT rendered here anymore — it lives in the
// design system (component/gallery.html). The audit reuses the design system's
// block names so the two artifacts speak the same language.
//
// Inputs (only audit.json is required — everything else degrades gracefully):
//   <OUT>/audit.json     deterministic backbone
//   <OUT>/visuals.json   block thumbnails (png/html embeds)     [optional]
//   <OUT>/quality.json   model's 10-metric DS scorecard         [optional]
//   --tokens <css>       resolved tokens.css (swatches + nearest-token fixes)
//
// Usage: node ds-audit-report.mjs --out <auditDir> [--tokens <tokens.css>]

import fs from 'node:fs';
import path from 'node:path';
import { readHouseCss } from './house-style.mjs';

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
if (!Object.keys(visuals).length) {
  console.error('ds-audit-report: WARNING — visuals.json is missing or empty; block cards will render'
    + ' without previews. Run ds-shots.mjs before this report to capture them.');
}
const quality = readJson(path.join(OUT, 'quality.json')); // may be null
const metricsData = readJson(path.join(OUT, 'metrics.json')); // may be null
const tokensCss = TOKENS_PATH && fs.existsSync(TOKENS_PATH) ? fs.readFileSync(TOKENS_PATH, 'utf8') : null;

const summary = audit.summary || {};
const dsStats = audit.ds_stats || { source: 'none' };
const clusters = audit.canonical_blocks || [];
const deviations = audit.deviations || [];
const blockStatus = audit.block_status || [];
const signals = audit.quality_signals || {};

// ── token map (for swatches + nearest-token fix hints) ───────────────────────
function parseColor(v) {
  v = String(v).trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; }
  return null;
}
// The site's real root font-size, detected by ds-audit.mjs — rem values on
// both sides convert through it, never a hardcoded 16.
const ROOT_PX = (audit.summary && audit.summary.root_font_px) || 16;
function lenToPx(v, rootPx = ROOT_PX) {
  const m = String(v).trim().match(/^(-?\d*\.?\d+)(px|rem|em|pt)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]); const u = (m[2] || 'px').toLowerCase();
  return u === 'rem' || u === 'em' ? n * rootPx : u === 'pt' ? n * (96 / 72) : n;
}
// Same category heuristic as ds-audit.mjs: a nearest-token suggestion may only
// come from the raw value's own category (plus uncategorized tokens) — never
// suggest a --space-* for a font-size.
function tokenCategory(name) {
  if (/radius|rounded|corner/.test(name)) return 'radius';
  if (/font-size|text-size|type-|\bfs-|-size\b/.test(name)) return 'font-size';
  if (/space|gap|gutter|inset|pad|margin/.test(name)) return 'spacing';
  return 'other';
}
const tokenList = [];
if (tokensCss) {
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m; const seen = new Set();
  while ((m = re.exec(tokensCss))) {
    const name = m[1].toLowerCase(); if (seen.has(name)) continue; seen.add(name);
    const val = m[2].trim();
    const col = parseColor(val);
    if (col) { tokenList.push({ name, val, kind: 'color', col }); continue; }
    const px = lenToPx(val, 16); // tokens.css is authored against the default root
    if (px != null) tokenList.push({ name, val, kind: 'len', px, cat: tokenCategory(name) });
  }
}
function nearestToken(rawVal, category) {
  const col = parseColor(rawVal);
  if (col) {
    let best = null, bd = Infinity;
    for (const t of tokenList) {
      if (t.kind !== 'color') continue;
      const d = (t.col.r - col.r) ** 2 + (t.col.g - col.g) ** 2 + (t.col.b - col.b) ** 2 + ((t.col.a - col.a) * 255) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best && bd <= 60 * 60 * 4 ? best : null; // only suggest a genuinely close color
  }
  const px = lenToPx(rawVal);
  if (px != null) {
    let best = null, bd = Infinity;
    for (const t of tokenList) {
      if (t.kind !== 'len') continue;
      if (category && t.cat !== category && t.cat !== 'other') continue; // same-category only
      const d = Math.abs(t.px - px); if (d < bd) { bd = d; best = t; }
    }
    return best && bd <= 4 ? best : null; // within 4px
  }
  return null;
}
// "1.5rem" for a 24px token when the raw value was in rem — so the suggestion
// speaks the same unit the site's CSS uses.
function tokenEquiv(near, rawVal) {
  if (near.kind !== 'len') return esc(near.val);
  const showRem = /rem|em/i.test(String(rawVal));
  if (!showRem || /rem|em/i.test(near.val)) return esc(near.val);
  const rem = Math.round((near.px / ROOT_PX) * 10000) / 10000;
  return `${esc(near.val)} = ${rem}rem`;
}
// Enrich a delta string ("color `#7a82a8` is not a design-system token value")
// with the nearest token, so the fix names the actual replacement. The delta's
// leading word (color / spacing / font-size / radius) scopes the search.
function enrichDelta(s) {
  const m = String(s).match(/^\s*(color|spacing|font-size|radius)?[^`]*`([^`]+)`/);
  if (!m) return esc(s);
  const near = nearestToken(m[2], m[1] || null);
  const base = esc(s);
  return near ? `${base} <span class="near">→ use <code>${esc(near.name)}</code> (${tokenEquiv(near, m[2])})</span>` : base;
}

// ── small render helpers ──────────────────────────────────────────────────────
const TIER_ORDER = ['BLOCKER', 'WARNING', 'SUGGESTION'];
function tierClass(t) { return 'tier-' + String(t || 'OK').toLowerCase(); }
function statusBadge(b) {
  if (b.tier === 'OK') return '<span class="badge tier-ok">OK</span>';
  return `<span class="badge ${tierClass(b.tier)}">${esc(b.tier)} · ${b.match}% match</span>`;
}
function reasonChips(types) {
  return (types || []).map((t) => `<span class="chip chip-${esc(t)}">${esc(t)}</span>`).join('');
}
function thumb(v, cls) {
  if (!v) return '<div class="noimg">no preview captured</div>';
  if (v.kind === 'png') return `<img class="${cls || ''}" loading="lazy" src="${esc(v.path)}" alt="block preview">`;
  return `<iframe class="${cls || ''}" src="${esc(v.path)}" sandbox="allow-same-origin" loading="lazy" title="block preview"></iframe>`;
}

// Per-cluster "canonical reference" = the highest-match instance of the cluster
// (ideally an OK one) — that's "how it should look". Falls back to the cluster
// example from audit.json.
const clusterBest = new Map();
for (const b of blockStatus) {
  const cur = clusterBest.get(b.cluster);
  if (!cur || b.match > cur.match) clusterBest.set(b.cluster, b);
}
function canonRef(clusterId) {
  const best = clusterBest.get(clusterId);
  if (best) return { page: best.page, block: best.block, match: best.match };
  const cl = clusters.find((c) => c.id === clusterId);
  return cl && cl.example ? { page: cl.example.page, block: cl.example.block, match: 100 } : null;
}
const clusterName = new Map(clusters.map((c) => [c.id, c.name || c.role]));

// ── homepage: scorecard ──────────────────────────────────────────────────────
const sourceLabel = dsStats.source === 'synthesized' ? 'synthesized by this audit'
  : dsStats.source === 'provided' ? 'provided' : 'none';
const qScore = quality && typeof quality.weighted_overall === 'number' ? quality.weighted_overall : null;

function scorecard() {
  const scores5 = quality ? {
    coherence: quality.ds_coherence,
    adoption: quality.implementation_adoption,
    consistency: quality.visual_consistency,
    accessibility: quality.accessibility_safety,
    governance: quality.governance,
    alignment: quality.product_system_alignment ?? quality.weighted_overall,
  } : null;

  const hardGates = quality?.hard_gates || metricsData?.hard_gates || {};
  const gateWarnings = Object.entries(hardGates)
    .filter(([, v]) => v === true)
    .map(([k]) => {
      const labels = {
        token_usage_zero: 'Token usage = 0% → Implementation Adoption capped at 15; Alignment capped at 45',
        unique_ui_colors_blocker: '25+ unique UI colors → Alignment score reduced by 15 (floor 30)',
        inline_style_blocker: '21+ inline styles → Implementation Adoption capped at 40',
        important_blocker: '11+ !important declarations → Implementation Adoption reduced',
        raw_value_blocker: '51+ raw values → Implementation Adoption capped at 35',
        critical_a11y_failure: 'Critical accessibility failure → Accessibility Safety capped at 80; Alignment capped at 70',
      };
      return labels[k] || k;
    });

  let scoresHtml = '';
  if (scores5) {
    const fmt = (v, lbl) => v != null
      ? `<div class="metric"><div class="num">${v}<span class="den">/100</span></div><div class="lbl">${lbl}</div></div>`
      : '';
    scoresHtml = [
      fmt(scores5.alignment, 'Product-System Alignment'),
      fmt(scores5.coherence, 'DS Coherence'),
      fmt(scores5.adoption, 'Implementation Adoption'),
      fmt(scores5.consistency, 'Visual Consistency'),
      fmt(scores5.accessibility, 'Accessibility Safety'),
      fmt(scores5.governance, 'Governance'),
    ].filter(Boolean).join('');
  } else if (qScore != null) {
    scoresHtml = `<div class="metric"><div class="num">${qScore}<span class="den">/100</span></div><div class="lbl">DS quality</div></div>`;
  }

  const gateHtml = gateWarnings.length
    ? `<div class="gates">${gateWarnings.map((w) => `<div class="gate-warn">⚠ ${esc(w)}</div>`).join('')}</div>`
    : '';

  return `<section class="card scorecard">
    <div class="meta">
      <span><b>Baseline:</b> ${esc(sourceLabel)}</span>
      <span><b>Confidence:</b> ${esc(summary.confidence || 'static')}</span>
      ${summary.crawled ? `<span><b>Crawled:</b> ${summary.crawled} page(s)</span>` : ''}
    </div>
    ${gateHtml}
    <div class="metrics">
      ${scoresHtml}
      <div class="metric"><div class="num">${summary.consistency_pct != null ? summary.consistency_pct + '%' : '—'}</div><div class="lbl">Consistency</div></div>
      <div class="metric"><div class="num ${summary.deviating_instances ? 'warnnum' : ''}">${summary.deviating_instances || 0}</div><div class="lbl">Drifting blocks</div></div>
      <div class="metric"><div class="num">${summary.pages || 0}</div><div class="lbl">Pages</div></div>
      <div class="metric"><div class="num">${summary.clusters || clusters.length}</div><div class="lbl">Components</div></div>
    </div>
  </section>`;
}

// ── homepage: design-system review ───────────────────────────────────────────
function dsLine() {
  if (dsStats.source === 'none') return 'No design system was provided or synthesized — consistency measured against each component’s own dominant pattern.';
  const where = dsStats.source === 'synthesized' ? '<em>synthesized by this audit</em>' : '<em>provided</em>';
  return `Design system: ${where} — <b>${dsStats.token_count}</b> tokens · `
    + `${dsStats.color_count} colors · ${dsStats.type_size_count} type sizes · `
    + `${dsStats.space_count} spacings · ${dsStats.radius_count} radii · `
    + `${dsStats.component_count} components. Every block below is measured against these token values.`;
}
function swatches() {
  const cols = tokenList.filter((t) => t.kind === 'color').slice(0, 24);
  if (!cols.length) return '';
  const out = cols.map((t) => `<div class="swatch" title="${esc(t.name)}: ${esc(t.val)}"><span style="background:${esc(t.val)}"></span><code>${esc(t.name)}</code></div>`);
  return `<div class="swatches">${out.join('')}</div>`;
}
const METRICS_LEGEND = `<div class="metrics-legend">
  <div class="ml-item"><span class="ml-label">Weight</span><span class="ml-desc">How much this metric contributes to the DS Coherence score. Higher weight = greater impact on the final number.</span></div>
  <div class="ml-item"><span class="ml-label">Score</span><span class="ml-desc">How well the design system performs on this metric (0–100%). Below 60% is highlighted as a concern.</span></div>
</div>`;

function qualityTable() {
  let html = '';

  // 5-score summary (new in v2)
  if (quality && quality.product_system_alignment != null) {
    const scoreRows = [
      ['Design System Coherence', quality.ds_coherence, '20%', 'Whether the system definition is well-structured on its own'],
      ['Implementation Adoption', quality.implementation_adoption, '30%', 'Whether the product actually uses the system in CSS/code'],
      ['Visual Consistency', quality.visual_consistency, '25%', 'Whether similar UI looks and behaves consistently'],
      ['Accessibility Safety', quality.accessibility_safety, '15%', 'Contrast, focus, target size, readability'],
      ['Governance / Intentionality', quality.governance, '10%', 'Whether exceptions are documented and justified'],
    ].map(([name, val, weight, desc]) => `<tr>
      <td><b>${esc(name)}</b></td>
      <td class="r">${esc(weight)}</td>
      <td class="r ${val != null && val < 50 ? 'low' : ''}">${val != null ? val : '—'}/100</td>
      <td>${esc(desc)}</td></tr>`).join('');
    const ca = quality.critical_assessment || {};
    const caHtml = (ca.strength || ca.weakness || ca.fix)
      ? `<div class="assess"><b>Critical assessment.</b>
          ${ca.strength ? '<div><b>Strength:</b> ' + esc(ca.strength) + '</div>' : ''}
          ${ca.weakness ? '<div><b>Weakness:</b> ' + esc(ca.weakness) + '</div>' : ''}
          ${ca.fix ? '<div><b>Highest-impact fix:</b> ' + esc(ca.fix) + '</div>' : ''}</div>` : '';
    html += `<h3>Score Breakdown</h3>
      <table class="grid"><thead><tr><th>Dimension</th><th class="r">Weight</th><th class="r">Score</th><th>What it means</th></tr></thead>
      <tbody>${scoreRows}</tbody></table>${caHtml}`;
  }

  // 10-metric DS Coherence detail (existing, unchanged)
  if (quality && Array.isArray(quality.metrics) && quality.metrics.length) {
    const rows = quality.metrics.map((q) => `<tr>
      <td>${esc(q.name)}</td><td class="r">${esc(q.weight)}</td>
      <td class="r ${Number(q.score) < 60 ? 'low' : ''}">${esc(q.score)}%</td>
      <td>${esc(q.evidence || '')}${q.note ? ' — ' + esc(q.note) : ''}</td></tr>`).join('');
    html += `<h3>DS Coherence Detail (10 sub-metrics)</h3>
      ${METRICS_LEGEND}<table class="grid"><thead><tr><th>Metric</th><th class="r">Weight</th><th class="r">Score</th><th>Evidence / note</th></tr></thead><tbody>${rows}</tbody></table>`;
  } else if (!html) {
    const sig = [
      ['Token coverage', (signals.token_coverage_pct || 0) + '%'],
      ['Undefined var refs', signals.undefined_var_refs || 0],
      ['Distinct colors', signals.distinct_colors || 0],
      ['Distinct lengths', signals.distinct_lengths || 0],
      ['Breakpoints', signals.breakpoint_count || 0],
      ['Duplicate token defs', signals.duplicate_token_defs || 0],
    ].map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('');
    html += `<p class="note">No model scorecard (quality.json) found — showing deterministic signals only.</p>
      <table class="grid"><thead><tr><th>Signal</th><th class="r">Value</th></tr></thead><tbody>${sig}</tbody></table>`;
  }
  return html;
}

// ── group blocks by page ──────────────────────────────────────────────────────
const byPage = new Map();
for (const b of blockStatus) {
  if (!byPage.has(b.page)) byPage.set(b.page, []);
  byPage.get(b.page).push(b);
}
const devByPageBlock = new Map(); // page##block -> deviation (carries deltas)
for (const d of deviations) devByPageBlock.set(vid(d.page, d.block), d);

function pageCounts(blocks) {
  const c = { BLOCKER: 0, WARNING: 0, SUGGESTION: 0, OK: 0 };
  for (const b of blocks) c[b.tier === 'OK' ? 'OK' : b.tier] = (c[b.tier === 'OK' ? 'OK' : b.tier] || 0) + 1;
  return c;
}

// Stable, unique per-page filenames.
const pageFile = new Map();
{
  const used = new Set();
  for (const page of byPage.keys()) {
    let base = 'audit-' + slugify(page); let name = base; let i = 2;
    while (used.has(name)) name = base + '-' + (i++);
    used.add(name); pageFile.set(page, name + '.html');
  }
}

// ── homepage: page list with per-page counts ─────────────────────────────────
function countChips(c) {
  const parts = [];
  if (c.BLOCKER) parts.push(`<span class="pc pc-blocker">${c.BLOCKER} blocker${c.BLOCKER > 1 ? 's' : ''}</span>`);
  if (c.WARNING) parts.push(`<span class="pc pc-warning">${c.WARNING} warning${c.WARNING > 1 ? 's' : ''}</span>`);
  if (c.SUGGESTION) parts.push(`<span class="pc pc-suggestion">${c.SUGGESTION} suggestion${c.SUGGESTION > 1 ? 's' : ''}</span>`);
  parts.push(`<span class="pc pc-ok">${c.OK} ok</span>`);
  return parts.join('');
}
function pageList() {
  const rows = [...byPage.entries()].map(([page, blocks]) => ({ page, blocks, c: pageCounts(blocks) }));
  rows.sort((a, b) => (b.c.BLOCKER - a.c.BLOCKER) || (b.c.WARNING - a.c.WARNING) || (b.blocks.length - a.blocks.length));
  const items = rows.map(({ page, blocks, c }) => `<a class="pagerow" href="${esc(pageFile.get(page))}">
      <div class="pr-main">
        <div class="pr-title">${esc(prettyPage(page))}</div>
        <div class="pr-url">${esc(page)}</div>
      </div>
      <div class="pr-counts">${countChips(c)} <span class="pr-total">${blocks.length} block(s)</span></div>
    </a>`).join('');
  return `<div class="pagelist">${items}</div>`;
}
function prettyPage(page) {
  try { const u = new URL(page); const p = u.pathname.replace(/\/$/, ''); return p && p !== '' ? p : '/ (home)'; }
  catch { return page; }
}

// ── homepage: unify (cross-page near-duplicates) ─────────────────────────────
function unify() {
  const driftClusters = new Set(deviations.map((d) => d.cluster));
  const rows = clusters
    .filter((cl) => cl.instances > 1 && driftClusters.has(cl.id))
    .map((cl) => `<li><b>${esc(cl.name || cl.role)}</b> <code class="muted">${esc(cl.id)}</code> — appears on ${cl.pages.length} page(s) with drift; converge every instance on one canonical block.</li>`)
    .join('');
  return rows ? `<ul class="unify">${rows}</ul>` : '<p class="ok">No near-duplicate components need converging.</p>';
}

// Canonical comparison is only worth showing when the human can perceive the
// difference. Subtle radius tweaks or minor font-size drifts look identical at
// display size; showing two identical-looking panels just adds noise.
function isSignificant(b) {
  if (b.tier === 'BLOCKER') return true;
  if (b.tier !== 'WARNING') return false;
  const rt = new Set(b.reason_types || []);
  if (!rt.size) return false;
  if (rt.size === 1 && rt.has('font-size')) return false;
  if (rt.size === 1 && rt.has('radius')) return false;
  return true;
}

// ── DS comparison metrics section ────────────────────────────────────────────
function fmtVal(m) {
  if (m.value == null) return '<span class="mc-null">—</span>';
  const v = m.value;
  const u = m.unit || '';
  if (typeof v === 'string' && /[^\d.x%]/.test(v)) return esc(v); // descriptive string
  return `<b>${esc(v)}</b><span class="mc-unit">${esc(u)}</span>`;
}
function stBadge(st) {
  if (!st) return '';
  const map = {
    ok: ['st-ok', 'OK'],
    warn: ['st-warn', 'WARN'],
    bad: ['st-bad', 'BAD'],
    blocker: ['st-blocker', 'BLOCKER'],
    info: ['st-info', '·'],
  };
  const [cls, label] = map[st] || ['st-info', st];
  return `<span class="${cls}">${label}</span>`;
}
function metricsSection() {
  if (!metricsData || !Array.isArray(metricsData.categories) || !metricsData.categories.length) return '';
  const catHtml = metricsData.categories.map((cat) => {
    const computed = cat.metrics.filter((m) => m.value != null && m.value !== '').length;
    const rows = cat.metrics.map((m) => `<tr>
      <td class="mc-id">${esc(m.id)}</td>
      <td class="mc-name">${esc(m.name)}</td>
      <td class="mc-val">${fmtVal(m)}</td>
      <td class="mc-st">${stBadge(m.status)}</td>
      <td class="mc-desc">${esc(m.desc || '')}</td>
    </tr>`).join('');
    return `<details class="mc-cat">
      <summary class="mc-sum">${esc(cat.label)}<span class="mc-count">${computed} of ${cat.metrics.length} computed</span></summary>
      <table class="grid mc-tbl">
        <thead><tr><th class="mc-id">#</th><th>Metric</th><th>Value</th><th class="mc-st">Status</th><th>Description</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
  }).join('');
  return `<h2>Design System Comparison Metrics</h2>
  <p class="note">Compares what the design system defines against what the site actually uses — token counts, coverage ratios, and site-side drift. Metrics marked <span class="st-blocker">BLOCKER</span> indicate hard failures; <span class="st-bad">BAD</span> systemic drift; <span class="st-warn">WARN</span> suggests review; <span class="mc-null">—</span> requires Playwright or manual review. Generated ${esc(metricsData.generated_at || '')}.</p>
  <div class="mc-legend">
    <span><b>Value</b> — computed from crawled CSS and audit data</span>
    <span><b>OK</b> — within healthy thresholds</span>
    <span class="st-blocker">BLOCKER</span> — hard failure; gate triggered
    <span class="st-warn">WARN</span> — worth reviewing
    <span class="st-bad">BAD</span> — systemic issue
    <span class="mc-null">—</span> — requires browser/manual review
  </div>
  ${catHtml}`;
}

// ── per-page: one fused card per block ───────────────────────────────────────
function blockCard(b) {
  const dev = devByPageBlock.get(vid(b.page, b.block));
  const own = visuals[vid(b.page, b.block)];
  const ref = canonRef(b.cluster);
  const refDifferent = ref && vid(ref.page, ref.block) !== vid(b.page, b.block);
  const refV = refDifferent ? visuals[vid(ref.page, ref.block)] : null;
  const name = b.name || clusterName.get(b.cluster) || b.role;
  const deltas = (dev && dev.deltas ? dev.deltas : (b.reasons || []));
  const reasonsHtml = deltas.length
    ? `<ul class="deltas">${deltas.map((x) => `<li>${enrichDelta(x)}</li>`).join('')}</ul>`
    : '<p class="ok small">Matches the design system — no drift.</p>';
  const isOk = b.tier === 'OK';
  // Now-vs-canonical pair when a distinct canonical instance has a preview and
  // the drift is actually perceivable at display size; single pane otherwise.
  const showPair = refV && isSignificant(b);
  const previews = isOk ? '' : showPair ? `
    <div class="ba">
      <figure class="ba-now"><figcaption>This instance <span class="muted">(${b.match}% match)</span></figcaption>
        <div class="pane">${thumb(own, 'fullpv')}</div></figure>
      <figure class="ba-should"><figcaption>Best-matching instance <span class="muted">(${esc(prettyPage(ref.page))} · ${ref.match}% match)</span></figcaption>
        <div class="pane">${thumb(refV, 'fullpv')}</div></figure>
    </div>` : `
    <div class="ba single">
      <figure class="ba-now"><figcaption>Block preview <span class="muted">(this instance)</span></figcaption>
        <div class="pane">${thumb(own, 'fullpv')}</div></figure>
    </div>`;
  return `<article class="block ${tierClass(b.tier)}" id="${esc(slugify(b.block))}">
    <header class="bhead">
      <div class="btitle"><span class="bname">${esc(name)}</span> ${statusBadge(b)}</div>
      <code class="bsel">${esc(b.block)}</code>
    </header>
    <div class="breasons">
      ${b.reason_types && b.reason_types.length ? `<div class="chips">${reasonChips(b.reason_types)}</div>` : ''}
      ${reasonsHtml}
    </div>
    ${previews}
  </article>`;
}

function pageDoc(page, blocks) {
  const c = pageCounts(blocks);
  // Worst first: BLOCKER, WARNING, SUGGESTION, then OK.
  const rank = { BLOCKER: 0, WARNING: 1, SUGGESTION: 2, OK: 3 };
  const sorted = [...blocks].sort((a, b) => (rank[a.tier] - rank[b.tier]) || (a.match - b.match));
  const drifting = sorted.filter((b) => b.tier !== 'OK');
  const okBlocks = sorted.filter((b) => b.tier === 'OK');
  const cards = drifting.map(blockCard).join('\n');
  const okList = okBlocks.length
    ? `<details class="okwrap"><summary>${okBlocks.length} block(s) match the design system</summary>
       <ul class="oklist">${okBlocks.map((b) => `<li><span class="badge tier-ok">OK</span> <b>${esc(b.name || b.role)}</b> <code class="muted">${esc(b.block)}</code></li>`).join('')}</ul></details>`
    : '';
  const body = `
    <a class="back" href="audit-report.html">← All pages</a>
    <h1>${esc(prettyPage(page))}</h1>
    <div class="note"><a href="${esc(page)}" target="_blank" rel="noopener">${esc(page)}</a></div>
    <section class="card"><div class="metrics small">
      <div class="metric"><div class="num ${c.BLOCKER ? 'blknum' : ''}">${c.BLOCKER}</div><div class="lbl">Blockers</div></div>
      <div class="metric"><div class="num ${c.WARNING ? 'warnnum' : ''}">${c.WARNING}</div><div class="lbl">Warnings</div></div>
      <div class="metric"><div class="num">${c.SUGGESTION}</div><div class="lbl">Suggestions</div></div>
      <div class="metric"><div class="num">${c.OK}</div><div class="lbl">OK</div></div>
    </div></section>
    ${drifting.length ? cards : '<p class="ok">Every block on this page matches the design system.</p>'}
    ${okList}`;
  return htmlShell(prettyPage(page) + ' — audit', body);
}

// ── shared shell + CSS ───────────────────────────────────────────────────────
const CSS = `
/* doc-hub light design language — shared with gen-preview.mjs:
   light page, blue accents, Montserrat headings, tri-color (red/blue/yellow)
   accent bars, rounded panels. */
:root{--ink:var(--hs-ink);--text:var(--hs-text);--muted:var(--hs-muted);--line:var(--hs-rule);--bg:var(--hs-surface);--soft:var(--hs-panel-soft);
  --blocker:var(--hs-danger);--warning:var(--hs-warning);--suggestion:var(--hs-accent-blue);--ok:var(--hs-ok);--accent:var(--hs-accent-blue);
  --red:var(--hs-accent-red);--blue:var(--hs-accent-blue);--yellow:var(--hs-accent-yellow);
  --font-heading:var(--hs-font-heading);
  --font-body:var(--hs-font-body);
  --font-mono:var(--hs-font-mono)}
*{box-sizing:border-box}
body{margin:0;font:15px/1.55 var(--font-body);color:var(--text);background:var(--bg)}
.wrap{max-width:1100px;margin:0 auto;padding:48px 24px 96px}
h1{font-family:var(--font-heading);font-size:clamp(2rem,4vw,2.75rem);font-weight:800;line-height:1.05;letter-spacing:0;color:var(--ink);margin:0 0 4px}
h1::after{content:"";display:block;width:72px;height:4px;margin:18px 0 0;border-radius:999px;background:linear-gradient(90deg,var(--red) 0 33%,var(--blue) 33% 66%,var(--yellow) 66% 100%)}
h2{font-family:var(--font-heading);font-size:clamp(1.2rem,2.2vw,1.4rem);font-weight:800;color:var(--ink);margin:48px 0 14px;padding-bottom:0;border-bottom:0;display:flex;align-items:center;gap:10px}
h2::before{content:"";width:30px;height:6px;border-radius:999px;flex:none;background:linear-gradient(90deg,var(--yellow) 0 33%,var(--red) 33% 66%,var(--blue) 66% 100%)}
a{color:var(--accent)} code{font:12px/1.4 var(--font-mono);background:var(--soft);border:1px solid rgba(122,130,168,.18);color:var(--ink);padding:1px 5px;border-radius:4px}
.muted{color:var(--muted);font-weight:400}.note{color:var(--muted);font-size:13px;margin-bottom:10px}.ok{color:var(--ok)}.small{font-size:13px}
.back{display:inline-block;font-size:13px;margin-bottom:10px}
.card{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:14px 0}
.scorecard .meta{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin-bottom:14px}
.metrics{display:flex;gap:14px;flex-wrap:wrap}.metrics.small .metric{min-width:90px}
.metric{flex:1;min-width:120px;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center}
.metric .num{font-family:var(--font-heading);font-size:30px;font-weight:800;color:var(--ink)}.metric .den{font-size:15px;color:var(--muted)}.metric .lbl{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.warnnum{color:var(--warning)}.blknum{color:var(--blocker)}
table.grid{width:100%;border-collapse:collapse;font-size:13px;background:var(--bg);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.grid th,.grid td{padding:8px 10px;border:0;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.grid th{background:var(--soft);font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
.grid .r{text-align:right}.grid .low{color:var(--blocker);font-weight:700}
.assess{margin-top:10px;font-size:13px;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.assess>div{margin-top:3px}
.swatches{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.swatch{display:flex;align-items:center;gap:6px;font-size:11px;border:1px solid var(--line);border-radius:6px;padding:3px 7px;background:var(--bg)}
.swatch span{width:14px;height:14px;border-radius:3px;border:1px solid var(--line);display:inline-block}
.badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;color:#fff;white-space:nowrap}
.tier-blocker>.badge,.badge.tier-blocker{background:var(--blocker)} .badge.tier-warning{background:var(--warning)} .badge.tier-suggestion{background:var(--suggestion)} .badge.tier-ok{background:var(--ok)}
.chip{display:inline-block;font-size:10px;padding:1px 7px;border-radius:999px;margin:0 4px 4px 0;background:#eef0f4;color:#374151;text-transform:uppercase;letter-spacing:.03em}
.chip-color{background:#fde7e7;color:#b91c1c}.chip-spacing{background:#fef3c7;color:#92400e}.chip-font-size{background:#dbeafe;color:#1d4ed8}.chip-radius{background:#e0e7ff;color:#4338ca}.chip-structure{background:#f3e8ff;color:#7e22ce}
/* homepage page list */
.pagelist{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.pagerow{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 16px;text-decoration:none;color:inherit}
.pagerow:hover{border-color:var(--accent)}
.pr-title{font-family:var(--font-heading);font-weight:700;font-size:15px;color:var(--accent)}.pr-url{font-size:12px;color:var(--muted);word-break:break-all}
.pr-counts{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pc{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}
.pc-blocker{background:#fde7e7;color:#b91c1c}.pc-warning{background:#fef3c7;color:#92400e}.pc-suggestion{background:#dbeafe;color:#1d4ed8}.pc-ok{background:#e8f5ef;color:#047857}
.pr-total{font-size:12px;color:var(--muted);margin-left:4px}
.unify li{margin:4px 0}
/* per-page block cards (fused matrix + findings) */
.block{background:var(--bg);border:1px solid var(--line);border-left-width:5px;border-radius:12px;padding:16px 18px;margin:14px 0}
.block.tier-blocker{border-left-color:var(--blocker)}.block.tier-warning{border-left-color:var(--warning)}.block.tier-suggestion{border-left-color:var(--suggestion)}.block.tier-ok{border-left-color:var(--ok)}
.bhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.btitle{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.bname{font-family:var(--font-heading);font-size:17px;font-weight:800;color:var(--ink)}
.bsel{font-size:11px;color:var(--muted);background:#eef0f4}
.breasons{margin:10px 0}.chips{margin-bottom:6px}
.deltas{margin:6px 0 0;padding-left:18px;font-size:13px}.deltas li{margin:2px 0}
.near{color:var(--ok);font-weight:600}.near code{background:#e8f5ef}
/* full-width before/after */
.ba{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px}
.ba.single{grid-template-columns:1fr}
@media (max-width:720px){.ba{grid-template-columns:1fr}}
.ba figure{margin:0}.ba figcaption{font-size:12px;font-weight:600;margin-bottom:6px}
.ba-now figcaption{color:var(--blocker)}.ba-should figcaption{color:var(--ok)}
/* Natural image height, capped — no fixed-height letterboxing. Screenshots
   shorter than the cap take only their own height; taller ones scroll. */
.pane{max-height:480px;border:1px solid var(--line);border-radius:8px;overflow-y:auto;background:#fff;outline:none}
.pane img{width:100%;height:auto;border:0;display:block}
.pane iframe{width:100%;height:420px;border:0;display:block;outline:none}
.noimg{display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;color:var(--muted);font-size:12px;background:var(--soft)}
.okwrap{margin-top:18px}.okwrap>summary{cursor:pointer;font-weight:600;color:var(--muted)}
.oklist{list-style:none;padding:0;margin:10px 0;display:flex;flex-direction:column;gap:6px;font-size:13px}
.oklist li{display:flex;align-items:center;gap:8px}
/* metrics legend */
.metrics-legend{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 12px;padding:12px 14px;background:var(--soft);border:1px solid var(--line);border-radius:8px}
.ml-item{display:flex;align-items:baseline;gap:8px;font-size:13px}
.ml-label{font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);white-space:nowrap}
.ml-desc{color:var(--ink)}
/* DS comparison metrics */
.mc-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:4px 0 10px;align-items:center}
.mc-cat{border:1px solid var(--line);border-radius:10px;margin:8px 0;background:var(--bg);overflow:hidden}
.mc-sum{padding:11px 16px;cursor:pointer;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:space-between;list-style:none;background:var(--soft);user-select:none}
.mc-sum::-webkit-details-marker{display:none}
.mc-cat[open]>.mc-sum{border-bottom:1px solid var(--line)}
.mc-count{font-weight:400;font-size:12px;color:var(--muted);margin-left:8px}
.mc-tbl{border:none;border-radius:0}
.mc-tbl thead tr th:first-child,.mc-tbl tbody tr td:first-child{padding-left:16px}
.mc-tbl thead tr th:last-child,.mc-tbl tbody tr td:last-child{padding-right:16px}
.mc-id{font-size:11px;color:var(--muted);width:38px;white-space:nowrap}
.mc-name{font-size:13px;font-weight:600;width:220px}
.mc-val{font-size:14px;width:90px;white-space:nowrap}.mc-val b{color:var(--ink)}
.mc-unit{font-size:11px;color:var(--muted);margin-left:1px}
.mc-null{color:var(--muted);font-size:13px}
.mc-st{width:52px;text-align:center}
.mc-desc{font-size:12px;color:var(--muted);line-height:1.4}
.st-ok{color:var(--ok);font-weight:700;font-size:11px}
.st-warn{color:var(--warning);font-weight:700;font-size:11px}
.st-bad{color:var(--blocker);font-weight:700;font-size:11px}
.st-blocker{background:#7f1d1d;color:#fff;border-radius:3px;padding:1px 5px;font-size:.75rem;font-weight:700}
.st-info{color:var(--accent);font-size:11px}
.gates{margin:8px 0;display:flex;flex-direction:column;gap:4px}
.gate-warn{background:#7f1d1d22;border-left:3px solid #dc2626;padding:4px 8px;font-size:.8rem;color:#dc2626;border-radius:0 4px 4px 0}
`;

function htmlShell(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700;800&display=swap">
<style>${readHouseCss()}</style><style>${CSS}</style></head>
<body><div class="wrap">${body}</div></body></html>`;
}

// ── assemble homepage ─────────────────────────────────────────────────────────
const homeBody = `
  <h1>Design-system audit</h1>
  <div class="note">${esc(new Date().toISOString().slice(0, 10))} · ${esc(summary.source || (dsStats.source === 'synthesized' ? 'audited design' : ''))}</div>
  ${scorecard()}

  <h2>Design-system review</h2>
  <p>${dsLine()}</p>
  ${qualityTable()}

  ${metricsSection()}

  <h2>Pages</h2>
  <p class="note">Each page lists only its own blocks. Open a page to see every drifting block as a card — the block as it looks now next to how it should look. Ordered worst-first.</p>
  ${pageList()}

  <h2>Unify these (near-duplicate components)</h2>
  ${unify()}`;

fs.writeFileSync(path.join(OUT, 'audit-report.html'), htmlShell('Design-system audit', homeBody));

let pageCount = 0;
for (const [page, blocks] of byPage) {
  fs.writeFileSync(path.join(OUT, pageFile.get(page)), pageDoc(page, blocks));
  pageCount++;
}

console.error('ds-audit-report: wrote audit-report.html + ' + pageCount + ' page file(s) ('
  + clusters.length + ' clusters, ' + deviations.length + ' findings, ' + blockStatus.length + ' blocks)');
