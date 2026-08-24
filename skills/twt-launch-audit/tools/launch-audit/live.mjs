// tools/launch-audit/live.mjs — category 11's mechanical half.
//
// Only runs when the user supplied a URL, and only reports what a response can
// actually prove. Everything else about operational readiness (backups, DNS
// cutover, who presses the button) is an interview question — inferring it from
// a 200 would be a fabricated fact.
//
// Never throws: an unreachable host is a RESULT (status:'failed' + an
// `unreachable` finding), not a crash that takes the whole scan down.

const TIMEOUT_MS = 10_000;
// Enough of the body to recognise a robots directive or a sitemap root element
// without pulling a multi-megabyte sitemap into memory.
const SNIFF_BYTES = 4096;

async function head(url, { body = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // GET, not HEAD: many hosts answer HEAD with 405 or omit the very headers
    // this module exists to read.
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    // Read the body only where a caller needs it. A failure mid-body is still a
    // failed probe, so it belongs inside this try like every other network error.
    const text = body ? (await res.text()).slice(0, SNIFF_BYTES) : '';
    return { ok: true, status: res.status, headers: res.headers, url: res.url, body: text };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

// What each root file has to look like to count as served.
//
// A 200 proves something answered — not that it answered with the file. A
// catch-all that rewrites unmatched paths to the front page returns 200 for
// /robots.txt (observed in the wild: 301 to /robots.txt/ then 200 text/html,
// 42KB of homepage), and a status-only check reads that as a pass on a site
// that has neither file. So the proof is content-type plus body.
//
// The landing PATH deliberately is not part of the test: /sitemap.xml → 301 →
// /sitemap_index.xml is the standard Yoast shape and a perfectly real sitemap.
// Requiring the response to land where it was asked would fail most of the
// WordPress installs this check exists to serve.
const ROOT_FILES = [
  {
    key: 'robots_txt', path: '/robots.txt',
    // A directive at the start of a line. HTML that merely mentions the word
    // "sitemap" in prose cannot match, and the type gate below rejects it first.
    valid: (b) => /^[\t ]*(user-agent|disallow|allow|sitemap|crawl-delay)[\t ]*:/im.test(b),
    want: 'no robots directive (User-agent:/Disallow:/Allow:/Sitemap:) in the body',
  },
  {
    key: 'sitemap_xml', path: '/sitemap.xml',
    valid: (b) => /<(urlset|sitemapindex)\b/i.test(b),
    want: 'no <urlset> or <sitemapindex> root element in the body',
  },
];

// Returns null when the file is genuinely served, else why it is not.
function rootFileProblem(res, spec) {
  if (!res.ok) return `request failed: ${res.error}`;
  if (res.status !== 200) return `returned ${res.status}`;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const landed = res.url && !res.url.endsWith(spec.path) ? ` (landed on ${res.url})` : '';
  if (type === 'text/html' || type === 'application/xhtml+xml') {
    return `returned 200 ${type}${landed} — an HTML page, not ${spec.path.slice(1)}`;
  }
  if (!spec.valid(res.body || '')) return `returned 200${landed} but ${spec.want}`;
  return null;
}

export async function checkLive(rawUrl) {
  const base = rawUrl.replace(/\/+$/, '');
  // robots.txt and sitemap.xml are host-root conventions (the robots exclusion
  // protocol only ever consults /robots.txt at the origin) — probing them
  // under a supplied path prefix (e.g. https://x.com/staging/robots.txt) would
  // report a false "missing" on every site that lives under a subpath, even
  // though the real file is being served correctly one level up.
  // `new URL()` throws on a malformed string; fall back to `base` itself so a
  // bad --url degrades through the normal unreachable path below instead of
  // throwing out of this function directly.
  let origin;
  try { origin = new URL(base).origin; } catch { origin = base; }
  const findings = [];
  const checks = {
    reachable: false, status_code: null, https: false,
    x_robots_noindex: false, robots_txt: false, sitemap_xml: false,
    notfound_status: null, hsts: false,
  };
  const at = (kind, detail) => findings.push({ kind, file: base, line: 0, detail });

  const root = await head(base + '/');
  if (!root.ok) {
    at('unreachable', `GET ${base}/ failed: ${root.error}`);
    return { status: 'failed', url: base, checks, findings };
  }
  checks.reachable = true;
  checks.status_code = root.status;
  if (root.status >= 400) at('bad_root_status', `GET / returned ${root.status}`);

  // Judge https by where the response actually ended up, not by the string the
  // user typed: a plain-http URL that correctly redirects to https is secure,
  // and hard-coding the input's spelling would flag that as a false failure.
  checks.https = root.url.startsWith('https://');
  if (!checks.https) at('no_https', 'the audited URL does not resolve to https');
  checks.hsts = Boolean(root.headers.get('strict-transport-security'));
  if (checks.https && !checks.hsts) at('no_hsts', 'no Strict-Transport-Security header');

  const xr = root.headers.get('x-robots-tag') || '';
  checks.x_robots_noindex = /\bnoindex\b/i.test(xr);
  if (checks.x_robots_noindex) at('x_robots_noindex', `X-Robots-Tag: ${xr}`);

  for (const spec of ROOT_FILES) {
    const r = await head(origin + spec.path, { body: true });
    const problem = rootFileProblem(r, spec);
    checks[spec.key] = problem === null;
    if (problem) at(`missing_${spec.key}`, `GET ${spec.path} ${problem}`);
  }

  // A path that cannot plausibly exist. A 200 here means the host serves the
  // homepage for every unknown URL, which duplicates the whole site under
  // infinite URLs as far as a crawler is concerned.
  const probe = await head(`${base}/twt-launch-probe-${Date.now()}`);
  if (probe.ok) {
    checks.notfound_status = probe.status;
    if (probe.status === 200) at('soft_404', 'an unknown URL returns 200 instead of 404');
  }

  return { status: 'ok', url: base, checks, findings };
}
