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
      out.push(u.href);
    } catch { /* ignore */ }
  }
  return out;
}

async function collectCss(html, base) {
  let css = '';
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html))) css += '\n' + m[1];
  const linkRe = /<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi;
  const hrefRe = /\bhref=["']([^"']+)["']/i;
  const links = html.match(linkRe) || [];
  for (const ln of links.slice(0, 12)) {
    const h = ln.match(hrefRe);
    if (!h) continue;
    try {
      const u = new URL(h[1], base).href;
      const r = await fetchUrl(u);
      if (r.status >= 200 && r.status < 300) css += '\n/* ' + u + ' */\n' + r.body;
    } catch { /* ignore */ }
  }
  return css;
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

function guessRole(tag, classes, html) {
  if (tag === 'nav') return 'nav';
  if (tag === 'header') return 'header';
  if (tag === 'footer') return 'footer';
  const hay = classes.join(' ') + ' ' + (html.slice(0, 200));
  for (const [, re, role] of ROLE_KEYWORDS) if (re.test(hay)) return role;
  return 'section';
}

// Pull top-level regions: header/nav/footer/main + section/article + direct
// div children that carry a class (a reasonable proxy for "a block").
function topLevelRegions(html) {
  const regions = [];
  const tagRe = /<(header|nav|footer|section|article)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    regions.push({ tag: m[1].toLowerCase(), attrs: m[2] || '', inner: m[3] || '' });
  }
  // Also class-bearing top divs that aren't already captured (cheap heuristic).
  const divRe = /<div\b([^>]*\bclass=["'][^"']+["'][^>]*)>([\s\S]{40,}?)<\/div>/gi;
  let d, count = 0;
  while ((d = divRe.exec(html)) && count < 40) {
    count++;
    regions.push({ tag: 'div', attrs: d[1] || '', inner: d[2] || '' });
  }
  return regions;
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

function styleFingerprint(rules, classes, id, tag) {
  const keys = new Set([...classes.map((c) => '.' + c.toLowerCase()), id ? '#' + id.toLowerCase() : '', tag].filter(Boolean));
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

function looksJsRendered(html) {
  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, ''])[1];
  const text = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length < 200 && /<div\b[^>]*\bid=["'](root|app|__next)["']/i.test(html);
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
    const role = guessRole(reg.tag, classes, reg.inner);
    blocks.push({
      page: pageUrl,
      role,
      tag: reg.tag,
      classes,
      id,
      structure: structure(reg.inner),
      styles: styleFingerprint(rules, classes, id, reg.tag),
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

function tokenValueSet(tokensCss) {
  if (!tokensCss) return null;
  const vals = new Set();
  const re = /--[a-z0-9-]+\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(tokensCss))) {
    for (const v of (m[1].match(COLOR_RE) || [])) vals.add(v.toLowerCase().trim());
    for (const v of (m[1].match(LEN_RE) || [])) vals.add(v.toLowerCase().trim());
  }
  return vals;
}

function deviations(instance, canon, tokenVals) {
  const out = [];
  const check = (field, label) => {
    for (const v of instance.styles[field]) {
      if (!canon[field].includes(v)) {
        const tokenHint = tokenVals && !tokenVals.has(v) ? ' — not a defined token value' : '';
        out.push(`${label} \`${v}\` differs from canonical (${canon[field].join(', ') || 'none'})${tokenHint}`);
      }
    }
  };
  check('colors', 'color');
  check('spacing', 'spacing');
  check('fontSizes', 'font-size');
  check('radius', 'radius');
  for (const k of ['headings', 'buttons', 'images']) {
    const a = instance.structure[k] || 0, b = canon.structure[k] || 0;
    if (Math.abs(a - b) >= 2) out.push(`structure: ${k}=${a} vs canonical ${b}`);
  }
  const checked = 4 + 3;
  const match = Math.max(0, Math.round((1 - out.length / (checked + out.length || 1)) * 100));
  return { deltas: out, match };
}

function qualitySignals(allCss, tokensCss) {
  const tokenVals = tokenValueSet(tokensCss) || new Set();
  const nonTokenCss = allCss; // tokens.css excluded by caller if desired
  const colors = uniqLower(nonTokenCss.match(COLOR_RE) || []);
  const lengths = uniqLower(nonTokenCss.match(LEN_RE) || []);
  const varRefs = uniqLower(nonTokenCss.match(/var\(\s*--[a-z0-9-]+/gi) || []).map((v) => v.replace(/var\(\s*/, ''));
  const definedVars = new Set((tokensCss ? tokensCss + allCss : allCss).match(/--[a-z0-9-]+(?=\s*:)/gi)?.map((v) => v.toLowerCase()) || []);
  const undefinedVarRefs = varRefs.filter((v) => !definedVars.has(v));
  const valuesUsed = [...colors, ...lengths];
  const covered = tokenVals.size ? valuesUsed.filter((v) => tokenVals.has(v)).length : 0;
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
function buildReport(blocks, allCss, tokensCss, extra = {}) {
  const tokenVals = tokenValueSet(tokensCss);
  const clusters = clusterBlocks(blocks);
  const clusterOut = [];
  const deviationsOut = [];
  let matchSum = 0, matchN = 0;
  for (const cl of clusters) {
    const canon = canonicalStyles(cl);
    clusterOut.push({
      id: cl.id, role: cl.role, instances: cl.members.length,
      pages: [...new Set(cl.members.map((m) => m.page))],
      canonical: canon,
    });
    for (const inst of cl.members) {
      const dv = deviations(inst, canon, tokenVals);
      matchSum += dv.match; matchN++;
      if (dv.deltas.length) {
        deviationsOut.push({
          cluster: cl.id, role: cl.role, page: inst.page,
          block: inst.tag + (inst.classes.length ? '.' + inst.classes.join('.') : '') + (inst.id ? '#' + inst.id : ''),
          match: dv.match, deltas: dv.deltas,
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
      ...extra,
    },
    canonical_blocks: clusterOut,
    deviations: deviationsOut.sort((a, b) => a.match - b.match),
    quality_signals: qualitySignals(allCss.replace(tokensOnly, ''), tokensCss),
  };
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
  const start = positional[0];
  if (!start) die('site <url> required');
  const outDir = OUT, pagesDir = path.join(outDir, 'pages');
  ensureDir(pagesDir);
  const tokensCss = TOKENS_PATH && fs.existsSync(TOKENS_PATH) ? fs.readFileSync(TOKENS_PATH, 'utf8') : null;
  const queue = [start], visited = new Set();
  const blocks = [];
  let allCss = '';
  const jsPages = [];
  while (queue.length && visited.size < MAX) {
    const url = queue.shift();
    if (visited.has(url) || !sameHost(url, start)) continue;
    visited.add(url);
    const res = await fetchUrl(url);
    if (res.status < 200 || res.status >= 300 || !res.body) continue;
    const css = await collectCss(res.body, url);
    allCss += '\n' + css;
    const slug = slugify(url);
    fs.writeFileSync(path.join(pagesDir, slug + '.html'), res.body);
    if (looksJsRendered(res.body)) jsPages.push(url);
    for (const b of blocksFromPage(url, res.body, css)) blocks.push(b);
    for (const link of extractLinks(res.body, url)) if (!visited.has(link)) queue.push(link);
  }
  const result = buildReport(blocks, allCss, tokensCss, {
    crawled: visited.size,
    js_rendered_pages: jsPages,
    confidence: jsPages.length ? 'low (JS-rendered pages present — static analysis is partial)' : 'static',
  });
  fs.writeFileSync(path.join(outDir, 'blocks.json'), JSON.stringify({ blocks }, null, 2) + '\n');
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
  emit(buildReport(blocks, css, tokensCss), OUT);
}

(async () => {
  if (sub === 'site') await runSite();
  else if (sub === 'analyze') runAnalyze();
  else die('usage: ds-audit.mjs site <url> | analyze <blocks.json>  [--out dir] [--tokens tokens.css] [--max N]');
})();
