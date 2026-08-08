// site-fetch.mjs — shared HTTP + HTML/CSS retrieval for the site-reading skills
// (/twt-design-system-audit and /twt-block-map). Extracted from ds-audit.mjs so
// both skills crawl identically; forking this logic would let the two skills
// disagree about what a page even is.

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

// ── networking (static crawl) ────────────────────────────────────────────────
export function fetchUrl(target, redirects = 0) {
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

export function sameHost(a, b) { try { return new URL(a).host === new URL(b).host; } catch { return false; } }

// Canonicalize a page URL so `https://site.com` and `https://site.com/` (and
// `/about` vs `/about/`) don't crawl as two separate pages — which doubled the
// home page and inflated the page/cluster counts. Drops hash + query and the
// trailing slash (except the bare root).
export function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = ''; x.search = '';
    if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, '');
    return x.href;
  } catch { return u; }
}

export function extractLinks(html, base) {
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
export function stylesheetHrefs(html, base) {
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
export async function collectCss(html, base) {
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
export function detectRootFontPx(css) {
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

export function looksJsRendered(html) {
  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, ''])[1];
  const text = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length < 200 && /<div\b[^>]*\bid=["'](root|app|__next)["']/i.test(html);
}
