#!/usr/bin/env node
/**
 * seed-permissions.js — one-time project setup helper (invoked by /twt-setup
 * and by every skill's unattended Step-0 gate).
 *
 * Idempotently merges a curated runtime permission allowlist into a project's
 * (or ~/.claude's) settings.json, so a twt pipeline run stops prompting for the
 * routine commands the skills issue. It only ever ADDS entries (dedup by exact
 * string) — it never removes or reorders what's already there.
 *
 * Pairs with the scope-guard hook: the scope-guard auto-allows the file/bash
 * tools when it can prove the path is inside the project and defers otherwise;
 * this allowlist covers the rest (utility Bash it can't parse, WebFetch, the
 * Figma read MCP tools) so the common case is silent.
 *
 * Usage:
 *   node seed-permissions.js <claudeDir> [--remove]
 *     <claudeDir>  the .claude directory to seed (a project's, or ~/.claude)
 *     --remove     remove exactly the entries this seeder adds
 *
 * Always exits 0 for non-fatal issues so it never breaks an install run.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Curated allowlist. Read-only / build-utility Bash the skills + bundled tools
// run, plus WebFetch (content-fetch-site, live QA) and the Figma read MCP tools.
//
// Use Claude Code's canonical *colon-prefix* form — `Bash(ls:*)` means "any
// command starting with `ls `". This is what reliably matches; the older space
// form (`Bash(ls *)`) does NOT consistently match commands that carry flags,
// quotes, or absolute paths, which is why sub-skills that run the bundled
// generators against the plugin cache (e.g. `node "<plugin>/tools/gen-preview.mjs"`,
// or `ls`/`find`/`grep` over the install dir) kept triggering per-call
// filesystem-read approvals mid-pipeline. Both forms are seeded for the utility
// commands so an already-seeded project that re-runs /twt-setup gains the
// working colon form without losing anything. The scope-guard still gates
// anything path-escaping a write.
const BASH_UTILS = [
  'ls', 'cat', 'grep', 'rg', 'echo', 'mkdir', 'wc', 'find', 'head', 'tail',
  'node', 'npx', 'python', 'python3', 'pdfinfo', 'pdftotext', 'pandoc',
  'cd', 'sed', 'sort', 'uniq', 'bc', 'curl',
];

// Playwright browser MCP tools (portable — plain tool names, never a path).
// Live QA, /twt-block-preview, and the DS audit drive a browser to inspect,
// screenshot, and read computed styles from pages; these navigate/read/inspect
// calls (plus the light interactions QA needs — click, hover, keys, selects)
// are routine and no riskier than the already-allowed WebFetch(domain:*).
// Deliberately NOT allowed (still prompt): browser_run_code_unsafe,
// browser_type, browser_fill_form, browser_file_upload, browser_handle_dialog —
// the shapes that submit data into live sites or run code outside the page.
const PLAYWRIGHT_MCP = [
  'browser_navigate', 'browser_navigate_back', 'browser_snapshot',
  'browser_take_screenshot', 'browser_evaluate', 'browser_close',
  'browser_resize', 'browser_console_messages', 'browser_network_requests',
  'browser_wait_for', 'browser_click', 'browser_hover', 'browser_press_key',
  'browser_select_option', 'browser_find', 'browser_tabs',
].map((t) => `mcp__plugin_playwright_playwright__${t}`);

// Playwright browser cache (read-only). The export skills render PDF / PDF-slides
// via Chromium through the optional `playwright` package; those reads happen
// inside `node` (already allowed) and don't prompt — but a skill or check that
// inspects the installed browsers directly would trip a scope-read approval.
// Pre-authorize the ms-playwright cache for THIS machine (computed at seed time,
// so it's correct per-OS wherever /twt-setup runs). Read-only; never a write path.
function toReadGlob(nativePath) {
  const win = /^([A-Za-z]):[\\/](.*)$/.exec(nativePath);
  if (win) return '//' + win[1].toLowerCase() + '/' + win[2].replace(/\\/g, '/');
  return nativePath.replace(/\\/g, '/');
}
const msPlaywrightDir =
  process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
  : path.join(os.homedir(), '.cache', 'ms-playwright');
const PLAYWRIGHT_READS = [`Read(${toReadGlob(msPlaywrightDir)}/**)`];

// Installed-plugin cache (read-only). The plugin's own bundled scripts live at
// ~/.claude/plugins/**, NOT in the target project — so any skill that reads one
// (inspecting a `tools/*.py|*.mjs` generator, its templates, etc.) points at a
// path the scope-guard correctly treats as "outside the project" and defers on.
// Pre-authorize reading the plugin cache so those routine inspections stay
// silent. Read-only; this is never a write target.
const PLUGIN_READS = [`Read(${toReadGlob(path.join(os.homedir(), '.claude', 'plugins'))}/**)`];

// Session scratchpad (read + write). Intermediate/throwaway files belong in the
// harness-assigned scratchpad under the OS temp dir, kept OUT of the project so
// they never pollute git or get committed (see CONVENTIONS §15). That directory
// is outside the project, so the scope-guard defers on it — pre-authorize the
// `claude/` scratch subtree here so writing/reading scratch files doesn't prompt.
const scratchDir = path.join(os.tmpdir(), 'claude');
const SCRATCH_ACCESS = [
  `Read(${toReadGlob(scratchDir)}/**)`,
  `Write(${toReadGlob(scratchDir)}/**)`,
];

const ALLOW = [
  ...BASH_UTILS.map((c) => `Bash(${c}:*)`),
  ...BASH_UTILS.map((c) => `Bash(${c} *)`),
  ...PLAYWRIGHT_READS,
  ...PLUGIN_READS,
  ...SCRATCH_ACCESS,
  ...PLAYWRIGHT_MCP,
  'WebFetch(domain:*)',
  'mcp__plugin_figma_figma__get_design_context',
  'mcp__plugin_figma_figma__get_screenshot',
  'mcp__plugin_figma_figma__get_metadata',
  'mcp__plugin_figma_figma__get_variable_defs',
  'mcp__plugin_figma_figma__whoami',
];

function fail(msg) { console.error('  ! permissions: ' + msg); process.exit(0); }

function nativize(p) {
  if (p && process.platform === 'win32' && /^\/[a-zA-Z]\//.test(p)) {
    return p[1].toUpperCase() + ':' + p.slice(2);
  }
  return p;
}

const claudeDir = nativize(process.argv[2]);
const remove = process.argv.includes('--remove');
if (!claudeDir) fail('usage: seed-permissions.js <claudeDir> [--remove]');

const settingsPath = path.join(claudeDir, 'settings.json');

function readSettings() {
  if (!fs.existsSync(settingsPath)) return {};
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}'); }
  catch (e) { fail('settings.json is not valid JSON — leaving it untouched (' + e.message + ')'); }
}

const settings = readSettings();
settings.permissions = settings.permissions || {};
const current = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];

let changed = 0;
if (remove) {
  const next = current.filter((e) => !ALLOW.includes(e));
  changed = current.length - next.length;
  settings.permissions.allow = next;
} else {
  const have = new Set(current);
  for (const e of ALLOW) { if (!have.has(e)) { current.push(e); have.add(e); changed++; } }
  settings.permissions.allow = current;
}

seedArtifactsReadme(); // before the no-change early exit — re-runs must still seed it

if (changed === 0) {
  console.log('  Permissions already ' + (remove ? 'absent from ' : 'present in ') + settingsPath);
  process.exit(0);
}

fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log('  ' + (remove ? 'Removed' : 'Seeded') + ' ' + changed + ' permission entr' +
  (changed === 1 ? 'y' : 'ies') + ' ' + (remove ? 'from ' : 'into ') + settingsPath);
process.exit(0);

// Orientation file for the artifacts tree. Every skill writes into
// .twt-artifacts/ but nothing ever told a human (or a fresh agent) opening the
// folder what it is, what is safe to delete, or that the built site lives at
// the project root. Seeded once, never overwritten; skipped for the global
// ~/.claude (no project) and on --remove.
function seedArtifactsReadme() {
  try {
    if (remove) return;
    if (path.basename(claudeDir) !== '.claude') return;
    const projectRoot = path.dirname(claudeDir);
    if (projectRoot === os.homedir()) return; // global seeding — no project here
    const artifactsDir = path.join(projectRoot, '.twt-artifacts');
    const readmePath = path.join(artifactsDir, 'README.md');
    if (fs.existsSync(readmePath)) return;
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(readmePath, [
      '# .twt-artifacts — the twt pipeline workspace',
      '',
      '**Everything in this folder is generated and regenerable.** It is the working',
      'evidence of the twt skills, not the deliverable — deleting it loses no human',
      'knowledge (decisions and their reasons live in `.project-wiki/`, if the project',
      'has one; re-running the skills rebuilds the rest).',
      '',
      '## Where things are',
      '',
      '| Path | What it is |',
      '|---|---|',
      '| `pre-design/` | Phase 1 — brand, positioning, IA, curation, fetched content |',
      '| `design/` | Phase 2 — design-system (the cross-phase spine), layouts, mockups |',
      '| `qa/` | Phase 4 — audit reports and gaps |',
      '| `reports/index.html` | **Start here** — the consolidated review dashboard |',
      '| `site-log.md` / `site-dev-log.md` | Per-run log: questions, answers, dispatch trace |',
      '| `export/`, `content-approval/`, `content-quality/`, `screenshots/`, `search/`, `intake/` | Standalone tool outputs, one folder per tool |',
      '| `html-site/`, `elementor-theme/` | Build *conventions* and phase reviews — **the built site itself lives at the project root** (`site/` or `wp-content/themes/<slug>/`) |',
      '',
      'Every pipeline area carries the same trio: the artifact, a sibling `decisions.md`',
      '(open questions and model-decided assumptions), and a sibling `validation-report.md`',
      '(BLOCKER / WARNING / SUGGESTION findings).',
      '',
      'Generated by /twt-setup. Safe to delete this file; it reappears on the next setup.',
      '',
    ].join('\n'));
    console.log('  Seeded ' + readmePath);
  } catch (e) { /* orientation is best-effort — never break setup */ }
}
