// acquire.mjs — three sources, one normalized shape.
//
// The Figma adapter deliberately does NOT call the Figma MCP tools: MCP is
// model-side, scripts are not. The skill body reads the file via MCP and
// writes figma-export.json; this adapter only normalizes what it finds.
'use strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { normUrl, sameHost, fetchUrl, extractLinks, collectCss, looksJsRendered } from '../lib/site-fetch.mjs';

const pageId = (i) => 'P' + String(i + 1).padStart(2, '0');

// Is `candidate` (already resolved to an absolute path) inside `root`
// (also absolute)? Used to stop a page's `<link href>` from walking a
// stylesheet path out of the directory the caller pointed fromDir at
// (`../../../../etc/passwd` etc.) — fromDir reads whatever local file that
// resolves to and folds its contents into `css`, and this tool's eventual
// output (a block-map report) can surface that content verbatim, so an
// unguarded resolve() is a real local file disclosure, not just a
// theoretical one.
function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function fromDir(dir) {
  const root = resolve(dir);
  const files = readdirSync(root).filter((f) => /\.html?$/i.test(f)).sort();
  return files.map((f, i) => {
    const p = join(root, f);
    const html = readFileSync(p, 'utf8');
    let css = '';
    for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)) {
      const href = m[1];
      if (/^https?:/i.test(href)) continue;              // local dir mode: disk only
      const cssPath = resolve(dirname(p), href);
      if (!isInside(root, cssPath)) continue;             // never follow a href out of the site root
      if (existsSync(cssPath)) css += readFileSync(cssPath, 'utf8') + '\n';
    }
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += m[1] + '\n';
    return { id: pageId(i), url: p, html, css, jsRendered: looksJsRendered(html) };
  });
}

// Cheap sniff for "is this actually HTML" — fetchUrl doesn't surface
// Content-Type (see tools/lib/site-fetch.mjs), so a PDF/image/binary
// response at a crawled URL would otherwise sail through as a "page" with
// garbage html/css. Not a full MIME parse — just enough to reject the
// obvious non-HTML case before it pollutes the page list.
function looksLikeHtml(body) {
  if (!body) return false;
  const head = body.slice(0, 1024);
  if (head.startsWith('%PDF-')) return false;
  return /<\s*(!doctype\s+html|html[\s>]|head[\s>]|body[\s>])/i.test(head) || /<[a-zA-Z][^>]*>/.test(head);
}

export async function fromUrl(startUrl, { max = 20 } = {}) {
  const start = normUrl(startUrl);
  const queue = [start], seen = new Set(), pages = [];
  while (queue.length && pages.length < max) {
    const url = queue.shift();
    if (seen.has(url) || !sameHost(url, start)) continue;
    seen.add(url);
    let res;
    try { res = await fetchUrl(url); } catch { continue; }
    if (!res || res.status < 200 || res.status >= 300) continue;
    // fetchUrl (tools/lib/site-fetch.mjs) follows up to 4 redirects on its
    // own and, on the URL that actually terminated the chain, reports it
    // back via `res.url` — but it never checks host along the way. Without
    // re-checking here, a same-host page that 302s off-host would have its
    // *other site's* body folded into a page still labeled with the
    // original same-host URL, and links harvested from that foreign body
    // would then be resolved and re-queued as if they belonged to `start`.
    // Confirmed by probe (task-8-report.md) with a same-host page
    // redirecting to a second local origin.
    const finalUrl = normUrl(res.url || url);
    if (!sameHost(finalUrl, start)) continue;
    seen.add(finalUrl);
    const html = res.body || '';
    if (!looksLikeHtml(html)) continue;
    const css = await collectCss(html, finalUrl);
    pages.push({ id: pageId(pages.length), url: finalUrl, html, css: css.page, jsRendered: looksJsRendered(html) });
    for (const l of extractLinks(html, finalUrl)) {
      const n = normUrl(l);
      if (!seen.has(n) && sameHost(n, start)) queue.push(n);
    }
  }
  return pages;
}

export async function fromFigmaExport(jsonPath) {
  const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.frames)) {
    throw new Error(`figma export at ${jsonPath} has no "frames" array — expected { frames: [{ name, html }] }`);
  }
  return raw.frames.map((f, i) => ({
    id: pageId(i),
    url: 'figma://' + encodeURIComponent(f?.name ?? `frame-${i + 1}`),
    html: f?.html || '',
    css: f?.css || '',
    jsRendered: false,
  }));
}
