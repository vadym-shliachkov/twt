#!/usr/bin/env node
// gen-gallery.mjs — scaffolder + checker for the component-catalog gallery.html.
//
// The gallery used to be 100% hand-written by the MODEL, which made it the only
// design-system artifact with no script backbone: the doc-hub chrome CSS lived
// as a paste-verbatim block in the skill (drifting from preview's), and the
// recurring defects (dark-on-dark text, stretched logos, silently missing
// components) were all hand-authoring bugs nothing detected. This script gives
// the gallery the same deal preview.html got from gen-preview.mjs: the CHROME
// and per-component cell shells are generated; the model fills one `gal:fill`
// slot per component with the variant × state specimens (token-only var(--…)).
//
//   node gen-gallery.mjs <projectDir> --scaffold   write gallery.html chrome + slots
//   node gen-gallery.mjs <projectDir> --check      read-only evidence JSON (for
//                                                  /twt-component-validate): unfilled
//                                                  slots, inventory coverage, raw
//                                                  hex/px literals in specimens,
//                                                  <img> height guard, dark-surface
//                                                  contrast suspects
//
// Reads:
//   .twt-artifacts/design/design-system/tokens.css                   (var resolution)
//   .twt-artifacts/design/design-system/tokens.md                    (§3.2/3.3/3.4 inventory)
//   .twt-artifacts/design/design-system/observed-components.md       (preferred §3 inventory)
//   .twt-artifacts/design/design-system/component/components.md      (catalog specs — ## tier / ### name)
//   .twt-artifacts/design/design-system/component/gallery.html       (--check)
// Writes (--scaffold only):
//   .twt-artifacts/design/design-system/component/gallery.html
//
// Prints a ```json block to stdout (qa-scan style). Exit 0 always (evidence,
// not pass/fail); exit 2 on bad usage. --check never writes anything.
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { projectFontLinks } from './lib/google-fonts.mjs';

const projectDir = process.argv[2];
const scaffold = process.argv.includes('--scaffold');
const checkOnly = process.argv.includes('--check');
if (!projectDir || (!scaffold && !checkOnly) || (scaffold && checkOnly)) {
  console.error('usage: gen-gallery.mjs <projectDir> --scaffold | --check');
  process.exit(2);
}

const DS = join(projectDir, '.twt-artifacts', 'design', 'design-system');
const COMP = join(DS, 'component');
const CSS = join(DS, 'tokens.css');
const OBSERVED_MD = join(DS, 'observed-components.md');
const TOKENS_MD = join(DS, 'tokens.md');
const CATALOG_MD = join(COMP, 'components.md');
const OUT = join(COMP, 'gallery.html');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- tokens.css custom-property parsing + var() resolution (as gen-preview) --
const vars = new Map();
if (existsSync(CSS)) {
  const noComments = readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
  for (const seg of noComments.split(/@media[^{]*\{/)) {
    let m;
    declRe.lastIndex = 0;
    while ((m = declRe.exec(seg)) !== null) {
      const name = m[1].trim();
      if (!vars.has(name)) vars.set(name, m[2].trim().replace(/\s+/g, ' '));
    }
  }
}
function resolveVal(val, depth = 0) {
  if (depth > 12 || !val) return val;
  return val.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, ref, fallback) => {
    if (vars.has(ref)) return resolveVal(vars.get(ref), depth + 1);
    return fallback ? resolveVal(fallback.trim(), depth + 1) : `var(${ref})`;
  });
}
function parseColor(v) {
  if (!v) return null;
  v = v.trim();
  let m;
  if ((m = v.match(/^#([0-9a-f]{3,8})$/i))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
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
  // gradients: judge by the first parseable stop (good enough for "is it dark")
  if (/gradient\s*\(/i.test(v)) {
    const stop = (v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i) || [])[0];
    return stop ? parseColor(stop) : null;
  }
  return null;
}
function composite(fg, bg) {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
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

// ---- inventory: tokens.md/observed-components.md §3 tables ∪ components.md headings
function parseSection3() {
  const file = existsSync(OBSERVED_MD) ? OBSERVED_MD : existsSync(TOKENS_MD) ? TOKENS_MD : null;
  const buckets = { primitives: [], components: [], modules: [] };
  if (!file) return buckets;
  const KEY = { '3.2': 'primitives', '3.3': 'components', '3.4': 'modules' };
  let cur = null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const h = line.match(/^###\s+(3\.[234])\b/);
    if (h) { cur = KEY[h[1]]; continue; }
    if (/^###\s+3\.[1567]\b/.test(line) || /^##\s+4\b/.test(line)) cur = null;
    if (!cur) continue;
    const row = line.match(/^\|\s*\*\*([^*]+)\*\*\s*\|([^|]*)\|/);
    if (row) buckets[cur].push({ name: row[1].trim(), note: row[2].trim().replace(/`/g, '') });
  }
  return buckets;
}
// components.md: `## Primitives` / `## Components` / `## Modules` sections with
// one `### <Component name>` heading per component (the format the define skill writes).
function parseCatalogMd() {
  const buckets = { primitives: [], components: [], modules: [] };
  if (!existsSync(CATALOG_MD)) return buckets;
  let cur = null;
  for (const line of readFileSync(CATALOG_MD, 'utf8').split(/\r?\n/)) {
    const tier = line.match(/^##\s+(Primitives|Components|Modules)\b/i);
    if (tier) { cur = tier[1].toLowerCase(); continue; }
    if (/^##\s+/.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const h = line.match(/^###\s+(.+?)\s*$/);
    if (h) buckets[cur].push({ name: h[1].replace(/[#*`]/g, '').trim(), note: '' });
  }
  return buckets;
}
function unionInventory() {
  const s3 = parseSection3(), cat = parseCatalogMd();
  const out = {};
  for (const k of ['primitives', 'components', 'modules']) {
    const seen = new Map();
    for (const it of [...s3[k], ...cat[k]]) {
      const key = it.name.toLowerCase();
      if (!seen.has(key)) seen.set(key, it);
      else if (!seen.get(key).note && it.note) seen.get(key).note = it.note;
    }
    out[k] = [...seen.values()];
  }
  return out;
}
const inv = unionInventory();
const invAll = [...inv.primitives, ...inv.components, ...inv.modules];

function projName() {
  if (existsSync(TOKENS_MD)) {
    const m = readFileSync(TOKENS_MD, 'utf8').match(/^#\s+Design System\s+—\s+(.+?)\s*$/m);
    if (m) return m[1];
  }
  return basename(projectDir);
}

// ---- doc-hub light chrome (the canonical skin — single source; the skill no
// longer carries a paste-verbatim copy). Keep in visual lockstep with the gp-
// skin gen-preview.mjs renders so the two sheets read as one system.
const CHROME_CSS = `:root{
  --gal-page:#ffffff; --gal-panel:#ffffff; --gal-panel-soft:#f8f9fc;
  --gal-ink:#090e22; --gal-text:#3a3f5c; --gal-muted:#7a82a8;
  --gal-rule:#dde0ee; --gal-rule-soft:rgba(122,130,168,.18);
  --gal-red:#ca221f; --gal-blue:#0b68b7; --gal-yellow:#f6c22b;
  --gal-action:#090e22; --gal-action-hover:#0e1630;
  --gal-font-heading:Montserrat,Avenir Next,ui-sans-serif,system-ui,sans-serif;
  --gal-font-body:Inter,Segoe UI,ui-sans-serif,system-ui,sans-serif;
  --gal-font-mono:"IBM Plex Mono",SFMono-Regular,Menlo,Consolas,monospace;
}
html{background:var(--gal-page)}
body{margin:0;min-width:320px;color:var(--gal-text);background:var(--gal-page);font-family:var(--gal-font-body);line-height:1.55;text-rendering:optimizeLegibility}
code{font-family:var(--gal-font-mono);font-size:.88em}
.gal-wrap{max-width:1120px;margin:0 auto;padding:64px 24px 96px}
.gal-head{padding:24px 0 52px;border-bottom:1px solid var(--gal-rule)}
.gal-project{display:block;margin:0 0 26px;color:var(--gal-blue);font-family:var(--gal-font-heading);font-size:clamp(1.45rem,3vw,2.15rem);font-weight:800;line-height:1.12}
.gal-project::after{content:"";display:block;width:72px;height:4px;margin:22px 0 0;background:linear-gradient(90deg,var(--gal-red) 0 33%,var(--gal-blue) 33% 66%,var(--gal-yellow) 66% 100%)}
.gal-head h1{max-width:760px;margin:0 0 18px;color:var(--gal-ink);font-family:var(--gal-font-heading);font-size:clamp(3rem,6.8vw,5.75rem);font-weight:800;line-height:.98}
.gal-head .gal-legend{max-width:760px;margin:0;color:var(--gal-text);font-size:1.05rem}
.gal-tier{margin:0;padding:64px 0;border-top:1px solid var(--gal-rule)}
.gal-tag{display:inline-flex;align-items:center;gap:10px;margin:0 0 8px;color:var(--gal-blue);font-family:var(--gal-font-heading);font-size:.82rem;font-weight:700}
.gal-tag::before{content:"";width:30px;height:6px;border-radius:999px;background:linear-gradient(90deg,var(--gal-yellow) 0 33%,var(--gal-red) 33% 66%,var(--gal-blue) 66% 100%)}
.gal-th{margin:0 0 18px;color:var(--gal-ink);font-family:var(--gal-font-heading);font-size:clamp(1.8rem,3.4vw,3rem);font-weight:800;line-height:1.05;text-wrap:balance}
.gal-sub{display:block;margin:56px 0 18px;color:var(--gal-ink);font-family:var(--gal-font-heading);font-size:1.05rem;font-weight:800}
.gal-legend{max-width:92ch;margin-bottom:20px;color:var(--gal-text);font-size:.92rem;line-height:1.6}
.gal-legend code{color:var(--gal-ink);background:var(--gal-panel-soft);border:1px solid var(--gal-rule-soft);padding:2px 6px;border-radius:4px}
/* component cells: name-first cards with a delimited specimen stage */
.gal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.gal-cell{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--gal-rule);border-radius:8px;background:var(--gal-panel);transition:transform 160ms ease-out,border-color 160ms ease-out,box-shadow 160ms ease-out}
@media (hover:hover) and (pointer:fine){.gal-cell:hover{transform:translateY(-2px);border-color:rgba(11,104,183,.42);box-shadow:0 10px 24px rgba(9,14,34,.06)}}
/* card header: WHAT it is, in ink — readable at first glance */
.gal-cell-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.gal-name{font-family:var(--gal-font-heading);font-size:.92rem;font-weight:800;color:var(--gal-ink);line-height:1.2}
.gal-meta{font-family:var(--gal-font-mono);font-size:.66rem;color:var(--gal-muted);text-align:right}
/* specimen stage: dashed canvas that separates live specimens from chrome text */
.gal-stage{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:14px;padding:14px;border:1px dashed var(--gal-rule);border-radius:6px}
.gal-stage--bare{padding:0;border:none;display:block}
/* one variant/state instance + its own micro-label (no positional guessing) */
.gal-var{display:flex;flex-direction:column;gap:5px;align-items:flex-start;max-width:100%}
.gal-var--row{flex-direction:row;align-items:center;gap:10px;flex-wrap:wrap}
.gal-var--fill{align-self:stretch}
.gal-varlabel{font-family:var(--gal-font-mono);font-size:.62rem;letter-spacing:.05em;text-transform:uppercase;color:var(--gal-muted)}
/* footnote: token refs / behavior notes only — never repeats the card name */
.gal-note{margin-top:auto;padding-top:10px;border-top:1px solid var(--gal-rule-soft);color:var(--gal-muted);font-size:.75rem;line-height:1.5}
/* guard: an <img> specimen must never overflow or squash */
.gal-cell img{max-width:100%;object-fit:contain}
/* modules render full-width, one per row */
.gal-grid--modules{grid-template-columns:1fr}
@media (max-width:760px){.gal-wrap{padding:36px 16px 72px}.gal-head h1{font-size:clamp(2.6rem,14vw,4.2rem)}.gal-tier{padding:48px 0}.gal-sub{margin:44px 0 16px}}`;

// ---- scaffold ----------------------------------------------------------------
const TIERS = [
  { key: 'primitives', tag: 'Tier 2', title: 'Primitives', legend: 'The smallest functional units. Every variant and every state, one <code>gal-var</code> per instance with its own micro-label. Specimens are styled with <code>var(--…)</code> tokens only.' },
  { key: 'components', tag: 'Tier 3', title: 'Components', legend: 'Compositions of primitives — which parts each one reuses is noted in <code>components.md</code>. Same rules: all variants, all states, token-only styling.' },
  { key: 'modules', tag: 'Tier 4', title: 'Modules', legend: 'Full sections (header, hero, footer, …). Dark or full-bleed modules replace the dashed canvas via <code>gal-stage--bare</code> and must scope-override every text primitive they contain to the on-dark token.' },
];

function cellShell(it) {
  return `      <div class="gal-cell" data-component="${esc(it.name)}">
        <header class="gal-cell-head"><span class="gal-name">${esc(it.name)}</span><span class="gal-meta"></span></header>
        <div class="gal-stage">
          <!-- gal:fill ${esc(it.name)} — replace this comment with the full variant × state matrix for “${esc(it.name)}”: one <div class="gal-var"> per instance (specimen, then <span class="gal-varlabel">label</span>), token-only var(--…) styling. Note in gal-meta one key token if helpful.${it.note ? ` Spec note: ${esc(it.note)}` : ''} -->
        </div>
      </div>`;
}
function tierSection(t) {
  const items = inv[t.key];
  if (!items.length) return '';
  return `  <section class="gal-tier" id="gal-${t.key}">
    <p class="gal-tag">${t.tag}</p>
    <h2 class="gal-th">${t.title}</h2>
    <p class="gal-legend">${t.legend}</p>
    <div class="gal-grid${t.key === 'modules' ? ' gal-grid--modules' : ''}">
${items.map(cellShell).join('\n')}
    </div>
  </section>`;
}

if (scaffold) {
  if (!invAll.length) {
    console.log('gen-gallery: no component inventory found (tokens.md §3.2–3.4 or component/components.md) — write the specs first, then re-run.');
    printJson({ ok: false, reason: 'empty inventory' });
    process.exit(0);
  }
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Component Gallery — ${esc(projName())}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700;800;900&display=swap">
${projectFontLinks(existsSync(CSS) ? readFileSync(CSS, 'utf8') : '', { 'ibm plex mono': [400, 500], inter: [400, 500, 600, 700], montserrat: [600, 700, 800, 900] })}
<link rel="stylesheet" href="../tokens.css">
<style data-gal-chrome>
${CHROME_CSS}
</style>
<style data-gal-specimens>
/* Model-authored specimen styles ONLY. Every value must be var(--…) from
   ../tokens.css — no raw hex, rgba, px, or font literals. Chrome styles live in
   the data-gal-chrome block above; never edit that block. */
</style>
</head>
<body>
<div class="gal-wrap">
  <header class="gal-head">
    <p class="gal-project">Project name: ${esc(projName())}</p>
    <h1>Component Gallery</h1>
    <p class="gal-legend">The exhaustive <b>depth</b> catalog — every component with all its variants × states, grouped Primitives → Components → Modules. <a href="../preview.html">../preview.html</a> shows <b>breadth</b>: every design token rendered live. Both sheets share the doc-hub light skin so they read as one system. Scaffold generated by <code>gen-gallery.mjs</code>; specimens are project-authored.</p>
  </header>
${TIERS.map(tierSection).filter(Boolean).join('\n')}
</div>
</body>
</html>`;
  mkdirSync(COMP, { recursive: true });
  writeFileSync(OUT, html);
  console.log(`gen-gallery: wrote scaffold — ${inv.primitives.length}+${inv.components.length}+${inv.modules.length} cells, all slots unfilled (fill every gal:fill comment next).`);
  printJson({
    tool: 'gen-gallery', mode: 'scaffold', out: OUT,
    counts: { cells: invAll.length, primitives: inv.primitives.length, components: inv.components.length, modules: inv.modules.length, unfilled_slots: invAll.length },
    unfilled_slots: invAll.map((i) => i.name),
  });
  process.exit(0);
}

// ---- check --------------------------------------------------------------------
if (!existsSync(OUT)) {
  console.log(`gen-gallery: no gallery.html at ${OUT} — run --scaffold (or /twt-component-define) first.`);
  printJson({ tool: 'gen-gallery', mode: 'check', ok: false, reason: 'gallery.html missing' });
  process.exit(0);
}
const html = readFileSync(OUT, 'utf8');

// unfilled slots
const unfilled = [];
for (const m of html.matchAll(/<!--\s*gal:fill\s+([\s\S]*?)-->/g)) {
  unfilled.push(m[1].split(/\s+—/)[0].trim());
}

// inventory coverage via data-component
const present = new Set();
for (const m of html.matchAll(/data-component="([^"]+)"/g)) present.add(m[1].toLowerCase());
const missing = invAll.filter((i) => !present.has(i.name.toLowerCase())).map((i) => i.name);
const invNames = new Set(invAll.map((i) => i.name.toLowerCase()));
const extras = [...present].filter((n) => !invNames.has(n));

// style blocks: first data-gal-chrome (or the first block, in pre-scaffold files)
// is chrome and MAY hardcode; everything after must be token-only.
const styleBlocks = [...html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi)].map((m) => ({ attrs: m[1], css: m[2] }));
let chromeSeen = false;
const specimenCss = [];
for (const b of styleBlocks) {
  const isChrome = /data-gal-chrome/.test(b.attrs) || (!chromeSeen && !/data-gal-specimens/.test(b.attrs));
  if (isChrome && !chromeSeen) { chromeSeen = true; continue; }
  specimenCss.push(b.css);
}
// raw value literals in specimen CSS (ignore rules on .gal- chrome selectors)
const rawValues = [];
for (const css of specimenCss) {
  for (const rm of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = rm[1].trim(), body = rm[2];
    if (/^\.gal-/.test(sel)) continue;
    for (const lit of body.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b\d+(?:\.\d+)?px\b/gi)) {
      // px inside var() fallbacks or 0px/1px hairlines are tolerated noise? No — report all; the validator judges.
      rawValues.push({ selector: sel.slice(0, 80), literal: lit[0] });
      if (rawValues.length >= 60) break;
    }
    if (rawValues.length >= 60) break;
  }
}
// inline style="" literals inside the body (outside chrome)
const bodyHtml = (html.split(/<body[^>]*>/i)[1] || html);
for (const m of bodyHtml.matchAll(/style="([^"]*)"/g)) {
  for (const lit of m[1].matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)) {
    rawValues.push({ selector: 'inline style', literal: lit[0] });
    if (rawValues.length >= 60) break;
  }
}

// <img> height guard: an image without an explicit height distorts in flex columns
const imgsMissingHeight = [];
for (const m of bodyHtml.matchAll(/<img\b[^>]*>/gi)) {
  const tag = m[0];
  const hasH = /\bheight\s*=|height\s*:/.test(tag);
  if (!hasH) imgsMissingHeight.push(tag.slice(0, 120));
}

// dark-surface contrast suspects (heuristic):
// 1. from specimen CSS, find classes whose background resolves dark (relLum < .35)
// 2. for each element carrying such a class, collect descendant class names
// 3. resolve each text class's effective color — scoped rule (selector mentions the
//    dark/scope class) wins over its bare rule — and flag contrast < 3:1
const classBg = new Map();   // class -> {color, decl}
const classColorRules = [];  // {sel, color}
for (const css of specimenCss) {
  for (const rm of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = rm[1].trim(), body = rm[2];
    const bg = body.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (bg) {
      const c = parseColor(resolveVal(bg[1].trim()));
      if (c) for (const cm of sel.matchAll(/\.([\w-]+)/g)) classBg.set(cm[1], { color: c });
    }
    const col = body.match(/(?:^|;|\s)color\s*:\s*([^;]+)/i);
    if (col) {
      const c = parseColor(resolveVal(col[1].trim()));
      if (c) classColorRules.push({ sel, color: c });
    }
  }
}
function innerOf(startIdx) {
  // walk tags from the element open tag at startIdx; return inner HTML up to its close
  const tagRe = /<\/?[a-zA-Z][^>]*>/g;
  tagRe.lastIndex = startIdx;
  let depth = 0, first = true, from = -1;
  let m;
  while ((m = tagRe.exec(bodyHtml)) !== null) {
    const t = m[0];
    const selfClosing = /\/>$/.test(t) || /^<(img|br|hr|input|meta|link)\b/i.test(t);
    if (t[1] === '/') { depth--; if (depth <= 0) return bodyHtml.slice(from, m.index); }
    else if (!selfClosing) { depth++; if (first) { from = tagRe.lastIndex; first = false; } }
    if (depth <= 0 && !first) break;
  }
  return '';
}
const darkSuspects = [];
const darkClasses = [...classBg.entries()].filter(([, v]) => {
  const c = v.color.a < 1 ? composite(v.color, { r: 255, g: 255, b: 255, a: 1 }) : v.color;
  return relLum(c) < 0.35;
});
for (const [dcls, { color: surface }] of darkClasses) {
  const elRe = new RegExp(`<[a-zA-Z][^>]*class="[^"]*\\b${dcls}\\b[^"]*"[^>]*>`, 'g');
  let m;
  while ((m = elRe.exec(bodyHtml)) !== null) {
    const elClasses = new Set(((m[0].match(/class="([^"]+)"/) || [])[1] || '').split(/\s+/));
    const inner = innerOf(m.index);
    const seen = new Set();
    for (const cm of inner.matchAll(/class="([^"]+)"/g)) for (const cls of cm[1].split(/\s+/)) seen.add(cls);
    for (const cls of seen) {
      if (cls === dcls || /^gal-/.test(cls)) continue;
      // A scoped override only counts if its scope class is actually APPLIED —
      // on the dark element itself or somewhere inside it. A `.spec-on-ink .x`
      // rule with no spec-on-ink in the markup protects nothing.
      const scoped = classColorRules.filter((r) => {
        if (!r.sel.includes(`.${cls}`)) return false;
        if (r.sel.includes(`.${dcls}`)) return true;
        const scopeClasses = [...r.sel.matchAll(/\.([\w-]+)/g)].map((x) => x[1]).filter((c) => c !== cls);
        return scopeClasses.length > 0 && scopeClasses.every((sc) => elClasses.has(sc) || seen.has(sc));
      });
      const bare = classColorRules.filter((r) => r.sel.includes(`.${cls}`) && !scoped.includes(r));
      const rule = scoped[scoped.length - 1] || bare[bare.length - 1];
      if (!rule) continue; // no color declared anywhere — inherits; can't judge statically
      const r = ratio(rule.color, surface);
      if (r < 3.0 && !darkSuspects.some((s) => s.surface_class === dcls && s.text_class === cls)) {
        darkSuspects.push({ surface_class: dcls, text_class: cls, ratio: Math.round(r * 100) / 100, scoped_override: scoped.length > 0 });
      }
    }
    if (darkSuspects.length >= 40) break;
  }
}

const summary = {
  tool: 'gen-gallery', mode: 'check', out: null,
  counts: {
    cells: present.size,
    inventory: { primitives: inv.primitives.length, components: inv.components.length, modules: inv.modules.length },
    unfilled_slots: unfilled.length,
    inventory_missing: missing.length,
    inventory_extras: extras.length,
    raw_values: rawValues.length,
    imgs_missing_height: imgsMissingHeight.length,
    dark_surface_suspects: darkSuspects.length,
  },
  unfilled_slots: unfilled,
  inventory_missing: missing,
  inventory_extras: extras,
  raw_values: rawValues,
  imgs_missing_height: imgsMissingHeight,
  // heuristic static-cascade check — confirm each suspect before treating as a defect
  dark_surface_suspects: darkSuspects,
};
console.log(`gen-gallery (check) — ${present.size} cells, ${unfilled.length} unfilled slot(s), ${missing.length} missing vs inventory, ${rawValues.length} raw literal(s), ${imgsMissingHeight.length} img(s) without height, ${darkSuspects.length} dark-surface suspect(s).`);
printJson(summary);
process.exit(0);

function printJson(obj) {
  console.log('```json');
  console.log(JSON.stringify(obj, null, 2));
  console.log('```');
}
