#!/usr/bin/env node
// eval-smoke.mjs — deterministic half of the standing behavioral smoke eval.
//
// The 100+ unit tests and five structural checkers guard TOOLS and FORMATS;
// nothing exercised the PROMPTS — skill regressions (a broken dependency
// check, a dead path) surfaced only in real user runs. /twt-eval-smoke closes
// that: this script seeds a tiny fixture into the (gitignored) artifact tree,
// the command dispatches a real skill against it in collect mode, and this
// script then asserts the postconditions mechanically — files at contract
// paths, decisions.md passing check-decisions, the wiki lint clean.
//
//   node tools/eval-smoke.mjs seed  <projectDir> --scope ia|wiki
//   node tools/eval-smoke.mjs check <projectDir> --scope ia|wiki
//   node tools/eval-smoke.mjs clean <projectDir> --scope ia|wiki
//
// Safety: seed drops an ownership marker (.eval-smoke) into every tree it
// creates; clean REFUSES to delete a tree without the marker, so it can never
// destroy a real project's artifacts or wiki. check exits 1 with FAIL lines;
// seed/clean exit 1 on refusal/usage.
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkDecisions } from './check-decisions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = '.eval-smoke';

function fail(msg) { console.error(`eval-smoke: ${msg}`); process.exit(1); }
function put(p, content) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content, 'utf8'); }

// ---- fixtures ----------------------------------------------------------------

const FIXTURE_POSITIONING = `# Positioning — Acme Bakery

**Audience:** local families and small offices ordering weekly bread boxes.
**Value proposition:** same-day fresh sourdough, subscription-first.
**Promotion priorities:** elevate the subscription; de-emphasize one-off sales.
`;

const FIXTURE_CONTENT = `# Acme Bakery — fetched homepage

Acme Bakery bakes sourdough daily in Springfield since 2015. Weekly bread
subscriptions with free delivery. Three loaves: classic, seeded, rye.
Contact: hello@acme-bakery.test.
`;

const FIXTURE_INBOX_ENTRIES = `
## 2026-07-10T09:00:00Z · decision · AskUserQuestion
- **header:** Fonts
- **question:** EVALFIXTURE which font pairing should headings use?
- **options:** Inter + Lora | System stack
- **chosen:** Inter + Lora

## 2026-07-10T09:00:05Z · reason · twt-design-system-define
- **decision:** EVALFIXTURE headings use Inter + Lora
- **why:** the bakery brand voice is warm-editorial; a literary serif body carries it
- **evidence:** .twt-artifacts/pre-design/brand/brand-brief.md
- **reversible:** yes
`;

function seedIa(projectDir) {
  const pre = join(projectDir, '.twt-artifacts', 'pre-design');
  // Never adopt a real project's tree: planting the marker there would let a
  // later clean destroy genuine artifacts. Only an absent or already-marked
  // tree is seedable.
  if (existsSync(pre) && !existsSync(join(pre, MARKER))) {
    fail(`REFUSING to seed: ${pre} already exists and is not an eval fixture`);
  }
  put(join(pre, MARKER), 'seeded by eval-smoke — safe for clean to remove\n');
  put(join(pre, 'positioning', 'positioning.md'), FIXTURE_POSITIONING);
  put(join(pre, 'content', 'fetched', 'site', 'acme-bakery.test', 'index.md'), FIXTURE_CONTENT);
  console.log('seeded: ia fixture (positioning.md + fetched content). Dispatch:');
  console.log('  twt-ia-define with: subagent-collect — project brief: "Acme Bakery, weekly sourdough subscriptions for Springfield families; site goal: grow subscriptions."');
}

function seedWiki(projectDir) {
  const wiki0 = join(projectDir, '.project-wiki');
  if (existsSync(wiki0) && !existsSync(join(wiki0, MARKER))) {
    fail(`REFUSING to seed: ${wiki0} already exists and is not an eval fixture — a real wiki must never become deletable`);
  }
  const wikiInit = spawnSync(process.execPath, [join(HERE, 'wiki-init.mjs'), projectDir, '--name', 'Eval Fixture'],
    { encoding: 'utf8' });
  if (wikiInit.status !== 0) fail('wiki-init failed:\n' + wikiInit.stderr);
  const wiki = join(projectDir, '.project-wiki');
  put(join(wiki, MARKER), 'seeded by eval-smoke — safe for clean to remove\n');
  writeFileSync(join(wiki, 'inbox.md'), readFileSync(join(wiki, 'inbox.md'), 'utf8') + FIXTURE_INBOX_ENTRIES, 'utf8');
  console.log('seeded: wiki fixture (scaffold + 2 inbox entries). Dispatch:');
  console.log('  twt-wiki-define with: inbox only');
}

// ---- checks --------------------------------------------------------------------

function checkIa(projectDir) {
  const problems = [];
  const ia = join(projectDir, '.twt-artifacts', 'pre-design', 'ia');
  for (const f of ['sitemap.md', 'functional-scope.md']) {
    const p = join(ia, f);
    if (!existsSync(p)) { problems.push(`missing ${f} at the contract path pre-design/ia/`); continue; }
    const text = readFileSync(p, 'utf8');
    if (text.trim().length < 80) problems.push(`${f} is implausibly small (${text.trim().length} chars)`);
  }
  const sitemap = existsSync(join(ia, 'sitemap.md')) ? readFileSync(join(ia, 'sitemap.md'), 'utf8') : '';
  if (sitemap && !/^\s*-\s+/m.test(sitemap)) problems.push('sitemap.md has no nested-list page entries');
  const dec = join(ia, 'decisions.md');
  if (existsSync(dec)) {
    for (const p of checkDecisions(readFileSync(dec, 'utf8'))) problems.push(`decisions.md: ${p}`);
  }
  return problems;
}

function checkWiki(projectDir) {
  const problems = [];
  const wiki = join(projectDir, '.project-wiki');
  const inbox = existsSync(join(wiki, 'inbox.md')) ? readFileSync(join(wiki, 'inbox.md'), 'utf8') : '';
  if (/EVALFIXTURE/.test(inbox)) problems.push('inbox still holds the seeded entries — the curator did not drain them');
  const decisionsDir = join(wiki, 'decisions');
  const pages = existsSync(decisionsDir) ? readdirSync(decisionsDir).filter((f) => f.endsWith('.md')) : [];
  const promoted = pages.some((f) => /EVALFIXTURE|Inter \+ Lora/i.test(readFileSync(join(decisionsDir, f), 'utf8')));
  if (!promoted) problems.push('no decisions/ page carries the seeded decision — promotion did not happen');
  const index = existsSync(join(wiki, 'index.md')) ? readFileSync(join(wiki, 'index.md'), 'utf8') : '';
  if (pages.length && !pages.some((f) => index.includes(f))) problems.push('index.md does not list the promoted page — the index was not regenerated');
  const lint = spawnSync(process.execPath, [join(HERE, 'wiki-lint.mjs'), projectDir, '--json'], { encoding: 'utf8' });
  try {
    const parsed = JSON.parse(lint.stdout);
    if (parsed.blockers > 0) problems.push(`wiki-lint reports ${parsed.blockers} BLOCKER(s) after curation`);
  } catch { problems.push('wiki-lint did not return JSON: ' + (lint.stderr || lint.stdout).slice(0, 200)); }
  return problems;
}

// ---- clean --------------------------------------------------------------------

function cleanTree(root, label) {
  if (!existsSync(root)) { console.log(`clean: ${label} absent — nothing to do`); return; }
  if (!existsSync(join(root, MARKER))) fail(`REFUSING to delete ${root} — no ${MARKER} ownership marker (this is not an eval fixture)`);
  rmSync(root, { recursive: true, force: true });
  console.log(`clean: removed ${label}`);
}

// ---- cli ----------------------------------------------------------------------

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain) {
  const [cmd, projectDir] = process.argv.slice(2);
  const scopeAt = process.argv.indexOf('--scope');
  const scope = scopeAt !== -1 ? process.argv[scopeAt + 1] : '';
  if (!cmd || !projectDir || !['ia', 'wiki'].includes(scope)) {
    fail('usage: node tools/eval-smoke.mjs seed|check|clean <projectDir> --scope ia|wiki');
  }
  if (cmd === 'seed') {
    if (scope === 'ia') seedIa(projectDir); else seedWiki(projectDir);
  } else if (cmd === 'check') {
    const problems = scope === 'ia' ? checkIa(projectDir) : checkWiki(projectDir);
    if (problems.length) {
      for (const p of problems) console.error('FAIL: ' + p);
      process.exit(1);
    }
    console.log(`eval-smoke check (${scope}): PASS`);
  } else if (cmd === 'clean') {
    if (scope === 'ia') cleanTree(join(projectDir, '.twt-artifacts', 'pre-design'), '.twt-artifacts/pre-design (ia fixture)');
    else cleanTree(join(projectDir, '.project-wiki'), '.project-wiki (wiki fixture)');
    // ia runs also generate ia/ under pre-design — covered by the tree above.
  } else fail(`unknown command: ${cmd}`);
}
