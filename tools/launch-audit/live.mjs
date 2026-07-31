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

async function head(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // GET, not HEAD: many hosts answer HEAD with 405 or omit the very headers
    // this module exists to read.
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    return { ok: true, status: res.status, headers: res.headers, url: res.url };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
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

  for (const [key, path] of [['robots_txt', '/robots.txt'], ['sitemap_xml', '/sitemap.xml']]) {
    const r = await head(origin + path);
    checks[key] = r.ok && r.status === 200;
    if (!checks[key]) at(`missing_${key}`, `GET ${path} returned ${r.ok ? r.status : r.error}`);
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
