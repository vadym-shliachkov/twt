#!/usr/bin/env node
/**
 * seed-permissions.js — installer helper (shared by install.ps1 and install.sh).
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
  'node', 'npx', 'python', 'python3', 'pdfinfo', 'pdftotext',
  'cd', 'sed', 'sort', 'uniq', 'bc',
];
const ALLOW = [
  ...BASH_UTILS.map((c) => `Bash(${c}:*)`),
  ...BASH_UTILS.map((c) => `Bash(${c} *)`),
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

if (changed === 0) {
  console.log('  Permissions already ' + (remove ? 'absent from ' : 'present in ') + settingsPath);
  process.exit(0);
}

fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log('  ' + (remove ? 'Removed' : 'Seeded') + ' ' + changed + ' permission entr' +
  (changed === 1 ? 'y' : 'ies') + ' ' + (remove ? 'from ' : 'into ') + settingsPath);
process.exit(0);
