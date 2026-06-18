#!/usr/bin/env node
/**
 * seed-debug-log.js — installer helper (shared by install.ps1 and install.sh).
 *
 * Idempotently seeds the twt debug tracer into a project's .claude folder:
 *   1. copies templates/hooks/twt-debug-log.js -> <claudeDir>/hooks/
 *   2. merges PreToolUse + PostToolUse hook entries (matcher Task|AskUserQuestion)
 *      into <claudeDir>/settings.json
 *
 * The hook is INERT unless /twt-roast-full --log arms it (sentinel file), so
 * seeding it has no effect on normal runs.
 *
 * Usage:
 *   node seed-debug-log.js <claudeDir> <repoRoot> [--remove]
 *
 * Always exits 0 for non-fatal issues so it never breaks an install run.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HOOK_NAME = 'twt-debug-log.js';
const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/' + HOOK_NAME + '"';
const MATCHER = 'Task|AskUserQuestion';
const EVENTS = ['PreToolUse', 'PostToolUse'];

function fail(msg) { console.error('  ! debug-log: ' + msg); process.exit(0); }

function nativize(p) {
  if (p && process.platform === 'win32' && /^\/[a-zA-Z]\//.test(p)) {
    return p[1].toUpperCase() + ':' + p.slice(2);
  }
  return p;
}

const claudeDir = nativize(process.argv[2]);
const repoRoot = nativize(process.argv[3]);
const remove = process.argv.includes('--remove');

if (!claudeDir || !repoRoot) fail('usage: seed-debug-log.js <claudeDir> <repoRoot> [--remove]');

const hooksDir = path.join(claudeDir, 'hooks');
const hookDest = path.join(hooksDir, HOOK_NAME);
const hookSrc = path.join(repoRoot, 'templates', 'hooks', HOOK_NAME);
const settingsPath = path.join(claudeDir, 'settings.json');

function readSettings() {
  if (!fs.existsSync(settingsPath)) return {};
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}'); }
  catch (e) { fail('settings.json is not valid JSON — leaving it untouched (' + e.message + ')'); }
}
function writeSettings(obj) { fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + '\n'); }

function present(settings, ev) {
  const arr = settings.hooks && settings.hooks[ev];
  return Array.isArray(arr) && arr.some((g) => Array.isArray(g.hooks) &&
    g.hooks.some((h) => typeof h.command === 'string' && h.command.includes(HOOK_NAME)));
}

if (remove) {
  try { if (fs.existsSync(hookDest)) fs.unlinkSync(hookDest); } catch {}
  if (fs.existsSync(settingsPath)) {
    const settings = readSettings();
    for (const ev of EVENTS) {
      const arr = settings.hooks && settings.hooks[ev];
      if (!Array.isArray(arr)) continue;
      settings.hooks[ev] = arr
        .map((g) => { if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h) => !(typeof h.command === 'string' && h.command.includes(HOOK_NAME))); return g; })
        .filter((g) => Array.isArray(g.hooks) && g.hooks.length > 0);
      if (settings.hooks[ev].length === 0) delete settings.hooks[ev];
    }
    if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
    writeSettings(settings);
  }
  console.log('  Removed debug-log from ' + claudeDir);
  process.exit(0);
}

if (!fs.existsSync(hookSrc)) fail('template not found at ' + hookSrc);
fs.mkdirSync(hooksDir, { recursive: true });
fs.copyFileSync(hookSrc, hookDest);

const settings = readSettings();
settings.hooks = settings.hooks || {};
let added = 0;
for (const ev of EVENTS) {
  if (present(settings, ev)) continue;
  settings.hooks[ev] = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
  settings.hooks[ev].push({ matcher: MATCHER, hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  added++;
}
if (added) { writeSettings(settings); console.log('  Seeded debug-log hook (' + added + ' event(s)) into ' + settingsPath); }
else console.log('  Debug-log already present in ' + settingsPath + ' (hook file refreshed)');
process.exit(0);
