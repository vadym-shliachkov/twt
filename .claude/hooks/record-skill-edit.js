#!/usr/bin/env node
/**
 * PostToolUse (Write|Edit) hook.
 * Records the path of any edited skill file into a per-session queue. "Skill file"
 * means the current plugin layout: skills/twt-<name>/SKILL.md. That is the ONLY
 * layout now — the flat commands/twt-<name>.md tier is retired, and a skill's
 * surface (command | internal) is declared in frontmatter, not by its folder.
 * Does NOT modify any file — the Stop hook does the bump once per turn so multiple
 * edits to one skill only bump the version once. (Script fs-writes, e.g. gen-docs,
 * don't go through the Edit/Write tool, so they never trip this hook.)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }

let data = {};
try { data = JSON.parse(raw || '{}'); } catch { process.exit(0); }

const fp =
  (data.tool_input && data.tool_input.file_path) ||
  (data.tool_response && data.tool_response.filePath) ||
  '';
if (!fp) process.exit(0);

// Only skill files in the current plugin layout: skills/twt-<name>/SKILL.md.
// Matches the monolith's skills/ and a split-out plugin's
// plugins/<plugin>/skills/ alike, since the suffix is the same either way.
const norm = fp.replace(/\\/g, '/');
if (!/(^|\/)skills\/twt-[^/]+\/SKILL\.md$/.test(norm)) process.exit(0);

const session = String(data.session_id || 'nosession').replace(/[^a-zA-Z0-9_-]/g, '_');
const queue = path.join(os.tmpdir(), `twt-bump-${session}.txt`);

let lines = [];
try { lines = fs.readFileSync(queue, 'utf8').split('\n').filter(Boolean); } catch {}
if (!lines.includes(fp)) {
  lines.push(fp);
  try { fs.writeFileSync(queue, lines.join('\n') + '\n'); } catch {}
}
process.exit(0);
