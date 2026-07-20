import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (this repo lives under "C:\Work\~marketplace") decode.
const TOOL = fileURLToPath(new URL('../tools/site-crawl.mjs', import.meta.url));

// Two-hostname fixture on one server: 127.0.0.1 plays the apex domain and
// 301-redirects every request to localhost (the "www"), which serves a
// 3-page site. This is the xivic.com -> www.xivic.com shape that used to
// kill the crawl after one page, because crawl() pinned the start hostname.
let srv, port;

const page = (title, body) =>
  `<html><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

before(async () => {
  srv = createServer((req, res) => {
    const host = req.headers.host || '';
    if (host.startsWith('127.0.0.1')) {
      res.writeHead(301, { location: `http://localhost:${port}${req.url}` });
      res.end('<html><body>Moved Permanently</body></html>');
      return;
    }
    res.setHeader('content-type', 'text/html');
    if (req.url === '/') res.end(page('Home', `<a href="/a">A</a> <a href="/b">B</a> <a href="/offsite">Off</a>`));
    else if (req.url === '/a') res.end(page('Page A', ''));
    else if (req.url === '/b') res.end(page('Page B', ''));
    else if (req.url === '/offsite') {
      // mid-crawl redirect to a *different* host — must not be saved as a page
      res.writeHead(301, { location: `http://127.0.0.2:${port}/elsewhere` });
      res.end('Moved');
    } else if (req.url === '/elsewhere') res.end(page('Elsewhere', ''));
    else { res.writeHead(404); res.end('nope'); }
  });
  await new Promise((r) => srv.listen(0, r));
  port = srv.address().port;
});

after(() => srv.close());

// async execFile, NOT execFileSync: the fixture server lives in this process,
// and a sync spawn would block the event loop so the server could never answer
// the crawler child — every fetch would time out.
const run = async (args, cwd) => {
  const { stdout } = await promisify(execFile)(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd });
  return JSON.parse(stdout);
};

test('fetch follows a start-URL redirect to the final host and keeps crawling there', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-crawl-'));
  const out = await run(['fetch', `http://127.0.0.1:${port}`, '--max', '10'], dir);

  // the output folder is named after the FINAL host, not the redirecting one
  assert.match(out.out_dir, /localhost$/);
  assert.ok(!existsSync(join(dir, '.twt-artifacts', 'pre-design', 'content', 'fetched', 'site', `127.0.0.1`)));

  // home + a + b crawled; the off-site redirect is reported, never written
  assert.equal(out.pages_written, 3);
  assert.equal(out.unreachable.length, 1);
  assert.match(out.unreachable[0], /offsite/);

  const domainDir = join(dir, out.out_dir);
  const files = readdirSync(domainDir, { recursive: true }).map(String);
  assert.ok(files.some((f) => /(^|[\\/])index\.md$/.test(f)));
  for (const f of files.filter((f) => f.endsWith('.md'))) {
    const body = readFileSync(join(domainDir, f), 'utf8');
    assert.ok(!/Moved Permanently/i.test(body), `${f} contains a redirect body`);
  }
});

test('search follows the start-URL redirect too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-crawl-'));
  const out = await run(['search', 'Page', `http://127.0.0.1:${port}`, '--max', '10'], dir);
  assert.equal(out.pages_scanned, 3);
  assert.match(out.report_path, /localhost/);
});
