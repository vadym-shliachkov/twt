#!/usr/bin/env node
// qa-scan.mjs — deterministic local-mode evidence for the twt QA skills.
//
// The QA skills used to read every built HTML/CSS file into the MODEL's context
// and ask it to COUNT things (hex/px literals, undefined var() refs, dead links,
// lorem blocks, missing alt text). Those are regex/parse jobs: this script does
// them in code and emits structured evidence (counts + file:line locations), so
// the model never ingests the source — it only SCORES and writes the findings
// prose from the evidence. The model still owns judgment (severity, "is this px
// literal sanctioned?"); the script owns the counting.
//
//   node qa-scan.mjs <check> <projectDir> [variant]
//     <check>       tokens | links | content | a11y
//     <projectDir>  the target project root (built site/ or mockup fallback)
//     [variant]     tokens only: "elementor" scans the Hello-Elementor child
//                   theme's CSS (widgets.css / design-system.css) instead of
//                   the static site — for /twt-qa-elementor's token-only check
//
// LOCAL MODE ONLY. Live (URL) audits stay model-driven via WebFetch — this script
// is never the right tool for a served URL.
//
// Output: a one-line human summary per category, then a fenced ```json block with
// { check, sources, counts, findings[] } where each finding = { kind, file, line,
// detail }. Exit 0 always (evidence, not pass/fail); exit 2 on bad usage; the
// model decides the verdict. Findings are capped (CAP) per kind to bound output.
'use strict';

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';

const CAP = 40; // max findings emitted per kind (counts are always exact)

const check = process.argv[2];
const projectDir = process.argv[3];
const variant = (process.argv[4] || '').trim();
if (!check || !projectDir || !['tokens', 'links', 'content', 'a11y'].includes(check)) {
  console.error('usage: qa-scan.mjs <tokens|links|content|a11y> <projectDir> [elementor]');
  process.exit(2);
}
const ART = join(projectDir, '.twt-artifacts');

// ---- source location ---------------------------------------------------------
// Prefer a built site/; fall back to the design mockup. Mirrors the QA skills'
// "site/*.html if site/ exists, otherwise mockup/pages/*.html" rule.
function listFiles(dir, ext) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, ext));
    else if (e.name.toLowerCase().endsWith(ext)) out.push(p);
  }
  return out;
}
// Hello-Elementor child theme CSS: the token-only files the elementor audit cares
// about (widgets.css / design-system.css), found anywhere under the theme dir.
function locateElementorCss() {
  const themesRoot = join(projectDir, 'wp-content', 'themes');
  if (!existsSync(themesRoot)) return { html: [], css: [], base: null };
  let themeDir = null;
  for (const e of readdirSync(themesRoot, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith('hello-elementor-')) { themeDir = join(themesRoot, e.name); break; }
  }
  if (!themeDir) return { html: [], css: [], base: null };
  const all = listFiles(themeDir, '.css');
  const named = all.filter((f) => /(?:^|[\\/])(widgets|design-system)\.css$/i.test(f));
  return { html: [], css: named.length ? named : all, base: themeDir };
}
function locate() {
  const siteDir = join(projectDir, 'site');
  if (existsSync(siteDir)) {
    return { html: listFiles(siteDir, '.html'), css: listFiles(siteDir, '.css'), base: siteDir };
  }
  const mockDir = join(ART, 'design', 'mockup');
  if (existsSync(mockDir)) {
    return { html: listFiles(join(mockDir, 'pages'), '.html').concat(listFiles(mockDir, '.html')),
             css: listFiles(mockDir, '.css'), base: mockDir };
  }
  return { html: [], css: [], base: null };
}

// ---- tiny utilities ----------------------------------------------------------
const rel = (p) => (p ? relative(projectDir, p).replace(/\\/g, '/') : p);
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
function lineOf(text, idx) { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') n++; return n; }
// Strip /* ... */ comments but keep length/offsets stable (replace with spaces).
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length)); }

function buildEvidenceHints(checkType, counts) {
  if (checkType === 'a11y') return {
    alt_text: `${counts.img_no_alt} image${counts.img_no_alt !== 1 ? 's' : ''} missing alt`,
    heading_landmarks: `${counts.heading_jumps} heading level skip${counts.heading_jumps !== 1 ? 's' : ''}, ${counts.missing_h1} page${counts.missing_h1 !== 1 ? 's' : ''} missing h1`,
    labels_roles: `${counts.control_no_label} unlabeled control${counts.control_no_label !== 1 ? 's' : ''}, ${counts.link_no_text} link${counts.link_no_text !== 1 ? 's' : ''} with no text`,
    contrast: '— compute from tokens.css WCAG AA pairs (not in scanner)',
    focusable: `${counts.missing_lang} page${counts.missing_lang !== 1 ? 's' : ''} missing lang attribute`,
  };
  if (checkType === 'tokens') return {
    token_only_styling: `${counts.hex_literals} hex + ${counts.length_literals} length + ${counts.font_literals} font literal${counts.font_literals !== 1 ? 's' : ''} across CSS`,
    defined_vars: `${counts.undefined_var_refs} undefined var() reference${counts.undefined_var_refs !== 1 ? 's' : ''}`,
    structure_vs_ds: '— check layout components manually against layouts/; not in scanner',
    consistency: '— check unique undocumented patterns manually; not in scanner',
  };
  if (checkType === 'links') return {
    internal_links: `${counts.dead_internal_links} dead internal link${counts.dead_internal_links !== 1 ? 's' : ''}, ${counts.dead_anchors} dead anchor${counts.dead_anchors !== 1 ? 's' : ''}`,
    asset_resolution: `${counts.missing_assets} missing asset${counts.missing_assets !== 1 ? 's' : ''}, ${counts.empty_or_placeholder_hrefs} placeholder href${counts.empty_or_placeholder_hrefs !== 1 ? 's' : ''}`,
    responsive_tiers: '— check @media breakpoints manually; not in scanner',
  };
  if (checkType === 'content') return {
    sitemap_coverage: `${counts.missing_pages} page${counts.missing_pages !== 1 ? 's' : ''} in sitemap not built, ${counts.extra_pages} built but not in sitemap`,
    real_content: `${counts.lorem_blocks} lorem block${counts.lorem_blocks !== 1 ? 's' : ''}, ${counts.placeholder_markers} placeholder marker${counts.placeholder_markers !== 1 ? 's' : ''}`,
    content_ia_fidelity: '— compare sections to outlines/ manually; not in scanner',
    heading_copy: `${counts.empty_headings} empty heading${counts.empty_headings !== 1 ? 's' : ''}`,
  };
  return {};
}

function emit(sources, counts, findings) {
  const capped = findings.slice(0, CAP * 8);
  const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ');
  console.log(`qa-scan ${check}: ${summary}  (sources: ${sources.length} file${sources.length === 1 ? '' : 's'})`);
  if (findings.length > capped.length) console.log(`(showing ${capped.length} of ${findings.length} locations; counts above are exact)`);
  console.log('```json');
  console.log(JSON.stringify({ check, sources: sources.map(rel), counts, evidence_hints: buildEvidenceHints(check, counts), findings: capped }, null, 2));
  console.log('```');
}

// ---- tokens ------------------------------------------------------------------
// Flags raw hex / length / font literals in token-only CSS, and var(--x) refs to
// custom properties defined nowhere. Literals that are the VALUE of a custom
// property definition (`--x: #abc`) are token definitions, not raw usage, so they
// are not flagged — this covers an inline `:root { --color-error:#B23A48 }` in a
// non-tokens file. The model still judges sanctioned exceptions (e.g. 44px touch
// targets, SVG geometry) from the reported locations.
function runTokens(css) {
  const findings = [];
  const counts = { hex_literals: 0, length_literals: 0, font_literals: 0, undefined_var_refs: 0 };
  const defined = new Set();   // every --x defined anywhere
  const referenced = [];       // {name, file, line}

  // Pass 1: collect all custom-property definitions across every CSS file.
  for (const f of css) {
    const src = stripComments(read(f));
    for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1].toLowerCase());
  }

  // Pass 2: scan each file for literals (excluding token-definition values) and var refs.
  for (const f of css) {
    const isTokens = /tokens\.css$/i.test(f);
    const src = stripComments(read(f));

    // Build a "scannable" copy where each `--x: <value>;` definition body is blanked
    // out (spaces), so literals that ARE token values don't count, but offsets hold.
    const scannable = src.replace(/(--[a-z0-9-]+\s*:)([^;}]*)/gi, (_, head, body) => head + ' '.repeat(body.length));

    // var(--x) references — checked against `defined` (collected from ALL files).
    for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      const name = m[1].toLowerCase();
      referenced.push({ name, file: f, line: lineOf(src, m.index) });
    }

    // tokens.css DEFINES values — don't flag literals there.
    if (isTokens) continue;

    // hex colors
    for (const m of scannable.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      counts.hex_literals++;
      findings.push({ kind: 'hex_literal', file: rel(f), line: lineOf(scannable, m.index), detail: m[0] });
    }
    // lengths with a unit (ignore 0 and unitless); px/rem/em/vh/vw/pt
    for (const m of scannable.matchAll(/(?<![\w.#-])(\d*\.?\d+)(px|rem|em|vh|vw|pt)\b/g)) {
      if (parseFloat(m[1]) === 0) continue;
      counts.length_literals++;
      findings.push({ kind: 'length_literal', file: rel(f), line: lineOf(scannable, m.index), detail: m[0] });
    }
    // raw font-family (a value that isn't a var())
    for (const m of scannable.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
      if (/var\(/i.test(m[1])) continue;
      counts.font_literals++;
      findings.push({ kind: 'font_literal', file: rel(f), line: lineOf(scannable, m.index), detail: m[1].trim().slice(0, 60) });
    }
  }

  for (const r of referenced) {
    if (!defined.has(r.name)) {
      counts.undefined_var_refs++;
      findings.push({ kind: 'undefined_var', file: rel(r.file), line: r.line, detail: `var(${r.name}) — not defined in any CSS` });
    }
  }
  return { counts, findings };
}

// ---- links -------------------------------------------------------------------
// Internal href/anchor integrity + asset resolution across the built HTML.
function runLinks(html) {
  const findings = [];
  const counts = { dead_internal_links: 0, dead_anchors: 0, missing_assets: 0, empty_or_placeholder_hrefs: 0 };

  // Map of page basename -> { anchors:Set, absPath }. Also index every page so
  // links like "about.html" resolve regardless of directory.
  const pages = new Map();
  for (const f of html) {
    const src = read(f);
    const anchors = new Set();
    for (const m of src.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) anchors.add(m[1]);
    for (const m of src.matchAll(/\bname\s*=\s*["']([^"']+)["']/gi)) anchors.add(m[1]);
    pages.set(basename(f).toLowerCase(), { anchors, absPath: f });
  }
  const fileExists = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

  for (const f of html) {
    const src = read(f);
    const here = dirname(f);
    // anchors/hrefs
    for (const m of src.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi)) {
      const href = m[1].trim(); const line = lineOf(src, m.index);
      if (href === '' || href === '#' || /^javascript:/i.test(href)) {
        counts.empty_or_placeholder_hrefs++;
        findings.push({ kind: 'placeholder_href', file: rel(f), line, detail: `href="${href}"` });
        continue;
      }
      if (/^(https?:|mailto:|tel:|data:)/i.test(href)) continue; // external — out of scope
      const [rawPath, frag] = href.split('#');
      const path = rawPath.split('?')[0]; // drop query string before resolving the page
      if (path === '') { // same-page anchor
        if (frag && !pages.get(basename(f).toLowerCase()).anchors.has(frag)) {
          counts.dead_anchors++;
          findings.push({ kind: 'dead_anchor', file: rel(f), line, detail: `#${frag} not found in page` });
        }
        continue;
      }
      const target = pages.get(basename(path).toLowerCase());
      if (!target && !fileExists(join(here, path))) {
        counts.dead_internal_links++;
        findings.push({ kind: 'dead_link', file: rel(f), line, detail: href });
      } else if (frag && target && !target.anchors.has(frag)) {
        counts.dead_anchors++;
        findings.push({ kind: 'dead_anchor', file: rel(f), line, detail: `${path}#${frag} — anchor missing` });
      }
    }
    // asset references (src / link href for css)
    for (const m of src.matchAll(/<(?:img|script|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      const url = m[1].trim();
      if (/^(https?:|data:|mailto:)/i.test(url)) continue;
      if (!fileExists(join(here, url.split('#')[0].split('?')[0]))) {
        counts.missing_assets++;
        findings.push({ kind: 'missing_asset', file: rel(f), line: lineOf(src, m.index), detail: url });
      }
    }
    for (const m of src.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
      const url = m[1].trim();
      if (/^(https?:|data:)/i.test(url)) continue;
      if (!fileExists(join(here, url.split('#')[0].split('?')[0]))) {
        counts.missing_assets++;
        findings.push({ kind: 'missing_asset', file: rel(f), line: lineOf(src, m.index), detail: url });
      }
    }
  }
  return { counts, findings };
}

// ---- content -----------------------------------------------------------------
// Lorem / placeholder / empty-block detection + optional sitemap coverage.
function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
             .replace(/<style[\s\S]*?<\/style>/gi, ' ')
             .replace(/<!--[\s\S]*?-->/g, ' ')
             .replace(/<[^>]+>/g, ' ');
}
function runContent(html) {
  const findings = [];
  const counts = { lorem_blocks: 0, placeholder_markers: 0, empty_headings: 0, missing_pages: 0, extra_pages: 0 };
  const PLACEHOLDER = /\b(lorem ipsum|dolor sit amet|placeholder|coming soon|tktk|tk tk|todo|tbd|xxxx+|\[[^\]]*\]|insert .* here)\b/gi;

  for (const f of html) {
    const src = read(f);
    const text = visibleText(src);
    for (const m of text.matchAll(/lorem ipsum/gi)) { counts.lorem_blocks++; findings.push({ kind: 'lorem', file: rel(f), line: lineOf(text, m.index), detail: text.slice(m.index, m.index + 50).replace(/\s+/g, ' ').trim() }); }
    for (const m of text.matchAll(PLACEHOLDER)) {
      if (/lorem ipsum/i.test(m[0])) continue; // already counted
      counts.placeholder_markers++;
      findings.push({ kind: 'placeholder', file: rel(f), line: lineOf(text, m.index), detail: m[0].slice(0, 50) });
    }
    for (const m of src.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
      if (visibleText(m[2]).trim() === '') { counts.empty_headings++; findings.push({ kind: 'empty_heading', file: rel(f), line: lineOf(src, m.index), detail: `empty <h${m[1]}>` }); }
    }
  }

  // Optional sitemap coverage: compare declared pages to built HTML basenames.
  const sitemap = join(ART, 'pre-design', 'ia', 'sitemap.md');
  if (existsSync(sitemap)) {
    const sm = read(sitemap);
    const declared = new Set();
    for (const m of sm.matchAll(/([a-z0-9][a-z0-9_-]*\.html)/gi)) declared.add(m[1].toLowerCase());
    const built = new Set(html.map((f) => basename(f).toLowerCase()));
    if (declared.size) {
      for (const d of declared) if (!built.has(d)) { counts.missing_pages++; findings.push({ kind: 'missing_page', file: 'sitemap.md', line: 0, detail: `${d} declared but not built` }); }
      for (const b of built) if (!declared.has(b)) { counts.extra_pages++; findings.push({ kind: 'extra_page', file: rel(html.find((f) => basename(f).toLowerCase() === b)), line: 0, detail: `${b} built but not in sitemap` }); }
    }
  }
  return { counts, findings };
}

// ---- a11y --------------------------------------------------------------------
function runA11y(html) {
  const findings = [];
  const counts = { img_no_alt: 0, control_no_label: 0, heading_jumps: 0, missing_h1: 0, missing_lang: 0, link_no_text: 0 };

  for (const f of html) {
    const src = read(f);
    // <html lang="...">
    if (/<html\b/i.test(src) && !/<html\b[^>]*\blang\s*=/i.test(src)) {
      counts.missing_lang++; findings.push({ kind: 'missing_lang', file: rel(f), line: lineOf(src, src.search(/<html\b/i)), detail: '<html> has no lang attribute' });
    }
    // images without alt (alt="" is allowed = decorative)
    for (const m of src.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\balt\s*=/i.test(m[0])) { counts.img_no_alt++; findings.push({ kind: 'img_no_alt', file: rel(f), line: lineOf(src, m.index), detail: m[0].slice(0, 70) }); }
    }
    // form controls without an accessible name
    for (const m of src.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
      const tag = m[0];
      if (/\btype\s*=\s*["'](hidden|submit|button|reset|image)["']/i.test(tag)) continue;
      const hasAria = /\baria-label(ledby)?\s*=/i.test(tag);
      const idm = tag.match(/\bid\s*=\s*["']([^"']+)["']/i);
      const hasFor = idm && new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*["']${idm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(src);
      const hasTitle = /\btitle\s*=/i.test(tag);
      if (!hasAria && !hasFor && !hasTitle) {
        counts.control_no_label++; findings.push({ kind: 'control_no_label', file: rel(f), line: lineOf(src, m.index), detail: tag.slice(0, 70) });
      }
    }
    // links with no text and no aria-label
    for (const m of src.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
      const inner = visibleText(m[1]).trim();
      const hasAria = /\baria-label\s*=/i.test(m[0]) || /<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(m[1]);
      if (inner === '' && !hasAria) { counts.link_no_text++; findings.push({ kind: 'link_no_text', file: rel(f), line: lineOf(src, m.index), detail: m[0].slice(0, 70) }); }
    }
    // heading order
    const heads = [...src.matchAll(/<h([1-6])\b[^>]*>/gi)].map((m) => ({ level: +m[1], line: lineOf(src, m.index) }));
    if (heads.length && !heads.some((h) => h.level === 1)) { counts.missing_h1++; findings.push({ kind: 'missing_h1', file: rel(f), line: 0, detail: 'no <h1> on page' }); }
    for (let i = 1; i < heads.length; i++) {
      if (heads[i].level - heads[i - 1].level > 1) { counts.heading_jumps++; findings.push({ kind: 'heading_jump', file: rel(f), line: heads[i].line, detail: `h${heads[i - 1].level} → h${heads[i].level} skips a level` }); }
    }
  }
  return { counts, findings };
}

// ---- dispatch ----------------------------------------------------------------
const elementorTokens = check === 'tokens' && variant === 'elementor';
const { html, css, base } = elementorTokens ? locateElementorCss() : locate();
if (!base) {
  const where = elementorTokens ? 'wp-content/themes/hello-elementor-*/' : 'site/ and .twt-artifacts/design/mockup/';
  console.log(`qa-scan ${check}${elementorTokens ? ' (elementor)' : ''}: no ${elementorTokens ? 'theme CSS' : 'built HTML/CSS'} found (looked in ${where}). Local audit needs built source.`);
  process.exit(0);
}

let result, sources;
if (check === 'tokens') { sources = css; result = runTokens(css); }
else if (check === 'links') { sources = html; result = runLinks(html); }
else if (check === 'content') { sources = html; result = runContent(html); }
else { sources = html; result = runA11y(html); }

emit(sources, result.counts, result.findings);
process.exit(0);
