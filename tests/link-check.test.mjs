// tests/link-check.test.mjs — unit coverage for the pure helpers in link-check.mjs.
// The end-to-end runs (fixture HTTP server, crawl, report) live in
// tests/link-check-integration.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// fileURLToPath-equivalent import: the repo lives under "C:\Work\~marketplace",
// so a hand-rolled .pathname would arrive percent-encoded.
const {
  extractRefs, extractAnchors, classifyRaw, parseSrcset, blankComments,
  canonical, looksSoft404, verdictFor, resolveLocalTarget, buildFindings,
  renderReport, probeUrl, pool,
} = await import(new URL('../skills/twt-link-check/tools/link-check.mjs', import.meta.url));

// ---- extractRefs -------------------------------------------------------------

test('extractRefs finds anchors, assets, srcset entries and records line numbers', () => {
  const html = [
    '<html><body>',                                   // 1
    '<a href="/about">About us</a>',                  // 2
    '<img src="/img/a.png" alt="A logo">',            // 3
    '<script src="/js/app.js"></script>',             // 4
    '<link rel="stylesheet" href="/css/site.css">',   // 5
    '<iframe src="https://player.example/v/1"></iframe>', // 6
    '<img srcset="/img/s.png 1x, /img/l.png 2x">',    // 7
  ].join('\n');
  const refs = extractRefs(html);
  const got = refs.map((r) => `${r.element}:${r.attr}:${r.raw}:${r.line}`);
  assert.deepEqual(got, [
    'a:href:/about:2',
    'img:src:/img/a.png:3',
    'script:src:/js/app.js:4',
    'link:href:/css/site.css:5',
    'iframe:src:https://player.example/v/1:6',
    'img:srcset:/img/s.png:7',
    'img:srcset:/img/l.png:7',
  ]);
  assert.equal(refs[0].kind, 'link');
  assert.equal(refs[0].text, 'About us');
  assert.equal(refs[1].kind, 'asset');
  assert.equal(refs[1].text, 'A logo');
});

test('extractRefs with assets:false yields navigational links only', () => {
  const html = '<a href="/a">A</a><img src="/i.png"><script src="/s.js"></script>';
  assert.deepEqual(extractRefs(html, { assets: false }).map((r) => r.raw), ['/a']);
});

test('extractRefs skips references inside HTML comments but keeps line numbers', () => {
  const html = '<a href="/live">Live</a>\n<!--\n<a href="/dead">Dead</a>\n-->\n<a href="/last">Last</a>';
  const refs = extractRefs(html);
  assert.deepEqual(refs.map((r) => r.raw), ['/live', '/last']);
  assert.equal(refs[1].line, 5, 'a blanked comment must not shift later line numbers');
});

test('extractRefs ignores <link rel=canonical> and other metadata rels', () => {
  const html = '<link rel="canonical" href="/x"><link rel="alternate" href="/feed.xml"><link rel="icon" href="/f.ico">';
  assert.deepEqual(extractRefs(html).map((r) => r.raw), ['/f.ico']);
});

test('blankComments preserves the newline count of what it removes', () => {
  const out = blankComments('a<!--\n\n-->b');
  assert.equal(out.split('\n').length, 3);
  assert.ok(!out.includes('--'));
});

test('parseSrcset drops descriptors and data: URIs', () => {
  assert.deepEqual(parseSrcset('/a.png 480w, /b.png 2x'), ['/a.png', '/b.png']);
  assert.deepEqual(parseSrcset('data:image/gif;base64,R0lGOD 1x, /c.png 2x'), ['/c.png']);
});

// ---- classifyRaw -------------------------------------------------------------

const base = 'https://site.test/page';

test('classifyRaw flags placeholder hrefs without probing them', () => {
  for (const raw of ['', '#', 'javascript:void(0)', 'javascript:;', 'TODO']) {
    assert.equal(classifyRaw(raw, base).type, 'placeholder', `${raw} should be a placeholder`);
  }
});

test('classifyRaw validates mailto: and tel: syntax', () => {
  assert.equal(classifyRaw('mailto:hi@example.com', base).type, 'mailto');
  assert.equal(classifyRaw('mailto:hi@example.com?subject=Hey', base).type, 'mailto');
  assert.equal(classifyRaw('tel:+1 (555) 010-9999', base).type, 'tel');
  assert.equal(classifyRaw('mailto:', base).type, 'malformed');
  assert.equal(classifyRaw('mailto:not-an-address', base).type, 'malformed');
  assert.equal(classifyRaw('tel:abc', base).type, 'malformed');
});

test('classifyRaw splits the fragment off an http target', () => {
  const c = classifyRaw('/team#leadership', base);
  assert.equal(c.type, 'http');
  assert.equal(c.url, 'https://site.test/team');
  assert.equal(c.fragment, 'leadership');
});

test('classifyRaw treats a bare #fragment as same-page and ignores data:/blob:', () => {
  assert.deepEqual(classifyRaw('#pricing', base), { type: 'fragment', fragment: 'pricing' });
  assert.equal(classifyRaw('data:image/png;base64,AAA', base).type, 'ignore');
  assert.equal(classifyRaw('ftp://files.example/x', base).type, 'ignore');
});

test('canonical folds trailing slashes and index.html into one identity', () => {
  const a = canonical('https://s.test/about/');
  assert.equal(canonical('https://s.test/about'), a);
  assert.equal(canonical('https://s.test/about/index.html'), a);
  assert.equal(canonical('https://s.test/'), 'https://s.test/');
});

// ---- anchors / soft 404 ------------------------------------------------------

test('extractAnchors collects id= and <a name=> targets', () => {
  const ids = extractAnchors('<h2 id="pricing">P</h2><a name="legacy"></a><div id=\'quoted\'></div>');
  assert.deepEqual([...ids].sort(), ['legacy', 'pricing', 'quoted']);
});

test('looksSoft404 fires on a "not found" title, not on ordinary pages', () => {
  assert.ok(looksSoft404('<title>404 – Page not found</title>'));
  assert.ok(looksSoft404('<title>Acme</title><h1>Nothing found</h1>'));
  assert.ok(!looksSoft404('<title>Our services</title><h1>Services</h1>'));
});

// ---- verdicts ----------------------------------------------------------------

const entry = (over = {}) => ({ type: 'http', kind: 'link', scope: 'internal', sources: [], ...over });

test('a 404 on the audited site is a BLOCKER; the same 404 off-site is a WARNING', () => {
  const p = { status: 404, finalUrl: 'https://site.test/x', chain: [], headers: {} };
  assert.equal(verdictFor(entry({ probe: p })).severity, 'BLOCKER');
  assert.equal(verdictFor(entry({ scope: 'external', probe: p })).severity, 'WARNING');
});

test('a 403 from a known bot-protected host is a SUGGESTION, not a broken link', () => {
  const blocked = verdictFor(entry({
    scope: 'external',
    probe: { status: 403, finalUrl: 'https://www.linkedin.com/in/x', chain: [], headers: {} },
  }));
  assert.equal(blocked.severity, 'SUGGESTION');
  assert.equal(blocked.klass, 'blocked');

  const real403 = verdictFor(entry({
    scope: 'external',
    probe: { status: 403, finalUrl: 'https://plain.example/x', chain: [], headers: {} },
  }));
  assert.equal(real403.klass, 'forbidden');
  assert.equal(real403.severity, 'WARNING');
});

test('a 403 carrying a bot-protection header is downgraded whatever the host', () => {
  const v = verdictFor(entry({
    scope: 'external',
    probe: { status: 403, finalUrl: 'https://plain.example/x', chain: [], headers: { 'cf-mitigated': 'challenge' } },
  }));
  assert.equal(v.klass, 'blocked');
});

test('a 404 from a bot-protected host stays broken', () => {
  const v = verdictFor(entry({
    scope: 'external',
    probe: { status: 404, finalUrl: 'https://medium.com/@x/gone', chain: [], headers: {} },
  }));
  assert.equal(v.klass, 'not-found');
});

test('a permanent internal redirect is a WARNING; a temporary one only a SUGGESTION', () => {
  const perm = verdictFor(entry({
    probe: { status: 200, finalUrl: 'https://site.test/new', headers: {}, chain: [{ from: 'https://site.test/old', to: 'https://site.test/new', status: 301 }] },
  }));
  assert.equal(perm.klass, 'redirect-permanent');
  assert.equal(perm.severity, 'WARNING');

  const temp = verdictFor(entry({
    probe: { status: 200, finalUrl: 'https://site.test/new', headers: {}, chain: [{ from: 'https://site.test/old', to: 'https://site.test/new', status: 302 }] },
  }));
  assert.equal(temp.severity, 'SUGGESTION');
});

test('network failures, missing files and missing fragments each get their own class', () => {
  assert.equal(verdictFor(entry({ probe: { status: 0, error: 'DNS lookup failed (host does not resolve)', chain: [], headers: {} } })).klass, 'unreachable');
  assert.equal(verdictFor(entry({ type: 'local-missing', tried: ['about.html'] })).klass, 'missing-file');
  assert.equal(verdictFor(entry({ type: 'missing-fragment', fragment: 'team' })).klass, 'missing-fragment');
  assert.equal(verdictFor(entry({ type: 'placeholder', reason: 'href="#"' })).klass, 'placeholder');
});

test('a soft 404 (HTTP 200 that reads as "not found") is reported, not treated as OK', () => {
  const v = verdictFor(entry({ softNotFound: true, probe: { status: 200, finalUrl: 'https://site.test/x', chain: [], headers: {} } }));
  assert.equal(v.klass, 'soft-404');
  assert.equal(v.severity, 'WARNING');
});

test('an http asset on an https page is flagged as mixed content', () => {
  const v = verdictFor(entry({ kind: 'asset', mixedContent: true, probe: { status: 200, finalUrl: 'http://cdn.example/a.js', chain: [], headers: {} } }));
  assert.equal(v.klass, 'mixed-content');
});

// ---- local resolution --------------------------------------------------------

function fixtureSite() {
  const root = mkdtempSync(join(tmpdir(), 'twt-lc-'));
  mkdirSync(join(root, 'about'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<a href="/about">About</a>', 'utf8');
  writeFileSync(join(root, 'about', 'index.html'), '<h1 id="team">Team</h1>', 'utf8');
  writeFileSync(join(root, 'contact.html'), '<p>Contact</p>', 'utf8');
  return root;
}

test('resolveLocalTarget resolves extensionless paths, directories and .html the way a static host does', () => {
  const root = fixtureSite();
  const page = join(root, 'index.html');
  assert.ok(resolveLocalTarget(root, page, '/about').file.endsWith(join('about', 'index.html')));
  assert.ok(resolveLocalTarget(root, page, '/about/').file.endsWith(join('about', 'index.html')));
  assert.ok(resolveLocalTarget(root, page, '/contact').file.endsWith('contact.html'));
  assert.ok(resolveLocalTarget(root, page, 'contact.html').file.endsWith('contact.html'));
  assert.equal(resolveLocalTarget(root, page, '/careers').file, null);
});

test('resolveLocalTarget strips the query and fragment before hitting the disk', () => {
  const root = fixtureSite();
  const page = join(root, 'index.html');
  assert.ok(resolveLocalTarget(root, page, '/contact?ref=nav#form').file.endsWith('contact.html'));
});

// ---- aggregation & report ----------------------------------------------------

test('buildFindings sorts blockers first and keeps one finding per target', () => {
  const result = {
    targets: [
      entry({ display: 'https://site.test/ok', probe: { status: 200, chain: [], headers: {} }, sources: [{ page: 'p', line: 1, element: 'a', attr: 'href', raw: '/ok', text: '' }] }),
      entry({ display: 'https://site.test/dead', probe: { status: 404, chain: [], headers: {} }, sources: [
        { page: 'p1', line: 3, element: 'a', attr: 'href', raw: '/dead', text: 'One' },
        { page: 'p2', line: 9, element: 'a', attr: 'href', raw: '/dead', text: 'Two' },
      ] }),
    ],
  };
  const findings = buildFindings(result);
  assert.equal(findings[0].severity, 'BLOCKER');
  assert.equal(findings[0].display, 'https://site.test/dead');
  assert.equal(findings[0].sources.length, 2, 'one target referenced twice stays one finding');
});

test('renderReport writes a FAIL verdict, the source lines, and the fix hint', () => {
  const result = {
    mode: 'site', target: 'https://site.test/', host: 'site.test',
    pages: ['https://site.test/'], unreachablePages: [],
    targets: [entry({
      display: 'https://site.test/dead', probe: { status: 404, chain: [], headers: {}, method: 'HEAD' },
      sources: [{ page: 'https://site.test/', line: 12, element: 'a', attr: 'href', raw: '/dead', text: 'Our services' }],
    })],
  };
  const md = renderReport(result, buildFindings(result), { checkExternal: true, checkAssets: true });
  assert.match(md, /verdict: FAIL/);
  assert.match(md, /\*\*Verdict: FAIL\*\*/);
  assert.match(md, /HTTP 404 Not Found · https:\/\/site\.test\/dead/);
  assert.match(md, /https:\/\/site\.test\/:12/);
  assert.match(md, /"Our services"/);
  assert.match(md, /- Fix: /);
});

test('renderReport reports PASS when everything resolves', () => {
  const result = {
    mode: 'page', target: 'https://site.test/', host: 'site.test',
    pages: ['https://site.test/'], unreachablePages: [],
    targets: [entry({ display: 'https://site.test/ok', probe: { status: 200, chain: [], headers: {} }, sources: [{ page: 'https://site.test/', line: 2, element: 'a', attr: 'href', raw: '/ok', text: 'OK' }] })],
  };
  const md = renderReport(result, buildFindings(result), { checkExternal: true, checkAssets: true });
  assert.match(md, /verdict: PASS/);
  assert.match(md, /## BLOCKER — broken on this site \(0\)/);
});

// ---- probeUrl (injected fetch, no network) -----------------------------------

const res = (status, headers = {}) => ({
  status, headers: new Map(Object.entries(headers)), body: null,
});

test('probeUrl retries with GET when HEAD is refused, and records the method used', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push(init.method);
    return init.method === 'HEAD' ? res(405) : res(200, { 'content-type': 'text/html' });
  };
  const out = await probeUrl('https://site.test/x', { fetch: fakeFetch });
  assert.deepEqual(calls, ['HEAD', 'GET']);
  assert.equal(out.status, 200);
  assert.equal(out.method, 'GET');
});

test('probeUrl follows redirects by hand and records the whole chain', async () => {
  const fakeFetch = async (url) => {
    if (url.endsWith('/old')) return res(301, { location: '/mid' });
    if (url.endsWith('/mid')) return res(302, { location: 'https://site.test/new' });
    return res(200);
  };
  const out = await probeUrl('https://site.test/old', { fetch: fakeFetch });
  assert.equal(out.status, 200);
  assert.equal(out.finalUrl, 'https://site.test/new');
  assert.deepEqual(out.chain.map((h) => h.status), [301, 302]);
});

test('probeUrl stops on a redirect loop instead of spinning', async () => {
  const fakeFetch = async (url) => res(302, { location: url.endsWith('/a') ? '/b' : '/a' });
  const out = await probeUrl('https://site.test/a', { fetch: fakeFetch });
  assert.equal(out.error, 'redirect loop');
});

test('probeUrl turns a DNS failure into a readable reason, not a stack trace', async () => {
  const fakeFetch = async () => { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; };
  const out = await probeUrl('https://nope.invalid/', { fetch: fakeFetch });
  assert.equal(out.status, 0);
  assert.match(out.error, /DNS lookup failed/);
});

test('pool never runs more than `limit` tasks at once', async () => {
  let live = 0, peak = 0;
  await pool([...Array(20).keys()], 4, async () => {
    peak = Math.max(peak, ++live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
  });
  assert.ok(peak <= 4, `peak concurrency was ${peak}`);
});
