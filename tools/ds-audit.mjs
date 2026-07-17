#!/usr/bin/env node
// ds-audit.mjs — deterministic core for /twt-design-system-audit.
//
// Does the token-heavy work so the skill doesn't have to: crawl a site (static
// HTML+CSS), extract a per-page block inventory, cluster near-duplicate blocks
// across pages, detect each instance's deviations from the cluster canonical
// (or a provided tokens.css), and compute consistency + design-system-quality
// signals. Emits one ```json block to stdout and writes audit.json to --out.
//
// Zero runtime deps (same pattern as qa-scan.mjs / gen-preview.mjs). Static
// analysis is approximate — no CSS cascade, no JS execution — so it flags
// low-confidence (JS-rendered) pages instead of pretending. A Playwright pass
// is a future upgrade; the skill degrades to static today.
//
// Usage:
//   node ds-audit.mjs site <url> --out <dir> [--tokens <tokens.css>] [--max N]
//   node ds-audit.mjs analyze <blocks.json> --out <dir> [--tokens <tokens.css>]
//
// blocks.json (the normalized inventory the Figma path produces model-side):
//   { "blocks": [ { page, role, tag, classes:[], structure:{headings,buttons,
//                   images,lists,inputs}, styles:{colors:[],spacing:[],
//                   fontSizes:[],radius:[],shadow:bool} } ] }

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const sub = argv[0];
const positional = [];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { flags[key] = true; }
    else { flags[key] = next; i++; }
  } else positional.push(a);
}
const OUT = flags.out ? String(flags.out) : '.twt-artifacts/design/design-system-audit';
const MAX = flags.max ? parseInt(flags.max, 10) || 20 : 20;
const TOKENS_PATH = flags.tokens ? String(flags.tokens) : null;
const DS_SOURCE = flags['ds-source'] ? String(flags['ds-source']) : null; // provided | synthesized
const COUNT_ONLY = !!flags['count-only']; // fast link-discovery pass — no block/CSS extraction

function die(msg) { console.error('ds-audit: ' + msg); process.exit(1); }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function slugify(s) {
  return String(s).replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'index';
}

// ── networking (static crawl) ────────────────────────────────────────────────
function fetchUrl(target, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 4) return resolve({ status: 0, body: '', url: target });
    let lib;
    try { lib = new URL(target).protocol === 'http:' ? http : https; }
    catch { return resolve({ status: 0, body: '', url: target }); }
    const req = lib.get(target, { timeout: 15000, headers: { 'User-Agent': 'twt-ds-audit/1.0' } }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        return resolve(fetchUrl(new URL(loc, target).href, redirects + 1));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 4_000_000) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data, url: target }));
    });
    req.on('error', () => resolve({ status: 0, body: '', url: target }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', url: target }); });
  });
}

function sameHost(a, b) { try { return new URL(a).host === new URL(b).host; } catch { return false; } }

// Canonicalize a page URL so `https://site.com` and `https://site.com/` (and
// `/about` vs `/about/`) don't crawl as two separate pages — which doubled the
// home page and inflated the page/cluster counts. Drops hash + query and the
// trailing slash (except the bare root).
function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = ''; x.search = '';
    if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, '');
    return x.href;
  } catch { return u; }
}

function extractLinks(html, base) {
  const out = [];
  const re = /<a\b[^>]*\bhref=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      u.hash = ''; u.search = '';
      const ext = u.pathname.toLowerCase();
      if (/\.(pdf|zip|jpg|jpeg|png|gif|svg|webp|css|js|ico|woff2?|ttf|mp4|xml)$/.test(ext)) continue;
      if (/^(mailto|tel|javascript):/.test(m[1])) continue;
      out.push(normUrl(u.href));
    } catch { /* ignore */ }
  }
  return out;
}

// Absolute hrefs of every <link rel=stylesheet> on a page (resolved against
// the page URL) — consumed by ds-shots.mjs's embed-preview fallback.
function stylesheetHrefs(html, base) {
  const out = [];
  const linkRe = /<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi;
  const hrefRe = /\bhref=["']([^"']+)["']/i;
  for (const ln of html.match(linkRe) || []) {
    const h = ln.match(hrefRe);
    if (!h) continue;
    try { out.push(new URL(h[1], base).href); } catch { /* ignore */ }
  }
  return [...new Set(out)];
}

// Linked stylesheets are cached across pages: a shared site.css is fetched
// once and counted ONCE in the aggregate CSS (`fresh`), so frequency-based
// metrics don't see it multiplied by the page count. `page` still carries the
// full CSS this page loads (for per-block fingerprinting).
const sheetCache = new Map(); // abs url → css string ('' on failure)
async function collectCss(html, base) {
  let inline = '';
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html))) inline += '\n' + m[1];
  let page = inline, fresh = inline;
  const linkRe = /<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi;
  const hrefRe = /\bhref=["']([^"']+)["']/i;
  const links = html.match(linkRe) || [];
  for (const ln of links.slice(0, 12)) {
    const h = ln.match(hrefRe);
    if (!h) continue;
    try {
      const u = new URL(h[1], base).href;
      if (sheetCache.has(u)) { page += '\n' + sheetCache.get(u); continue; }
      const r = await fetchUrl(u);
      const body = (r.status >= 200 && r.status < 300) ? '\n/* ' + u + ' */\n' + r.body : '';
      sheetCache.set(u, body);
      page += body; fresh += body;
    } catch { /* ignore */ }
  }
  return { page, fresh };
}

// The site's real root font-size (for rem→px conversion). Last html/:root
// font-size declaration wins; defaults to 16px.
function detectRootFontPx(css) {
  let px = 16;
  const re = /(?:^|[}\s,])(?:html|:root)\b[^{}]*\{([^}]*)\}/gi;
  let m;
  while ((m = re.exec(css))) {
    const f = m[1].match(/font-size\s*:\s*([\d.]+)\s*(px|%|em|rem)/i);
    if (!f) continue;
    const n = parseFloat(f[1]);
    const u = f[2].toLowerCase();
    px = u === 'px' ? n : u === '%' ? 16 * (n / 100) : 16 * n;
  }
  return Math.round(px * 100) / 100;
}

// ── block extraction (static, approximate) ───────────────────────────────────
const ROLE_KEYWORDS = [
  ['nav', /\bnav(bar|igation)?\b|menu/i, 'nav'],
  ['header', /\bheader|masthead|topbar\b/i, 'header'],
  ['footer', /\bfooter|site-foot\b/i, 'footer'],
  ['hero', /\bhero|banner|jumbotron|intro\b/i, 'hero'],
  ['cards', /\bcard|grid|tiles|listing|portfolio|gallery|posts|services\b/i, 'cards'],
  ['cta', /\bcta|call-to-action|signup|subscribe|newsletter\b/i, 'cta'],
  ['features', /\bfeature|benefit|highlights\b/i, 'features'],
  ['testimonial', /\btestimonial|quote|review\b/i, 'testimonial'],
  ['form', /\bform|contact\b/i, 'form'],
  ['pricing', /\bpricing|plans|tiers\b/i, 'pricing'],
];

// Role is classified from the block's OWN classes + id only. Inner HTML used
// to be part of the haystack, which misclassified whole sections from
// incidental content (a "Contact" link made a sticky CTA a `form`; a child
// with a *-header class made a plain section a `header`).
function guessRole(tag, classes, id) {
  if (tag === 'nav') return 'nav';
  if (tag === 'header') return 'header';
  if (tag === 'footer') return 'footer';
  const hay = classes.join(' ') + ' ' + (id || '');
  for (const [, re, role] of ROLE_KEYWORDS) if (re.test(hay)) return role;
  return 'section';
}

// Index just past the balanced closing tag for an element whose opening tag
// ends at `afterOpenIdx`. Returns { end, innerEnd } (innerEnd = closing tag's
// start). Best-effort to EOF on unbalanced markup.
function balancedEnd(html, tag, afterOpenIdx) {
  const tokRe = new RegExp('<' + tag + '\\b[^>]*?(/?)>|</' + tag + '\\s*>', 'gi');
  tokRe.lastIndex = afterOpenIdx;
  let depth = 1, t;
  while ((t = tokRe.exec(html))) {
    if (t[0][1] === '/') { if (--depth === 0) return { end: tokRe.lastIndex, innerEnd: t.index }; }
    else if (t[1] !== '/') depth++;
  }
  return { end: html.length, innerEnd: html.length };
}

// Pull TOP-LEVEL page regions: semantic landmarks (header/nav/footer/section/
// article) plus class-bearing divs — with real nesting rules. The previous
// version regex-matched class-bearing divs ANYWHERE in the page, so a hero's
// inner wrapper, a header's nav-links div, and a grid's card all became
// separate "blocks", double-counting the same UI at several DOM depths and
// letting the report recommend "unifying" a container with its own child.
// Now every region's balanced extent is computed and any candidate nested
// inside an accepted region is dropped; page-spanning wrapper divs are skipped
// (their children surface instead).
function topLevelRegions(html) {
  const semantic = [];
  const openRe = /<(header|nav|footer|section|article)\b([^>]*)>/gi;
  let m;
  while ((m = openRe.exec(html))) {
    const tag = m[1].toLowerCase();
    const { end, innerEnd } = balancedEnd(html, tag, openRe.lastIndex);
    semantic.push({ tag, attrs: m[2] || '', inner: html.slice(openRe.lastIndex, innerEnd), start: m.index, end });
  }
  const contains = (outer, c) => c.start >= outer.start && c.end <= outer.end && !(c.start === outer.start && c.end === outer.end);
  const accepted = [];
  semantic.sort((a, b) => (a.start - b.start) || (b.end - a.end));
  for (const c of semantic) {
    if (accepted.some((p) => contains(p, c))) continue; // e.g. <nav> inside <header>
    accepted.push(c);
  }
  // Class-bearing divs: only those that are not inside an accepted region, do
  // not wrap one (page/layout wrappers), and are not page-spanning.
  const bodyLen = ((html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, html])[1] || html).length;
  const divs = [];
  const divRe = /<div\b([^>]*\bclass=["'][^"']+["'][^>]*)>/gi;
  let d;
  while ((d = divRe.exec(html))) {
    const { end, innerEnd } = balancedEnd(html, 'div', divRe.lastIndex);
    const inner = html.slice(divRe.lastIndex, innerEnd);
    if (inner.length < 40) continue;
    divs.push({ tag: 'div', attrs: d[1] || '', inner, start: d.index, end });
  }
  divs.sort((a, b) => (a.start - b.start) || (b.end - a.end));
  let divCount = 0;
  for (const c of divs) {
    if (divCount >= 40) break;
    if (c.inner.length > bodyLen * 0.6) continue;             // page wrapper — recurse via children
    if (accepted.some((p) => contains(p, c))) continue;       // nested inside an accepted block
    if (accepted.some((p) => contains(c, p))) continue;       // wraps an accepted block
    accepted.push(c); divCount++;
  }
  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

function attrClasses(attrs) {
  const c = attrs.match(/\bclass=["']([^"']+)["']/i);
  return c ? c[1].trim().split(/\s+/).slice(0, 8) : [];
}
function attrId(attrs) { const i = attrs.match(/\bid=["']([^"']+)["']/i); return i ? i[1] : ''; }

function structure(inner) {
  const count = (re) => (inner.match(re) || []).length;
  return {
    headings: count(/<h[1-6]\b/gi),
    buttons: count(/<button\b|class=["'][^"']*\bbtn\b/gi),
    images: count(/<img\b|background-image/gi),
    lists: count(/<ul\b|<ol\b/gi),
    inputs: count(/<input\b|<textarea\b|<select\b/gi),
    links: count(/<a\b/gi),
  };
}

// Parse CSS into selector→declaration text, then collect declarations that
// reference any of a block's class names / id / tag.
function parseCssRules(css) {
  const rules = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) rules.push({ sel: m[1].trim(), decl: m[2].trim() });
  return rules;
}

const COLOR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)/gi;
const LEN_RE = /\b\d*\.?\d+(px|rem|em)\b/gi;

function styleFingerprint(rules, classes, id, tag, innerClasses = []) {
  // The block is its whole subtree: since nested wrappers are no longer
  // separate blocks, the fingerprint includes rules addressing the block's
  // descendant classes so drift inside the block is still seen.
  const keys = new Set([
    ...classes.map((c) => '.' + c.toLowerCase()),
    ...innerClasses.map((c) => '.' + c.toLowerCase()),
    id ? '#' + id.toLowerCase() : '', tag,
  ].filter(Boolean));
  let decl = '';
  for (const r of rules) {
    const sl = r.sel.toLowerCase();
    for (const k of keys) { if (sl.includes(k)) { decl += ';' + r.decl; break; } }
  }
  const colors = uniqLower(decl.match(COLOR_RE) || []);
  const fontSizes = uniqLower((decl.match(/font-size\s*:\s*[^;]+/gi) || []).flatMap((d) => d.match(LEN_RE) || []));
  const radius = uniqLower((decl.match(/border-radius\s*:\s*[^;]+/gi) || []).flatMap((d) => d.match(LEN_RE) || []));
  const spacing = uniqLower((decl.match(/(padding|margin|gap)\s*:\s*[^;]+/gi) || []).flatMap((d) => d.match(LEN_RE) || []));
  const shadow = /box-shadow\s*:\s*(?!none)/i.test(decl);
  return { colors, spacing, fontSizes, radius, shadow };
}
function uniqLower(arr) { return [...new Set(arr.map((x) => String(x).toLowerCase().trim()))]; }
// rem/em convert via the site's real root font-size (detected from html/:root),
// not a hardcoded 16 — 3rem on a 16px root IS 48px and must match a 48px token.
function lenToPx(v, rootPx = 16) {
  const m = String(v).trim().match(/^(-?\d*\.?\d+)(px|rem|em)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return (m[2] || 'px').toLowerCase() === 'px' ? n : n * rootPx;
}
// Canonicalize a color/length value so cosmetic formatting differences don't
// read as drift: collapse whitespace, expand short hex (#abc → #aabbcc), and
// pad leading-dot decimals (rgba(…,.5) → rgba(…,0.5)). Both the token set and
// the per-instance values are compared through this, so a token written
// `rgba(255, 255, 255, 0.5)` matches a use of `rgba(255,255,255,.5)`.
function normVal(v) {
  let s = String(v).toLowerCase().trim().replace(/\s+/g, '');
  const hm = s.match(/^#([0-9a-f]{3,4})$/);
  if (hm) s = '#' + hm[1].split('').map((c) => c + c).join('');
  s = s.replace(/([(,])\.(\d)/g, '$1' + '0.$2');
  s = s.replace(/(\d\.\d*?)0+(?=\D|$)/g, '$1'); // .80 → .8 (trailing zeros)
  s = s.replace(/(\d)\.(?=\D|$)/g, '$1');       // 1. → 1  (dangling dot)
  return s;
}

function looksJsRendered(html) {
  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, ''])[1];
  const text = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length < 200 && /<div\b[^>]*\bid=["'](root|app|__next)["']/i.test(html);
}

// Distinct class names inside a region's inner HTML (capped) — used to
// fingerprint the block's whole subtree.
function innerClassList(inner, cap = 40) {
  const out = new Set();
  const re = /class=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(inner)) && out.size < cap) {
    for (const c of m[1].trim().split(/\s+/)) { out.add(c); if (out.size >= cap) break; }
  }
  return [...out];
}

function blocksFromPage(pageUrl, html, css) {
  const rules = parseCssRules(css);
  const regions = topLevelRegions(html);
  const blocks = [];
  const seen = new Set();
  for (const reg of regions) {
    const classes = attrClasses(reg.attrs);
    const id = attrId(reg.attrs);
    if (reg.tag === 'div' && classes.length === 0) continue;
    const sig = (reg.tag + '|' + classes.join('.') + '|' + id);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const st = structure(reg.inner);
    let role = guessRole(reg.tag, classes, id);
    // "form" needs actual form controls — a section that merely says
    // "contact" is a call-to-action, not a form.
    if (role === 'form' && !st.inputs) role = 'cta';
    blocks.push({
      page: pageUrl,
      role,
      tag: reg.tag,
      classes,
      id,
      structure: st,
      styles: styleFingerprint(rules, classes, id, reg.tag, innerClassList(reg.inner)),
    });
  }
  return blocks;
}

// ── clustering + deviation scoring (shared core) ─────────────────────────────
function structDist(a, b) {
  const keys = ['headings', 'buttons', 'images', 'lists', 'inputs', 'links'];
  let d = 0;
  for (const k of keys) { const x = (a[k] || 0), y = (b[k] || 0); d += Math.abs(x - y) / (Math.max(x, y, 1)); }
  return d / keys.length; // 0 identical .. 1 very different
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}
const lc = (a) => (a || []).map((x) => String(x).toLowerCase());
// Cluster on identity (role + class signature + structure) — NOT on style.
// Style differences between members ARE the deviations we want to report, so
// they must never split an otherwise-identical component into two clusters.
// "Close but a little different" → same cluster, the divergent one flagged.
function similar(a, b) {
  if (a.role !== b.role) return false;
  const aHas = a.classes && a.classes.length, bHas = b.classes && b.classes.length;
  if (aHas && bHas) {
    if (jaccard(lc(a.classes), lc(b.classes)) >= 0.5) return true; // same component
    return structDist(a.structure, b.structure) <= 0.25;          // diff class, near-identical shape
  }
  return structDist(a.structure, b.structure) <= 0.4;             // no class info → structure proximity
}

function clusterBlocks(blocks) {
  const clusters = [];
  for (const b of blocks) {
    let placed = false;
    for (const cl of clusters) {
      if (similar(cl.members[0], b)) { cl.members.push(b); placed = true; break; }
    }
    if (!placed) clusters.push({ members: [b] });
  }
  clusters.forEach((cl, i) => { cl.id = 'C' + (i + 1); cl.role = cl.members[0].role; });
  return clusters;
}

function mode(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  let best = null, n = -1;
  for (const [k, v] of m) if (v > n) { best = k; n = v; }
  return best;
}
// Canonical = union of values that appear in the majority of members.
function canonicalStyles(cl) {
  const fields = ['colors', 'spacing', 'fontSizes', 'radius'];
  const out = {};
  const half = cl.members.length / 2;
  for (const f of fields) {
    const counts = new Map();
    for (const mb of cl.members) for (const v of mb.styles[f]) counts.set(v, (counts.get(v) || 0) + 1);
    out[f] = [...counts.entries()].filter(([, c]) => c >= half).map(([v]) => v);
  }
  out.structure = {};
  for (const k of ['headings', 'buttons', 'images', 'lists', 'inputs', 'links']) {
    out.structure[k] = mode(cl.members.map((mb) => mb.structure[k] || 0));
  }
  return out;
}

// Category of a length token, from its name. Length comparison is
// category-scoped: a font-size is only "on system" if it matches a type-scale
// (or uncategorized) token — never because some spacing step happens to share
// the number. The 'other' pool (container widths, terse live vars, breakpoints)
// is accepted for every field as "a value the system defines somewhere".
function tokenCategory(name) {
  if (/radius|rounded|corner/.test(name)) return 'radius';
  if (/font-size|text-size|type-|\bfs-|-size\b/.test(name)) return 'font-size';
  if (/space|gap|gutter|inset|pad|margin/.test(name)) return 'spacing';
  return 'other';
}
// Token values, split for unit-aware comparison: colors as normalized strings,
// lengths as px numbers per category (converted at the DS's own 16px root —
// tokens.css is authored against the default root).
function tokenValueSet(tokensCss) {
  if (!tokensCss) return null;
  const colors = new Set();
  const lens = { 'font-size': [], spacing: [], radius: [], other: [] };
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(tokensCss))) {
    const cat = tokenCategory(m[1].toLowerCase());
    for (const v of (m[2].match(COLOR_RE) || [])) colors.add(normVal(v));
    for (const v of (m[2].match(LEN_RE) || [])) {
      const px = lenToPx(v);
      if (px != null) lens[cat].push(px);
    }
  }
  return { colors, lens };
}
function lenPoolMatch(lens, cat, px, tol = 0.5) {
  const pool = (lens[cat] || []).concat(lens.other || []);
  return pool.some((t) => Math.abs(t - px) <= tol);
}

// A stable CSS-ish selector for a block instance (also used by ds-shots).
function blockSel(inst) {
  return inst.tag
    + (inst.classes.length ? '.' + inst.classes.join('.') : '')
    + (inst.id ? '#' + inst.id : '');
}

// A human-readable label for a cluster, shown next to the selector so the
// report reads "Diagnostic section" / "Site header" rather than only
// `section.sec.vfi.reveal#diagnostic`. Specific roles use a role noun
// (qualified by a meaningful id); the generic "section" role is named from its
// id or a non-utility class.
const ROLE_NOUN = {
  nav: 'Navigation', header: 'Site header', footer: 'Footer', hero: 'Hero',
  cards: 'Card grid', cta: 'Call-to-action', features: 'Features section',
  testimonial: 'Testimonial', form: 'Form', pricing: 'Pricing', section: 'Section',
};
const GENERIC_CLASS = /^(rows?|cols?|wrap|wrapper|inner|outer|container|grid|flex|sec|section|block|content|main|reveal|active|solid|child|items?|box|area|el|js|is|has)([-_]|$)/i;
function humanize(s) {
  return String(s).replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim().replace(/\b\w/g, (c) => c.toUpperCase());
}
function friendlyName(cl) {
  const roleNoun = ROLE_NOUN[cl.role] || 'Section';
  const inst = cl.members[0] || {};
  const id = inst.id || '';
  const idHint = (id && /[a-z]/i.test(id) && !/^[0-9]/.test(id) && !GENERIC_CLASS.test(id)) ? humanize(id) : '';
  if (cl.role === 'section') {
    if (idHint) return `${idHint} section`;
    const cls = (inst.classes || []).find((c) => c.length > 3 && !GENERIC_CLASS.test(c));
    return cls ? `${humanize(cls)} section` : 'Section';
  }
  if (idHint && !idHint.toLowerCase().includes(cl.role)) return `${roleNoun} · ${idHint}`;
  return roleNoun;
}

// Per-instance deviation scan. Returns:
//   deltas      — string[] (unchanged shape: human prose, one per delta)
//   deltas_typed— [{ type, severity, text }] (v2: adds the reason category)
//   reason_types— deduped category set
//   tier        — OK | SUGGESTION | WARNING | BLOCKER (the skill's tiering rule)
//   match       — 0..100
// When a design system exists, "drift" means a value that is NOT in the design
// system — measured against the token values in tokens.css, not against a
// per-cluster union of whatever the instances happen to use. (The old union
// approach flagged ~55% of blocks and emitted useless "differs from canonical
// (none)" deltas; comparing to the actual tokens is both accurate and slim.)
// Without a DS, fall back to the cluster's dominant pattern.
//
// Severity follows the audit tiering rule: a raw color where a palette exists
// is a BLOCKER; off-scale spacing/type/radius is a WARNING; a structural
// omission relative to the component's norm is a BLOCKER.
const SEVERITY_BY_TYPE = { color: 'BLOCKER', spacing: 'WARNING', 'font-size': 'WARNING', radius: 'WARNING' };
// Alpha of a color value (1 = opaque). Used to tier color drift: an opaque
// off-palette color is a real palette violation (BLOCKER); a translucent value
// is almost always an overlay/tint/shadow, which is lower-stakes (WARNING) and
// shouldn't flood the report with BLOCKERs.
function colorAlpha(v) {
  let m = String(v).match(/^(?:rgba?|hsla?)\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(/[,/\s]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1; }
  m = String(v).match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/i);
  if (m) { const h = m[1]; const a = h.length === 4 ? parseInt(h[3] + h[3], 16) : parseInt(h.slice(6, 8), 16); return a / 255; }
  return 1;
}
function colorSeverity(raw) { return colorAlpha(raw) < 0.85 ? 'WARNING' : 'BLOCKER'; }
function deviations(instance, canon, tokenVals, rootPx = 16) {
  const typed = [];
  const hasTokens = tokenVals && (tokenVals.colors.size > 0
    || Object.values(tokenVals.lens).some((a) => a.length > 0));
  const check = (field, label, type) => {
    const canonNorm = hasTokens ? null : new Set((canon[field] || []).map(normVal));
    for (const raw of instance.styles[field]) {
      const v = normVal(raw);
      if (hasTokens) {
        if (type === 'color') {
          if (tokenVals.colors.has(v)) continue; // value is part of the design system → OK
        } else {
          // Lengths compare in px (site rem/em resolved at the DETECTED root
          // font-size) against the same-category token pool. Radius keeps a
          // ±4px tolerance — 8 vs 12px is visually near-identical at display size.
          const rpx = lenToPx(raw, rootPx);
          if (rpx == null) continue; // not statically comparable — don't guess
          if (lenPoolMatch(tokenVals.lens, type, rpx, type === 'radius' ? 4 : 0.5)) continue;
        }
        typed.push({
          type, severity: type === 'color' ? colorSeverity(raw) : (SEVERITY_BY_TYPE[type] || 'WARNING'),
          text: `${label} \`${raw}\` is not a design-system token value`,
        });
      } else {
        if (canonNorm.has(v)) continue; // matches the cluster's dominant value
        // Radius: tolerate ±4 px vs the cluster's canonical radius
        if (type === 'radius') {
          const rpx = lenToPx(raw, rootPx);
          if (rpx != null && (canon[field] || []).some(cv => { const cpx = lenToPx(cv, rootPx); return cpx != null && Math.abs(cpx - rpx) <= 4; })) continue;
        }
        const shown = (canon[field] || []).slice(0, 3).join(', ');
        typed.push({
          type, severity: type === 'color' ? 'BLOCKER' : 'WARNING',
          text: shown
            ? `${label} \`${raw}\` is off the component norm (${shown}${canon[field].length > 3 ? '…' : ''})`
            : `${label} \`${raw}\` has no shared norm across this component`,
        });
      }
    }
  };
  check('colors', 'color', 'color');
  check('spacing', 'spacing', 'spacing');
  check('fontSizes', 'font-size', 'font-size');
  check('radius', 'radius', 'radius');
  for (const k of ['headings', 'buttons', 'images']) {
    const a = instance.structure[k] || 0, b = canon.structure[k] || 0;
    if (Math.abs(a - b) >= 2) {
      typed.push({ type: 'structure', severity: 'BLOCKER', text: `structure: ${k}=${a} vs the component norm of ${b}` });
    }
  }
  const deltas = typed.map((t) => t.text);
  const checked = 4 + 3;
  const match = Math.max(0, Math.round((1 - deltas.length / (checked + deltas.length || 1)) * 100));
  const tier = tierFor(typed, match);
  const reason_types = [...new Set(typed.map((t) => t.type))];
  return { deltas, deltas_typed: typed, reason_types, tier, match };
}

// Severity rollup for one instance: any structural omission or raw-value-where-
// a-token-exists → BLOCKER; otherwise a mostly-matching instance is a
// SUGGESTION, a clearly off one a WARNING; no deltas → OK.
function tierFor(typed, match) {
  if (!typed.length) return 'OK';
  if (typed.some((t) => t.severity === 'BLOCKER')) return 'BLOCKER';
  return match >= 80 ? 'SUGGESTION' : 'WARNING';
}

// DS stats for the report's "design-system review" — counts from the resolved
// tokens.css (deduped --var defs, bucketed by name/value) + cluster count.
function dsStats(tokensCss, componentCount, source) {
  const stats = {
    token_count: 0, color_count: 0, type_size_count: 0,
    space_count: 0, radius_count: 0, component_count: componentCount || 0,
    source: source || (tokensCss ? 'provided' : 'none'),
  };
  if (!tokensCss) return stats;
  const looksColor = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  const seen = new Set();
  let m;
  while ((m = re.exec(tokensCss))) {
    const name = m[1].toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    const val = m[2].toLowerCase();
    stats.token_count++;
    if (/color|brand|ink|\bbg\b|background|\bfg\b|foreground|surface|accent|border|fill|swatch/.test(name) || looksColor.test(val)) stats.color_count++;
    else if (/radius|rounded|corner/.test(name)) stats.radius_count++;
    else if (/space|gap|gutter|inset|\bpad|margin/.test(name)) stats.space_count++;
    else if (/font-size|\btext|type-|\bfs-|\bsize/.test(name) && /\d/.test(val)) stats.type_size_count++;
  }
  return stats;
}

function qualitySignals(allCss, tokensCss, rootPx = 16) {
  const tokenVals = tokenValueSet(tokensCss);
  const nonTokenCss = allCss; // tokens.css excluded by caller if desired
  const colors = uniqLower(nonTokenCss.match(COLOR_RE) || []);
  const lengths = uniqLower(nonTokenCss.match(LEN_RE) || []);
  const varRefs = uniqLower(nonTokenCss.match(/var\(\s*--[a-z0-9-]+/gi) || []).map((v) => v.replace(/var\(\s*/, ''));
  const definedVars = new Set((tokensCss ? tokensCss + allCss : allCss).match(/--[a-z0-9-]+(?=\s*:)/gi)?.map((v) => v.toLowerCase()) || []);
  const undefinedVarRefs = varRefs.filter((v) => !definedVars.has(v));
  const valuesUsed = [...colors, ...lengths];
  const allLenPx = tokenVals ? Object.values(tokenVals.lens).flat() : [];
  const covered = tokenVals
    ? colors.filter((c) => tokenVals.colors.has(normVal(c))).length
      + lengths.filter((l) => { const p = lenToPx(l, rootPx); return p != null && allLenPx.some((t) => Math.abs(t - p) <= 0.5); }).length
    : 0;
  const usesVars = (nonTokenCss.match(/var\(\s*--/g) || []).length;
  const tokenCoveragePct = valuesUsed.length
    ? Math.round(((covered + usesVars) / (valuesUsed.length + usesVars || 1)) * 100) : 0;
  const dupDefs = {};
  for (const v of (allCss.match(/--[a-z0-9-]+(?=\s*:)/gi) || [])) { const k = v.toLowerCase(); dupDefs[k] = (dupDefs[k] || 0) + 1; }
  return {
    token_coverage_pct: tokenCoveragePct,
    undefined_var_refs: undefinedVarRefs.length,
    distinct_colors: colors.length,
    distinct_lengths: lengths.length,
    breakpoint_count: (allCss.match(/@media\b/gi) || []).length,
    duplicate_token_defs: Object.values(dupDefs).filter((n) => n > 1).length,
  };
}

// ── assemble ─────────────────────────────────────────────────────────────────
function buildReport(blocks, allCss, tokensCss, extra = {}, opts = {}) {
  const tokenVals = tokenValueSet(tokensCss);
  const rootPx = opts.rootPx || detectRootFontPx(allCss);
  // Cap per-block delta lists so a block with dozens of off-token values can't
  // bloat audit.json (and the report) — keep the match score from the full
  // count, store a bounded list with an overflow marker.
  const capList = (arr, n = 12) => (arr.length <= n ? arr : [...arr.slice(0, n), `+${arr.length - n} more`]);
  const clusters = clusterBlocks(blocks);
  const clusterOut = [];
  const deviationsOut = [];
  const blockStatus = []; // one entry per instance (drifting AND OK) — full matrix
  let matchSum = 0, matchN = 0;
  for (const cl of clusters) {
    const canon = canonicalStyles(cl);
    const name = friendlyName(cl);
    const example = { page: cl.members[0].page, block: blockSel(cl.members[0]) };
    clusterOut.push({
      id: cl.id, role: cl.role, name, instances: cl.members.length,
      pages: [...new Set(cl.members.map((m) => m.page))],
      example,
      canonical: canon,
    });
    for (const inst of cl.members) {
      const dv = deviations(inst, canon, tokenVals, rootPx);
      matchSum += dv.match; matchN++;
      const sel = blockSel(inst);
      blockStatus.push({
        page: inst.page, block: sel, name, cluster: cl.id, role: cl.role,
        match: dv.match, tier: dv.tier,
        reason_types: dv.reason_types, reasons: capList(dv.deltas),
      });
      if (dv.deltas.length) {
        deviationsOut.push({
          cluster: cl.id, role: cl.role, name, page: inst.page, block: sel,
          match: dv.match, tier: dv.tier, reason_types: dv.reason_types,
          deltas: capList(dv.deltas),
        });
      }
    }
  }
  const consistency = matchN ? Math.round(matchSum / matchN) : 100;
  const tokensOnly = tokensCss || '';
  const result = {
    summary: {
      pages: [...new Set(blocks.map((b) => b.page))].length,
      blocks: blocks.length,
      clusters: clusters.length,
      consistency_pct: consistency,
      deviating_instances: deviationsOut.length,
      root_font_px: rootPx,
      ...extra,
    },
    ds_stats: dsStats(tokensCss, clusters.length, opts.dsSource),
    canonical_blocks: clusterOut,
    deviations: deviationsOut.sort((a, b) => a.match - b.match),
    block_status: blockStatus,
    quality_signals: qualitySignals(allCss.replace(tokensOnly, ''), tokensCss, rootPx),
  };
  if (opts.pageStylesheets) result.page_stylesheets = opts.pageStylesheets;
  return result;
}

function emit(result, outDir) {
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('```json');
  console.log(JSON.stringify(result, null, 2));
  console.log('```');
}

// ── subcommands ──────────────────────────────────────────────────────────────
async function runSite() {
  const start = normUrl(positional[0]);
  if (!positional[0]) die('site <url> required');
  const outDir = OUT, pagesDir = path.join(outDir, 'pages');
  if (!COUNT_ONLY) ensureDir(pagesDir);
  const tokensCss = TOKENS_PATH && fs.existsSync(TOKENS_PATH) ? fs.readFileSync(TOKENS_PATH, 'utf8') : null;
  const queue = [start], visited = new Set();
  const blocks = [];
  let allCss = '';
  const jsPages = [];
  const pageStylesheets = {}; // page URL → { slug, stylesheets:[abs hrefs] }
  while (queue.length && visited.size < MAX) {
    const url = queue.shift();
    if (visited.has(url) || !sameHost(url, start)) continue;
    visited.add(url);
    const res = await fetchUrl(url);
    if (res.status < 200 || res.status >= 300 || !res.body) continue;
    if (!COUNT_ONLY) {
      const css = await collectCss(res.body, url);
      allCss += '\n' + css.fresh;
      const slug = slugify(url);
      fs.writeFileSync(path.join(pagesDir, slug + '.html'), res.body);
      pageStylesheets[url] = { slug, stylesheets: stylesheetHrefs(res.body, url) };
      if (looksJsRendered(res.body)) jsPages.push(url);
      for (const b of blocksFromPage(url, res.body, css.page)) blocks.push(b);
    }
    for (const link of extractLinks(res.body, url)) if (!visited.has(link)) queue.push(link);
  }
  // Total unique pages discovered (visited + remaining queue, same-host, deduped).
  const allDiscovered = new Set(visited);
  for (const u of queue) { try { if (sameHost(u, start)) allDiscovered.add(normUrl(u)); } catch {} }
  const discoveredTotal = allDiscovered.size;
  if (COUNT_ONLY) {
    const out = { count_only: true, crawled: visited.size, discovered_total: discoveredTotal };
    console.log('```json');
    console.log(JSON.stringify(out, null, 2));
    console.log('```');
    return;
  }
  const result = buildReport(blocks, allCss, tokensCss, {
    crawled: visited.size,
    discovered_total: discoveredTotal,
    js_rendered_pages: jsPages,
    confidence: jsPages.length ? 'low (JS-rendered pages present — static analysis is partial)' : 'static',
  }, { pageStylesheets, dsSource: DS_SOURCE || (tokensCss ? 'provided' : 'none') });
  fs.writeFileSync(path.join(outDir, 'blocks.json'), JSON.stringify({ blocks }, null, 2) + '\n');
  // Aggregate site CSS (inline styles + each linked sheet ONCE) — persisted so
  // ds-metrics.mjs can measure the full stylesheet surface, not just inline
  // <style> blocks (which undercounted !important and missed the
  // prefers-reduced-motion block living in linked CSS).
  fs.writeFileSync(path.join(outDir, 'site-styles.css'), allCss);
  emit(result, outDir);
}

function runAnalyze() {
  const file = positional[0];
  if (!file || !fs.existsSync(file)) die('analyze <blocks.json> required (file not found)');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const blocks = (parsed.blocks || []).map((b) => ({
    page: b.page || 'unknown', role: b.role || 'section', tag: b.tag || 'section',
    classes: b.classes || [], id: b.id || '',
    structure: Object.assign({ headings: 0, buttons: 0, images: 0, lists: 0, inputs: 0, links: 0 }, b.structure || {}),
    styles: Object.assign({ colors: [], spacing: [], fontSizes: [], radius: [], shadow: false }, b.styles || {}),
  }));
  const tokensCss = TOKENS_PATH && fs.existsSync(TOKENS_PATH) ? fs.readFileSync(TOKENS_PATH, 'utf8') : null;
  const css = parsed.css || tokensCss || '';
  emit(buildReport(blocks, css, tokensCss, {}, { dsSource: DS_SOURCE || (tokensCss ? 'provided' : 'none') }), OUT);
}

(async () => {
  if (sub === 'site') await runSite();
  else if (sub === 'analyze') runAnalyze();
  else die('usage: ds-audit.mjs site <url> | analyze <blocks.json>  [--out dir] [--tokens tokens.css] [--max N] [--count-only]');
})();
