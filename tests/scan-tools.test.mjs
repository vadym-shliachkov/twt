import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (e.g. this repo lives under "C:\Work\~marketplace", and
// Node percent-encodes "~" to "%7E" in import.meta.url) are decoded correctly.
const STATUS = fileURLToPath(new URL('../tools/status-scan.mjs', import.meta.url));
const QA = fileURLToPath(new URL('../tools/qa-scan.mjs', import.meta.url));

const run = (tool, args) => execFileSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
const newProject = () => mkdtempSync(join(tmpdir(), 'twt-scan-'));
function put(p, content) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content, 'utf8'); }
const jsonBlock = (out) => JSON.parse(/```json\n([\s\S]*?)\n```/.exec(out)[1]);

// ---- status-scan -------------------------------------------------------------

test('status-scan: empty project reports no artifacts', () => {
  const dir = newProject();
  mkdirSync(join(dir, '.twt-artifacts'), { recursive: true });
  assert.match(run(STATUS, [dir]), /No twt artifacts found/);
});

test('status-scan: an output older than its input is STALE with a re-run plan', () => {
  const dir = newProject();
  const art = join(dir, '.twt-artifacts');
  put(join(art, 'pre-design', 'positioning', 'positioning.md'), '# positioning');
  put(join(art, 'pre-design', 'brand', 'brand-brief.md'), '# brief');
  const past = new Date(Date.now() - 3600e3);
  utimesSync(join(art, 'pre-design', 'positioning', 'positioning.md'), past, past);
  const out = run(STATUS, [dir]);
  assert.match(out, /STALE/);
  assert.match(out, /Re-run plan/);
  assert.equal(jsonBlock(out).stale >= 1, true);
});

test('status-scan: legacy component-catalog layout is detected and names the migrating run', () => {
  const dir = newProject();
  put(join(dir, '.twt-artifacts', 'design', 'component', 'components.md'), '# old catalog');
  const out = run(STATUS, [dir]);
  assert.match(out, /LEGACY LAYOUT: component catalog at pre-move/);
  assert.match(out, /twt-component-define/);
});

// ---- qa-scan -------------------------------------------------------------------

function seedSite(dir) {
  put(join(dir, 'site', 'index.html'), `<!doctype html><html><head>
<link rel="stylesheet" href="assets/css/general.css"></head><body>
<main><h1>Acme</h1><h3>skipped level</h3>
<img src="assets/img/hero.jpg">
<a href="missing-page.html">dead</a>
<a href="#">placeholder</a>
<p>Lorem ipsum dolor sit amet filler.</p>
</main></body></html>`);
  put(join(dir, 'site', 'assets', 'css', 'general.css'),
    'h1 { color: #FF0000; width: 13px; font-family: "Comic Sans MS"; }\n.x { color: var(--undefined-token); }\n');
}

test('qa-scan a11y: counts the missing alt and heading jump', () => {
  const dir = newProject(); seedSite(dir);
  const r = jsonBlock(run(QA, ['a11y', dir]));
  assert.ok(r.findings.some((f) => /alt/.test(f.kind)), 'missing alt found');
  assert.ok(r.findings.some((f) => /heading/.test(f.kind)), 'heading jump found');
});

test('qa-scan links: dead link + placeholder href found', () => {
  const dir = newProject(); seedSite(dir);
  const r = jsonBlock(run(QA, ['links', dir]));
  assert.ok(r.findings.some((f) => f.kind === 'dead_link' && /missing-page/.test(f.detail)));
  assert.ok(r.findings.some((f) => f.kind === 'placeholder_href'));
});

test('qa-scan content: lorem is flagged with file:line', () => {
  const dir = newProject(); seedSite(dir);
  const r = jsonBlock(run(QA, ['content', dir]));
  const lorem = r.findings.find((f) => f.kind === 'lorem');
  assert.ok(lorem, 'lorem finding present');
  assert.ok(lorem.file && lorem.line > 0, 'carries location');
});

test('qa-scan tokens: hex/px/font literals and the undefined var are all evidence', () => {
  const dir = newProject(); seedSite(dir);
  const r = jsonBlock(run(QA, ['tokens', dir]));
  for (const kind of ['hex_literal', 'length_literal', 'font_literal', 'undefined_var']) {
    assert.ok(r.findings.some((f) => f.kind === kind), `${kind} found`);
  }
});
