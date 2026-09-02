#!/usr/bin/env node
// link-check.mjs - deterministic broken-link auditor behind /twt-link-check.
//
// Finding a bad link is mechanical: collect every reference, probe it, record
// the status. Running that through the model would burn a context window on
// hundreds of HTTP responses and give a different answer every run, so the
// whole thing lives here and the model only reads the summary.
//
//   node link-check.mjs page  <url>  [opts]   check every link on ONE page
//   node link-check.mjs site  <url>  [opts]   crawl internal pages, then check
//   node link-check.mjs local <dir>  [opts]   built HTML on disk (+ live externals)
//
// Options:
//   --max <n>          pages to crawl in site mode           (default 50)
//   --concurrency <n>  parallel probes                       (default 6)
//   --timeout <ms>     per-request timeout                   (default 15000)
//   --out <path>       report path                           (default under .twt-artifacts/)
//   --no-external      skip every off-host URL (fast, offline-ish)
//   --no-assets        anchors only; skip img/script/css/iframe/video
//   --ua <string>      override the User-Agent
//
// Writes a Markdown report and prints a bounded JSON summary to stdout.
// Exit 0 on a completed audit (even when links are broken), 1 when the target
// itself is unusable, 2 on bad usage.
'use strict';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- constants ---------------------------------------------------------------

const DEFAULT_UA = 'Mozilla/5.0 (compatible; twt-link-check/1.0; +https://github.com/vadym-shliachkov/twt)';
const MAX_BODY = 2_000_000;
const MAX_REDIRECTS = 5;
const MAX_SOURCES_LISTED = 10;

// Hosts that answer automated requests with 401/403/429/999 as policy, not as
// a broken link. Reporting these as BLOCKERs is the classic link-checker
// false positive - the page is fine in a browser. They are downgraded to
// "needs a manual check"; a 404 from them is still a 404.
const BOT_BLOCKERS = /(^|\.)(?:linkedin\.com|instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com|threads\.net|medium\.com|reddit\.com|quora\.com|glassdoor\.[a-z.]+|crunchbase\.com|amazon\.[a-z.]+|jstor\.org|sciencedirect\.com|ieeexplore\.ieee\.org|dribbble\.com|behance\.net|producthunt\.com|udemy\.com|indeed\.com|yelp\.com|tripadvisor\.[a-z.]+|booking\.com|cloudflare\.com|g2\.com|capterra\.com)$/i;

// Attributes that carry a URL, per element. `a`/`area` produce navigational
// links; everything else produces assets (a broken one is a missing image or
// stylesheet, which reads differently in a report).
const URL_ATTRS = {
  a: ['href'], area: ['href'], form: ['action'],
  img: ['src', 'srcset'], source: ['src', 'srcset'], script: ['src'],
  link: ['href'], iframe: ['src'], embed: ['src'], object: ['data'],
  video: ['src', 'poster'], audio: ['src'], track: ['src'],
};
const LINK_ELEMENTS = new Set(['a', 'area', 'form']);
const ASSET_EXT = /\.(?:pdf|zip|rar|7z|jpe?g|png|gif|svg|webp|avif|ico|css|js|mjs|json|xml|txt|csv|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|docx?|xlsx?|pptx?)$/i;
const AUTH_PATH = /\/(?:wp-admin|wp-login|wp-json|login|logout|signin|signout|register|cart|checkout|my-account)(?:\/|$)/i;

// ---- CLI ---------------------------------------------------------------------

const argv = process.argv.slice(2);

function flag(name, dflt) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
function has(name) { return argv.includes(name); }
function firstPositional() {
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { if (!BOOL_FLAGS.has(argv[i])) i++; continue; }
    return argv[i];
  }
  return undefined;
}
const BOOL_FLAGS = new Set(['--no-external', '--no-assets']);

function usage(msg) {
  console.error(msg);
  console.error('Usage: link-check.mjs page  <url>  [--max n] [--concurrency n] [--timeout ms] [--out path] [--no-external] [--no-assets] [--ua s]');
  console.error('       link-check.mjs site  <url>  [same options]');
  console.error('       link-check.mjs local <dir>  [same options]');
  process.exit(2);
}

// ---- small helpers -----------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const write = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, 'utf8'); };
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return out;
}

/** Blank out HTML comments while preserving newlines, so line numbers survive. */
export function blankComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

const lineOf = (html, index) => {
  let n = 1;
  for (let i = 0; i < index && i < html.length; i++) if (html.charCodeAt(i) === 10) n++;
  return n;
};

const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"').replace(/&(?:apos|#39);/gi, "'").replace(/&nbsp;/gi, ' ');

function parseAttrs(raw) {
  const out = {};
  for (const m of raw.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/**
 * URLs out of a srcset value, ignoring the width/density descriptors.
 * Tokenized the way the HTML spec does - the URL is a run of NON-WHITESPACE,
 * not "everything up to the next comma" - because a data: URI carries commas
 * of its own and a naive split shreds it into fake candidates.
 */
export function parseSrcset(value) {
  const out = [];
  const ws = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  let i = 0;
  while (i < value.length) {
    while (i < value.length && (ws(value[i]) || value[i] === ',')) i++;
    const start = i;
    while (i < value.length && !ws(value[i])) i++;
    let url = value.slice(start, i);
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else while (i < value.length && value[i] !== ',') i++; // skip the descriptor
    if (url && !/^data:/i.test(url)) out.push(url);
  }
  return out;
}

// ---- reference extraction ----------------------------------------------------

/**
 * Every URL-bearing attribute in an HTML document.
 * Returns raw (undecided) references: { raw, element, attr, kind, line, text }.
 * `kind` is 'link' for navigational elements, 'asset' for everything else.
 */
export function extractRefs(html, { assets = true } = {}) {
  const src = blankComments(html);
  const refs = [];
  for (const m of src.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const element = m[1].toLowerCase();
    const attrs = URL_ATTRS[element];
    if (!attrs) continue;
    const kind = LINK_ELEMENTS.has(element) ? 'link' : 'asset';
    if (kind === 'asset' && !assets) continue;
    const parsed = parseAttrs(m[2]);
    // <link> only points at a real file for these rels; rel=canonical/alternate
    // and friends are metadata a checker should not treat as page assets.
    if (element === 'link') {
      const rel = (parsed.rel || '').toLowerCase();
      if (!/\b(?:stylesheet|icon|apple-touch-icon|manifest|preload|prefetch|shortcut)\b/.test(rel)) continue;
    }
    const line = lineOf(src, m.index);
    const text = element === 'a'
      ? anchorTextAt(src, m.index + m[0].length)
      : (parsed.alt || parsed.title || '');
    for (const attr of attrs) {
      const value = parsed[attr];
      if (value === undefined) continue;
      const raws = attr === 'srcset' ? parseSrcset(value) : [value];
      for (const raw of raws) refs.push({ raw: raw.trim(), element, attr, kind, line, text: trunc(text, 60) });
    }
  }
  return refs;
}

function anchorTextAt(html, from) {
  const end = html.indexOf('</a', from);
  const inner = end === -1 ? html.slice(from, from + 200) : html.slice(from, end);
  return decodeEntities(inner.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Fragment targets a page offers: every id= and every <a name=>. */
export function extractAnchors(html) {
  const ids = new Set();
  for (const m of blankComments(html).matchAll(/\b(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const v = decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (v) ids.add(v);
  }
  return ids;
}

/** Heuristic: a 200 response that is really an error page. */
export function looksSoft404(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1];
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, ''])[1];
  const probe = decodeEntities(`${title} ${h1}`.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return /\b(?:404|page not found|not found|page does(?:n't| not) exist|nothing found)\b/i.test(probe);
}

// ---- URL classification ------------------------------------------------------

const MAILTO_RE = /^mailto:([^?]*)(\?.*)?$/i;
const TEL_RE = /^tel:(.+)$/i;
const EMAIL_RE = /^[^\s@,;:<>()[\]\\]+@[^\s@.,;:<>()[\]\\]+(?:\.[^\s@.,;:<>()[\]\\]+)+$/;
const TEL_OK_RE = /^[+]?[0-9][0-9\s().-]{4,}$/;

/**
 * Decide what a raw href/src is, before any network call.
 * Returns { type, ... } where type is one of:
 *   http | fragment | placeholder | mailto | tel | malformed | ignore
 */
export function classifyRaw(raw, baseUrl) {
  const v = (raw || '').trim();
  if (v === '' || v === '#') return { type: 'placeholder', reason: v === '' ? 'empty href' : 'href="#"' };
  if (/^javascript:\s*(?:void\s*\(\s*0\s*\)|;)?\s*$/i.test(v)) return { type: 'placeholder', reason: 'javascript: no-op' };
  if (/^(?:todo|tbd|xxx|#todo|#tbd)$/i.test(v)) return { type: 'placeholder', reason: 'placeholder text' };
  if (/^(?:data|blob|about|javascript):/i.test(v)) return { type: 'ignore' };
  if (MAILTO_RE.test(v)) {
    const addr = decodeURIComponent(v.match(MAILTO_RE)[1] || '');
    const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
    const bad = parts.filter((p) => !EMAIL_RE.test(p));
    if (!parts.length) return { type: 'malformed', reason: 'mailto: with no address' };
    return bad.length ? { type: 'malformed', reason: `invalid email address: ${bad.join(', ')}` } : { type: 'mailto', address: addr };
  }
  if (TEL_RE.test(v)) {
    const num = v.match(TEL_RE)[1].trim();
    return TEL_OK_RE.test(num) ? { type: 'tel', number: num } : { type: 'malformed', reason: `implausible tel: number "${num}"` };
  }
  if (v.startsWith('#')) return { type: 'fragment', fragment: decodeURIComponent(v.slice(1)) };
  let u;
  try { u = new URL(v, baseUrl); } catch { return { type: 'malformed', reason: 'unparseable URL' }; }
  if (!/^https?:$/.test(u.protocol)) return { type: 'ignore' };
  const fragment = u.hash ? decodeURIComponent(u.hash.slice(1)) : '';
  u.hash = '';
  return { type: 'http', url: u.href, fragment };
}

/** Fold /a/ and /a and /a/index.html into one identity, for crawl dedupe. */
export function canonical(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.pathname = u.pathname.replace(/\/index\.(?:html?|php)$/i, '/');
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.href;
  } catch { return url; }
}

/**
 * Scheme-blind identity: http://a/b and https://a/b share one key. Used only to
 * cross-reference the two in the report - never to collapse them into one probe,
 * because the schemes genuinely can answer differently and that difference is
 * itself a finding (mixed content, http-only outages).
 */
export function schemeBlindKey(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.host}${u.pathname}${u.search}`;
  } catch { return null; }
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const isHtmlPath = (url) => { try { return !ASSET_EXT.test(new URL(url).pathname); } catch { return false; } };

// ---- probing -----------------------------------------------------------------

/**
 * One URL, followed by hand so the redirect chain is visible.
 * HEAD first (cheap); GET on the statuses that mean "this server dislikes HEAD"
 * rather than "this link is broken" - a HEAD-only 403/405 is the second classic
 * link-checker false positive.
 */
export async function probeUrl(url, opts = {}) {
  const { timeout = 15000, ua = DEFAULT_UA, wantBody = false } = opts;
  const fetchImpl = opts.fetch || globalThis.fetch;
  const chain = [];
  let current = url;
  let method = wantBody ? 'GET' : 'HEAD';
  let retriedWithGet = false;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await fetchImpl(current, {
        method,
        redirect: 'manual',
        headers: { 'user-agent': ua, accept: '*/*', 'accept-language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      if (method === 'HEAD' && !retriedWithGet) { method = 'GET'; retriedWithGet = true; hop--; continue; }
      return { status: 0, finalUrl: current, chain, method, error: netReason(err) };
    }
    const status = res.status;
    const headers = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));

    if (method === 'HEAD' && !retriedWithGet && shouldRetryWithGet(status)) {
      res.body?.cancel?.().catch(() => {});
      method = 'GET'; retriedWithGet = true; hop--; continue;
    }

    const location = headers.location;
    if (status >= 300 && status < 400 && location) {
      res.body?.cancel?.().catch(() => {});
      let nextUrl;
      try { nextUrl = new URL(location, current).href; }
      catch { return { status, finalUrl: current, chain, method, headers, error: `invalid Location header: ${location}` }; }
      chain.push({ from: current, to: nextUrl, status });
      if (chain.some((h) => h.from === nextUrl)) {
        return { status, finalUrl: nextUrl, chain, method, headers, error: 'redirect loop' };
      }
      current = nextUrl;
      continue;
    }

    let body = '';
    if (wantBody && res.body) {
      try { body = (await res.text()).slice(0, MAX_BODY); } catch { body = ''; }
    } else { res.body?.cancel?.().catch(() => {}); }
    return { status, finalUrl: current, chain, method, headers, contentType: headers['content-type'] || '', body };
  }
  return { status: 0, finalUrl: current, chain, method, error: `more than ${MAX_REDIRECTS} redirects` };
}

// 401/403 can be bot policy, 405/501 mean HEAD is unimplemented, 429 is rate
// limiting, 999 is LinkedIn's bespoke refusal. All are worth one honest GET.
const shouldRetryWithGet = (status) => [401, 403, 405, 406, 409, 429, 500, 501, 503, 999].includes(status);

function netReason(err) {
  const name = err?.name || '';
  const code = err?.cause?.code || err?.code || '';
  if (name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'ETIMEDOUT') return 'timed out';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS lookup failed (host does not resolve)';
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (code === 'ECONNRESET') return 'connection reset';
  if (code === 'CERT_HAS_EXPIRED') return 'TLS certificate expired';
  if (/^(?:ERR_TLS|DEPTH_ZERO|UNABLE_TO_VERIFY|SELF_SIGNED)/.test(code)) return `TLS error (${code})`;
  return code ? `request failed (${code})` : `request failed (${err?.message || 'unknown error'})`;
}

function looksBotBlocked(target) {
  const { status, headers = {} } = target;
  if (![401, 403, 429, 999].includes(status)) return false;
  if (BOT_BLOCKERS.test(hostOf(target.finalUrl || ''))) return true;
  if (headers['cf-mitigated'] || headers['x-datadome'] || headers['x-sucuri-id']) return true;
  if (/cloudflare|akamai|sucuri|incapsula|imperva/i.test(headers.server || '')) return true;
  return false;
}

// ---- verdicts ----------------------------------------------------------------

const SEVERITY_ORDER = { BLOCKER: 0, WARNING: 1, SUGGESTION: 2, OK: 3 };

/**
 * Turn a probe result (or a pre-network classification) into a reportable
 * verdict. `internal` decides severity: a dead link on your own site is a
 * blocker; a dead link on someone else's site is something to go fix, but it
 * does not block your build.
 */
export function verdictFor(entry) {
  const { scope, kind, probe: p } = entry;
  const internal = scope === 'internal';
  const B = internal ? 'BLOCKER' : 'WARNING';

  if (entry.type === 'placeholder') return { severity: 'WARNING', klass: 'placeholder', label: entry.reason };
  if (entry.type === 'malformed') return { severity: 'WARNING', klass: 'malformed', label: entry.reason };
  if (entry.type === 'mailto' || entry.type === 'tel') return { severity: 'OK', klass: 'not-probed', label: `${entry.type}: not network-checkable` };
  if (entry.type === 'local-missing') return { severity: 'BLOCKER', klass: 'missing-file', label: `file not found on disk (tried ${entry.tried.join(', ')})` };
  if (entry.type === 'missing-fragment') return { severity: B, klass: 'missing-fragment', label: `no id="${entry.fragment}" on the target page` };
  if (entry.type === 'skipped') return { severity: 'OK', klass: 'skipped', label: entry.reason };

  if (!p) return { severity: 'OK', klass: 'not-probed', label: 'not probed' };
  if (p.status === 0) {
    return { severity: internal ? 'BLOCKER' : 'WARNING', klass: 'unreachable', label: p.error || 'unreachable' };
  }
  if (looksBotBlocked(p)) {
    return { severity: 'SUGGESTION', klass: 'blocked', label: `HTTP ${p.status} - looks like bot protection, verify in a browser` };
  }
  if (p.status === 401) return { severity: 'SUGGESTION', klass: 'auth-required', label: 'HTTP 401 - authentication required' };
  if (p.status === 403) return { severity: B, klass: 'forbidden', label: 'HTTP 403 Forbidden' };
  if (p.status === 404) return { severity: B, klass: 'not-found', label: 'HTTP 404 Not Found' };
  if (p.status === 410) return { severity: B, klass: 'gone', label: 'HTTP 410 Gone' };
  if (p.status === 429) return { severity: 'SUGGESTION', klass: 'rate-limited', label: 'HTTP 429 - rate limited, verify manually' };
  if (p.status >= 400 && p.status < 500) return { severity: B, klass: 'client-error', label: `HTTP ${p.status}` };
  if (p.status >= 500) return { severity: B, klass: 'server-error', label: `HTTP ${p.status}` };

  if (entry.softNotFound) {
    return { severity: 'WARNING', klass: 'soft-404', label: 'HTTP 200 but the page reads as a "not found" page' };
  }
  if (entry.mixedContent) {
    return { severity: 'WARNING', klass: 'mixed-content', label: 'http:// resource loaded from an https:// page' };
  }
  if (p.chain?.length) {
    const permanent = p.chain.some((h) => h.status === 301 || h.status === 308);
    if (internal && permanent) {
      return { severity: 'WARNING', klass: 'redirect-permanent', label: `${p.chain.length} redirect(s) - update the href to ${p.finalUrl}` };
    }
    return { severity: 'SUGGESTION', klass: 'redirect', label: `${p.chain.length} redirect(s) to ${p.finalUrl}` };
  }
  return { severity: 'OK', klass: 'ok', label: `HTTP ${p.status}` };
}

const FIX_HINTS = {
  'not-found': 'Point the href at a page that exists, or remove the link. If the page moved, add a 301 from the old URL.',
  gone: 'The target is permanently gone. Remove the link or repoint it.',
  forbidden: 'The server refuses this request. Check the file permissions or whether the resource should be public.',
  'client-error': 'The server rejected the request. Verify the URL is still valid.',
  'server-error': 'The target server is erroring. Re-run the check; if it persists, the destination is broken, not the link.',
  unreachable: 'The host did not answer. Check the domain is still registered and the URL is not a typo.',
  'missing-file': 'The referenced file is not in the build. Add it, or fix the path.',
  'missing-fragment': 'Add the id to the target section, or fix the fragment in the href.',
  placeholder: 'Replace with a real destination before launch, or remove the anchor.',
  malformed: 'Fix the address syntax.',
  'soft-404': 'The server returns 200 for a missing page. Either the link is wrong or the site should return a real 404.',
  'mixed-content': 'Switch the resource URL to https:// - browsers block or downgrade it otherwise.',
  'redirect-permanent': 'Update the href to the final URL so visitors skip the extra hop.',
  redirect: 'Optional: link the final URL directly.',
  blocked: 'Open it in a browser to confirm. Bot-protected hosts refuse automated checks by policy.',
  'auth-required': 'Expected if the target is behind a login. Otherwise the resource is not public.',
  'rate-limited': 'Re-check later or with lower concurrency.',
};

// ---- collection --------------------------------------------------------------

/**
 * Fold every extracted ref into a target map keyed by identity, so one broken
 * URL reported on 40 pages is one finding with 40 sources - not 40 findings.
 */
function addRef(targets, key, base) {
  if (!targets.has(key)) targets.set(key, { key, sources: [], ...base });
  const t = targets.get(key);
  t.sources.push(base.source);
  if (base.kind === 'link') t.kind = 'link';
  return t;
}

function sourceOf(page, ref) {
  return { page, line: ref.line, element: ref.element, attr: ref.attr, text: ref.text, raw: ref.raw };
}

// ---- live modes (page / site) ------------------------------------------------

async function fetchHtml(url, opts) {
  const p = await probeUrl(url, { ...opts, wantBody: true });
  const html = /text\/html|application\/xhtml/i.test(p.contentType || '') ? p.body || '' : '';
  return { probe: p, html };
}

async function runLive({ mode, target, max, opts, checkAssets, checkExternal }) {
  const start = canonical(target);
  const first = await fetchHtml(start, opts);
  if (first.probe.status === 0 || first.probe.status >= 400) {
    return { fatal: `Cannot read ${target} - ${first.probe.error || `HTTP ${first.probe.status}`}` };
  }
  const rootHost = hostOf(first.probe.finalUrl);
  const pages = new Map();            // canonical url -> html
  const unreachablePages = [];
  const queue = [first.probe.finalUrl];
  const seen = new Set([canonical(first.probe.finalUrl), start]);
  pages.set(canonical(first.probe.finalUrl), first.html);

  if (mode === 'site') {
    while (queue.length && pages.size < max) {
      const url = queue.shift();
      const html = pages.get(canonical(url));
      if (html === undefined) continue;
      for (const ref of extractRefs(html, { assets: false })) {
        const c = classifyRaw(ref.raw, url);
        if (c.type !== 'http') continue;
        const key = canonical(c.url);
        if (seen.has(key) || hostOf(c.url) !== rootHost) continue;
        if (!isHtmlPath(c.url) || AUTH_PATH.test(new URL(c.url).pathname)) continue;
        seen.add(key);
        if (pages.size + queue.length >= max) break;
        const got = await fetchHtml(c.url, opts);
        if (got.probe.status >= 200 && got.probe.status < 300 && got.html) {
          pages.set(canonical(got.probe.finalUrl), got.html);
          queue.push(got.probe.finalUrl);
          console.error(`[crawl ${pages.size}/${max}] ${new URL(got.probe.finalUrl).pathname}`);
        } else if (got.probe.status === 0 || got.probe.status >= 400) {
          unreachablePages.push({ url: c.url, reason: got.probe.error || `HTTP ${got.probe.status}` });
        }
        await sleep(60);
      }
    }
  }

  // Collect every reference across every fetched page.
  const targets = new Map();
  for (const [pageUrl, html] of pages) {
    for (const ref of extractRefs(html, { assets: checkAssets })) {
      const c = classifyRaw(ref.raw, pageUrl);
      if (c.type === 'ignore') continue;
      const source = sourceOf(pageUrl, ref);
      if (c.type === 'fragment') {
        if (ref.element !== 'a') continue;
        addRef(targets, `frag:${pageUrl}#${c.fragment}`, {
          type: 'fragment', kind: 'link', scope: 'internal', display: `${pageUrl}#${c.fragment}`,
          pageForFragment: pageUrl, fragment: c.fragment, source,
        });
        continue;
      }
      if (c.type !== 'http') {
        addRef(targets, `${c.type}:${ref.raw}`, {
          type: c.type, kind: ref.kind, scope: 'n/a', display: ref.raw,
          reason: c.reason, source,
        });
        continue;
      }
      const scope = hostOf(c.url) === rootHost ? 'internal' : 'external';
      const t = addRef(targets, `url:${c.url}`, {
        type: 'http', kind: ref.kind, scope, display: c.url, url: c.url, source,
        mixedContent: new URL(c.url).protocol === 'http:' && new URL(pageUrl).protocol === 'https:' && ref.kind === 'asset',
      });
      if (c.fragment) (t.fragments ||= new Map()).set(c.fragment, source);
    }
  }

  // Probe.
  const probeable = [];
  for (const t of targets.values()) {
    if (t.type !== 'http') continue;
    if (checkExternal || t.scope === 'internal') probeable.push(t);
    else { t.type = 'skipped'; t.reason = 'external check disabled (--no-external)'; }
  }

  let done = 0;
  await pool(probeable, opts.concurrency, async (t) => {
    // Internal HTML pages come back with a body: it is the only way to check
    // fragments and to notice a 200 that is really an error page.
    const wantBody = t.scope === 'internal' && isHtmlPath(t.url);
    const p = pages.get(canonical(t.url)) !== undefined && wantBody
      ? { status: 200, finalUrl: t.url, chain: [], method: 'CACHED', headers: {}, contentType: 'text/html', body: pages.get(canonical(t.url)) }
      : await probeUrl(t.url, { ...opts, wantBody });
    t.probe = p;
    if (wantBody && p.status >= 200 && p.status < 300 && p.body) {
      t.anchors = extractAnchors(p.body);
      t.softNotFound = looksSoft404(p.body);
    }
    delete t.probe.body;
    if (++done % 25 === 0) console.error(`[probe ${done}/${probeable.length}]`);
  });

  // Fragment resolution, now that page bodies are known.
  const anchorsFor = (url) => {
    const cached = pages.get(canonical(url));
    if (cached !== undefined) return extractAnchors(cached);
    const t = targets.get(`url:${url}`);
    return t?.anchors;
  };
  const extra = [];
  for (const t of targets.values()) {
    if (t.type === 'fragment') {
      const ids = anchorsFor(t.pageForFragment);
      if (!ids) { t.type = 'skipped'; t.reason = 'target page body unavailable'; }
      else if (!isTopFragment(t.fragment) && !ids.has(t.fragment)) t.type = 'missing-fragment';
      else { t.type = 'skipped'; t.reason = 'anchor resolves'; }
      continue;
    }
    if (t.type === 'http' && t.fragments && t.scope === 'internal' && t.probe?.status >= 200 && t.probe.status < 300) {
      const ids = t.anchors || anchorsFor(t.url);
      if (!ids) continue;
      for (const [frag, source] of t.fragments) {
        if (isTopFragment(frag) || ids.has(frag)) continue;
        extra.push({
          key: `frag:${t.url}#${frag}`, type: 'missing-fragment', kind: 'link', scope: 'internal',
          display: `${t.url}#${frag}`, fragment: frag, sources: [source],
        });
      }
    }
  }
  for (const e of extra) targets.set(e.key, e);

  return {
    mode, target: first.probe.finalUrl, host: rootHost,
    pages: [...pages.keys()], unreachablePages, targets: [...targets.values()],
  };
}

const isTopFragment = (f) => f === '' || f.toLowerCase() === 'top';

// ---- local mode --------------------------------------------------------------

function walkHtml(dir, root = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkHtml(full, root, out);
    else if (/\.html?$/i.test(name)) out.push(full);
  }
  return out;
}

/** Resolve an internal href against the built tree, the way a static host would. */
export function resolveLocalTarget(root, pageFile, rawPath) {
  const clean = decodeURIComponent(rawPath.split('#')[0].split('?')[0]);
  if (clean === '') return { file: pageFile, tried: [] };
  const base = clean.startsWith('/') ? join(root, clean.slice(1)) : resolve(dirname(pageFile), clean);
  const candidates = /\.[a-z0-9]+$/i.test(clean) && !/\/$/.test(clean)
    ? [base]
    : [base, `${base}.html`, `${base}.htm`, join(base, 'index.html'), join(base, 'index.htm')];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return { file: c, tried: candidates };
  }
  return { file: null, tried: candidates.map((c) => relative(root, c).split(sep).join('/')) };
}

async function runLocal({ dir, opts, checkAssets, checkExternal }) {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) return { fatal: `Not a directory: ${dir}` };
  const files = walkHtml(root);
  if (!files.length) return { fatal: `No .html files under ${dir}` };

  const htmlCache = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
  const targets = new Map();
  const rel = (f) => relative(root, f).split(sep).join('/');

  for (const file of files) {
    const html = htmlCache.get(file);
    for (const ref of extractRefs(html, { assets: checkAssets })) {
      const c = classifyRaw(ref.raw, 'https://local.invalid/');
      if (c.type === 'ignore') continue;
      const source = sourceOf(rel(file), ref);
      if (c.type === 'fragment') {
        if (ref.element !== 'a') continue;
        if (!isTopFragment(c.fragment) && !extractAnchors(html).has(c.fragment)) {
          addRef(targets, `frag:${rel(file)}#${c.fragment}`, {
            type: 'missing-fragment', kind: 'link', scope: 'internal',
            display: `${rel(file)}#${c.fragment}`, fragment: c.fragment, source,
          });
        }
        continue;
      }
      if (c.type === 'placeholder' || c.type === 'malformed' || c.type === 'mailto' || c.type === 'tel') {
        addRef(targets, `${c.type}:${ref.raw}`, {
          type: c.type, kind: ref.kind, scope: 'n/a', display: ref.raw, reason: c.reason, source,
        });
        continue;
      }
      // Absolute http(s) refs are external targets; everything else is a path
      // into the build, resolved on disk.
      if (/^https?:\/\//i.test(ref.raw)) {
        addRef(targets, `url:${c.url}`, {
          type: 'http', kind: ref.kind, scope: 'external', display: c.url, url: c.url, source,
        });
        continue;
      }
      const { file: hit, tried } = resolveLocalTarget(root, file, ref.raw);
      if (!hit) {
        // Keyed by the RESOLVED path, never the raw href: `../about.html` from
        // a subpage and `/about.html` from the root are one missing file (they
        // used to report as two), while a bare `logo.png` referenced from two
        // different directories is two different files and must stay split.
        addRef(targets, `file:${tried[0]}`, {
          type: 'local-missing', kind: ref.kind, scope: 'internal', display: tried[0], tried, source,
        });
        continue;
      }
      const frag = ref.raw.includes('#') ? decodeURIComponent(ref.raw.split('#')[1]) : '';
      if (frag && !isTopFragment(frag) && /\.html?$/i.test(hit)) {
        const targetHtml = htmlCache.get(hit) ?? readFileSync(hit, 'utf8');
        if (!extractAnchors(targetHtml).has(frag)) {
          addRef(targets, `frag:${rel(hit)}#${frag}`, {
            type: 'missing-fragment', kind: 'link', scope: 'internal',
            display: `${rel(hit)}#${frag}`, fragment: frag, source,
          });
          continue;
        }
      }
      addRef(targets, `file-ok:${rel(hit)}`, {
        type: 'skipped', kind: ref.kind, scope: 'internal', display: rel(hit),
        reason: 'resolves on disk', source,
      });
    }
  }

  const external = [...targets.values()].filter((t) => t.type === 'http');
  if (checkExternal) {
    let done = 0;
    await pool(external, opts.concurrency, async (t) => {
      t.probe = await probeUrl(t.url, { ...opts, wantBody: false });
      if (++done % 25 === 0) console.error(`[probe ${done}/${external.length}]`);
    });
  } else {
    for (const t of external) { t.type = 'skipped'; t.reason = 'external check disabled (--no-external)'; }
  }

  return {
    mode: 'local', target: root, host: null,
    pages: files.map(rel), unreachablePages: [], targets: [...targets.values()],
  };
}

// ---- report ------------------------------------------------------------------

const VERDICT_BANDS = [
  ['FAIL', (c) => c.BLOCKER > 0],
  ['REVISE', (c) => c.WARNING > 0],
  ['PASS', () => true],
];

export function buildFindings(result) {
  const findings = [];
  for (const t of result.targets) {
    const v = verdictFor(t);
    findings.push({ ...t, ...v });
  }
  findings.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (b.sources.length - a.sources.length) ||
    String(a.display).localeCompare(String(b.display)));

  // A page that links the same resource as both http:// and https:// produces two
  // probes on purpose - the schemes can answer differently, and that difference is
  // a real finding. But reporting them as two unrelated entries reads as two
  // separate problems. Cross-reference them instead of merging: the reader sees
  // they are one resource, and the 1:1 target-to-finding count the report's
  // arithmetic rests on stays intact.
  const byScheme = new Map();
  for (const f of findings) {
    const k = f.type === 'http' && f.url ? schemeBlindKey(f.url) : null;
    if (!k) continue;
    if (!byScheme.has(k)) byScheme.set(k, []);
    byScheme.get(k).push(f);
  }
  for (const group of byScheme.values()) {
    if (group.length < 2) continue;
    for (const f of group) f.schemeSiblings = group.filter((g) => g !== f).map((g) => g.display);
  }
  return findings;
}

function renderSources(f) {
  const shown = f.sources.slice(0, MAX_SOURCES_LISTED);
  const lines = shown.map((s) => {
    const where = s.line ? `${s.page}:${s.line}` : s.page;
    const label = s.text ? ` — "${s.text}"` : '';
    return `  - ${where} \`<${s.element} ${s.attr}="${trunc(s.raw, 80)}">\`${label}`;
  });
  if (f.sources.length > shown.length) lines.push(`  - (+${f.sources.length - shown.length} more occurrence(s))`);
  return lines.join('\n');
}

function renderFinding(f, n) {
  const parts = [`### ${n}. ${f.label} · ${f.display}`];
  const meta = [`${f.kind === 'asset' ? 'asset' : 'link'}`, f.scope !== 'n/a' ? f.scope : null,
    f.probe?.method && f.probe.method !== 'CACHED' ? `probed with ${f.probe.method}` : null].filter(Boolean);
  parts.push(`- Kind: ${meta.join(' · ')}`);
  if (f.probe?.chain?.length) {
    parts.push(`- Redirects: ${f.probe.chain.map((h) => `${h.status} → ${h.to}`).join(' → ')}`);
  }
  if (f.schemeSiblings?.length) {
    parts.push(`- Same resource, other scheme: ${f.schemeSiblings.join(', ')} — checked separately, since http:// and https:// can answer differently.`);
  }
  parts.push(`- Referenced from ${f.sources.length} place(s):`);
  parts.push(renderSources(f));
  const hint = FIX_HINTS[f.klass];
  if (hint) parts.push(`- Fix: ${hint}`);
  return parts.join('\n');
}

export function renderReport(result, findings, meta) {
  const counts = { BLOCKER: 0, WARNING: 0, SUGGESTION: 0, OK: 0 };
  for (const f of findings) counts[f.severity]++;
  const verdict = VERDICT_BANDS.find(([, test]) => test(counts))[0];

  const byStatus = new Map();
  for (const f of findings) {
    const k = f.probe ? (f.probe.status === 0 ? 'network error' : String(f.probe.status)) : 'not probed';
    byStatus.set(k, (byStatus.get(k) || 0) + 1);
  }
  const byClass = new Map();
  for (const f of findings) if (f.severity !== 'OK') byClass.set(f.klass, (byClass.get(f.klass) || 0) + 1);

  const section = (sev, title, blurb) => {
    const items = findings.filter((f) => f.severity === sev);
    if (!items.length) return `## ${title} (0)\n\nNone.`;
    return [`## ${title} (${items.length})`, '', blurb, '', ...items.map((f, i) => renderFinding(f, i + 1))].join('\n');
  };

  const okItems = findings.filter((f) => f.severity === 'OK' && f.klass === 'ok');
  const skipped = findings.filter((f) => f.severity === 'OK' && f.klass !== 'ok');
  const label = result.host || result.target;

  return `---
tool: twt-link-check
mode: ${result.mode}
target: ${result.target}
checked_at: ${today()}
pages_scanned: ${result.pages.length}
targets_checked: ${findings.length}
blockers: ${counts.BLOCKER}
warnings: ${counts.WARNING}
suggestions: ${counts.SUGGESTION}
verdict: ${verdict}
external_checked: ${meta.checkExternal}
assets_checked: ${meta.checkAssets}
---

# Bad-link report — ${label}

**Verdict: ${verdict}** — ${counts.BLOCKER} blocker(s), ${counts.WARNING} warning(s), ${counts.SUGGESTION} needing a manual check, across ${result.pages.length} page(s) and ${findings.length} distinct target(s).

> Verdict bands: **FAIL** = at least one blocker · **REVISE** = warnings only · **PASS** = clean.

## Summary

| Severity | Count | Means |
|---|---:|---|
| BLOCKER | ${counts.BLOCKER} | Dead on your own site — fix before launch |
| WARNING | ${counts.WARNING} | Dead off-site, placeholder, or a hop that should be updated |
| SUGGESTION | ${counts.SUGGESTION} | Probably fine — bot-blocked or behind auth; verify by hand |
| OK | ${counts.OK} | Resolved cleanly, or not network-checkable |

### By problem class

${byClass.size ? ['| Class | Count |', '|---|---:|', ...[...byClass].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`)].join('\n') : 'No problems found.'}

### By HTTP status

${byStatus.size === 1 && byStatus.has('not probed')
    ? 'Nothing was probed over HTTP — every target was resolved on disk or skipped.'
    : ['| Status | Targets |', '|---|---:|', ...[...byStatus].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`)].join('\n')}

${section('BLOCKER', 'BLOCKER — broken on this site', 'Every one of these is a dead destination on the audited site itself.')}

${section('WARNING', 'WARNING — broken off-site, placeholder, or stale', 'Real problems, but they do not point at a missing page of your own.')}

${section('SUGGESTION', 'SUGGESTION — verify by hand', 'Automated checks cannot settle these. Open them in a browser.')}

## Healthy targets (${okItems.length})

${okItems.length ? okItems.map((f) => `- ${f.label} · ${f.display}`).join('\n') : 'None.'}

## Not network-checkable (${skipped.length})

${skipped.length ? skipped.map((f) => `- ${f.display} — ${f.label}`).join('\n') : 'None.'}

## Pages scanned (${result.pages.length})

${result.pages.map((p) => `- ${p}`).join('\n') || 'None.'}
${result.unreachablePages.length ? `\n## Pages that could not be read during the crawl (${result.unreachablePages.length})\n\n${result.unreachablePages.map((u) => `- ${u.url} — ${u.reason}`).join('\n')}\n` : ''}
## How to read this

- A **BLOCKER** is a reference on the audited site whose destination answered 4xx/5xx or did not answer at all.
- A **403/429/999 from a known bot-protected host** is reported as SUGGESTION, not as broken: those hosts refuse automated requests by policy and the link usually works in a browser.
- Every finding lists **where** it was found (page, line, element) so it can be fixed at the source, and one target referenced from many pages is one finding with many sources.
`;
}

// ---- main --------------------------------------------------------------------

function outPathFor(result, explicit) {
  if (explicit) return explicit;
  const slug = result.host
    ? result.host.replace(/[^a-z0-9.-]/gi, '-')
    : (relative(process.cwd(), result.target).split(sep).filter(Boolean).join('-') || 'local').replace(/[^a-z0-9.-]/gi, '-');
  return join('.twt-artifacts', 'link-check', slug || 'site', 'link-report.md');
}

async function main() {
  const cmd = argv[0];
  if (!['page', 'site', 'local'].includes(cmd)) usage(`unknown subcommand: ${cmd ?? '(none)'}`);
  const positional = firstPositional();
  if (!positional) usage(`${cmd} needs a ${cmd === 'local' ? 'directory' : 'URL'}`);

  const opts = {
    timeout: Number(flag('--timeout', 15000)),
    ua: flag('--ua', DEFAULT_UA),
    concurrency: Math.max(1, Number(flag('--concurrency', 6))),
  };
  const checkExternal = !has('--no-external');
  const checkAssets = !has('--no-assets');
  const max = Math.max(1, Number(flag('--max', 50)));

  let result;
  if (cmd === 'local') {
    result = await runLocal({ dir: positional, opts, checkAssets, checkExternal });
  } else {
    const url = /^https?:\/\//i.test(positional) ? positional : `https://${positional}`;
    result = await runLive({ mode: cmd, target: url, max, opts, checkAssets, checkExternal });
  }
  if (result.fatal) { console.error(result.fatal); console.log(JSON.stringify({ error: result.fatal }, null, 2)); process.exit(1); }

  const findings = buildFindings(result);
  const reportPath = outPathFor(result, flag('--out', null));
  write(reportPath, renderReport(result, findings, { checkExternal, checkAssets }));

  const counts = { BLOCKER: 0, WARNING: 0, SUGGESTION: 0, OK: 0 };
  for (const f of findings) counts[f.severity]++;
  const worst = findings
    .filter((f) => f.severity !== 'OK')
    .slice(0, 25)
    .map((f) => ({
      severity: f.severity, klass: f.klass, target: f.display, label: f.label,
      refs: f.sources.length, first_seen: `${f.sources[0].page}${f.sources[0].line ? `:${f.sources[0].line}` : ''}`,
    }));

  console.log(JSON.stringify({
    report_path: reportPath,
    mode: result.mode,
    target: result.target,
    pages_scanned: result.pages.length,
    targets_checked: findings.length,
    counts,
    verdict: VERDICT_BANDS.find(([, t]) => t(counts))[0],
    unreachable_pages: result.unreachablePages.length,
    top_findings: worst,
    truncated_findings: Math.max(0, findings.filter((f) => f.severity !== 'OK').length - worst.length),
  }, null, 2));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
