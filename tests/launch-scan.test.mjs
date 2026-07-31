// tests/launch-scan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCAN = fileURLToPath(new URL('../tools/launch-scan.mjs', import.meta.url));
const run = (args) => execFileSync(process.execPath, [SCAN, ...args], { encoding: 'utf8' });
const newProject = () => mkdtempSync(join(tmpdir(), 'twt-launch-'));
function put(p, content) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content, 'utf8'); }
const facts = (dir) => JSON.parse(readFileSync(join(dir, '.twt-artifacts', 'launch', 'facts.json'), 'utf8'));

function siteProject(files) {
  const dir = newProject();
  for (const [name, body] of Object.entries(files)) put(join(dir, 'site', name), body);
  return dir;
}

test('launch-scan: no auditable build exits 0 and says so, writing no facts', () => {
  const dir = newProject();
  const out = run([dir]);
  assert.match(out, /no built HTML found/i);
  assert.throws(() => facts(dir), /ENOENT/);
});

test('launch-scan: bad usage exits 2', () => {
  assert.throws(() => execFileSync(process.execPath, [SCAN], { encoding: 'utf8' }), (e) => e.status === 2);
});

test('launch-scan: writes a well-formed envelope with layers.scan ok', () => {
  const dir = siteProject({ 'index.html': '<html lang="en"><body><h1>Acme</h1></body></html>' });
  run([dir]);
  const f = facts(dir);
  assert.equal(f.tool, 'launch-scan');
  assert.equal(f.version, 1);
  assert.equal(f.mode, 'local');
  assert.equal(f.layers.scan, 'ok');
  assert.equal(f.sources.kind, 'site');
  assert.deepEqual(f.sources.html, ['site/index.html']);
  assert.ok(f.checks.content, 'content check must be present');
  assert.ok(f.checks.hygiene, 'hygiene check must be present');
  assert.match(f.generated, /^\d{4}-\d{2}-\d{2}T/);
});

test('launch-scan: prints a one-line summary and a fenced json block', () => {
  const dir = siteProject({ 'index.html': '<html><body>hi</body></html>' });
  const out = run([dir]);
  assert.match(out, /^launch-scan: /m);
  assert.match(out, /```json/);
});

// ---- content (category 1) ----------------------------------------------------

test('content: counts lorem, TODO markers, and empty slots with file:line', () => {
  const dir = siteProject({
    'index.html': [
      '<html lang="en"><body>',
      '<p>Lorem ipsum dolor sit amet</p>',
      '<p>TODO: real copy here</p>',
      '<h2></h2>',
      '</body></html>',
    ].join('\n'),
  });
  run([dir]);
  const c = facts(dir).checks.content;
  assert.equal(c.counts.lorem_blocks, 1);
  assert.equal(c.counts.placeholder_markers, 1);
  assert.equal(c.counts.empty_headings, 1);
  const lorem = c.findings.find((x) => x.kind === 'lorem');
  assert.equal(lorem.file, 'site/index.html');
  assert.equal(lorem.line, 2);
});

test('content: XXX and FIXME count as placeholder markers, prose does not', () => {
  const dir = siteProject({
    'a.html': '<html><body><p>XXX</p><p>FIXME later</p><p>We fix things.</p></body></html>',
  });
  run([dir]);
  assert.equal(facts(dir).checks.content.counts.placeholder_markers, 2);
});

test('content: clean copy produces zero content findings', () => {
  const dir = siteProject({ 'a.html': '<html lang="en"><body><h1>Acme</h1><p>We build bridges.</p></body></html>' });
  run([dir]);
  const c = facts(dir).checks.content;
  assert.equal(c.counts.lorem_blocks, 0);
  assert.equal(c.counts.placeholder_markers, 0);
  assert.deepEqual(c.findings, []);
});

test('content: a multi-line <script> block does not shift later line numbers', () => {
  const dir = siteProject({
    'index.html': [
      '<html lang="en"><body>',        // line 1
      '<script>',                       // line 2
      'function f() {',                 // line 3
      '  return 1;',                     // line 4
      '}',                               // line 5
      '</script>',                       // line 6
      '<p>TODO: real copy here</p>',     // line 7 — must still be reported as 7
      '</body></html>',                  // line 8
    ].join('\n'),
  });
  run([dir]);
  const c = facts(dir).checks.content;
  const marker = c.findings.find((x) => x.kind === 'placeholder_marker');
  assert.equal(marker.line, 7);
});

test('content: "and" between lorem phrases is a real word, not punctuation — two blocks', () => {
  const dir = siteProject({ 'a.html': '<html><body><p>Lorem ipsum and dolor sit amet</p></body></html>' });
  run([dir]);
  assert.equal(facts(dir).checks.content.counts.lorem_blocks, 2);
});

test('content: extra whitespace between lorem phrases is still one contiguous block', () => {
  const dir = siteProject({ 'a.html': '<html><body><p>Lorem ipsum      dolor sit amet</p></body></html>' });
  run([dir]);
  assert.equal(facts(dir).checks.content.counts.lorem_blocks, 1);
});

// ---- hygiene (category 9) ---------------------------------------------------

test('hygiene: a committed .env is found', () => {
  const dir = siteProject({ 'index.html': '<html></html>' });
  put(join(dir, '.env'), 'API_KEY=sk-live-abc123\n');
  run([dir]);
  const h = facts(dir).checks.hygiene;
  assert.equal(h.counts.committed_secret_files, 1);
  assert.ok(h.findings.some((x) => x.kind === 'secret_file' && x.file === '.env'));
});

test('hygiene: an inline API key in shipped HTML is found', () => {
  const dir = siteProject({ 'index.html': '<script>const k = "sk_live_51H8xYzAbCdEfGhIjKlMnOp";</script>' });
  run([dir]);
  assert.equal(facts(dir).checks.hygiene.counts.inline_secrets, 1);
});

test('hygiene: the inline-secret finding redacts the key — never republishes it in full', () => {
  const KEY = ['sk', 'live', '51H8xYzAbCdEfGhIjKlMnOpQRSTUVWXYZ0123456789'].join('_');
  const dir = siteProject({ 'index.html': `<script>const k = "${KEY}";</script>` });
  run([dir]);
  const h = facts(dir).checks.hygiene;
  const found = h.findings.find((x) => x.kind === 'inline_secret');
  assert.ok(found, 'expected an inline_secret finding');
  assert.match(found.detail, /redacted/i);
  assert.ok(!found.detail.includes(KEY), 'detail must not contain the full matched key');
  // Also guard against the raw facts.json ever carrying the live value anywhere.
  const raw = readFileSync(join(dir, '.twt-artifacts', 'launch', 'facts.json'), 'utf8');
  assert.ok(!raw.includes(KEY), 'facts.json must never contain the full matched key');
});

test('hygiene: console.log and debugger in shipped files are counted', () => {
  const dir = siteProject({ 'index.html': '<script>console.log("x"); debugger;</script>' });
  run([dir]);
  const h = facts(dir).checks.hygiene;
  assert.equal(h.counts.debug_statements, 2);
});

test('hygiene: localhost and staging URLs are counted', () => {
  const dir = siteProject({
    'index.html': '<a href="http://localhost:8080/x">x</a><img src="https://staging.acme.com/a.png">',
  });
  run([dir]);
  assert.equal(facts(dir).checks.hygiene.counts.nonprod_urls, 2);
});

test('hygiene: WP_DEBUG true in a committed wp-config is found', () => {
  const dir = siteProject({ 'index.html': '<html></html>' });
  put(join(dir, 'wp-config.php'), "<?php define( 'WP_DEBUG', true );\n");
  run([dir]);
  const h = facts(dir).checks.hygiene;
  assert.equal(h.counts.wp_debug_on, 1);
  assert.equal(h.counts.committed_secret_files, 1, 'wp-config.php itself is a secret file');
});

test('hygiene: a clean project reports zeros', () => {
  const dir = siteProject({ 'index.html': '<html lang="en"><body><h1>Acme</h1></body></html>' });
  run([dir]);
  const h = facts(dir).checks.hygiene;
  assert.equal(h.counts.committed_secret_files, 0);
  assert.equal(h.counts.debug_statements, 0);
  assert.equal(h.counts.nonprod_urls, 0);
  assert.equal(h.counts.inline_secrets, 0);
});

test('hygiene: does not scan node_modules or .git', () => {
  const dir = siteProject({ 'index.html': '<html></html>' });
  put(join(dir, 'node_modules', 'pkg', '.env'), 'X=1');
  run([dir]);
  assert.equal(facts(dir).checks.hygiene.counts.committed_secret_files, 0);
});

// ---- discoverability (category 2) -------------------------------------------

const HEAD = (head, body = '<h1>x</h1>') =>
  `<html lang="en"><head>${head}</head><body>${body}</body></html>`;

test('discoverability: a meta robots noindex is found and located', () => {
  const dir = siteProject({ 'about.html': HEAD('<title>About</title><meta name="robots" content="noindex,follow">') });
  run([dir]);
  const d = facts(dir).checks.discoverability;
  assert.equal(d.counts.noindex_pages, 1);
  const f = d.findings.find((x) => x.kind === 'noindex');
  assert.equal(f.file, 'site/about.html');
  assert.ok(f.line >= 1);
});

test('discoverability: noindex is case-insensitive and matches crawler-specific tags', () => {
  const dir = siteProject({
    'a.html': HEAD('<title>A</title><META NAME="ROBOTS" CONTENT="NOINDEX">'),
    'b.html': HEAD('<title>B</title><meta name="googlebot" content="noindex">'),
  });
  run([dir]);
  assert.equal(facts(dir).checks.discoverability.counts.noindex_pages, 2);
});

test('discoverability: missing title, description, canonical, and lang are each counted', () => {
  const dir = siteProject({ 'bare.html': '<html><head></head><body><h1>x</h1></body></html>' });
  run([dir]);
  const c = facts(dir).checks.discoverability.counts;
  assert.equal(c.pages, 1);
  assert.equal(c.missing_title, 1);
  assert.equal(c.missing_description, 1);
  assert.equal(c.missing_canonical, 1);
  assert.equal(c.missing_lang, 1);
});

test('discoverability: over-length title and description are flagged, in-range are not', () => {
  const dir = siteProject({
    'long.html': HEAD(`<title>${'a'.repeat(75)}</title><meta name="description" content="${'b'.repeat(175)}">`),
    'ok.html': HEAD('<title>Acme — Bridges</title><meta name="description" content="We build bridges that last a century, on time and on budget.">'),
  });
  run([dir]);
  const c = facts(dir).checks.discoverability.counts;
  assert.equal(c.long_title, 1);
  assert.equal(c.long_description, 1);
});

test('discoverability: robots.txt and sitemap.xml presence is reported as booleans', () => {
  const dir = siteProject({ 'index.html': HEAD('<title>A</title>') });
  run([dir]);
  let c = facts(dir).checks.discoverability.counts;
  assert.equal(c.robots_txt, false);
  assert.equal(c.sitemap_xml, false);
  put(join(dir, 'site', 'robots.txt'), 'User-agent: *\nAllow: /\n');
  put(join(dir, 'site', 'sitemap.xml'), '<urlset><url><loc>https://acme.com/index.html</loc></url></urlset>');
  run([dir]);
  c = facts(dir).checks.discoverability.counts;
  assert.equal(c.robots_txt, true);
  assert.equal(c.sitemap_xml, true);
});

test('discoverability: a Disallow: / in robots.txt is its own finding', () => {
  const dir = siteProject({ 'index.html': HEAD('<title>A</title>') });
  put(join(dir, 'site', 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  run([dir]);
  assert.ok(facts(dir).checks.discoverability.findings.some((x) => x.kind === 'robots_disallow_all'));
});

test('discoverability: built pages absent from sitemap.xml are counted as orphans', () => {
  const dir = siteProject({ 'index.html': HEAD('<title>Home</title>'), 'about.html': HEAD('<title>About</title>') });
  put(join(dir, 'site', 'sitemap.xml'), '<urlset><url><loc>https://acme.com/index.html</loc></url></urlset>');
  run([dir]);
  assert.equal(facts(dir).checks.discoverability.counts.sitemap_orphans, 1);
});

test('discoverability: a fully tagged page produces zero findings', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>Acme — Bridges</title><meta name="description" content="We build bridges that last."><link rel="canonical" href="https://acme.com/">'),
  });
  put(join(dir, 'site', 'robots.txt'), 'User-agent: *\nAllow: /\n');
  put(join(dir, 'site', 'sitemap.xml'), '<urlset><url><loc>https://acme.com/index.html</loc></url></urlset>');
  run([dir]);
  assert.deepEqual(facts(dir).checks.discoverability.findings, []);
});

// ---- social (category 3) ----------------------------------------------------

test('social: missing og tags, favicon, and twitter card are counted', () => {
  const dir = siteProject({ 'index.html': HEAD('<title>A</title>') });
  run([dir]);
  const c = facts(dir).checks.social.counts;
  assert.equal(c.favicon, false);
  assert.equal(c.apple_touch_icon, false);
  assert.equal(c.missing_og_title, 1);
  assert.equal(c.missing_og_image, 1);
  assert.equal(c.missing_twitter_card, 1);
});

test('social: an og:image naming a nonexistent file is a distinct finding', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title><meta property="og:title" content="A"><meta property="og:image" content="/img/og.png">'),
  });
  run([dir]);
  const c = facts(dir).checks.social.counts;
  assert.equal(c.missing_og_image, 0, 'the tag is present');
  assert.equal(c.og_image_missing_file, 1, 'but the file it names is not on disk');
});

test('social: an og:image whose file exists is not flagged', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title><meta property="og:title" content="A"><meta property="og:image" content="/img/og.png">'),
  });
  put(join(dir, 'site', 'img', 'og.png'), 'PNG');
  run([dir]);
  assert.equal(facts(dir).checks.social.counts.og_image_missing_file, 0);
});

test('social: an absolute-URL og:image is not checked on disk', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title><meta property="og:title" content="A"><meta property="og:image" content="https://cdn.acme.com/og.png">'),
  });
  run([dir]);
  assert.equal(facts(dir).checks.social.counts.og_image_missing_file, 0);
});

test('social: a favicon link on any page sets the boolean', () => {
  const dir = siteProject({
    'index.html': HEAD('<title>A</title><link rel="icon" href="/favicon.ico">'),
    'about.html': HEAD('<title>B</title>'),
  });
  run([dir]);
  assert.equal(facts(dir).checks.social.counts.favicon, true);
});
