// tests/launch-live.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { checkLive } from '../tools/launch-audit/live.mjs';

// Fixed, long-expiry self-signed cert/key for 127.0.0.1, generated once with
// `openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=127.0.0.1"`.
// Only used to prove real redirect/TLS behavior for the https-after-redirect
// regression below — never validated against a real CA, so tests must disable
// NODE_TLS_REJECT_UNAUTHORIZED around the single fetch that hits it.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7kEPTJ4y23j/g
UMgK1xtTNSzC5EOZ26hdxjRdF9d7fdBNs3wOJ5u+55j/QKCUzaLvkoTqQfd6yqtH
ESAzchIj2CRJrD2FZCEhZE1hrbLu9h1k4ap7h94Rr/t614IIasDph8wlc69khTZW
G8vXzMbBTwWlmOxH/tD29COwVZgAEIru55Q3GC3HN6OLp7N2A7cGN+2q4/qzHQZX
S5e6lReDbQkTdLIPZAm77g0/eN4SkOMGXqLDj78jNHFItth3CIk2kzYILGpTNbvr
aZbeqye5xZXXSDYRt/mant+21AIT/UTcWGghLlLNpaQkYCG/vi6EN7iDYG08LSPk
XdY1OFxJAgMBAAECggEAAW1wlZDlkDJyr91LPi3gybf5rAXEAjuNGf2bQkZoZFzb
/BEe/qhMXzmnljpQVWq8GTn3LW6sqt4T3ceHFpG4Cp/wksNBU8ER1g1wKQuDB55q
VdsBis1JIlF4fbjsT+467FnMKb48cP7pH744RZZCnCIsC8I+aGhwJI/f1DuF9yGT
dC0e7tE8SBgud6+67txTHEoZf2BhY+5mKqCcRnu9RAiiVzp7FBMlJstm76ZAKb+t
I8YsPtcdSRoFEhgpKnru5xbz2RV3knOGkFqMZnQmdptEH6fKGbggAw7VArgo0i19
Usy2qsC6iRgUkgQy2AxR6QVWu6ezqUvJQMfVVrlHCwKBgQD32zEzbKbsdbaJKqQE
bFeVkn7+fTwG1pI2WyOr9xkO5HSL12rK+RPb9vS5BxMOyYmjrwQfjLFdLz0plXVA
lw3m4ZBbEgmPfw8ffdoc1M6k3ghTP370nmSfOZ4TjqJKctIzB9yGhDSgYhtEs++R
y+6v/LJjWcslP4mqMmn1a7LfBwKBgQDBue3mOt3wdZjdJoNGLcwdB+f4D/yvQaZe
GqASD/Nh2+pBjGqs6kd77IDH7lIuv9qdlYQTUeLTyGc523bDkzwF7UNWHzer1dLe
6yzEM5d8Rjrsje6ziIvWkGAK93VfLZoKUBWBeFTxh8htil4Crtdlyrz/5LHls4cl
9wzIV47GLwKBgBKVmuDSOsnsIZ2zVs0GGqMacu8+EKwqlpgAyXHxey2Er8B0jItf
lb+eisb84s7vCaT+UH7VG89y5VEi5cHMEbzIGPzbI2BhFI817o7O3he6lkE3t5s7
7SuLNHEe9shCR8SPyFdFvnRwJr9GBqaV9fW4KuAMMZE/bGEYmp1OUAEtAoGBAIWQ
KvUQoPOoIDxY0SkRaiiZytS8MPqjyJAYy0Oou6Q8esW2idWtsJs/84nkRcT1gUQk
UWsAieJ5yLGbHca5PCjZ7BL0cu2F/lyyx6p953NG+FkfgfNFsSO9ZnopIkL8rbdu
f2VEEUx00Tq0qxwub1M+9A95HS3BGOyT57w4obcBAoGAUvIE2MY45jGN/yg23OgH
aipNHeRv0NICpGKn3QAtzYmpzuC4nEEenjQyUFlkYqvU8mfdJE3Hhg6yM8U1WZLI
jwvchbn9P3jCeyb056MwWTb5AHEQdrCxuRlUwd3zWBMlsRFuUy1sXaD0s6kSLvUr
5k2vaPh7HVoszzza1o9pD0k=
-----END PRIVATE KEY-----`;
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUB738bja8cMjXcpVMkTngBQ38Om8wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDczMTExNDMwOFoXDTM2MDcy
ODExNDMwOFowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAu5BD0yeMtt4/4FDICtcbUzUswuRDmduoXcY0XRfXe33Q
TbN8DiebvueY/0CglM2i75KE6kH3esqrRxEgM3ISI9gkSaw9hWQhIWRNYa2y7vYd
ZOGqe4feEa/7eteCCGrA6YfMJXOvZIU2VhvL18zGwU8FpZjsR/7Q9vQjsFWYABCK
7ueUNxgtxzeji6ezdgO3BjftquP6sx0GV0uXupUXg20JE3SyD2QJu+4NP3jeEpDj
Bl6iw4+/IzRxSLbYdwiJNpM2CCxqUzW762mW3qsnucWV10g2Ebf5mp7fttQCE/1E
3FhoIS5SzaWkJGAhv74uhDe4g2BtPC0j5F3WNThcSQIDAQABo1MwUTAdBgNVHQ4E
FgQUn97TrWC8SVrYD2PF3J7qQCUuP6cwHwYDVR0jBBgwFoAUn97TrWC8SVrYD2PF
3J7qQCUuP6cwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAPeCs
oJ5+l283pMgONs5ZfjT7W9nZpRzx541hVPe7TA1cvsbvd4YTUt2LOeUk4d3Pe+3L
dyMVDpEuKdP+tmq+pKOkbAja1mR77yGvdurbQ0uT3z2z35xam1rhiy47joYVEVQT
LyOBi/ojq8D9nNVCZqGaRik8b0qh1jr/9wbt4w9fYDYN2FugZmpZEgqjE1vzGM2I
mEb8ObCG7HHO/ZpikdamPhW9H5bpYlzu5n7lOKVcVkdfs7++cNS2trbPNkg7kAvi
8s4AQ6SDCaU0swhirWuzHeJGbG7dbQlrfeOQ5MIlvYPDAvCaThsYqOMT/DSbFBxF
KM52ZwJN7JfWjfQqdg==
-----END CERTIFICATE-----`;

// A real loopback server, not a fetch stub: the thing under test is how the
// module reads headers and status codes, and a stub would only prove the stub.
function serve(handler) {
  const s = createServer(handler);
  return new Promise((res) => s.listen(0, '127.0.0.1', () => res({ s, base: `http://127.0.0.1:${s.address().port}` })));
}
const close = (s) => new Promise((r) => s.close(r));

test('live: a healthy site passes every check', async () => {
  const { s, base } = await serve((req, res) => {
    if (req.url === '/robots.txt') return res.writeHead(200).end('User-agent: *\nAllow: /');
    if (req.url === '/sitemap.xml') return res.writeHead(200).end('<urlset></urlset>');
    if (req.url.startsWith('/twt-launch-probe')) return res.writeHead(404).end('nope');
    res.writeHead(200, { 'strict-transport-security': 'max-age=63072000' }).end('<html></html>');
  });
  const live = await checkLive(base);
  await close(s);
  assert.equal(live.status, 'ok');
  assert.equal(live.checks.reachable, true);
  assert.equal(live.checks.status_code, 200);
  assert.equal(live.checks.robots_txt, true);
  assert.equal(live.checks.sitemap_xml, true);
  assert.equal(live.checks.notfound_status, 404);
  assert.equal(live.checks.x_robots_noindex, false);
  assert.deepEqual(live.findings.filter((f) => f.kind === 'x_robots_noindex'), []);
});

test('live: an X-Robots-Tag noindex header is found', async () => {
  const { s, base } = await serve((req, res) =>
    res.writeHead(200, { 'x-robots-tag': 'noindex, nofollow' }).end('<html></html>'));
  const live = await checkLive(base);
  await close(s);
  assert.equal(live.checks.x_robots_noindex, true);
  assert.ok(live.findings.some((f) => f.kind === 'x_robots_noindex'));
});

test('live: a soft 404 returning 200 is its own finding', async () => {
  const { s, base } = await serve((req, res) => res.writeHead(200).end('<html>Not found</html>'));
  const live = await checkLive(base);
  await close(s);
  assert.equal(live.checks.notfound_status, 200);
  assert.ok(live.findings.some((f) => f.kind === 'soft_404'));
});

test('live: a missing robots.txt and sitemap.xml are reported', async () => {
  const { s, base } = await serve((req, res) => {
    if (req.url !== '/') return res.writeHead(404).end('nope');
    res.writeHead(200).end('<html></html>');
  });
  const live = await checkLive(base);
  await close(s);
  assert.equal(live.checks.robots_txt, false);
  assert.equal(live.checks.sitemap_xml, false);
  assert.ok(live.findings.some((f) => f.kind === 'missing_robots_txt'));
});

test('live: an unreachable host degrades to status failed and never throws', async () => {
  const live = await checkLive('http://127.0.0.1:1');
  assert.equal(live.status, 'failed');
  assert.equal(live.checks.reachable, false);
  assert.ok(live.findings.some((f) => f.kind === 'unreachable'));
});

test('live: a plain-http production URL is flagged as not https', async () => {
  const { s, base } = await serve((req, res) => res.writeHead(200).end('<html></html>'));
  const live = await checkLive(base);
  await close(s);
  assert.equal(live.checks.https, false);
  assert.ok(live.findings.some((f) => f.kind === 'no_https'));
});

// ---- regression: https must be judged by where the response landed, not by
// the input string. The brief's sample code set `checks.https` from
// `base.startsWith('https://')` — a plain-http URL that correctly redirects to
// https would still be reported as insecure, a fabricated failure against a
// site doing the right thing.
test('live: an http URL that redirects to https is judged by where it lands, not by the input spelling', async () => {
  const httpsServer = createHttpsServer({ key: TEST_KEY, cert: TEST_CERT }, (req, res) => {
    res.writeHead(200, { 'strict-transport-security': 'max-age=63072000' }).end('<html></html>');
  });
  await new Promise((r) => httpsServer.listen(0, '127.0.0.1', r));
  const httpsPort = httpsServer.address().port;
  const { s, base } = await serve((req, res) =>
    res.writeHead(302, { Location: `https://127.0.0.1:${httpsPort}${req.url}` }).end());

  // The self-signed test cert above isn't chained to a real CA. Disabling
  // verification is scoped to this one fetch and always restored, even if the
  // fetch throws.
  const prevReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let live;
  try {
    live = await checkLive(base);
  } finally {
    if (prevReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevReject;
  }
  await close(s);
  await new Promise((r) => httpsServer.close(r));

  assert.equal(live.checks.reachable, true);
  assert.equal(live.checks.https, true, 'the redirect landed on https; the http input spelling must not override that');
  assert.ok(!live.findings.some((f) => f.kind === 'no_https'), 'no_https must not fire for a URL that redirects to https');
});

// ---- regression: robots.txt/sitemap.xml are host-root conventions. The
// brief's sample code probed `base + '/robots.txt'`, so a URL with a path
// prefix (a staging deploy under /staging/, say) would probe
// /staging/robots.txt — which almost never exists — and report a false
// "missing" even when robots.txt is served correctly at the real, root
// location the robots exclusion protocol actually consults.
test('live: robots.txt and sitemap.xml are checked at the origin root, not under a supplied path prefix', async () => {
  const { s, base } = await serve((req, res) => {
    if (req.url === '/robots.txt') return res.writeHead(200).end('User-agent: *\nAllow: /');
    if (req.url === '/sitemap.xml') return res.writeHead(200).end('<urlset></urlset>');
    if (req.url.startsWith('/twt-launch-probe')) return res.writeHead(404).end('nope');
    if (req.url === '/staging/') return res.writeHead(200).end('<html></html>');
    res.writeHead(404).end('nope');
  });
  const live = await checkLive(`${base}/staging/`);
  await close(s);
  assert.equal(live.checks.reachable, true);
  assert.equal(live.checks.robots_txt, true, 'robots.txt lives at the origin root even when the audited URL has a path');
  assert.equal(live.checks.sitemap_xml, true, 'sitemap.xml lives at the origin root even when the audited URL has a path');
  assert.deepEqual(live.findings.filter((f) => f.kind === 'missing_robots_txt'), []);
  assert.deepEqual(live.findings.filter((f) => f.kind === 'missing_sitemap_xml'), []);
});

// ---- coverage: trailing slash and port on the input are handled cleanly
// (no doubled slash, url recorded without the trailing slash).
test('live: a trailing slash on the input URL is normalized, not doubled', async () => {
  const seen = [];
  const { s, base } = await serve((req, res) => {
    seen.push(req.url);
    if (req.url === '/robots.txt' || req.url === '/sitemap.xml') return res.writeHead(200).end('ok');
    if (req.url.startsWith('/twt-launch-probe')) return res.writeHead(404).end('nope');
    res.writeHead(200).end('<html></html>');
  });
  const live = await checkLive(base + '/');
  await close(s);
  assert.equal(live.checks.reachable, true);
  assert.equal(live.url, base, 'the trailing slash must be stripped from the recorded url');
  assert.ok(seen.every((u) => !u.includes('//')), `no doubled slash in any request path: ${seen.join(', ')}`);
});

// ---- regression: computing the origin (for the robots.txt/sitemap.xml fix
// above) via `new URL(base).origin` throws synchronously on a malformed
// string, which would break checkLive's own "never throws" contract for any
// caller that doesn't separately wrap it (launch-scan.mjs does, but the
// module's contract shouldn't depend on that).
test('live: a malformed URL degrades to a result instead of throwing', async () => {
  const live = await checkLive('not a url at all');
  assert.equal(live.status, 'failed');
  assert.equal(live.checks.reachable, false);
});
