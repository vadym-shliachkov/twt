#!/usr/bin/env node
/**
 * seed-scope-guard.js — installer helper (shared by install.ps1 and install.sh).
 *
 * Idempotently seeds the twt scope-guard into a project's .claude folder:
 *   1. copies templates/hooks/twt-scope-guard.js -> <claudeDir>/hooks/
 *   2. merges a PreToolUse hook entry into <claudeDir>/settings.json
 *
 * The hook makes Claude Code auto-approve any tool call that stays inside the
 * project folder and prompt for anything that reaches outside it.
 *
 * Usage:
 *   node seed-scope-guard.js <claudeDir> <repoRoot> [--remove]
 *     <claudeDir>  the target project's .claude directory
 *     <repoRoot>   the twt marketplace repo root (to locate the template)
 *     --remove     unmerge the hook entry and delete the copied hook file
 *
 * Always exits 0 for non-fatal issues so it never breaks an install run.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HOOK_NAME = 'twt-scope-guard.js';
const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/' + HOOK_NAME + '"';
const MATCHER = 'Bash|Read|Write|Edit|NotebookEdit|Glob|Grep';

function fail(msg) { console.error('  ! scope-guard: ' + msg); process.exit(0); }

// On Windows Git Bash, $(pwd) yields MSYS paths like "/c/Work/..." which
// node misreads as drive-relative. Convert them back to "C:/Work/...".
// No-op on Linux/macOS, where "/c/..." is a legitimate absolute path.
function nativize(p) {
  if (p && process.platform === 'win32' && /^\/[a-zA-Z]\//.test(p)) {
    return p[1].toUpperCase() + ':' + p.slice(2);
  }
  return p;
}

const claudeDir = nativize(process.argv[2]);
const repoRoot = nativize(process.argv[3]);
const remove = process.argv.includes('--remove');

if (!claudeDir || !repoRoot) fail('usage: seed-scope-guard.js <claudeDir> <repoRoot> [--remove]');

const hooksDir = path.join(claudeDir, 'hooks');
const hookDest = path.join(hooksDir, HOOK_NAME);
const hookSrc = path.join(repoRoot, 'templates', 'hooks', HOOK_NAME);
const settingsPath = path.join(claudeDir, 'settings.json');

function readSettings() {
  if (!fs.existsSync(settingsPath)) return {};
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}'); }
  catch (e) { fail('settings.json is not valid JSON — leaving it untouched (' + e.message + ')'); }
}

function writeSettings(obj) {
  fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + '\n');
}

function hasOurHook(settings) {
  const pre = settings.hooks && settings.hooks.PreToolUse;
  if (!Array.isArray(pre)) return false;
  return pre.some((g) => Array.isArray(g.hooks) &&
    g.hooks.some((h) => typeof h.command === 'string' && h.command.includes(HOOK_NAME)));
}

if (remove) {
  // Remove the hook file.
  try { if (fs.existsSync(hookDest)) fs.unlinkSync(hookDest); } catch {}
  // Unmerge the settings entry.
  if (fs.existsSync(settingsPath)) {
    const settings = readSettings();
    const pre = settings.hooks && settings.hooks.PreToolUse;
    if (Array.isArray(pre)) {
      settings.hooks.PreToolUse = pre
        .map((g) => {
          if (Array.isArray(g.hooks)) {
            g.hooks = g.hooks.filter((h) => !(typeof h.command === 'string' && h.command.includes(HOOK_NAME)));
          }
          return g;
        })
        .filter((g) => Array.isArray(g.hooks) && g.hooks.length > 0);
      if (settings.hooks.PreToolUse.length === 0) delete settings.hooks.PreToolUse;
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      writeSettings(settings);
    }
  }
  console.log('  Removed scope-guard from ' + claudeDir);
  process.exit(0);
}

// --- seed mode ---
if (!fs.existsSync(hookSrc)) fail('template not found at ' + hookSrc);

fs.mkdirSync(hooksDir, { recursive: true });
fs.copyFileSync(hookSrc, hookDest);

const settings = readSettings();
if (hasOurHook(settings)) {
  console.log('  Scope-guard already present in ' + settingsPath + ' (hook file refreshed)');
  process.exit(0);
}

settings.hooks = settings.hooks || {};
settings.hooks.PreToolUse = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
settings.hooks.PreToolUse.push({
  matcher: MATCHER,
  hooks: [{ type: 'command', command: HOOK_COMMAND }],
});
writeSettings(settings);
console.log('  Seeded scope-guard hook into ' + settingsPath);
process.exit(0);
