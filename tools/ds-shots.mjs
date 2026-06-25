#!/usr/bin/env node
// ds-shots.mjs — block visuals for /twt-design-system-audit (v3).
//
// Reads audit.json, picks a bounded target set (one canonical example per
// cluster + every itemized finding instance) and produces a thumbnail per
// target so the HTML report can show the block being criticized:
//
//   • Playwright path  — if `import('playwright')` succeeds AND Chromium
//     launches: goto(page) once per page, then element-screenshot each block
//     → shots/<cluster>-<n>.png. Skipped when --html-only is passed.
//   • HTML-embed path  — slice the block's outer HTML out of the crawler-saved
//     pages/<slug>.html, fetch each linked stylesheet and INLINE it as a
//     <style> block (so the iframe renders faithfully without cross-origin
//     requests), add 20px body padding, and save as previews/<cluster>-<n>.html
//     inside a sandboxed iframe. Used for blocks Playwright didn't capture.
//
// Flags:
//   --out <dir>          audit output directory (default: .twt-artifacts/design/design-system-audit)
//   --max-shots N        cap on targets (default: 400)
//   --html-only          skip Playwright entirely; use HTML-embed for every block
//
// Writes visuals.json: { <vid>: { page, block, cluster, kind:"png"|"html",
// path } } (value is null when neither path could produce anything). Never
// throws on a missing block — degrades to "no thumbnail" for that target.
//
// Zero hard deps (Playwright is optional). Usage:
//   node ds-shots.mjs --out <auditDir> [--max-shots N] [--html-only]

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

// ── args ──────────────────────────────────────────────────────────────────
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
const MAX_SHOTS = flags['max-shots'] ? parseInt(flags['max-shots'], 10) || 400 : 400;
const htmlOnly = Boolean(flags['html-only']);

function log(msg) { console.error('ds-shots: ' + msg); }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Must match ds-audit.mjs's slugify so we resolve the right pages/<slug>.html.
function slugify(s) {
  return String(s).replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'index';
}
// Stable visual id for a block instance — ds-audit-report.mjs reproduces this.
function vid(page, block) { return slugify(page) + '##' + block; }

// `section.hero.dark#top` → { tag, classes:[…], id }
function parseSel(sel) {
  const [left, id = ''] = String(sel).split('#');
  const parts = left.split('.');
  const tag = parts.shift() || 'div';
  return { tag, classes: parts.filter(Boolean), id };
}

// Outer-HTML extraction with DEPTH BALANCING. The previous version used a
// non-nesting regex `<tag>…</tag>` that stops at the FIRST `</tag>`, so any
// block containing nested elements of the same tag (a <div> full of <div>s,
// a <section> with inner <section>s) was truncated to a broken fragment that
// rendered as a white square. Here we find the matching opening tag, then walk
// forward tracking nesting depth to the real closing tag.
function extractBlockHtml(html, sel) {
  const { tag, classes, id } = parseSel(sel);
  const openRe = new RegExp('<' + escapeRe(tag) + '\\b([^>]*)>', 'gi');
  let m;
  while ((m = openRe.exec(html))) {
    const attrs = m[1] || '';
    if (id && !new RegExp('\\bid=["\']' + escapeRe(id) + '["\']', 'i').test(attrs)) continue;
    const classAttr = ((attrs.match(/\bclass=["']([^"']+)["']/i) || [, ''])[1] || '')
      .toLowerCase().split(/\s+/).filter(Boolean);
    if (classes.length && !classes.every((c) => classAttr.includes(c.toLowerCase()))) continue;
    const start = m.index;
    if (/\/>\s*$/.test(m[0])) return m[0]; // self-closing opener
    // Depth scan from just after the opening tag to the balanced close.
    const tokRe = new RegExp('<(' + escapeRe(tag) + ')\\b[^>]*?(/?)>|</' + escapeRe(tag) + '\\s*>', 'gi');
    tokRe.lastIndex = openRe.lastIndex;
    let depth = 1, t;
    while ((t = tokRe.exec(html))) {
      if (t[0][1] === '/') { if (--depth === 0) return html.slice(start, tokRe.lastIndex); }
      else if (t[2] !== '/') depth++; // a real (non-self-closing) nested open
    }
    return html.slice(start); // unbalanced markup — best-effort to EOF
  }
  return null;
}

// ── stylesheet fetching + caching ─────────────────────────────────────────
const styleCache = new Map(); // url → css string | null

async function fetchText(url) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout: 8000 }, (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}

async function fetchStylesheet(url) {
  if (styleCache.has(url)) return styleCache.get(url);
  const css = await fetchText(url);
  styleCache.set(url, css);
  return css;
}

// ── target set ──────────────────────────────────────────────────────────────
function buildTargets(audit) {
  const seen = new Set();
  const targets = []; // { id, page, block, cluster }
  const add = (page, block, cluster) => {
    if (!page || !block) return;
    const id = vid(page, block);
    if (seen.has(id)) return;
    seen.add(id);
    targets.push({ id, page, block, cluster: cluster || 'C0' });
  };
  // One canonical example per cluster.
  for (const cl of audit.canonical_blocks || []) {
    if (cl.example) add(cl.example.page, cl.example.block, cl.id);
  }
  // Every itemized finding instance.
  for (const d of audit.deviations || []) add(d.page, d.block, d.cluster);
  return targets.slice(0, MAX_SHOTS);
}

// Per-cluster filename counter so files read as <cluster>-<n>.<ext>.
function namer() {
  const n = {};
  return (cluster) => { n[cluster] = (n[cluster] || 0) + 1; return cluster + '-' + n[cluster]; };
}

// ── HTML-embed preview (with inlined stylesheets) ─────────────────────────
async function writePreview(target, audit, previewsDir, name) {
  const meta = (audit.page_stylesheets || {})[target.page];
  const slug = meta ? meta.slug : slugify(target.page);
  const pageFile = path.join(OUT, 'pages', slug + '.html');
  if (!fs.existsSync(pageFile)) return null;
  const html = fs.readFileSync(pageFile, 'utf8');
  const outer = extractBlockHtml(html, target.block);
  if (!outer) return null;

  // Fetch and inline each stylesheet so the iframe is fully self-contained —
  // no cross-origin requests needed, no sandbox blocking.
  const urls = (meta && meta.stylesheets) ? meta.stylesheets : [];
  const styleBlocks = (await Promise.all(
    urls.map(async (u) => {
      const css = await fetchStylesheet(u);
      return css ? `<style>\n/* inlined: ${u} */\n${css}\n</style>` : '';
    }),
  )).filter(Boolean);

  // Extract :root CSS variable definitions from the page's inline <style>
  // blocks. These define custom properties (--ink, --silver, etc.) that
  // component classes reference but that aren't in any linked stylesheet.
  const inlineVarDefs = [];
  const inlineStyleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let ism;
  while ((ism = inlineStyleRe.exec(html))) {
    const rootRe = /:root\s*\{([^}]+)\}/g;
    let rm;
    while ((rm = rootRe.exec(ism[1]))) inlineVarDefs.push(rm[1]);
  }
  const rootVarsBlock = inlineVarDefs.length ? `<style>:root{${inlineVarDefs.join('')}}</style>` : '';

  const doc = `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <base href="${target.page}">
  ${rootVarsBlock}
  ${styleBlocks.join('\n  ')}
  <style>
    html,body{margin:0;padding:0;background:#fff}
    *{box-sizing:border-box}
    img,video{max-width:100% !important;height:auto !important}
    svg,canvas{max-width:100% !important}
    /* Block lifted out of its parent — restore a sane content width */
    body>*{max-width:1200px;margin-inline:auto}
  </style>
</head><body>
${outer}
</body></html>`;
  const file = path.join(previewsDir, name + '.html');
  fs.writeFileSync(file, doc);
  return 'previews/' + name + '.html';
}

// ── playwright: element screenshots ──────────────────────────────────────────
async function tryPlaywright(targets, audit, shotsDir, name, visuals, captured) {
  let pw;
  try { pw = await import('playwright'); }
  catch { log('playwright not installed — using HTML-embed fallback'); return false; }
  let browser;
  try { browser = await pw.chromium.launch(); }
  catch (e) { log('chromium launch failed (' + (e && e.message) + ') — using fallback'); return false; }

  // Group targets by page so each page loads once.
  const byPage = new Map();
  for (const t of targets) {
    if (!byPage.has(t.page)) byPage.set(t.page, []);
    byPage.get(t.page).push(t);
  }
  for (const [page, group] of byPage) {
    let pg;
    try {
      pg = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await pg.goto(page, { waitUntil: 'networkidle', timeout: 20000 });
    } catch (e) { log('goto failed for ' + page + ' (' + (e && e.message) + ')'); if (pg) await pg.close().catch(() => {}); continue; }
    for (const t of group) {
      const fileName = name(t.cluster);
      try {
        const loc = pg.locator(cssFromSel(t.block)).first();
        await loc.waitFor({ state: 'visible', timeout: 4000 });
        const file = path.join(shotsDir, fileName + '.png');
        await loc.screenshot({ path: file });
        visuals[t.id] = { page: t.page, block: t.block, cluster: t.cluster, kind: 'png', path: 'shots/' + fileName + '.png' };
        captured.add(t.id);
      } catch { /* leave for fallback */ }
    }
    await pg.close().catch(() => {});
  }
  await browser.close().catch(() => {});
  return true;
}
// The block selector is already CSS-ish; Playwright accepts it as-is.
function cssFromSel(sel) { return sel; }

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const auditPath = path.join(OUT, 'audit.json');
  if (!fs.existsSync(auditPath)) { log('audit.json not found in ' + OUT + ' — run ds-audit first'); process.exit(1); }
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const targets = buildTargets(audit);

  const shotsDir = path.join(OUT, 'shots');
  const previewsDir = path.join(OUT, 'previews');
  ensureDir(shotsDir); ensureDir(previewsDir);

  const visuals = {};
  const captured = new Set();
  const name = namer();

  // 1) Try Playwright screenshots (best fidelity). Skipped in --html-only mode.
  let usedPw = false;
  if (!htmlOnly) {
    usedPw = await tryPlaywright(targets, audit, shotsDir, name, visuals, captured);
  } else {
    log('--html-only: skipping Playwright, using HTML-embed for all blocks');
  }

  // 2) HTML-embed fallback (with inlined stylesheets) for everything not captured.
  log(`fetching stylesheets for ${targets.length - captured.size} HTML previews…`);
  for (const t of targets) {
    if (captured.has(t.id)) continue;
    const rel = await writePreview(t, audit, previewsDir, name(t.cluster));
    visuals[t.id] = rel
      ? { page: t.page, block: t.block, cluster: t.cluster, kind: 'html', path: rel }
      : null;
  }

  fs.writeFileSync(path.join(OUT, 'visuals.json'), JSON.stringify(visuals, null, 2) + '\n');
  const png = Object.values(visuals).filter((v) => v && v.kind === 'png').length;
  const htm = Object.values(visuals).filter((v) => v && v.kind === 'html').length;
  const none = Object.values(visuals).filter((v) => !v).length;
  const mode = htmlOnly ? 'html-only' : usedPw ? 'playwright+fallback' : 'playwright-unavailable → html fallback';
  log(`visuals: ${png} screenshots, ${htm} embeds, ${none} missing (${mode})`);
})();
