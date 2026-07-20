import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (e.g. this repo lives under "C:\Work\~marketplace", and
// Node percent-encodes "~" to "%7E" in import.meta.url) are decoded correctly.
const TOOL = fileURLToPath(new URL('../tools/eval-smoke.mjs', import.meta.url));
const DRAIN = fileURLToPath(new URL('../tools/wiki-drain.mjs', import.meta.url));
const INDEX = fileURLToPath(new URL('../tools/wiki-index.mjs', import.meta.url));

const run = (args) => execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
const newProject = () => mkdtempSync(join(tmpdir(), 'twt-eval-'));

test('ia: seed → check fails (nothing generated) → simulated outputs pass → clean removes only the marked tree', () => {
  const dir = newProject();
  run(['seed', dir, '--scope', 'ia']);
  assert.ok(existsSync(join(dir, '.twt-artifacts', 'pre-design', 'positioning', 'positioning.md')));

  assert.throws(() => run(['check', dir, '--scope', 'ia']), /missing sitemap\.md/);

  // simulate what twt-ia-define must produce
  const ia = join(dir, '.twt-artifacts', 'pre-design', 'ia');
  mkdirSync(ia, { recursive: true });
  writeFileSync(join(ia, 'sitemap.md'), '# Sitemap\n\n- Home\n  - Subscriptions\n  - About\n- Contact — the bakery, hours, and the order form for weekly boxes\n');
  writeFileSync(join(ia, 'functional-scope.md'), '# Functional scope\n\nGlobal: sticky nav, newsletter signup form, subscription CTA in the header on every page.\n');
  assert.match(run(['check', dir, '--scope', 'ia']), /PASS/);

  // a malformed decisions.md flips the check to FAIL via check-decisions
  writeFileSync(join(ia, 'decisions.md'), '# no frontmatter\n\n## Open questions\n- Q — no options here\n');
  assert.throws(() => run(['check', dir, '--scope', 'ia']), /decisions\.md:/);

  run(['clean', dir, '--scope', 'ia']);
  assert.equal(existsSync(join(dir, '.twt-artifacts', 'pre-design')), false);
});

test('wiki: seed → check fails → simulated curation passes', () => {
  const dir = newProject();
  run(['seed', dir, '--scope', 'wiki']);
  assert.match(readFileSync(join(dir, '.project-wiki', 'inbox.md'), 'utf8'), /EVALFIXTURE/);

  assert.throws(() => run(['check', dir, '--scope', 'wiki']), /did not drain|no decisions/);

  // simulate the curator: promote to a page, drain the inbox, regenerate the index
  const page = join(dir, '.project-wiki', 'decisions', '2026-07-10-heading-fonts.md');
  writeFileSync(page, ['---', 'title: Headings use Inter + Lora', 'type: decision', 'status: current',
    'updated: 2026-07-10', 'summary: warm-editorial voice needs a literary serif', 'sources:',
    '  - .twt-artifacts/pre-design/brand/brand-brief.md', 'tags: [design-system]', '---', '',
    '# Headings use Inter + Lora', '', '**Decided:** EVALFIXTURE Inter + Lora.', '',
    '**Why:** warm-editorial brand voice.', ''].join('\n'), 'utf8');
  execFileSync(process.execPath, [DRAIN, dir, '--drain', 'all'], { encoding: 'utf8' });
  execFileSync(process.execPath, [INDEX, dir], { encoding: 'utf8' });
  const checkOut = run(['check', dir, '--scope', 'wiki']);
  assert.match(checkOut, /PASS/);
  // A stale pending source is seeded; the lint must flag it as never synthesized.
  assert.match(checkOut, /never synthesized/, 'eval-smoke wiki scope must surface the unsynthesized-source lint');

  run(['clean', dir, '--scope', 'wiki']);
  assert.equal(existsSync(join(dir, '.project-wiki')), false);
});

test('curation: seed → check fails → simulated outputs (incl. facts ledger) pass', () => {
  const dir = newProject();
  run(['seed', dir, '--scope', 'curation']);
  assert.ok(existsSync(join(dir, '.twt-artifacts', 'pre-design', 'ia', 'sitemap.md')), 'curation seed includes the sitemap');
  assert.throws(() => run(['check', dir, '--scope', 'curation']), /missing inventory\.md/);

  const cur = join(dir, '.twt-artifacts', 'pre-design', 'curation');
  mkdirSync(join(cur, 'outlines'), { recursive: true });
  writeFileSync(join(cur, 'inventory.md'), '# Inventory\n\n| item | decision | page |\n|---|---|---|\n| hero copy | KEEP | home |\n');
  writeFileSync(join(cur, 'outlines', 'home.md'), '# Home outline\n\n## Hero\nBaked this morning — weekly sourdough boxes.\n');
  // without the ledger the check still fails
  assert.throws(() => run(['check', dir, '--scope', 'curation']), /facts\.md/);
  writeFileSync(join(cur, 'facts.md'), '# Facts ledger\n\n## Canonical facts\n| fact | canonical | status | sources (value@source) |\n|---|---|---|---|\n| founding-year | 2015 | RESOLVED | 2015@site |\n');
  assert.match(run(['check', dir, '--scope', 'curation']), /PASS/);
  run(['clean', dir, '--scope', 'curation']);
  assert.equal(existsSync(join(dir, '.twt-artifacts', 'pre-design')), false);
});

test('design-system: seed → check fails → simulated tokens pass the WCAG oracle', () => {
  const dir = newProject();
  run(['seed', dir, '--scope', 'design-system']);
  assert.throws(() => run(['check', dir, '--scope', 'design-system']), /missing tokens\.md/);

  const ds = join(dir, '.twt-artifacts', 'design', 'design-system');
  mkdirSync(ds, { recursive: true });
  writeFileSync(join(ds, 'tokens.md'), '# Design system\n\n## 2. Tokens\n\n### 2.1 Colors\n\n| name | HEX | role |\n|---|---|---|\n| ink | #1A1108 | text |\n| surface | #FBF6EE | background |\n| accent | #8A3A0F | CTA |\n\n' + 'filler '.repeat(40));
  writeFileSync(join(ds, 'tokens.css'), [':root {',
    '  --color-ink: #1A1108;', '  --color-text: #2A1D10;', '  --color-surface: #FBF6EE;',
    '  --color-accent: #8A3A0F;', '  --color-surface-raised: #FFFFFF;',
    '  --space-2: 8px;', '  --space-4: 16px;', '  --space-8: 32px;',
    '  --radius-card: 12px;', '  --shadow-card: 0 1px 3px rgba(26,17,8,.08);',
    '  --font-heading: Georgia, serif;', '  --font-body: system-ui, sans-serif;',
    '  --motion-duration-fast: 120ms;', '}'].join('\n'));
  assert.match(run(['check', dir, '--scope', 'design-system']), /PASS/);
  run(['clean', dir, '--scope', 'design-system']);
  assert.equal(existsSync(join(dir, '.twt-artifacts', 'design')), false);
  assert.equal(existsSync(join(dir, '.twt-artifacts', 'pre-design')), false);
});

test('safety: seed refuses an existing unmarked tree; clean refuses without the marker', () => {
  const dir = newProject();
  mkdirSync(join(dir, '.twt-artifacts', 'pre-design', 'brand'), { recursive: true });
  writeFileSync(join(dir, '.twt-artifacts', 'pre-design', 'brand', 'brand-brief.md'), 'REAL PROJECT DATA');
  assert.throws(() => run(['seed', dir, '--scope', 'ia']), /REFUSING to seed/);
  assert.throws(() => run(['clean', dir, '--scope', 'ia']), /REFUSING to delete/);
  assert.ok(existsSync(join(dir, '.twt-artifacts', 'pre-design', 'brand', 'brand-brief.md')), 'real data survives');

  const dir2 = newProject();
  mkdirSync(join(dir2, '.project-wiki'), { recursive: true });
  writeFileSync(join(dir2, '.project-wiki', 'inbox.md'), 'a real wiki inbox');
  assert.throws(() => run(['seed', dir2, '--scope', 'wiki']), /REFUSING to seed/);
  assert.throws(() => run(['clean', dir2, '--scope', 'wiki']), /REFUSING to delete/);
});
