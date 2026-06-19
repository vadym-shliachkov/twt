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
// Space form (e.g. "Bash(cat *)") matches the format already proven in this
// repo's own settings.json. The scope-guard still gates anything path-escaping.
const ALLOW = [
  'Bash(ls *)', 'Bash(cat *)', 'Bash(grep *)', 'Bash(rg *)', 'Bash(echo *)',
  'Bash(mkdir *)', 'Bash(wc *)', 'Bash(find *)', 'Bash(head *)', 'Bash(tail *)',
  'Bash(node *)', 'Bash(npx *)', 'Bash(python *)', 'Bash(python3 *)',
  'Bash(pdfinfo *)', 'Bash(pdftotext *)',
  'WebFetch(domain:*)',
  'mcp__plugin_figma_figma__get_design_context',
  'mcp__plugin_figma_figma__get_screenshot',
  'mcp__plugin_figma_figma__get_metadata',
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
