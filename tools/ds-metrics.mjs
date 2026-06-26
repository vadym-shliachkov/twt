#!/usr/bin/env node
// ds-metrics.mjs — Design System vs Site comparison metrics (14 categories, ~90 computed metrics).
//
// Reads audit.json, tokens.css, and pages/*.html (already crawled) — zero new
// network calls. Computes every metric that static HTML/CSS analysis can support;
// marks others as null with a note. Writes metrics.json to the audit output dir
// for consumption by ds-audit-report.mjs.
//
// Usage: node ds-metrics.mjs --out <auditDir> [--tokens <tokens.css>]

import fs from 'node:fs';
import path from 'node:path';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2); const n = argv[i + 1];
    if (!n || n.startsWith('--')) flags[k] = true; else { flags[k] = n; i++; }
  }
}
const OUT = flags.out ? String(flags.out) : '.twt-artifacts/design/design-system-audit';
const TOKENS_PATH = flags.tokens ? String(flags.tokens) : null;

// ── load inputs ──────────────────────────────────────────────────────────────
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

const audit = readJson(path.join(OUT, 'audit.json'));
if (!audit) { console.error('ds-metrics: audit.json not found in ' + OUT); process.exit(1); }
const quality = readJson(path.join(OUT, 'quality.json'));

const qs = audit.quality_signals || {};
const ds = audit.ds_stats || {};
const deviations = audit.deviations || [];
const summary = audit.summary || {};

const tokensCss = TOKENS_PATH && fs.existsSync(TOKENS_PATH) ? fs.readFileSync(TOKENS_PATH, 'utf8') : null;

// Read all crawled page HTML + inline CSS
const pagesDir = path.join(OUT, 'pages');
let allSiteCss = '';
let allSiteHtml = '';
let inlineStyleCount = 0;
let importantCount = 0;
if (fs.existsSync(pagesDir)) {
  for (const f of fs.readdirSync(pagesDir).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(pagesDir, f), 'utf8');
    allSiteHtml += html;
    const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi; let m;
    while ((m = styleRe.exec(html))) allSiteCss += m[1] + '\n';
  }
  // inline style= attributes
  inlineStyleCount = (allSiteHtml.match(/\bstyle\s*=\s*["'][^"']+["']/gi) || []).length;
  // !important
  importantCount = (allSiteCss.match(/!important/gi) || []).length;
}

// ── colour helpers ────────────────────────────────────────────────────────────
const COLOR_RE = /(?:^|[\s;{,])#([0-9a-f]{3,8})\b|(?:^|[\s;{,])(rgba?\([^)]+\)|hsla?\([^)]+\))/gi;
function parseHex(h) {
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbDist(a, b) { return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2); }

function extractColors(css) {
  const seen = new Set();
  let m;
  const re = new RegExp(COLOR_RE.source, 'gi');
  while ((m = re.exec(css))) { const v = (m[1] ? '#' + m[1] : m[2] || '').toLowerCase().trim(); if (v) seen.add(v); }
  return [...seen];
}

// ── length extraction by CSS property ────────────────────────────────────────
const NUM_RE = /(-?\d*\.?\d+(?:px|rem|em|vh|vw|%))/g;
function vals(css, propRe) {
  const seen = new Set();
  const full = new RegExp(propRe.source + '\\s*:\\s*([^;{}]+)', 'gi'); let m;
  while ((m = full.exec(css))) {
    for (const v of (m[1].match(NUM_RE) || [])) seen.add(v.toLowerCase());
  }
  return [...seen];
}
function uniq(arr) { return [...new Set(arr.map((s) => String(s).toLowerCase().trim()))]; }

// ── token parsing (per-category) ─────────────────────────────────────────────
function parseTokensByCategory(css) {
  if (!css) return { colors: [], fontSizes: [], spacings: [], lineHeights: [], fontWeights: [], letterSpacings: [], radii: [], shadows: [], borderWidths: [], all: [] };
  const out = { colors: [], fontSizes: [], spacings: [], lineHeights: [], fontWeights: [], letterSpacings: [], radii: [], shadows: [], borderWidths: [], all: [] };
  const seen = new Set();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi; let m;
  while ((m = re.exec(css))) {
    const name = m[1].toLowerCase(), val = m[2].trim().toLowerCase();
    if (seen.has(name)) continue; seen.add(name);
    out.all.push({ name, val });
    const c = /color|brand|ink|\bbg\b|background|\bfg\b|foreground|surface|accent|border|fill|swatch/.test(name) || /^#|^rgb|^hsl/.test(val);
    const r = /radius|corner|rounded/.test(name);
    const sp = /space|gap|gutter|inset|\bpad|margin/.test(name);
    const fs = /font-size|\btext|type-|\bfs-|\bsize/.test(name) && /\d/.test(val);
    const lh = /line-height|\blh\b/.test(name);
    const fw = /font-weight|\bfw\b|weight/.test(name);
    const ls = /letter-spacing|tracking/.test(name);
    const sh = /shadow|elevation/.test(name);
    const bw = /border-width|\bbw\b/.test(name);
    if (c) out.colors.push({ name, val });
    else if (r) out.radii.push({ name, val });
    else if (sp) out.spacings.push({ name, val });
    else if (fs) out.fontSizes.push({ name, val });
    else if (lh) out.lineHeights.push({ name, val });
    else if (fw) out.fontWeights.push({ name, val });
    else if (ls) out.letterSpacings.push({ name, val });
    else if (sh) out.shadows.push({ name, val });
    else if (bw) out.borderWidths.push({ name, val });
  }
  return out;
}
const dsTokens = parseTokensByCategory(tokensCss);

// ── site-side CSS extraction ──────────────────────────────────────────────────
// Strip the tokens.css from site CSS to avoid counting token definitions as site usage.
const siteOnlyCss = tokensCss ? allSiteCss.replace(tokensCss, '') : allSiteCss;

const siteColors     = extractColors(siteOnlyCss);
const siteFontSizes  = vals(siteOnlyCss, /font-size/i);
const siteLineHeights= vals(siteOnlyCss, /line-height/i);
const siteFontWeights= uniq((siteOnlyCss.match(/font-weight\s*:\s*(\d{3}|bold|bolder|lighter|normal)/gi) || []).map((s) => s.split(':')[1].trim()));
const siteLetterSpacings = vals(siteOnlyCss, /letter-spacing/i);
const siteSpacings   = vals(siteOnlyCss, /\b(?:margin|padding|gap|inset|margin-top|margin-right|margin-bottom|margin-left|padding-top|padding-right|padding-bottom|padding-left)/i);
const siteRadii      = vals(siteOnlyCss, /border-radius/i);
const siteShadows    = uniq((siteOnlyCss.match(/box-shadow\s*:[^;]+;/gi) || []).map((s) => s.replace(/box-shadow\s*:\s*/i, '').replace(';', '').trim()));
const siteBorderWidths = vals(siteOnlyCss, /border(?:-top|-right|-bottom|-left)?-width/i);
const siteBorderColors = extractColors(siteOnlyCss.replace(/^[^{]*\{([^}]*border[^}]*)\}/gim, (_, body) => body));
const siteZIndexes   = uniq((siteOnlyCss.match(/z-index\s*:\s*(-?\d+)/gi) || []).map((s) => s.split(':')[1].trim()));
const siteWidths     = vals(siteOnlyCss, /\bwidth/i).filter((v) => !v.endsWith('%') && v !== '100%' && v !== 'auto');
const siteHeights    = vals(siteOnlyCss, /\bheight/i).filter((v) => !v.endsWith('%') && v !== '100%' && v !== 'auto');
const siteFontFamilies = uniq((siteOnlyCss.match(/font-family\s*:\s*([^;]+)/gi) || [])
  .flatMap((s) => s.replace(/font-family\s*:\s*/i, '').split(',').slice(0, 1))
  .map((f) => f.trim().replace(/["']/g, '').toLowerCase().split(/\s/)[0])
  .filter(Boolean));

// Breakpoints from all site CSS (including token CSS)
const breakpointCount = (allSiteCss.match(/@media\b/gi) || []).length;
const siteBreakpoints = uniq((allSiteCss.match(/@media[^{]+\(\s*(?:min|max)-width\s*:\s*(\d+px)/gi) || [])
  .map((s) => { const m = s.match(/(\d+px)/); return m ? m[1] : null; }).filter(Boolean));
const dsBreakpointCount = dsTokens.all.filter((t) => /breakpoint|bp-|screen/.test(t.name)).length;

// ── near-duplicate detection ──────────────────────────────────────────────────
// Colors: find site colors visually close to a DS token but not exact.
const dsColorHexes = dsTokens.colors.map((t) => {
  const hm = t.val.match(/^#([0-9a-f]{3,8})$/);
  return hm ? { token: t.name, rgb: parseHex(hm[1]) } : null;
}).filter(Boolean);
let nearDupColorCount = 0;
for (const sv of siteColors) {
  const hm = sv.match(/^#([0-9a-f]{3,8})$/); if (!hm) continue;
  const srgb = parseHex(hm[1]);
  const exact = dsColorHexes.some((t) => t.rgb.r === srgb.r && t.rgb.g === srgb.g && t.rgb.b === srgb.b);
  if (exact) continue;
  const near = dsColorHexes.some((t) => rgbDist(t.rgb, srgb) < 22);
  if (near) nearDupColorCount++;
}

// Lengths: near-token font-sizes, spacings
function nearTokenLengths(siteVals, dsVals) {
  const dsPx = dsVals.map((t) => parseFloat(t.val)).filter((n) => !isNaN(n));
  let near = 0;
  for (const sv of siteVals) {
    const n = parseFloat(sv); if (isNaN(n)) continue;
    const exact = dsPx.some((d) => Math.abs(d - n) < 0.1);
    if (exact) continue;
    const isNear = dsPx.some((d) => Math.abs(d - n) <= 2);
    if (isNear) near++;
  }
  return near;
}
const nearDupFontSizes = nearTokenLengths(siteFontSizes, dsTokens.fontSizes);
const nearDupSpacings = nearTokenLengths(siteSpacings, dsTokens.spacings);

// ── unmapped counts ───────────────────────────────────────────────────────────
// Count site values not covered by DS tokens (by exact or var() reference).
function unmappedCount(siteVals, dsVals) {
  const dsSet = new Set(dsVals.map((t) => t.val.replace(/\s+/g, '')));
  return siteVals.filter((v) => !dsSet.has(v.replace(/\s+/g, ''))).length;
}
const unmappedColors    = siteColors.length - (dsTokens.colors.length || 0); // rough: DS tokens are the approved set
const unmappedFontSizes = unmappedCount(siteFontSizes, dsTokens.fontSizes);
const unmappedSpacings  = unmappedCount(siteSpacings, dsTokens.spacings);
const unmappedRadii     = unmappedCount(siteRadii, dsTokens.radii);
const unmappedShadows   = unmappedCount(siteShadows, dsTokens.shadows);
const unmappedBorderWidths = unmappedCount(siteBorderWidths, dsTokens.borderWidths);

// ── coverage percentages ──────────────────────────────────────────────────────
// Count var(--…) references to colour / spacing / type tokens in site CSS.
function varRefCoverage(siteVals, tokenNames) {
  if (!siteVals.length) return null;
  const nameSet = new Set(tokenNames.map((t) => t.name));
  const varRefs = (siteOnlyCss.match(/var\(\s*--[a-z0-9-]+/gi) || []).map((v) => v.replace(/var\(\s*/, ''));
  const relevantRefs = varRefs.filter((v) => nameSet.has(v)).length;
  const rawUsage = siteVals.length;
  return rawUsage + relevantRefs > 0 ? Math.round(relevantRefs / (rawUsage + relevantRefs) * 100) : null;
}
const colorTokenCoverage   = qs.token_coverage_pct ?? null; // overall (best proxy we have)
const fontSizeCoverage     = varRefCoverage(siteFontSizes, dsTokens.fontSizes);
const spacingCoverage      = varRefCoverage(siteSpacings, dsTokens.spacings);

// ── deviation-derived metrics ─────────────────────────────────────────────────
const devByType = {};
for (const d of deviations) {
  for (const rt of d.reason_types || []) devByType[rt] = (devByType[rt] || 0) + 1;
}
const blockerCount    = deviations.filter((d) => d.tier === 'BLOCKER').length;
const warningCount    = deviations.filter((d) => d.tier === 'WARNING').length;
const suggestionCount = deviations.filter((d) => d.tier === 'SUGGESTION').length;
const contrastFailures = quality
  ? (quality.metrics?.find((m) => m.n === 4)?.score != null ? Math.round((1 - quality.metrics.find((m) => m.n === 4).score / 100) * 10) : null)
  : null;

// ── component metrics ─────────────────────────────────────────────────────────
const clusters = audit.canonical_blocks || [];
const usedDsComponents = clusters.length; // each cluster = one reused component pattern
const totalComponents = ds.component_count || clusters.length;
const customComponentEst = Math.max(0, clusters.length - totalComponents); // ones beyond DS set
const duplicateComponentCount = clusters.filter((cl) =>
  clusters.filter((c) => c.role === cl.role).length > 1
).length;

// ── DS adoption score (§14.8) ─────────────────────────────────────────────────
const tokenUsageRatio = qs.token_coverage_pct ?? null;
const componentCoverage = totalComponents > 0 ? Math.round(Math.min(usedDsComponents / totalComponents, 1) * 100) : null;
const consistencyPct = summary.consistency_pct ?? null;
const adoptionScore = (tokenUsageRatio != null && componentCoverage != null && consistencyPct != null)
  ? Math.round(tokenUsageRatio * 0.40 + componentCoverage * 0.25 + consistencyPct * 0.15 + (contrastFailures === 0 ? 100 : 60) * 0.10 + consistencyPct * 0.10)
  : null;
const driftScore = adoptionScore != null ? 100 - adoptionScore : null;

// ── raw value usage ───────────────────────────────────────────────────────────
const hardcodedColorCount = siteColors.filter((c) => !c.startsWith('var(')).length;
const hardcodedSpacingCount = siteSpacings.filter((v) => !v.startsWith('var(')).length;
const hardcodedTypographyCount = [
  ...siteFontSizes, ...siteLineHeights, ...siteFontWeights, ...siteLetterSpacings,
].filter((v) => !v.startsWith('var(')).length;
const rawValueUsageCount = hardcodedColorCount + hardcodedSpacingCount + hardcodedTypographyCount;

// ── font family DS compliance ─────────────────────────────────────────────────
const dsFontFamilies = uniq((siteOnlyCss.match(/font-family\s*:\s*([^;]+)/gi) || [])
  .flatMap((s) => [s.replace(/font-family\s*:\s*/i, '').split(',')[0].trim().replace(/["']/g, '').toLowerCase()])
  .filter(Boolean));
const unapprovedFontFamilyCount = dsTokens.all.some((t) => t.name.includes('font'))
  ? siteFontFamilies.filter((f) => !tokensCss?.toLowerCase().includes(f)).length
  : null;

// ── normalization opportunities ───────────────────────────────────────────────
// Repeated raw values that appear 2+ times are candidates for token creation.
function tokenCandidates(vals) {
  const freq = {}; for (const v of vals) freq[v] = (freq[v] || 0) + 1;
  return Object.values(freq).filter((n) => n >= 2).length;
}
const colorTokenCandidates = tokenCandidates(siteColors);
const spacingTokenCandidates = tokenCandidates(siteSpacings);
const fontSizeTokenCandidates = tokenCandidates(siteFontSizes);
const totalTokenCandidates = colorTokenCandidates + spacingTokenCandidates + fontSizeTokenCandidates;
const normalizationOpportunities = Math.max(0, siteColors.length - ds.color_count) + Math.max(0, siteFontSizes.length - ds.type_size_count) + Math.max(0, siteSpacings.length - ds.space_count);

// ── ratio helper ──────────────────────────────────────────────────────────────
function ratio(a, b) { return (a && b && b > 0) ? Math.round(a / b * 10) / 10 : null; }
function pct(a, b) { return (a != null && b != null && b > 0) ? Math.round(a / b * 100) : null; }
function fmt(v, suffix) { return v == null ? null : v + (suffix || ''); }

// ── metric definition list ────────────────────────────────────────────────────
// Each metric: { id, name, site, ds, value, unit, status, description }
// status: 'ok' | 'warn' | 'bad' | 'info' | null

function status(val, warnAt, badAt, invert = false) {
  if (val == null) return null;
  const v = parseFloat(val);
  if (isNaN(v)) return 'info';
  if (!invert) return v >= badAt ? 'bad' : v >= warnAt ? 'warn' : 'ok';
  return v <= badAt ? 'bad' : v <= warnAt ? 'warn' : 'ok';
}

const metrics = [
  // ── Category 1: Color ──────────────────────────────────────────────────────
  { cat: 1, catLabel: 'Color', id: '1.1',  name: 'Unique colors count',
    value: siteColors.length, site: siteColors.length, ds: null,
    st: status(siteColors.length, 30, 60), desc: 'How many distinct color values appear in the site\'s CSS. High counts signal ad-hoc decisions outside the palette.' },
  { cat: 1, id: '1.2',  name: 'DS color token count',
    value: ds.color_count, site: null, ds: ds.color_count,
    st: 'info', desc: 'How many approved color tokens the design system defines — the permitted palette.' },
  { cat: 1, id: '1.3',  name: 'Color token expansion ratio',
    value: ratio(siteColors.length, ds.color_count), site: siteColors.length, ds: ds.color_count,
    unit: 'x', st: status(ratio(siteColors.length, ds.color_count), 2, 4),
    desc: 'Site unique colors ÷ DS color tokens. A ratio above 2× means the site is using far more colors than the system allows; 4×+ is a systemic problem.' },
  { cat: 1, id: '1.4',  name: 'Extra colors count',
    value: Math.max(0, siteColors.length - (ds.color_count || 0)),
    site: siteColors.length, ds: ds.color_count,
    st: status(Math.max(0, siteColors.length - (ds.color_count || 0)), 5, 20),
    desc: 'Site unique colors minus DS tokens. Every extra color is a value that has no approved home in the system.' },
  { cat: 1, id: '1.5',  name: 'Approved color coverage',
    value: colorTokenCoverage, unit: '%',
    st: status(colorTokenCoverage, 60, 40, true),
    desc: 'What percentage of color usages reference an approved design system token (via var(--…)). Below 60% means most colors are raw/ad-hoc.' },
  { cat: 1, id: '1.6',  name: 'Unmapped colors count',
    value: Math.max(0, unmappedColors),
    st: status(Math.max(0, unmappedColors), 5, 15),
    desc: 'Colors used in the site that do not match any design system token value. These must each be mapped or removed.' },
  { cat: 1, id: '1.7',  name: 'Near-duplicate colors count',
    value: nearDupColorCount,
    st: status(nearDupColorCount, 3, 8),
    desc: 'Colors that are visually almost identical to a DS token (within 22/255 RGB distance) but not exactly equal — e.g. #FFFFFF vs #FEFEFE. Each one is a consolidation opportunity.' },
  { cat: 1, id: '1.8',  name: 'One-off colors count',
    value: tokenCandidates(siteColors) > 0 ? null : null, // requires per-component frequency; set null
    st: null, desc: 'Colors used only once across the entire site. One-offs are candidates for removal or replacement with an existing token.' },
  { cat: 1, id: '1.9',  name: 'Semantic color mismatch count',
    value: null, st: null,
    desc: 'Cases where an approved color is used for the wrong semantic purpose (e.g. error-red used as an accent). Requires manual review — static analysis cannot infer intent.' },
  { cat: 1, id: '1.10', name: 'Color contrast failure count',
    value: contrastFailures,
    st: status(contrastFailures, 1, 5),
    desc: 'Text/background color pairs that fail WCAG AA contrast requirements. Zero failures means every intended text-on-surface pair is accessible.' },
  { cat: 1, id: '1.11', name: 'Token-safe color pair coverage',
    value: contrastFailures === 0 ? 100 : contrastFailures != null ? Math.max(0, 100 - contrastFailures * 10) : null,
    unit: '%', st: status(contrastFailures === 0 ? 100 : contrastFailures != null ? Math.max(0, 100 - contrastFailures * 10) : null, 80, 60, true),
    desc: 'Percentage of color combinations that are both approved tokens and WCAG-accessible. The higher, the safer.' },

  // ── Category 2: Typography ─────────────────────────────────────────────────
  { cat: 2, catLabel: 'Typography', id: '2.1', name: 'Unique font-size count',
    value: siteFontSizes.length, site: siteFontSizes.length, ds: null,
    st: status(siteFontSizes.length, 12, 25), desc: 'How many distinct font-size values the site uses. A healthy type scale has 6–10 steps; many more indicates an uncontrolled scale.' },
  { cat: 2, id: '2.2',  name: 'DS font-size token count',
    value: ds.type_size_count, ds: ds.type_size_count, st: 'info',
    desc: 'Number of approved font-size tokens in the design system type scale.' },
  { cat: 2, id: '2.3',  name: 'Font-size expansion ratio',
    value: ratio(siteFontSizes.length, ds.type_size_count || 1), unit: 'x',
    st: status(ratio(siteFontSizes.length, ds.type_size_count || 1), 1.5, 3),
    desc: 'Site font-sizes ÷ DS font-size tokens. Values above 2× mean the site has grown a shadow type scale outside the system.' },
  { cat: 2, id: '2.4',  name: 'Unmapped font-size count',
    value: unmappedFontSizes,
    st: status(unmappedFontSizes, 4, 10),
    desc: 'Font sizes that do not match any approved type scale step. Each one breaks the visual rhythm.' },
  { cat: 2, id: '2.5',  name: 'Approved font-size coverage',
    value: fontSizeCoverage, unit: '%',
    st: status(fontSizeCoverage, 60, 40, true),
    desc: 'Percentage of font-size usages that reference a DS token via var(--…). High coverage means the type scale is actually being followed.' },
  { cat: 2, id: '2.6',  name: 'Near-token font-size count',
    value: nearDupFontSizes,
    st: status(nearDupFontSizes, 3, 7),
    desc: 'Font sizes within 2 px of an approved scale step but not exactly equal — e.g. 15 px near 16 px. These are consolidation wins.' },
  { cat: 2, id: '2.7',  name: 'Unique line-height count',
    value: siteLineHeights.length, site: siteLineHeights.length,
    st: status(siteLineHeights.length, 6, 12), desc: 'Number of distinct line-height values used. A minimal set (3–5) creates consistent text rhythm.' },
  { cat: 2, id: '2.8',  name: 'DS line-height token count',
    value: dsTokens.lineHeights.length, ds: dsTokens.lineHeights.length, st: 'info',
    desc: 'Number of approved line-height tokens in the design system.' },
  { cat: 2, id: '2.9',  name: 'Line-height expansion ratio',
    value: ratio(siteLineHeights.length, dsTokens.lineHeights.length || 1), unit: 'x',
    st: status(ratio(siteLineHeights.length, dsTokens.lineHeights.length || 1), 2, 4),
    desc: 'Site line-heights ÷ DS line-height tokens. High ratios indicate inconsistent text rhythm across the product.' },
  { cat: 2, id: '2.10', name: 'Unmapped line-height count',
    value: dsTokens.lineHeights.length ? unmappedCount(siteLineHeights, dsTokens.lineHeights) : null,
    st: dsTokens.lineHeights.length ? status(unmappedCount(siteLineHeights, dsTokens.lineHeights), 3, 7) : null,
    desc: 'Line-height values not covered by any DS token.' },
  { cat: 2, id: '2.11', name: 'Unique font-weight count',
    value: siteFontWeights.length,
    st: status(siteFontWeights.length, 5, 8), desc: 'Number of distinct font-weight values. Most systems need 2–4; more signals weight sprawl.' },
  { cat: 2, id: '2.12', name: 'DS font-weight token count',
    value: dsTokens.fontWeights.length, ds: dsTokens.fontWeights.length, st: 'info',
    desc: 'Number of approved font-weight tokens.' },
  { cat: 2, id: '2.13', name: 'Font-weight expansion ratio',
    value: ratio(siteFontWeights.length, dsTokens.fontWeights.length || 1), unit: 'x',
    st: status(ratio(siteFontWeights.length, dsTokens.fontWeights.length || 1), 1.5, 3),
    desc: 'Site font-weights ÷ DS font-weight tokens.' },
  { cat: 2, id: '2.14', name: 'Unique letter-spacing count',
    value: siteLetterSpacings.length,
    st: status(siteLetterSpacings.length, 5, 10), desc: 'Number of distinct letter-spacing values. 2–4 is typical for a well-controlled system.' },
  { cat: 2, id: '2.15', name: 'Unmapped letter-spacing count',
    value: dsTokens.letterSpacings.length ? unmappedCount(siteLetterSpacings, dsTokens.letterSpacings) : null,
    st: null, desc: 'Letter-spacing values not covered by DS tokens.' },
  { cat: 2, id: '2.16', name: 'Font-family count',
    value: siteFontFamilies.length,
    st: status(siteFontFamilies.length, 3, 5), desc: 'Number of distinct font families used. Most branded products should use 1–2 families.' },
  { cat: 2, id: '2.17', name: 'Unapproved font-family count',
    value: unapprovedFontFamilyCount,
    st: unapprovedFontFamilyCount != null ? status(unapprovedFontFamilyCount, 1, 3) : null,
    desc: 'Font families used in the site that are not defined in the design system. Each is a brand inconsistency.' },
  { cat: 2, id: '2.18', name: 'Heading hierarchy violation count',
    value: null, st: null,
    desc: 'Cases where heading order is skipped or a lower-level heading is visually larger than a higher-level one. Requires rendered output review.' },
  { cat: 2, id: '2.19', name: 'Body text consistency score',
    value: null, st: null,
    desc: 'Whether body/paragraph text uses a consistent size, line-height, and weight across pages. Requires cross-page DOM analysis.' },
  { cat: 2, id: '2.20', name: 'Typography accessibility issue count',
    value: null, st: null,
    desc: 'Text styles that are too small (< 12 px), too low contrast, or too compressed (letter-spacing < -0.05 em). Partially covered by contrast failures above.' },

  // ── Category 3: Spacing ────────────────────────────────────────────────────
  { cat: 3, catLabel: 'Spacing', id: '3.1', name: 'Unique spacing value count',
    value: siteSpacings.length, site: siteSpacings.length,
    st: status(siteSpacings.length, 20, 50), desc: 'How many distinct margin/padding/gap/inset values the site uses. A spacing scale should need 8–16 steps.' },
  { cat: 3, id: '3.2',  name: 'DS spacing token count',
    value: ds.space_count, ds: ds.space_count, st: 'info',
    desc: 'Number of approved spacing tokens (margin, padding, gap steps) in the design system.' },
  { cat: 3, id: '3.3',  name: 'Spacing expansion ratio',
    value: ratio(siteSpacings.length, ds.space_count || 1), unit: 'x',
    st: status(ratio(siteSpacings.length, ds.space_count || 1), 2, 5),
    desc: 'Site unique spacing values ÷ DS spacing tokens. Values above 3× indicate the spacing scale is effectively ignored.' },
  { cat: 3, id: '3.4',  name: 'Unmapped spacing value count',
    value: unmappedSpacings,
    st: status(unmappedSpacings, 10, 30),
    desc: 'Spacing values that fall outside the approved scale. Every one creates micro-inconsistency in rhythm and density.' },
  { cat: 3, id: '3.5',  name: 'Approved spacing coverage',
    value: spacingCoverage, unit: '%',
    st: status(spacingCoverage, 60, 40, true),
    desc: 'Percentage of spacing usages that reference a DS token. Below 50% means the layout is built on ad-hoc values.' },
  { cat: 3, id: '3.6',  name: 'Near-token spacing count',
    value: nearDupSpacings,
    st: status(nearDupSpacings, 5, 15),
    desc: 'Spacing values within 2 px of an approved scale step but not exact — e.g. 15 px near 16 px. Easy normalization wins.' },
  { cat: 3, id: '3.7',  name: 'One-off spacing value count',
    value: null, st: null,
    desc: 'Spacing values used in only one place. These are prime candidates for removal or replacement.' },
  { cat: 3, id: '3.8',  name: 'Layout gap consistency score',
    value: null, st: null,
    desc: 'Whether similar layouts (e.g. grid rows, card grids) use consistent gap values. Requires DOM structure analysis.' },
  { cat: 3, id: '3.9',  name: 'Component internal spacing drift count',
    value: devByType.spacing || 0,
    st: status(devByType.spacing || 0, 10, 30),
    desc: 'Block instances where internal padding or gap differs from the DS canonical — sourced from block-level deviation analysis.' },
  { cat: 3, id: '3.10', name: 'Page density inconsistency score',
    value: null, st: null,
    desc: 'Whether different pages feel too tight or too loose compared to the system. Requires visual density comparison across pages.' },

  // ── Category 4: Sizing ─────────────────────────────────────────────────────
  { cat: 4, catLabel: 'Sizing', id: '4.1', name: 'Unique width value count',
    value: siteWidths.length,
    st: status(siteWidths.length, 20, 40), desc: 'Number of distinct fixed-width values used (excluding %, auto). Large counts suggest hardcoded layouts.' },
  { cat: 4, id: '4.2',  name: 'Unique height value count',
    value: siteHeights.length,
    st: status(siteHeights.length, 15, 30), desc: 'Number of distinct fixed-height values. Many one-off heights make component scaling brittle.' },
  { cat: 4, id: '4.3',  name: 'Component height variant count',
    value: null, st: null, desc: 'How many different heights are used for the same component type (e.g. button). Requires component-level analysis.' },
  { cat: 4, id: '4.4',  name: 'DS component height token count',
    value: null, st: null, desc: 'Number of approved size variants for each component in the design system.' },
  { cat: 4, id: '4.5',  name: 'Component height expansion ratio',
    value: null, st: null, desc: 'Site component height variants ÷ DS approved size variants.' },
  { cat: 4, id: '4.6',  name: 'Icon size variant count',
    value: null, st: null, desc: 'Number of distinct icon sizes used. Systems typically define 3–5 (xs/sm/md/lg/xl).' },
  { cat: 4, id: '4.7',  name: 'Unmapped icon size count',
    value: null, st: null, desc: 'Icon sizes outside the design system.' },
  { cat: 4, id: '4.8',  name: 'Avatar size variant count',
    value: null, st: null, desc: 'Number of different avatar/image sizes used across the product.' },
  { cat: 4, id: '4.9',  name: 'Container width variant count',
    value: uniq((siteOnlyCss.match(/max-width\s*:\s*(\d+px)/gi) || [])).length,
    st: status(uniq((siteOnlyCss.match(/max-width\s*:\s*(\d+px)/gi) || [])).length, 4, 8),
    desc: 'Number of distinct max-width / container width values. Ideally 1–3 layout columns with a consistent max-width.' },
  { cat: 4, id: '4.10', name: 'Fixed-size exception count',
    value: siteWidths.filter((v) => !v.includes('%') && !v.includes('auto')).length + siteHeights.filter((v) => !v.includes('%') && !v.includes('auto')).length,
    st: 'info', desc: 'Hardcoded width/height values that do not map to DS tokens. High counts signal inflexible, hard-to-maintain layouts.' },

  // ── Category 5: Border, Radius, Shadow ─────────────────────────────────────
  { cat: 5, catLabel: 'Border, Radius & Shadow', id: '5.1', name: 'Unique border-radius count',
    value: siteRadii.length, site: siteRadii.length,
    st: status(siteRadii.length, 5, 10), desc: 'Distinct border-radius values in use. Most systems need 2–4; more indicates an inconsistent rounding language.' },
  { cat: 5, id: '5.2',  name: 'DS radius token count',
    value: ds.radius_count, ds: ds.radius_count, st: 'info',
    desc: 'Number of approved radius tokens in the design system.' },
  { cat: 5, id: '5.3',  name: 'Radius expansion ratio',
    value: ratio(siteRadii.length, ds.radius_count || 1), unit: 'x',
    st: status(ratio(siteRadii.length, ds.radius_count || 1), 2, 4),
    desc: 'Site unique radius values ÷ DS radius tokens. Systems with only 2–3 token steps should have a ratio close to 1×.' },
  { cat: 5, id: '5.4',  name: 'Unmapped radius count',
    value: unmappedRadii,
    st: status(unmappedRadii, 2, 5),
    desc: 'Radius values not covered by any DS token. Each breaks the rounding language.' },
  { cat: 5, id: '5.5',  name: 'Unique border-width count',
    value: siteBorderWidths.length,
    st: status(siteBorderWidths.length, 4, 7), desc: 'Number of distinct border-width values. Most systems define 1–2 (hairline + standard).' },
  { cat: 5, id: '5.6',  name: 'Unmapped border-width count',
    value: unmappedBorderWidths,
    st: status(unmappedBorderWidths, 2, 4), desc: 'Border widths outside the design system.' },
  { cat: 5, id: '5.7',  name: 'Unique border-color count',
    value: siteBorderColors.length,
    st: status(siteBorderColors.length, 5, 10), desc: 'Number of distinct border colors. A consistent border language uses 2–4 approved values.' },
  { cat: 5, id: '5.8',  name: 'Unique shadow count',
    value: siteShadows.length, site: siteShadows.length,
    st: status(siteShadows.length, 4, 8), desc: 'Distinct box-shadow / elevation styles. Elevation systems typically have 3–5 levels.' },
  { cat: 5, id: '5.9',  name: 'DS shadow token count',
    value: dsTokens.shadows.length, ds: dsTokens.shadows.length, st: 'info',
    desc: 'Number of approved shadow/elevation tokens.' },
  { cat: 5, id: '5.10', name: 'Shadow expansion ratio',
    value: ratio(siteShadows.length, dsTokens.shadows.length || 1), unit: 'x',
    st: status(ratio(siteShadows.length, dsTokens.shadows.length || 1), 2, 4),
    desc: 'Site unique shadows ÷ DS shadow tokens. Every extra elevation value undermines the depth language.' },
  { cat: 5, id: '5.11', name: 'Unmapped shadow count',
    value: unmappedShadows,
    st: status(unmappedShadows, 2, 5), desc: 'Shadow values not covered by any DS token.' },
  { cat: 5, id: '5.12', name: 'Elevation inconsistency count',
    value: null, st: null, desc: 'Cases where layering/elevation doesn\'t follow system rules (e.g. a modal below a tooltip). Requires z-index context analysis.' },
  { cat: 5, id: '5.13', name: 'Unique z-index count',
    value: siteZIndexes.length,
    st: status(siteZIndexes.length, 6, 12), desc: 'Number of distinct z-index values. A z-index scale should be a small, named set (overlay/modal/tooltip/etc.).' },
  { cat: 5, id: '5.14', name: 'Z-index scale violation count',
    value: null, st: null, desc: 'Z-index values outside the approved layering scale. Requires comparison against a defined z-index token set.' },

  // ── Category 6: Components ─────────────────────────────────────────────────
  { cat: 6, catLabel: 'Components', id: '6.1', name: 'DS component count',
    value: ds.component_count, ds: ds.component_count, st: 'info',
    desc: 'Total components available in the design system (Primitives + Components + Modules).' },
  { cat: 6, id: '6.2',  name: 'Used DS component count',
    value: usedDsComponents, site: usedDsComponents,
    st: 'info', desc: 'Number of distinct component patterns actually used in the site, detected as clusters in the audit.' },
  { cat: 6, id: '6.3',  name: 'Component coverage',
    value: componentCoverage, unit: '%',
    st: status(componentCoverage, 60, 40, true),
    desc: 'Used components ÷ DS components × 100. How much of the design system the product actually uses.' },
  { cat: 6, id: '6.4',  name: 'Custom component count',
    value: Math.max(0, customComponentEst),
    st: status(Math.max(0, customComponentEst), 3, 8),
    desc: 'Estimated UI patterns in the site that have no counterpart in the DS. These are candidates for system additions.' },
  { cat: 6, id: '6.5',  name: 'Duplicate component count',
    value: duplicateComponentCount,
    st: status(duplicateComponentCount, 2, 5),
    desc: 'Components solving the same UI problem with different markup — e.g. 3 different card implementations. Each should converge on one canonical.' },
  { cat: 6, id: '6.6',  name: 'Detached component instance count',
    value: null, st: null, desc: 'Component instances that were once system components but are now disconnected. Figma-only metric; not computable from static HTML.' },
  { cat: 6, id: '6.7',  name: 'Overridden component instance count',
    value: deviations.length, site: deviations.length,
    st: status(deviations.length, 20, 80),
    desc: 'Block instances with at least one local style deviation from the DS canonical — i.e. an override applied after instancing.' },
  { cat: 6, id: '6.8',  name: 'Component override rate',
    value: pct(deviations.length, (audit.block_status || []).length), unit: '%',
    st: status(pct(deviations.length, (audit.block_status || []).length), 20, 40),
    desc: 'Overridden instances ÷ all instances × 100. High rates mean component tokens are routinely ignored.' },
  { cat: 6, id: '6.9',  name: 'Variant expansion ratio',
    value: null, st: null, desc: 'Current visual variants in product ÷ DS approved variants. Requires Figma instance comparison.' },
  { cat: 6, id: '6.10', name: 'Unofficial variant count',
    value: null, st: null, desc: 'Component variants used in the product but not defined in the DS. These should be added to the system or removed.' },
  { cat: 6, id: '6.11', name: 'Prop/variant mismatch count',
    value: null, st: null, desc: 'Component instances using the wrong system variant for their context. Requires semantic intent analysis.' },
  { cat: 6, id: '6.12', name: 'Component reuse score',
    value: consistencyPct, unit: '%',
    st: status(consistencyPct, 70, 50, true),
    desc: 'Proxy: site consistency %. High consistency means blocks are built from the same canonical patterns rather than one-off custom styles.' },
  { cat: 6, id: '6.13', name: 'Component fragmentation score',
    value: consistencyPct != null ? 100 - consistencyPct : null, unit: '%',
    st: status(consistencyPct != null ? 100 - consistencyPct : null, 30, 50),
    desc: 'Inverse of consistency: how scattered and duplicated component implementations are. Lower is better.' },

  // ── Category 7: States ─────────────────────────────────────────────────────
  { cat: 7, catLabel: 'States', id: '7.1', name: 'State coverage score',
    value: null, st: null, desc: 'Whether components define all required interaction states (default/hover/focus/active/disabled/loading/error/success/empty/selected). Requires component spec review.' },
  { cat: 7, id: '7.2',  name: 'Missing state count',
    value: null, st: null, desc: 'Number of required states missing from component definitions.' },
  { cat: 7, id: '7.3',  name: 'Custom state style count',
    value: null, st: null, desc: 'States styled outside the design system (e.g. one-off :hover colors).' },
  { cat: 7, id: '7.4',  name: 'Focus state visibility issue count',
    value: (allSiteCss.match(/outline\s*:\s*0|outline\s*:\s*none/gi) || []).length,
    st: status((allSiteCss.match(/outline\s*:\s*0|outline\s*:\s*none/gi) || []).length, 1, 3),
    desc: 'CSS declarations removing the focus outline without a replacement. Each is a keyboard accessibility failure.' },
  { cat: 7, id: '7.5',  name: 'Error state inconsistency count',
    value: null, st: null, desc: 'Error states that use inconsistent colors, icons, or spacing across components.' },
  { cat: 7, id: '7.6',  name: 'Success state inconsistency count',
    value: null, st: null, desc: 'Success states with inconsistent visual language across components.' },
  { cat: 7, id: '7.7',  name: 'Disabled state readability issue count',
    value: null, st: null, desc: 'Disabled states with insufficient contrast or unclear affordance.' },
  { cat: 7, id: '7.8',  name: 'Loading state coverage',
    value: null, unit: '%', st: null, desc: 'Percentage of async components that define a loading state. Requires component spec review.' },
  { cat: 7, id: '7.9',  name: 'Empty state coverage',
    value: null, unit: '%', st: null, desc: 'Percentage of empty-data screens with an approved empty state pattern.' },

  // ── Category 8: Accessibility Design ──────────────────────────────────────
  { cat: 8, catLabel: 'Accessibility (Design)', id: '8.1', name: 'Contrast failure count',
    value: contrastFailures, st: status(contrastFailures, 1, 5),
    desc: 'Number of foreground/background pairs failing WCAG AA (< 4.5:1 for normal text, < 3:1 for large).' },
  { cat: 8, id: '8.2',  name: 'Contrast failure rate',
    value: null, unit: '%', st: null, desc: 'Contrast failures ÷ tested color pairs × 100.' },
  { cat: 8, id: '8.3',  name: 'Touch target violation count',
    value: null, st: null, desc: 'Interactive elements below the 44 × 44 px minimum touch target size. Requires rendered layout analysis (Playwright).' },
  { cat: 8, id: '8.4',  name: 'Focus visibility coverage',
    value: null, unit: '%', st: null, desc: 'Percentage of interactive components with a visible focus style.' },
  { cat: 8, id: '8.5',  name: 'Small text violation count',
    value: siteFontSizes.filter((v) => parseFloat(v) < 12 && v.endsWith('px')).length,
    st: status(siteFontSizes.filter((v) => parseFloat(v) < 12 && v.endsWith('px')).length, 1, 3),
    desc: 'Font sizes below 12 px (which is generally unreadable). Body text below 16 px warrants a readability review.' },
  { cat: 8, id: '8.6',  name: 'Disabled text contrast issue count',
    value: null, st: null, desc: 'Disabled text styles with insufficient contrast for legibility.' },
  { cat: 8, id: '8.7',  name: 'Link distinguishability issue count',
    value: null, st: null, desc: 'Links that rely only on color to be identified (no underline or icon). Fails WCAG 1.4.1.' },
  { cat: 8, id: '8.8',  name: 'Error message accessibility issue count',
    value: null, st: null, desc: 'Form error messages not programmatically associated with their fields.' },
  { cat: 8, id: '8.9',  name: 'Motion/reduced-motion issue count',
    value: (allSiteCss.match(/transition|animation/gi) || []).length > 0 && !(allSiteCss.match(/prefers-reduced-motion/gi) || []).length
      ? '⚠ animations found but no prefers-reduced-motion detected' : null,
    st: (allSiteCss.match(/transition|animation/gi) || []).length > 0 && !(allSiteCss.match(/prefers-reduced-motion/gi) || []).length ? 'warn' : 'ok',
    desc: 'Animations and transitions without a prefers-reduced-motion fallback. Can trigger vestibular disorders.' },

  // ── Category 9: CSS / Implementation ──────────────────────────────────────
  { cat: 9, catLabel: 'CSS / Implementation', id: '9.1', name: 'Raw value usage count',
    value: rawValueUsageCount,
    st: status(rawValueUsageCount, 30, 100), desc: 'Total hardcoded visual values (colors, spacings, font sizes) not expressed via tokens. The lower, the more maintainable.' },
  { cat: 9, id: '9.2',  name: 'Token usage ratio',
    value: qs.token_coverage_pct, unit: '%',
    st: status(qs.token_coverage_pct, 60, 40, true),
    desc: 'Percentage of all design declarations that reference a DS token (var(--…) or matching value). The headline maintainability metric.' },
  { cat: 9, id: '9.3',  name: 'CSS variable coverage',
    value: qs.token_coverage_pct, unit: '%',
    st: status(qs.token_coverage_pct, 60, 40, true),
    desc: 'What fraction of design-relevant declarations use CSS custom properties (var(--…)) rather than hardcoded values.' },
  { cat: 9, id: '9.4',  name: 'Hardcoded color count',
    value: hardcodedColorCount,
    st: status(hardcodedColorCount, 10, 30), desc: 'Raw color values used directly in CSS (not via a token). Each one is a theming and rebrand liability.' },
  { cat: 9, id: '9.5',  name: 'Hardcoded spacing count',
    value: hardcodedSpacingCount,
    st: status(hardcodedSpacingCount, 20, 50), desc: 'Raw spacing values (margin/padding/gap) not referencing tokens.' },
  { cat: 9, id: '9.6',  name: 'Hardcoded typography count',
    value: hardcodedTypographyCount,
    st: status(hardcodedTypographyCount, 15, 40), desc: 'Raw font-size, line-height, font-weight, and letter-spacing values not using tokens.' },
  { cat: 9, id: '9.7',  name: 'Duplicate declaration count',
    value: qs.duplicate_token_defs ?? null,
    st: status(qs.duplicate_token_defs, 5, 20), desc: 'Repeated identical CSS variable definitions. Duplicates add confusion and can create silent override bugs.' },
  { cat: 9, id: '9.8',  name: 'Override depth',
    value: null, st: null, desc: 'Average CSS specificity layers needed to reach the final computed value. Deep overrides make refactors risky.' },
  { cat: 9, id: '9.9',  name: '!important count',
    value: importantCount,
    st: status(importantCount, 5, 20), desc: 'Number of !important declarations. Each one bypasses the cascade and makes systematic token rollout harder.' },
  { cat: 9, id: '9.10', name: 'Inline style count',
    value: inlineStyleCount,
    st: status(inlineStyleCount, 10, 30), desc: 'Number of inline style= attributes in HTML. Inline styles can\'t be overridden by tokens and resist theming.' },
  { cat: 9, id: '9.11', name: 'Dead token count',
    value: qs.undefined_var_refs ?? null,
    st: status(qs.undefined_var_refs, 3, 10), desc: 'DS tokens defined in tokens.css but not referenced anywhere in site CSS. Clean these up to reduce system noise.' },
  { cat: 9, id: '9.12', name: 'Deprecated token usage count',
    value: null, st: null, desc: 'Old/deprecated tokens still in use. Requires a "deprecated" annotation in tokens.css.' },
  { cat: 9, id: '9.13', name: 'Missing token alias count',
    value: totalTokenCandidates,
    st: status(totalTokenCandidates, 10, 25), desc: 'Repeated raw values used 2+ times that could become tokens. Each represents a consolidation opportunity.' },
  { cat: 9, id: '9.14', name: 'Token naming inconsistency count',
    value: null, st: null, desc: 'Tokens that break naming conventions (e.g. mixing camelCase and kebab-case). Inconsistent names slow down developer adoption.' },
  { cat: 9, id: '9.15', name: 'Theme compatibility issue count',
    value: null, st: null, desc: 'Values that don\'t support dark mode or other themes correctly (e.g. hardcoded #fff in a component that should invert).' },

  // ── Category 10: Visual Consistency ───────────────────────────────────────
  { cat: 10, catLabel: 'Visual Consistency', id: '10.1', name: 'Similar UI inconsistency count',
    value: summary.deviating_instances ?? null,
    st: status(summary.deviating_instances, 20, 80), desc: 'Visually similar blocks/components styled differently across the site. This is the audit\'s core finding.' },
  { cat: 10, id: '10.2', name: 'Page-to-page drift score',
    value: consistencyPct != null ? 100 - consistencyPct : null, unit: '%',
    st: status(consistencyPct != null ? 100 - consistencyPct : null, 20, 40),
    desc: 'How much the same component varies between pages. Derived from the inverse of the consistency score.' },
  { cat: 10, id: '10.3', name: 'Layout alignment issue count',
    value: null, st: null, desc: 'Repeated misalignment across the grid. Requires rendered layout analysis.' },
  { cat: 10, id: '10.4', name: 'Rhythm consistency score',
    value: null, st: null, desc: 'Whether typography and spacing create predictable vertical rhythm. Requires per-page density analysis.' },
  { cat: 10, id: '10.5', name: 'Density consistency score',
    value: null, st: null, desc: 'Whether screen density feels consistent across the product (tight vs spacious).' },
  { cat: 10, id: '10.6', name: 'Brand consistency score',
    value: consistencyPct, unit: '%',
    st: status(consistencyPct, 70, 50, true),
    desc: 'Proxy: site consistency %. High consistency means the brand language is applied uniformly.' },
  { cat: 10, id: '10.7', name: 'Pattern consistency score',
    value: consistencyPct, unit: '%',
    st: status(consistencyPct, 70, 50, true),
    desc: 'Whether similar user tasks use similar UI patterns (e.g. all primary CTAs styled the same way).' },
  { cat: 10, id: '10.8', name: 'Cross-platform consistency score',
    value: null, st: null, desc: 'Consistency between desktop, mobile, and other breakpoints. Requires multi-viewport rendering.' },

  // ── Category 11: Responsive Design ────────────────────────────────────────
  { cat: 11, catLabel: 'Responsive Design', id: '11.1', name: 'Breakpoint token count',
    value: siteBreakpoints.length, site: siteBreakpoints.length,
    st: status(siteBreakpoints.length, 5, 8), desc: 'Number of distinct breakpoints used in the site\'s CSS. More than 4–5 suggests ad-hoc responsive logic.' },
  { cat: 11, id: '11.2', name: 'DS breakpoint count',
    value: dsBreakpointCount, ds: dsBreakpointCount, st: 'info',
    desc: 'Number of approved breakpoints defined in the design system.' },
  { cat: 11, id: '11.3', name: 'Breakpoint expansion ratio',
    value: ratio(siteBreakpoints.length, dsBreakpointCount || 1), unit: 'x',
    st: status(ratio(siteBreakpoints.length, dsBreakpointCount || 1), 1.5, 3),
    desc: 'Site breakpoints ÷ DS breakpoints. A ratio > 2× means responsive logic is outside system control.' },
  { cat: 11, id: '11.4', name: 'Unmapped breakpoint count',
    value: null, st: null, desc: 'Breakpoints not in the approved DS set. Requires explicit DS breakpoint token list.' },
  { cat: 11, id: '11.5', name: 'Responsive spacing drift count',
    value: null, st: null, desc: 'Spacing values that change inconsistently across breakpoints. Requires per-breakpoint rule analysis.' },
  { cat: 11, id: '11.6', name: 'Responsive typography drift count',
    value: null, st: null, desc: 'Font-size/line-height values that change inconsistently at different breakpoints.' },
  { cat: 11, id: '11.7', name: 'Mobile-specific exception count',
    value: null, st: null, desc: 'Custom mobile-only styles outside the DS responsive rules.' },
  { cat: 11, id: '11.8', name: 'Layout behavior inconsistency count',
    value: null, st: null, desc: 'Components that collapse, stack, or resize differently from DS guidance at breakpoints.' },

  // ── Category 12: Content & UX-Writing ─────────────────────────────────────
  { cat: 12, catLabel: 'Content & UX-Writing', id: '12.1', name: 'Button label inconsistency count',
    value: null, st: null, desc: 'Similar actions using different labels (e.g. Submit / Send / Continue). Requires NLP analysis of visible text.' },
  { cat: 12, id: '12.2', name: 'Error message pattern mismatch count',
    value: null, st: null, desc: 'Error messages that don\'t follow the approved format (e.g. missing the action step).' },
  { cat: 12, id: '12.3', name: 'Empty state copy mismatch count',
    value: null, st: null, desc: 'Empty states not matching the approved content pattern.' },
  { cat: 12, id: '12.4', name: 'Tooltip/help text inconsistency count',
    value: null, st: null, desc: 'Help text patterns that differ unnecessarily in tone, length, or format.' },
  { cat: 12, id: '12.5', name: 'Terminology inconsistency count',
    value: null, st: null, desc: 'Different terms used for the same concept across the product (e.g. "workspace" vs "project").' },
  { cat: 12, id: '12.6', name: 'CTA hierarchy mismatch count',
    value: null, st: null, desc: 'Cases where copy doesn\'t match visual action hierarchy (e.g. a primary button with weaker label than a secondary).' },

  // ── Category 13: Prioritization ────────────────────────────────────────────
  { cat: 13, catLabel: 'Prioritization', id: '13.1', name: 'Issue frequency',
    value: deviations.length, site: deviations.length,
    st: status(deviations.length, 30, 100), desc: 'Total number of deviating block instances — how often drift appears across the site.' },
  { cat: 13, id: '13.2', name: 'Affected surface area',
    value: summary.pages ?? null,
    st: status(summary.pages, 5, 10), desc: 'Number of pages affected by at least one design system deviation.' },
  { cat: 13, id: '13.3', name: 'User-facing importance',
    value: null, st: null, desc: 'How visible or critical the drifting UI is (e.g. hero vs footer). Requires semantic page section tagging.' },
  { cat: 13, id: '13.4', name: 'User impact',
    value: null, st: null, desc: 'How much each class of deviation affects usability, clarity, trust, or conversion.' },
  { cat: 13, id: '13.5', name: 'System distance (avg)',
    value: deviations.length > 0 ? Math.round((1 - (audit.summary?.consistency_pct || 100) / 100) * 100) : 0, unit: '%',
    st: status(deviations.length > 0 ? Math.round((1 - (audit.summary?.consistency_pct || 100) / 100) * 100) : 0, 15, 30),
    desc: 'Average percentage drift from the nearest DS canonical — how far off the deviating blocks are (100% − consistency_pct).' },
  { cat: 13, id: '13.6', name: 'Fix complexity',
    value: null, st: null, desc: 'How difficult typical fixes are (e.g. simple token swap vs component restructure).' },
  { cat: 13, id: '13.7', name: 'Fix simplicity',
    value: null, st: null, desc: 'Inverse of fix complexity. Token-swap fixes score highest (easiest).' },
  { cat: 13, id: '13.8', name: 'Reusability impact',
    value: null, st: null, desc: 'Whether fixing a deviation improves a shared component (multiplier effect).' },
  { cat: 13, id: '13.9', name: 'Risk of regression',
    value: null, st: null, desc: 'How likely a fix is to break nearby UI. High z-index / !important areas score highest risk.' },
  { cat: 13, id: '13.10', name: 'Priority score',
    value: blockerCount != null
      ? Math.round(blockerCount * 0.4 + warningCount * 0.3 + ((100 - (consistencyPct ?? 100)) * 0.2) + (importantCount > 0 ? 50 : 100) * 0.1)
      : null,
    st: null, desc: 'Composite: 40% frequency + 30% severity (BLOCKER weight) + 20% system distance + 10% fix simplicity. Higher = higher priority.' },
  { cat: 13, id: '13.11', name: 'Severity score',
    value: Math.round(blockerCount * 3 + warningCount * 1.5 + suggestionCount * 0.5),
    st: status(Math.round(blockerCount * 3 + warningCount * 1.5 + suggestionCount * 0.5), 20, 60),
    desc: 'Weighted sum of findings: BLOCKER × 3 + WARNING × 1.5 + SUGGESTION × 0.5. Raw severity of all issues combined.' },
  { cat: 13, id: '13.12', name: 'Confidence score',
    value: qs.token_coverage_pct != null ? 'static analysis' : null, st: 'info',
    desc: 'How confident the audit is in the detected issues. Static analysis flags known-bad values; some metrics require manual or Playwright confirmation.' },

  // ── Category 14: Summary / Global ─────────────────────────────────────────
  { cat: 14, catLabel: 'Summary / Global', id: '14.1', name: 'Total DS token count',
    value: ds.token_count || dsTokens.all.length, ds: ds.token_count || dsTokens.all.length,
    st: 'info', desc: 'Total number of tokens in the design system (colors + type + spacing + radius + shadow + motion + other).' },
  { cat: 14, id: '14.2', name: 'Total current unique value count',
    value: siteColors.length + siteFontSizes.length + siteSpacings.length + siteRadii.length + siteShadows.length,
    site: siteColors.length + siteFontSizes.length + siteSpacings.length + siteRadii.length + siteShadows.length,
    st: 'info', desc: 'Total unique visual values in site CSS (colors + font-sizes + spacings + radii + shadows). This is the raw material the DS should be distilling.' },
  { cat: 14, id: '14.3', name: 'Global token expansion ratio',
    value: ratio(siteColors.length + siteFontSizes.length + siteSpacings.length + siteRadii.length + siteShadows.length, (ds.token_count || dsTokens.all.length) || 1), unit: 'x',
    st: status(ratio(siteColors.length + siteFontSizes.length + siteSpacings.length + siteRadii.length + siteShadows.length, (ds.token_count || dsTokens.all.length) || 1), 2, 5),
    desc: 'Total site unique values ÷ DS tokens. The single-number answer to "how far has the product drifted from its system?"' },
  { cat: 14, id: '14.4', name: 'Global token coverage',
    value: qs.token_coverage_pct, unit: '%',
    st: status(qs.token_coverage_pct, 60, 40, true),
    desc: 'Overall percentage of design declarations referencing approved DS tokens. The headline adoption metric.' },
  { cat: 14, id: '14.5', name: 'Total unmapped value count',
    value: unmappedColors + unmappedFontSizes + unmappedSpacings + unmappedRadii + unmappedShadows + unmappedBorderWidths,
    st: status(unmappedColors + unmappedFontSizes + unmappedSpacings + unmappedRadii + unmappedShadows + unmappedBorderWidths, 30, 80),
    desc: 'Sum of all values (across categories) not mapped to a DS token. The raw remediation backlog.' },
  { cat: 14, id: '14.6', name: 'Total near-token value count',
    value: nearDupColorCount + nearDupFontSizes + nearDupSpacings,
    st: status(nearDupColorCount + nearDupFontSizes + nearDupSpacings, 10, 25),
    desc: 'Values visually close to a DS token but not exact. Quick wins: normalizing these to their nearest token closes the gap fast.' },
  { cat: 14, id: '14.7', name: 'Total one-off value count',
    value: null, st: null, desc: 'Total values used only once across the site. One-offs add complexity with no reuse benefit.' },
  { cat: 14, id: '14.8', name: 'Design system adoption score',
    value: adoptionScore, unit: '%',
    st: status(adoptionScore, 60, 40, true),
    desc: 'Composite: 40% token usage + 25% component coverage + 15% consistency + 10% contrast + 10% consistency. The headline "how well is the DS followed?" number.' },
  { cat: 14, id: '14.9', name: 'Design system drift score',
    value: driftScore, unit: '%',
    st: status(driftScore, 40, 60),
    desc: 'Inverse of adoption score. How far the product has wandered from its design system.' },
  { cat: 14, id: '14.10', name: 'Normalization opportunity count',
    value: normalizationOpportunities,
    st: status(normalizationOpportunities, 20, 60),
    desc: 'Places where an existing token could replace a current raw value without creating a new token. The fastest path to better coverage.' },
  { cat: 14, id: '14.11', name: 'Token creation candidate count',
    value: totalTokenCandidates,
    st: status(totalTokenCandidates, 5, 15),
    desc: 'Repeated raw values (appearing 2+ times) that don\'t have a token yet. Each is a candidate to expand the design system.' },
  { cat: 14, id: '14.12', name: 'Component creation candidate count',
    value: Math.max(0, customComponentEst),
    st: status(Math.max(0, customComponentEst), 2, 5),
    desc: 'Repeated custom UI patterns with no DS component counterpart. Adding them to the system multiplies the value of fixing them once.' },
];

// ── group into categories ─────────────────────────────────────────────────────
const catMap = {};
for (const m of metrics) {
  if (!catMap[m.cat]) catMap[m.cat] = { id: m.cat, label: m.catLabel || '', metrics: [] };
  if (m.catLabel) catMap[m.cat].label = m.catLabel;
  catMap[m.cat].metrics.push({
    id: m.id, name: m.name, value: m.value ?? null,
    site: m.site ?? null, ds: m.ds ?? null, unit: m.unit || null,
    status: m.st || null, desc: m.desc,
  });
}

const output = {
  generated_at: new Date().toISOString().slice(0, 10),
  categories: Object.values(catMap),
};

fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(output, null, 2) + '\n');
const computed = metrics.filter((m) => m.value != null && m.value !== '').length;
console.log(`ds-metrics: wrote metrics.json — ${metrics.length} metrics across ${Object.keys(catMap).length} categories, ${computed} computed, ${metrics.length - computed} requiring manual/Playwright review.`);
