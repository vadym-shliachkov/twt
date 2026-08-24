// acquire.mjs — three sources, one normalized shape.
//
// The Figma adapter deliberately does NOT call the Figma MCP tools: MCP is
// model-side, scripts are not. The skill body reads the file via MCP and
// writes figma-export.json; this adapter only normalizes what it finds.
'use strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { normUrl, sameHost, fetchUrl, extractLinks, collectCss, looksJsRendered } from '../../../../tools/lib/site-fetch.mjs';

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

// `fromDir` deliberately does not recurse (that would change what gets
// mapped and is out of this task's scope) — but it must not vanish pages
// silently either. An SSG build with `dist/blog/*.html` has every one of
// those pages disappear from the map with zero warning otherwise, so any
// subdirectory found alongside the top-level html files is collected and
// reported back to the caller via the non-enumerable-to-JSON `skippedDirs`
// property on the returned array (arrays serialize by index only, so this
// never leaks into an emitted artifact) — block-map.mjs surfaces it on
// stdout.
export async function fromDir(dir) {
  const root = resolve(dir);
  const entries = readdirSync(root, { withFileTypes: true });
  const skippedDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const files = entries.filter((e) => e.isFile() && /\.html?$/i.test(e.name)).map((e) => e.name).sort();
  const pages = files.map((f, i) => {
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
    // `url` is the page's DISPLAY label — it becomes a matrix column header
    // in report.mjs and a meta.pages entry in summary.json, both shared with
    // the user. The absolute filesystem path (`C:\...\tests\fixtures\...`)
    // is unreadable there (9 columns barely fit 2 on screen at 1440px) and
    // bakes the operator's local paths into a shareable report, so label it
    // relative to the source root instead ("bem-card.html", "blog/post.html"
    // — forward slashes even on Windows, matching every other url in this
    // pipeline). `fsPath` keeps the real absolute path for anything that
    // still needs to open the file (the Playwright walk below).
    const relUrl = relative(root, p).split(sep).join('/');
    return { id: pageId(i), url: relUrl, fsPath: p, html, css, jsRendered: looksJsRendered(html) };
  });
  if (skippedDirs.length) pages.skippedDirs = skippedDirs;
  return pages;
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

// Follow any redirect on the START url (apex -> www, http -> https, etc. —
// the single most common redirect shape on the web) so the crawl's
// same-host baseline reflects the actual destination. Mirrors
// tools/site-crawl.mjs's resolveStartUrl (same problem, same fix there:
// see its "Follow any redirect on the start URL" comment) — without this,
// a site whose homepage redirects cross-host would fail sameHost() against
// itself on page one and fromUrl would return zero pages for what is, from
// a user's perspective, a perfectly normal site. The body of this fetch is
// discarded and the main loop re-fetches `start` — a second request for
// the home page, same tradeoff site-crawl.mjs already makes, in exchange
// for not forking two different "what is the crawl root" code paths.
async function resolveStart(url) {
  try {
    const res = await fetchUrl(url);
    if (res && res.status >= 200 && res.status < 300 && res.url) return normUrl(res.url);
  } catch { /* unreachable start surfaces naturally when the main loop re-fetches it */ }
  return url;
}

export async function fromUrl(startUrl, { max = 20 } = {}) {
  const given = normUrl(startUrl);
  const start = await resolveStart(given);
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
  // Task 9/10 key page identity off `Page.url` (the reuse matrix filters
  // instances by `i.page === url` per column), so two frames sharing a
  // name must not collide on `figma://Name` — that would silently fold two
  // distinct frames' instances onto one matrix column.
  //
  // Disambiguate against the set of urls ACTUALLY EMITTED SO FAR, not
  // against a count of how many times the original name occurred — a
  // count-based scheme (`seenNames.get(name)`) only guards against a
  // GENERATED url colliding with a later occurrence of the SAME literal
  // name; it does nothing when a generated candidate (`Card~2`) collides
  // with a DIFFERENT frame whose literal name IS `Card~2` (e.g.
  // `[Card, Card~2, Card]` — the count-based version emits
  // `Card, Card~2, Card~2`, a real collision in the exact routine meant to
  // prevent one). Looping the suffix against the live `used` set and
  // re-checking membership after every increment closes that regardless of
  // which literal name — real or generated-looking — was seen first;
  // deterministic because it only ever depends on input order.
  const used = new Set();
  return raw.frames.map((f, i) => {
    const name = f?.name ?? `frame-${i + 1}`;
    const base = 'figma://' + encodeURIComponent(name);
    let url = base;
    for (let n = 2; used.has(url); n++) url = `${base}~${n}`;
    used.add(url);
    return {
      id: pageId(i),
      url,
      html: f?.html || '',
      css: f?.css || '',
      jsRendered: false,
    };
  });
}
