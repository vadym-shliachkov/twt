#!/usr/bin/env node
// gen-preview.mjs — deterministic generator for the design-system preview.html.
//
// The design-system preview used to be hand-written by the MODEL on every run,
// which made it (a) drift in structure between projects and (b) hit recurring
// CSS-class collisions (e.g. a `.chip` swatch class colliding with the `.chip`
// tag-atom class, collapsing every color block — the original bug this fixes).
// This script renders the styleguide from tokens.css so it is byte-for-byte
// consistent across projects and the color blocks can never collapse: every
// class is namespaced `gp-`.
//
//   node gen-preview.mjs <projectDir> [--mode tokens-only] [--check]
//     <projectDir>  target project root (reads .twt-artifacts/design/design-system/)
//     --mode tokens-only   render only Tier 1 (for design-system mode 5)
//     --check       compute + print the contrast JSON only; do NOT write preview.html
//                   (read-only mode for /twt-design-system-validate, which must not
//                    modify artifacts — gives it deterministic contrast evidence)
//
// Reads:
//   .twt-artifacts/design/design-system/tokens.css   (authoritative custom props)
//   .twt-artifacts/design/design-system/components.md (preferred component inventory)
//   .twt-artifacts/design/design-system/tokens.md     (fallback inventory — §3.2/3.3/3.4)
//
// Writes:
//   .twt-artifacts/design/design-system/preview.html
//
// Tiers use the project's tech vocabulary: Tokens → Primitives → Components → Modules
// (the atomic-design hierarchy, relabelled). Tier 1 (Tokens) and the WCAG contrast
// matrix are 100% scripted. Tiers 2–4 are scripted SHELLS — one captioned cell per
// inventory item with a `<!-- gp:fill <Name> -->` slot the model fills with the
// project-specific specimen markup. The script never guesses component markup.
//
// Also prints a ```json block to stdout (qa-scan style) with the contrast results
// so the calling skill can read AA failures without re-parsing the HTML. Exit 0
// always (evidence, not pass/fail); exit 2 on bad usage.
'use strict';

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const projectDir = process.argv[2];
const tokensOnly = process.argv.includes('--mode') &&
  process.argv[process.argv.indexOf('--mode') + 1] === 'tokens-only';
const checkOnly = process.argv.includes('--check');
// preview.html now documents TOKENS ONLY by default; the full
// Primitives/Components/Modules catalog lives in the component gallery
// (/twt-component-define → component/gallery.html), which preview links to.
// Pass --with-components to also inline the component shells (legacy behavior).
const withComponents = process.argv.includes('--with-components') && !tokensOnly;
// Where the component gallery lives, relative to preview.html.
// gallery.html is written into design-system/component/ (same folder as preview.html → no ../).
const COMPONENTS_HREF = 'component/gallery.html';
if (!projectDir) {
  console.error('usage: gen-preview.mjs <projectDir> [--mode tokens-only]');
  process.exit(2);
}
const DS = join(projectDir, '.twt-artifacts', 'design', 'design-system');
const CSS = join(DS, 'tokens.css');
const COMPONENTS_MD = join(DS, 'components.md');
const TOKENS_MD = join(DS, 'tokens.md');
const OUT = join(DS, 'preview.html');

if (!existsSync(CSS)) {
  console.log(`gen-preview: no tokens.css at ${CSS} — nothing to render. Run design-system first.`);
  process.exit(0);
}

// ---- CSS custom-property parsing --------------------------------------------
const cssText = readFileSync(CSS, 'utf8');
// strip comments
const noComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
// Collect the BASE :root declarations (ignore @media overrides for resolution —
// colors don't change responsively; we want the canonical value).
const vars = new Map(); // name -> raw value (first/base definition wins)
const order = [];       // preserve source order for the swatch grid
// match the first :root { ... } block's contents, then any others, but skip
// blocks nested under @media (those come after a `@media (...) {` token).
const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
// Determine which declarations live inside an @media — naive but effective:
// split on @media and only take the segment before the first @media for base,
// then still register media-only vars if not already present.
const segments = noComments.split(/@media[^{]*\{/);
for (let i = 0; i < segments.length; i++) {
  let m;
  declRe.lastIndex = 0;
  while ((m = declRe.exec(segments[i])) !== null) {
    const name = m[1].trim();
    const val = m[2].trim().replace(/\s+/g, ' ');
    if (!vars.has(name)) { vars.set(name, val); order.push(name); }
  }
}

// resolve var() chains to a concrete value
function resolveVal(val, depth = 0) {
  if (depth > 12 || !val) return val;
  return val.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, ref, fallback) => {
    if (vars.has(ref)) return resolveVal(vars.get(ref), depth + 1);
    return fallback ? resolveVal(fallback.trim(), depth + 1) : `var(${ref})`;
  });
}

// ---- color parsing + WCAG contrast ------------------------------------------
function parseColor(v) {
  if (!v) return null;
  v = v.trim();
  let m;
  if ((m = v.match(/^#([0-9a-f]{3,8})$/i))) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 4) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  if ((m = v.match(/^rgba?\(([^)]+)\)$/i))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    const r = +p[0], g = +p[1], b = +p[2];
    const a = p[3] !== undefined ? +p[3] : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a };
  }
  return null; // hsl/gradients/keywords not used for ratio math
}
function isGradient(v) { return /gradient\s*\(/i.test(v || ''); }
function composite(fg, bg) { // fg over bg, both {r,g,b,a}
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}
function relLum({ r, g, b }) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fgRaw, bgRaw) {
  const bg = bgRaw.a < 1 ? composite(bgRaw, { r: 255, g: 255, b: 255, a: 1 }) : bgRaw;
  const fg = fgRaw.a < 1 ? composite(fgRaw, bg) : fgRaw;
  const L1 = relLum(fg), L2 = relLum(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---- categorize tokens ------------------------------------------------------
const colorTokens = [], gradientTokens = [];
const fsTokens = [], lhTokens = new Map(), fwTokens = [], trackTokens = [], fontTokens = [];
const spaceTokens = [], radiusTokens = [], shadowTokens = [];
const durTokens = [], easeTokens = [], gridTokens = [];

for (const name of order) {
  const raw = vars.get(name);
  const resolved = resolveVal(raw);
  if (/^--(lh|line-height)/.test(name)) { lhTokens.set(name, resolved); continue; }
  if (/^--(fs|font-size)/.test(name)) { fsTokens.push({ name, raw, resolved }); continue; }
  if (/^--(fw|font-weight)/.test(name)) { fwTokens.push({ name, resolved }); continue; }
  if (/^--(tracking|letter-spacing)/.test(name)) { trackTokens.push({ name, resolved }); continue; }
  if (/^--(font|f)$/.test(name) || /^--font(-family)?/.test(name)) { fontTokens.push({ name, resolved }); continue; }
  if (/^--(space|spacing|gap)-/.test(name)) { spaceTokens.push({ name, resolved }); continue; }
  if (/^--(r$|rl$|radius)/.test(name)) { radiusTokens.push({ name, resolved }); continue; }
  if (/^--shadow/.test(name)) { shadowTokens.push({ name, resolved }); continue; }
  if (/^--(dur|duration)/.test(name)) { durTokens.push({ name, resolved }); continue; }
  if (/^--ease/.test(name)) { easeTokens.push({ name, resolved }); continue; }
  if (/^--(max|bp-|breakpoint|grid|container|gutter)/.test(name)) { gridTokens.push({ name, resolved }); continue; }
  if (isGradient(resolved)) { gradientTokens.push({ name, raw, resolved }); continue; }
  const c = parseColor(resolved);
  if (c) { colorTokens.push({ name, raw, resolved, color: c }); continue; }
}

// ---- contrast matrix --------------------------------------------------------
const TEXT_HINT = /text|heading|label|body|ink|foreground|\bfg\b|on-dark|on-light|caption|muted/i;
const SURFACE_HINT = /surface|background|\bbg\b|\bpage\b|panel|card|white|canvas|base|hero/i;
// Prefer role-alias tokens; dedupe by resolved value so --color-heading and --ink
// (same hex) don't both clutter the matrix — keep the role-named one.
function pickSet(hint) {
  const byVal = new Map();
  for (const t of colorTokens) {
    if (!hint.test(t.name)) continue;
    if (t.color.a === 0) continue;
    const key = `${Math.round(t.color.r)},${Math.round(t.color.g)},${Math.round(t.color.b)},${t.color.a}`;
    const existing = byVal.get(key);
    // prefer a role-alias name (has a hyphen role like color-/on-/surface-) over a raw brand token
    const isRole = (n) => /^--(color|on|surface|text|bg|background)-/.test(n);
    if (!existing || (isRole(t.name) && !isRole(existing.name))) byVal.set(key, t);
  }
  return [...byVal.values()];
}
const textSet = pickSet(TEXT_HINT);
const surfaceSet = pickSet(SURFACE_HINT);

// Build the matrix only for INTENDED polarity pairs (dark text on light surface,
// or light text on dark surface). A dark-on-dark pair is not a real pairing, so
// it is reported as n/a rather than a false FAIL.
const contrastRows = [];
const failures = [];
for (const s of surfaceSet) {
  const sBg = s.color.a < 1 ? composite(s.color, { r: 255, g: 255, b: 255, a: 1 }) : s.color;
  const surfaceLight = relLum(sBg) > 0.5;
  for (const t of textSet) {
    const tComp = t.color.a < 1 ? composite(t.color, sBg) : t.color;
    const textDark = relLum(tComp) <= 0.5;
    const intended = surfaceLight === textDark; // dark text on light, or light text on dark
    const r = ratio(t.color, s.color);
    const aaNormal = r >= 4.5, aaLarge = r >= 3.0;
    const row = {
      text: t.name, surface: s.name, ratio: Math.round(r * 100) / 100,
      intended, aa_normal: aaNormal, aa_large: aaLarge,
      verdict: !intended ? 'n/a' : aaNormal ? 'AA' : aaLarge ? 'AA-large-only' : 'FAIL',
    };
    contrastRows.push(row);
    if (intended && !aaNormal) failures.push(row);
  }
}

// ---- color palette split: primitive (raw value) vs semantic (var() alias) ---
const primitiveColors = colorTokens.filter((t) => !/^\s*var\s*\(/.test(t.raw));
const semanticColors  = colorTokens.filter((t) =>  /^\s*var\s*\(/.test(t.raw));
// Sort primitives lightest → darkest so the palette reads as a tonal ramp.
primitiveColors.sort((a, b) => relLum(b.color) - relLum(a.color));

// Near-duplicate detection within the primitive palette (Euclidean RGB distance).
// Two colors within 22/255 (~8.6%) are visually near-identical and flag a
// consolidation opportunity (e.g. --color-bg-section vs --color-accent-pale).
function rgbDist(c1, c2) {
  return Math.sqrt((c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2);
}
const NEAR_DUP_DIST = 22;
const primNearDups = new Map();
for (let i = 0; i < primitiveColors.length; i++) {
  for (let j = i + 1; j < primitiveColors.length; j++) {
    if (rgbDist(primitiveColors[i].color, primitiveColors[j].color) <= NEAR_DUP_DIST) {
      const na = primitiveColors[i].name, nb = primitiveColors[j].name;
      if (!primNearDups.has(na)) primNearDups.set(na, []);
      if (!primNearDups.has(nb)) primNearDups.set(nb, []);
      primNearDups.get(na).push(nb);
      primNearDups.get(nb).push(na);
    }
  }
}

// Semantic token grouping by purpose — ordered so the most common groups appear first.
const SEM_GROUPS = [
  { key: 'bg',     label: 'Background & Surface', re: /\b(bg|background|surface|canvas|page|section)\b/i },
  { key: 'text',   label: 'Text & Ink',            re: /\b(text|ink|body|label|heading|caption|muted|on)\b/i },
  { key: 'border', label: 'Border & Rule',         re: /\b(border|rule|divide|separator|outline|line)\b/i },
  { key: 'accent', label: 'Accent & Brand',        re: /\b(accent|brand|primary|secondary|cta|interactive|link)\b/i },
  { key: 'state',  label: 'State & Feedback',      re: /\b(active|focus|hover|disabled|error|success|warning|danger|info|alert)\b/i },
];
const semBuckets = new Map([...SEM_GROUPS.map((g) => [g.key, []]), ['other', []]]);
for (const t of semanticColors) {
  let placed = false;
  for (const g of SEM_GROUPS) { if (g.re.test(t.name)) { semBuckets.get(g.key).push(t); placed = true; break; } }
  if (!placed) semBuckets.get('other').push(t);
}

function swatchPrimitive(t) {
  const dups = primNearDups.get(t.name);
  const dupTag = dups && dups.length
    ? `<span class="gp-dup">≈ near-dup: ${dups.map((n) => esc(n)).join(', ')}</span>` : '';
  return `<div class="gp-sw">` +
    `<div class="gp-chip" style="background:var(${t.name})"></div>` +
    `<div class="gp-meta"><b>${esc(t.name)}</b><span>${esc(t.resolved)}</span>${dupTag}</div></div>`;
}
function swatchSemantic(t) {
  const am = t.raw.match(/var\(\s*(--[\w-]+)\s*\)/);
  return `<div class="gp-sw gp-sw-sem">` +
    `<div class="gp-chip" style="background:var(${t.name})"></div>` +
    `<div class="gp-meta"><b>${esc(t.name)}</b><span>${esc(t.resolved)}</span>` +
    (am ? `<span class="gp-alias">→ ${esc(am[1])}</span>` : '') +
    `</div></div>`;
}
function renderColorSection() {
  const primHtml = `
  <h4 class="gp-sub2">Basic palette <span class="gp-cnt">${primitiveColors.length} raw colors</span></h4>
  <p class="gp-legend">All unique raw color values on this site, sorted lightest → darkest. Every semantic token below references one of these. Near-identical primitives are flagged — consider consolidating.</p>
  <div class="gp-swatches">${primitiveColors.map(swatchPrimitive).join('')}${gradientTokens.map(gradientSwatch).join('')}</div>`;
  if (!semanticColors.length) return primHtml;
  const semHtml = [...SEM_GROUPS.map((g) => ({ label: g.label, items: semBuckets.get(g.key) })), { label: 'Other', items: semBuckets.get('other') }]
    .filter((g) => g.items.length > 0)
    .map((g) => `<h5 class="gp-sub3">${esc(g.label)}</h5><div class="gp-swatches">${g.items.map(swatchSemantic).join('')}</div>`)
    .join('');
  return primHtml + `
  <h4 class="gp-sub2">Semantic tokens by purpose <span class="gp-cnt">${semanticColors.length} aliases</span></h4>
  <p class="gp-legend">Purpose-mapped aliases — each → shows which basic palette color it references. All semantic tokens reuse primitives; no new raw values are introduced here.</p>
  ${semHtml}`;
}

// ---- component inventory (Tiers 2–4) ----------------------------------------
// Parse the first-column bold names + composition note from the §3.2/3.3/3.4
// tables of components.md (preferred) or tokens.md (fallback). Section numbers
// are stable across the Tokens→Primitives→Components→Modules relabelling.
function parseInventory() {
  const file = existsSync(COMPONENTS_MD) ? COMPONENTS_MD : existsSync(TOKENS_MD) ? TOKENS_MD : null;
  if (!file) return { primitives: [], components: [], modules: [] };
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const buckets = { '3.2': [], '3.3': [], '3.4': [] };
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^###\s+(3\.[234])\b/);
    if (h) { cur = h[1]; continue; }
    if (/^###\s+3\.[1567]\b/.test(line) || /^##\s+4\b/.test(line)) cur = null;
    if (!cur) continue;
    const row = line.match(/^\|\s*\*\*([^*]+)\*\*\s*\|([^|]*)\|/);
    if (row) buckets[cur].push({ name: row[1].trim(), note: row[2].trim().replace(/`/g, '') });
  }
  return { primitives: buckets['3.2'], components: buckets['3.3'], modules: buckets['3.4'] };
}
const inv = parseInventory();

// ---- HTML rendering ---------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const projName = (() => {
  const m = existsSync(TOKENS_MD) ? readFileSync(TOKENS_MD, 'utf8').match(/^#\s+Design System\s*[—-]\s*(.+)$/m) : null;
  return m ? m[1].trim() : 'Project';
})();

function swatch(t) {
  const val = t.resolved;
  return `<div class="gp-sw"><div class="gp-chip" style="background:var(${t.name})"></div>` +
    `<div class="gp-meta"><b>${esc(t.name)}</b><span>${esc(val)}${t.raw !== val ? ' · ' + esc(t.raw) : ''}</span></div></div>`;
}
function gradientSwatch(t) {
  return `<div class="gp-sw"><div class="gp-chip" style="background:var(${t.name})"></div>` +
    `<div class="gp-meta"><b>${esc(t.name)}</b><span>gradient</span></div></div>`;
}

const tier1 = `
<section class="gp-tier" id="gp-tokens">
  <p class="gp-tag">Tier 1</p><h2 class="gp-th">Tokens</h2>
  <p class="gp-legend">The subatomic particles — every design token, rendered live from <code>tokens.css</code>. Everything above is built only from these.</p>

  <h3 class="gp-sub">Color</h3>
  ${renderColorSection()}

  <h3 class="gp-sub">Contrast (WCAG, intended text/surface pairs)</h3>
  ${renderContrast()}

  <h3 class="gp-sub">Typography</h3>
  <div class="gp-type">${fsTokens.map(renderType).join('')}</div>
  ${fontTokens.length ? `<p class="gp-legend">Families: ${fontTokens.map((f) => `<code>${esc(f.name)}</code> ${esc(f.resolved)}`).join(' · ')}</p>` : ''}
  ${fwTokens.length ? `<p class="gp-legend">Weights: ${fwTokens.map((f) => `${esc(f.name)} (${esc(f.resolved)})`).join(' · ')}</p>` : ''}
  ${trackTokens.length ? `<p class="gp-legend">Tracking: ${trackTokens.map((f) => `${esc(f.name)} ${esc(f.resolved)}`).join(' · ')}</p>` : ''}

  <h3 class="gp-sub">Spacing</h3>
  <div>${spaceTokens.map(renderSpace).join('')}</div>

  <h3 class="gp-sub">Radius</h3>
  <div class="gp-tiles">${radiusTokens.map((t) => `<div class="gp-tile" style="border-radius:var(${t.name})"><span>${esc(t.name)} · ${esc(t.resolved)}</span></div>`).join('')}</div>

  <h3 class="gp-sub">Shadows</h3>
  <div class="gp-tiles">${shadowTokens.map((t) => `<div class="gp-shadowtile" style="box-shadow:var(${t.name})"><span>${esc(t.name)}</span></div>`).join('')}</div>

  <h3 class="gp-sub">Motion</h3>
  <div class="gp-motion">${durTokens.map((t) => `<div class="gp-mo" style="transition-duration:var(${t.name})"><span>${esc(t.name)} · ${esc(t.resolved)}</span></div>`).join('')}</div>
  ${easeTokens.length ? `<p class="gp-legend">Easings: ${easeTokens.map((e) => `<code>${esc(e.name)}</code>`).join(' · ')}</p>` : ''}

  <h3 class="gp-sub">Grid &amp; breakpoints</h3>
  <ul class="gp-grid">${gridTokens.map((t) => `<li><code>${esc(t.name)}</code> — ${esc(t.resolved)}</li>`).join('')}</ul>
</section>`;

function renderType(t) {
  const lhName = t.name.replace(/^--fs/, '--lh').replace(/^--font-size/, '--line-height');
  const lh = lhTokens.has(lhName) ? `line-height:var(${lhName});` : '';
  return `<div class="gp-spec"><span class="gp-spec-label">${esc(t.name)} · ${esc(t.resolved)}</span>` +
    `<div style="font-size:var(${t.name});${lh}">Ag — the quick brown fox</div></div>`;
}
// Resolve a length token to a pixel number so the spacing bars have real,
// distinguishable widths. Most projects express spacing in rem/em (e.g.
// `0.25rem`…`6.25rem`); the old px-only check fell through to width:100% for
// every one of them, so all bars rendered identical full-width translucent
// blocks (the "weird spacing" bug). Handle px/rem/em/pt and clamp the drawn
// width so an outsized step (e.g. --space-hero) doesn't overflow the row.
function lengthToPx(val) {
  const m = String(val).trim().match(/^(-?\d*\.?\d+)\s*(px|rem|em|pt)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'px').toLowerCase();
  if (unit === 'rem' || unit === 'em') return n * 16;
  if (unit === 'pt') return n * (96 / 72);
  return n;
}
function renderSpace(t) {
  const SPACE_BAR_MAX = 520; // px — drawn-width cap so big steps stay in the row
  const px = lengthToPx(t.resolved);
  const w = px != null
    ? `width:${Math.max(1, Math.min(px, SPACE_BAR_MAX))}px`
    : 'width:100%;opacity:.5';
  const over = px != null && px > SPACE_BAR_MAX ? ' <span class="gp-bar-over">(clamped)</span>' : '';
  return `<div class="gp-bar-row"><span>${esc(t.name)} · ${esc(t.resolved)}${over}</span><div class="gp-bar" style="${w}"></div></div>`;
}
function renderContrast() {
  if (!textSet.length || !surfaceSet.length) return `<p class="gp-legend">No text/surface token roles detected to pair.</p>`;
  const rows = contrastRows.filter((r) => r.intended).sort((a, b) => a.ratio - b.ratio);
  const cls = (v) => v === 'AA' ? 'gp-pass' : v === 'AA-large-only' ? 'gp-warn' : v === 'FAIL' ? 'gp-fail' : 'gp-na';
  const body = rows.map((r) => `<tr><td><code>${esc(r.text)}</code></td><td><code>${esc(r.surface)}</code></td>` +
    `<td>${r.ratio}:1</td><td class="${cls(r.verdict)}">${r.verdict}</td></tr>`).join('');
  const note = failures.length
    ? `<p class="gp-legend gp-fail"><b>${failures.length} AA failure(s)</b> for normal-size text — fix before build (darken the text token or lighten the surface).</p>`
    : `<p class="gp-legend gp-pass">All intended text/surface pairings meet WCAG AA for normal text.</p>`;
  return `<table class="gp-ct"><thead><tr><th>Text</th><th>Surface</th><th>Ratio</th><th>WCAG</th></tr></thead><tbody>${body}</tbody></table>${note}`;
}

// `wide` (used for Modules / Tier 4): modules are full-section compositions —
// rendering them in the same narrow auto-fill grid as primitives/components
// squeezes a hero/footer/CTA-band into a ~280px cell where it cannot be judged.
// Wide mode lays them out one-per-row at full container width with room to breathe.
function tierShells(title, tier, items, kind, wide = false) {
  if (!items.length) return `<section class="gp-tier"><p class="gp-tag">${tier}</p><h2 class="gp-th">${title}</h2><p class="gp-legend">No ${kind} documented in §3.</p></section>`;
  const cellCls = wide ? 'gp-cell gp-cell-wide' : 'gp-cell';
  // Wide (module) cells put the label on top so the full-width specimen reads as the body;
  // narrow (primitive/component) cells keep the label beneath the specimen as before.
  const cell = (it) => wide
    ? `<div class="${cellCls}" data-component="${esc(it.name)}">\n` +
      `      <span class="gp-cap gp-cap-top"><b>${esc(it.name)}</b>${it.note ? ' — ' + esc(it.note) : ''}</span>\n` +
      `      <!-- gp:fill ${esc(it.name)} — render one neutral specimen built only from var(--…) tokens; replace this comment -->\n` +
      `    </div>`
    : `<div class="${cellCls}" data-component="${esc(it.name)}">\n` +
      `      <!-- gp:fill ${esc(it.name)} — render one neutral specimen built only from var(--…) tokens; replace this comment -->\n` +
      `      <span class="gp-cap"><b>${esc(it.name)}</b>${it.note ? ' — ' + esc(it.note) : ''}</span>\n` +
      `    </div>`;
  const cells = items.map(cell).join('\n    ');
  const invCls = wide ? 'gp-inv gp-inv-wide' : 'gp-inv';
  return `<section class="gp-tier"><p class="gp-tag">${tier}</p><h2 class="gp-th">${esc(title)}</h2>` +
    `<p class="gp-legend">${items.length} ${kind}, each composed from the tier${tier === 'Tier 2' ? ' below (Tokens)' : ' below'}. Neutral specimens only — not the real site.${wide ? ' Each module spans the full width so its real proportions can be evaluated.' : ''}</p>` +
    `<div class="${invCls}">\n    ${cells}\n  </div></section>`;
}

const tiers234 = withComponents ? [
  tierShells('Primitives', 'Tier 2', inv.primitives, 'primitives'),
  tierShells('Components', 'Tier 3', inv.components, 'components'),
  tierShells('Modules', 'Tier 4', inv.modules, 'modules', true),
].join('\n') : '';

// A prominent pointer to the component gallery (the breadth/depth catalog),
// since preview.html no longer inlines the component shells by default.
const compCount = inv.primitives.length + inv.components.length + inv.modules.length;
const componentsLink = withComponents ? '' : `
  <div class="gp-complink">
    <span><b>Components</b> — ${compCount ? compCount + ' documented ' : ''}Primitives · Components · Modules live in the component gallery, built from these tokens. This sheet stays tokens-only.</span>
    <a href="${esc(COMPONENTS_HREF)}">Open component gallery →</a>
  </div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(projName)} — Design System Preview</title>
<link rel="stylesheet" href="tokens.css">
<style>
  /* gen-preview.mjs — all classes namespaced gp- to avoid collisions.
     Chrome (layout, labels, legends) uses the doc-hub light palette so every
     project's preview looks consistent. Token specimens use var(--…) from the
     project's own tokens.css (linked above). */
  body{margin:0;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#101214;background:#f7f3e8;line-height:1.6}
  .gp-wrap{max-width:1120px;margin:0 auto;padding:0 24px}
  .gp-head{padding:48px 0 8px}
  .gp-head h1{margin:0 0 8px;font-size:2rem;font-weight:700;color:#101214}
  .gp-tier{padding:48px 0;border-top:1px solid rgba(16,18,20,.14)}
  .gp-tag{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:#363b42;margin:0 0 4px;font-weight:600}
  .gp-th{font-size:1.6rem;margin:0 0 8px;color:#101214;font-weight:700}
  .gp-sub{font-size:1rem;margin:32px 0 12px;text-transform:uppercase;letter-spacing:.08em;color:#363b42}
  .gp-legend{font-size:.85rem;color:#363b42;max-width:110ch;line-height:1.55}
  .gp-legend code{font-family:ui-monospace,Menlo,monospace;font-size:.85em;background:rgba(16,18,20,.07);padding:1px 5px;border-radius:3px}
  .gp-bar-over{color:#363b42;font-style:italic}
  .gp-complink{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:8px 0 0;padding:18px 22px;border:1px solid rgba(16,18,20,.16);border-radius:12px;background:rgba(16,18,20,.04)}
  .gp-complink b{font-size:1rem;color:#101214}
  .gp-complink a{display:inline-block;padding:9px 16px;border-radius:8px;background:#101214;color:#f7f3e8;text-decoration:none;font-size:.85rem;font-weight:600;white-space:nowrap}
  .gp-swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px}
  .gp-sw{border:1px solid rgba(16,18,20,.14);border-radius:8px;overflow:hidden}
  .gp-chip{display:block;height:72px;width:100%}
  .gp-meta{padding:8px 10px;font-size:.78rem;background:#fff}
  .gp-meta b{display:block;color:#101214}
  .gp-meta span{color:#363b42;word-break:break-all;display:block}
  /* color palette hierarchy */
  .gp-sub2{font-size:.88rem;margin:24px 0 6px;font-weight:700;color:#363b42}
  .gp-sub3{font-size:.75rem;margin:16px 0 5px;text-transform:uppercase;letter-spacing:.07em;color:#363b42}
  .gp-cnt{font-size:.72rem;font-weight:400;letter-spacing:0;color:rgba(16,18,20,.45);margin-left:6px}
  .gp-alias{font-size:.72rem;color:#363b42;font-style:italic;margin-top:2px}
  .gp-dup{display:block;font-size:.7rem;color:#b45309;margin-top:3px}
  .gp-sw-sem{opacity:.95}
  .gp-ct{border-collapse:collapse;font-size:.82rem;margin:8px 0}
  .gp-ct th,.gp-ct td{border:1px solid rgba(16,18,20,.14);padding:6px 10px;text-align:left}
  .gp-ct th{background:rgba(16,18,20,.04);font-weight:600;color:#101214}
  .gp-pass{color:#1a7f37}.gp-warn{color:#9a6700}.gp-fail{color:#c01724}.gp-na{color:#363b42}
  .gp-type{display:grid;gap:16px}
  .gp-spec-label{display:block;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:#363b42;margin-bottom:4px}
  .gp-bar-row{display:flex;align-items:center;gap:16px;margin-bottom:8px}
  .gp-bar-row span{font-size:.8rem;color:#363b42;min-width:200px}
  .gp-bar{background:#101214;height:14px;border-radius:2px}
  .gp-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:16px}
  .gp-tile,.gp-shadowtile{height:88px;display:flex;align-items:flex-end;justify-content:center;padding:8px;font-size:.75rem;color:#363b42}
  .gp-tile{background:rgba(16,18,20,.06);border:1px solid rgba(16,18,20,.12)}
  .gp-shadowtile{background:#fff;border-radius:12px}
  .gp-motion{display:flex;gap:16px;flex-wrap:wrap}
  .gp-mo{height:60px;flex:1;min-width:140px;background:rgba(16,18,20,.06);border-radius:8px;display:flex;align-items:flex-end;padding:8px;font-size:.75rem;color:#363b42;transition-property:transform;transition-timing-function:ease}
  .gp-mo:hover{transform:translateY(-6px)}
  .gp-grid{font-size:.85rem;color:#363b42}
  .gp-inv{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
  /* Modules (Tier 4): one per row, full container width, taller */
  .gp-inv-wide{display:block}
  .gp-cell{border:1px solid rgba(16,18,20,.14);border-radius:12px;padding:20px;background:#fff}
  .gp-cell-wide{width:100%;margin-bottom:24px;padding:28px}
  .gp-cap{display:block;margin-top:12px;font-size:.78rem;color:#363b42}
  .gp-cap-top{margin-top:0;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid rgba(16,18,20,.12)}
  .gp-cap b{color:#101214}
</style>
</head>
<body>
<div class="gp-wrap">
  <header class="gp-head">
    <h1>${esc(projName)} — Design System</h1>
    <p class="gp-legend">Token specimen sheet (not the site) — every design token rendered live from <code>tokens.css</code>${withComponents ? ', followed by neutral Primitive/Component/Module specimens' : ''}. The full component catalog (breadth + variant × state depth) lives in the component gallery. Generated by <code>gen-preview.mjs</code>.</p>
  </header>
  ${componentsLink}
  ${tier1}
  ${tiers234}
  <section class="gp-tier">
    <p class="gp-legend">Component catalog → <code>${esc(COMPONENTS_HREF)}</code> (run /twt-component-define if absent). Templates &amp; Pages → /twt-layout-define and /twt-mockup-define.</p>
  </section>
</div>
</body>
</html>`;

if (!checkOnly) writeFileSync(OUT, html);

// ---- machine-readable summary to stdout (qa-scan style) ---------------------
const summary = {
  tool: 'gen-preview',
  mode: checkOnly ? 'check' : 'write',
  out: checkOnly ? null : OUT,
  counts: {
    colors: colorTokens.length, gradients: gradientTokens.length,
    type_steps: fsTokens.length, spacing: spaceTokens.length,
    radius: radiusTokens.length, shadows: shadowTokens.length,
    primitives: inv.primitives.length, components: inv.components.length, modules: inv.modules.length,
    contrast_pairs: contrastRows.filter((r) => r.intended).length,
    contrast_aa_failures: failures.length,
  },
  contrast_failures: failures,
};
console.log(`gen-preview${checkOnly ? ' (check)' : ': wrote preview.html'} — ${colorTokens.length} colors, ${inv.primitives.length}+${inv.components.length}+${inv.modules.length} components, ${failures.length} AA contrast failure(s).`);
console.log('```json');
console.log(JSON.stringify(summary, null, 2));
console.log('```');
process.exit(0);
