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
