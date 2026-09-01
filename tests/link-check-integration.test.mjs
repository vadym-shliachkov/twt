// tests/link-check-integration.test.mjs — the CLI end to end against a fixture
// HTTP server that serves one of every status class a link checker has to get
// right: 404, 403, 500, a HEAD-refusing endpoint, a 301 chain, a soft 404, a
// missing image, a dead fragment and a connection-refused host.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../skills/twt-link-check/tools/link-check.mjs', import.meta.url));

// Port 1 is never listening — an instant ECONNREFUSED, no real network egress.
const DEAD = 'http://127.0.0.1:1/dead-host';

let srv, port;
const home = () => `<!doctype html>
<html><body>
<a href="/about">About</a>
<a href="/gone">Gone page</a>
<a href="/forbidden">Forbidden page</a>
<a href="/boom">Broken server</a>
<a href="/old">Moved page</a>
<a href="/head-refuses">HEAD refuser</a>
<a href="/soft404">Soft 404</a>
<a href="/about#team">Valid anchor</a>
<a href="/about#nonexistent">Dead anchor</a>
<a href="#">Placeholder</a>
<a href="mailto:not-an-address">Bad mail</a>
<a href="mailto:hello@example.com">Good mail</a>
<a href="${DEAD}">Unreachable host</a>
<a href="http://127.0.0.1:${port}/gone">External 404</a>
<img src="/img/ok.png" alt="Fine">
<img src="/img/missing.png" alt="Missing art">
</body></html>`;

before(async () => {
  srv = createServer((req, res) => {
    const url = req.url.split('?')[0];
    const html = (body, status = 200) => {
      res.writeHead(status, { 'content-type': 'text/html' });
      res.end(req.method === 'HEAD' ? '' : body);
    };
    if (url === '/') return html(home());
    if (url === '/about') return html('<h1 id="team">Team</h1><a href="/deep">Deep page</a>');
    if (url === '/deep') return html('<h1>Deep</h1><a href="/gone">Gone from deep too</a>');
    if (url === '/gone') return html('<h1>Not here</h1>', 404);
    if (url === '/forbidden') return html('<h1>No</h1>', 403);
    if (url === '/boom') return html('<h1>Boom</h1>', 500);
    if (url === '/old') { res.writeHead(301, { location: '/about' }); return res.end(); }
    if (url === '/head-refuses') {
      if (req.method === 'HEAD') { res.writeHead(405); return res.end(); }
      return html('<h1>Fine over GET</h1>');
    }
    if (url === '/soft404') return html('<title>404 - Page not found</title><h1>Page not found</h1>');
    if (url === '/img/ok.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(); }
    if (url === '/img/missing.png') { res.writeHead(404); return res.end(); }
    return html('<h1>404</h1>', 404);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

after(() => srv.close());

// async execFile, NOT execFileSync: the fixture server runs in this process, so
// a sync spawn would deadlock — the server could never answer the child.
async function run(args) {
  const out = mkdtempSync(join(tmpdir(), 'twt-lci-'));
  const report = join(out, 'link-report.md');
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [TOOL, ...args, '--out', report, '--timeout', '4000'],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  return { json: JSON.parse(stdout), md: readFileSync(report, 'utf8'), report };
}

const findingFor = (json, needle) => json.top_findings.find((f) => f.target.includes(needle));

test('page mode reports each status class at the right severity', async () => {
  const { json, md } = await run(['page', `http://localhost:${port}/`]);

  assert.equal(json.mode, 'page');
  assert.equal(json.pages_scanned, 1);
  assert.equal(json.verdict, 'FAIL');

  const gone = findingFor(json, '/gone');
  assert.equal(gone.severity, 'BLOCKER', 'an internal 404 must block');
  assert.equal(gone.klass, 'not-found');

  assert.equal(findingFor(json, '/forbidden').klass, 'forbidden');
  assert.equal(findingFor(json, '/boom').klass, 'server-error');
  assert.equal(findingFor(json, '/img/missing.png').klass, 'not-found');
  assert.equal(findingFor(json, DEAD).klass, 'unreachable');
  assert.equal(findingFor(json, '/soft404').klass, 'soft-404');

  // The 301 to a page that exists is a warning to update the href, not a break.
  const moved = findingFor(json, '/old');
  assert.equal(moved.klass, 'redirect-permanent');
  assert.equal(moved.severity, 'WARNING');

  // Everything healthy stays out of the findings list entirely.
  assert.equal(findingFor(json, '/img/ok.png'), undefined);
  assert.match(md, /HTTP 200 · http:\/\/localhost:\d+\/img\/ok\.png/);
});

test('a HEAD-refusing endpoint is not reported as broken', async () => {
  const { json, md } = await run(['page', `http://localhost:${port}/`]);
  assert.equal(findingFor(json, '/head-refuses'), undefined, '405-on-HEAD must fall back to GET');
  assert.match(md, /HTTP 200 · http:\/\/localhost:\d+\/head-refuses/);
});

test('fragments are checked against the target page: the dead one is found, the live one is not', async () => {
  const { json } = await run(['page', `http://localhost:${port}/`]);
  const dead = findingFor(json, '#nonexistent');
  assert.ok(dead, 'a href to #nonexistent on /about must be reported');
  assert.equal(dead.klass, 'missing-fragment');
  assert.equal(dead.severity, 'BLOCKER');
  assert.equal(findingFor(json, '#team'), undefined, 'an anchor that exists must not be reported');
});

test('placeholder hrefs and malformed mailto: are reported without a network call', async () => {
  const { json } = await run(['page', `http://localhost:${port}/`, '--no-external']);
  const ph = json.top_findings.find((f) => f.klass === 'placeholder');
  assert.ok(ph, 'href="#" must be reported');
  assert.equal(ph.severity, 'WARNING');
  const mail = json.top_findings.find((f) => f.klass === 'malformed');
  assert.match(mail.target, /not-an-address/);
  assert.ok(!json.top_findings.some((f) => f.target === 'mailto:hello@example.com'), 'a valid address is not a finding');
});

test('an off-host 404 is a WARNING, not a BLOCKER', async () => {
  const { json } = await run(['page', `http://localhost:${port}/`]);
  const external = json.top_findings.find((f) => f.target.startsWith(`http://127.0.0.1:${port}/gone`));
  assert.equal(external.severity, 'WARNING');
  assert.equal(external.klass, 'not-found');
});

test('site mode crawls onward and merges the same broken target found on several pages', async () => {
  const { json, md } = await run(['site', `http://localhost:${port}/`, '--max', '10']);
  assert.ok(json.pages_scanned >= 3, `expected the crawl to reach /about and /deep, got ${json.pages_scanned}`);

  const gone = findingFor(json, '/gone');
  assert.equal(gone.refs, 2, '/gone is linked from both / and /deep — one finding, two sources');
  assert.match(md, /Referenced from 2 place\(s\)/);
  assert.match(md, /:\d+ `<a href="\/gone">`/);
});

test('--no-external skips off-host probes and says so in the report', async () => {
  const { json, md } = await run(['page', `http://localhost:${port}/`, '--no-external']);
  assert.equal(findingFor(json, DEAD), undefined);
  assert.match(md, /external_checked: false/);
  assert.match(md, /external check disabled/);
});

test('--no-assets drops image and script references', async () => {
  const { json, md } = await run(['page', `http://localhost:${port}/`, '--no-assets']);
  assert.equal(findingFor(json, '/img/missing.png'), undefined);
  assert.match(md, /assets_checked: false/);
});

test('the JSON summary stays bounded and points at the report', async () => {
  const { json, report } = await run(['page', `http://localhost:${port}/`]);
  assert.equal(json.report_path, report);
  assert.ok(json.top_findings.length <= 25);
  assert.equal(typeof json.truncated_findings, 'number');
  assert.deepEqual(Object.keys(json.counts).sort(), ['BLOCKER', 'OK', 'SUGGESTION', 'WARNING']);
});

test('an unreadable target fails loudly instead of writing an empty report', async () => {
  await assert.rejects(
    () => run(['page', `http://127.0.0.1:1/nothing`]),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr, /Cannot read/);
      return true;
    },
  );
});

// ---- local mode --------------------------------------------------------------

function builtSite() {
  const root = mkdtempSync(join(tmpdir(), 'twt-lcl-'));
  mkdirSync(join(root, 'about'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'assets', 'site.css'), 'body{}', 'utf8');
  writeFileSync(join(root, 'index.html'), [
    '<link rel="stylesheet" href="/assets/site.css">',
    '<a href="/about">About</a>',
    '<a href="/careers">Careers</a>',
    '<a href="/about#team">Team</a>',
    '<a href="/about#ghost">Ghost</a>',
    '<img src="/assets/logo.svg" alt="Logo">',
  ].join('\n'), 'utf8');
  writeFileSync(join(root, 'about', 'index.html'), '<h1 id="team">Team</h1>', 'utf8');
  return root;
}

test('local mode keys missing files by the resolved path, not the raw href', async () => {
  // The same absent file, reached by two different relative spellings from two
  // different directories, is ONE broken file. And two identical hrefs that
  // resolve to different directories are TWO.
  const root = mkdtempSync(join(tmpdir(), 'twt-lck-'));
  mkdirSync(join(root, 'blog'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<a href="/team.html">T</a><img src="logo.png">', 'utf8');
  writeFileSync(join(root, 'blog', 'index.html'), '<a href="../team.html">T</a><img src="logo.png">', 'utf8');

  const { json } = await run(['local', root, '--no-external']);
  const team = json.top_findings.filter((f) => f.target.includes('team.html'));
  assert.equal(team.length, 1, 'two spellings of one missing file must merge into one finding');
  assert.equal(team[0].refs, 2);

  const logos = json.top_findings.filter((f) => f.target.endsWith('logo.png'));
  assert.equal(logos.length, 2, 'the same href resolving to two directories is two missing files');
});

test('local mode resolves internal links on disk and reports the ones that are not there', async () => {
  const { json, md } = await run(['local', builtSite(), '--no-external']);
  assert.equal(json.mode, 'local');
  assert.equal(json.pages_scanned, 2);
  assert.equal(json.verdict, 'FAIL');

  // Findings are named by the path that is missing from the build, not by the
  // href spelling that happened to reach it.
  const careers = findingFor(json, 'careers');
  assert.equal(careers.klass, 'missing-file');
  assert.equal(careers.severity, 'BLOCKER');
  assert.match(careers.label, /tried careers, careers\.html/);
  assert.equal(findingFor(json, 'assets/logo.svg').klass, 'missing-file');

  // Present files and a live anchor produce no findings.
  assert.equal(findingFor(json, 'site.css'), undefined);
  assert.equal(findingFor(json, '#team'), undefined);
  assert.equal(findingFor(json, '#ghost').klass, 'missing-fragment');
  assert.match(md, /mode: local/);
});
