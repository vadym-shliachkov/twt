#!/usr/bin/env node
// ds-shots.mjs — block visuals for /twt-design-system-audit (v2).
//
// Reads audit.json, picks a bounded target set (one canonical example per
// cluster + every itemized finding instance) and produces a thumbnail per
// target so the HTML report can show the block being criticized:
//
//   • Playwright path — if `import('playwright')` succeeds AND Chromium
//     launches: goto(page) once per page, then element-screenshot each block
//     → shots/<cluster>-<n>.png.
//   • Fallback path  — no Playwright (or a capture failed): slice the block's
//     outer HTML out of the crawler-saved pages/<slug>.html and wrap it with a
//     <base href> + the page's own stylesheets → previews/<cluster>-<n>.html,
//     which renders faithfully inside a sandboxed iframe.
//
// Writes visuals.json: { <vid>: { page, block, cluster, kind:"png"|"html",
// path } } (value is null when neither path could produce anything). Never
// throws on a missing block — degrades to "no thumbnail" for that target.
//
// Zero hard deps (Playwright is optional). Usage:
//   node ds-shots.mjs --out <auditDir> [--max-shots N]

import fs from 'node:fs';
import path from 'node:path';

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

// Approximate outer-HTML extraction (same non-nesting heuristic as ds-audit's
// region scan — deliberately minimal). Returns the first element of `tag`
// whose attributes carry the given id and all the given classes.
function extractBlockHtml(html, sel) {
  const { tag, classes, id } = parseSel(sel);
  const re = new RegExp('<' + escapeRe(tag) + '\\b([^>]*)>([\\s\\S]*?)</' + escapeRe(tag) + '>', 'gi');
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (id && !new RegExp('\\bid=["\']' + escapeRe(id) + '["\']', 'i').test(attrs)) continue;
    const classAttr = ((attrs.match(/\bclass=["']([^"']+)["']/i) || [, ''])[1] || '')
      .toLowerCase().split(/\s+/).filter(Boolean);
    if (classes.length && !classes.every((c) => classAttr.includes(c.toLowerCase()))) continue;
    return m[0];
  }
  return null;
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

// ── fallback: embedded-HTML preview ──────────────────────────────────────────
function writePreview(target, audit, previewsDir, name) {
  const meta = (audit.page_stylesheets || {})[target.page];
  const slug = meta ? meta.slug : slugify(target.page);
  const pageFile = path.join(OUT, 'pages', slug + '.html');
  if (!fs.existsSync(pageFile)) return null;
  const html = fs.readFileSync(pageFile, 'utf8');
  const outer = extractBlockHtml(html, target.block);
  if (!outer) return null;
  const links = (meta && meta.stylesheets ? meta.stylesheets : [])
    .map((h) => `<link rel="stylesheet" href="${h}">`).join('\n  ');
  const doc = `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <base href="${target.page}">
  ${links}
  <style>body{margin:0}</style>
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

  // 1) Try Playwright screenshots (best fidelity).
  const usedPw = await tryPlaywright(targets, audit, shotsDir, name, visuals, captured);

  // 2) HTML-embed fallback for everything not captured by Playwright.
  for (const t of targets) {
    if (captured.has(t.id)) continue;
    const rel = writePreview(t, audit, previewsDir, name(t.cluster));
    visuals[t.id] = rel
      ? { page: t.page, block: t.block, cluster: t.cluster, kind: 'html', path: rel }
      : null;
  }

  fs.writeFileSync(path.join(OUT, 'visuals.json'), JSON.stringify(visuals, null, 2) + '\n');
  const png = Object.values(visuals).filter((v) => v && v.kind === 'png').length;
  const htm = Object.values(visuals).filter((v) => v && v.kind === 'html').length;
  const none = Object.values(visuals).filter((v) => !v).length;
  log(`visuals: ${png} screenshots, ${htm} embeds, ${none} missing (${usedPw ? 'playwright+fallback' : 'fallback only'})`);
})();
