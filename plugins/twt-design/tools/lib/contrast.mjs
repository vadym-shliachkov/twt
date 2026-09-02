// contrast.mjs — shared tokens.css parsing + WCAG contrast math.
//
// Single implementation of the color pipeline both the design phase
// (gen-preview.mjs) and QA (qa-scan.mjs a11y) use, so the ratios the design
// step reports and the ratios QA verifies can never disagree. Extracted
// verbatim from gen-preview.mjs — behavior is identical.
//
// Pure functions, no file I/O.
'use strict';

// ---- tokens.css custom-property parsing --------------------------------------
// Collect the BASE :root declarations (ignore @media overrides for resolution —
// colors don't change responsively; we want the canonical value).
export function parseCssVars(cssText) {
  const noComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const vars = new Map(); // name -> raw value (first/base definition wins)
  const order = [];       // preserve source order
  const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
  // Naive but effective @media handling: split on `@media ... {` and register
  // every declaration, base segment first, so base values win over media-only.
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
  return { vars, order };
}

// resolve var() chains to a concrete value
export function makeResolver(vars) {
  return function resolveVal(val, depth = 0) {
    if (depth > 12 || !val) return val;
    return val.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, ref, fallback) => {
      if (vars.has(ref)) return resolveVal(vars.get(ref), depth + 1);
      return fallback ? resolveVal(fallback.trim(), depth + 1) : `var(${ref})`;
    });
  };
}

// ---- color parsing + WCAG contrast ------------------------------------------
export function parseColor(v) {
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

export function isGradient(v) { return /gradient\s*\(/i.test(v || ''); }

export function composite(fg, bg) { // fg over bg, both {r,g,b,a}
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

export function relLum({ r, g, b }) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(fgRaw, bgRaw) {
  const bg = bgRaw.a < 1 ? composite(bgRaw, { r: 255, g: 255, b: 255, a: 1 }) : bgRaw;
  const fg = fgRaw.a < 1 ? composite(fgRaw, bg) : fgRaw;
  const L1 = relLum(fg), L2 = relLum(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---- color-token extraction ---------------------------------------------------
// Every custom property whose RESOLVED value parses as a solid color.
// (Font stacks, lengths, shadows, and gradients all fail parseColor, so no
// category pre-filtering is needed for contrast purposes.)
export function colorTokensFromCss(cssText) {
  const { vars, order } = parseCssVars(cssText);
  const resolveVal = makeResolver(vars);
  const out = [];
  for (const name of order) {
    const raw = vars.get(name);
    const resolved = resolveVal(raw);
    if (isGradient(resolved)) continue;
    const c = parseColor(resolved);
    if (c) out.push({ name, raw, resolved, color: c });
  }
  return out;
}

// ---- contrast matrix ----------------------------------------------------------
const TEXT_HINT = /text|heading|label|body|ink|foreground|\bfg\b|on-dark|on-light|caption|muted/i;
const SURFACE_HINT = /surface|background|\bbg\b|\bpage\b|panel|card|white|canvas|base|hero/i;

// Prefer role-alias tokens; dedupe by resolved value so --color-heading and --ink
// (same hex) don't both clutter the matrix — keep the role-named one.
function pickSet(colorTokens, hint) {
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

// Build the matrix only for INTENDED polarity pairs (dark text on light surface,
// or light text on dark surface). A dark-on-dark pair is not a real pairing, so
// it is reported as n/a rather than a false FAIL.
// Returns { rows, failures } — failures are the intended pairs below AA 4.5:1.
export function buildContrastMatrix(colorTokens) {
  const textSet = pickSet(colorTokens, TEXT_HINT);
  const surfaceSet = pickSet(colorTokens, SURFACE_HINT);
  const rows = [];
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
      rows.push(row);
      if (intended && !aaNormal) failures.push(row);
    }
  }
  return { rows, failures, textSet, surfaceSet };
}
