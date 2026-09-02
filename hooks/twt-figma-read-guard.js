#!/usr/bin/env node
/**
 * twt-figma-read-guard — PreToolUse context hook for the Figma read tools.
 *
 * Why this exists: the reading discipline lives in `twt-figma-read` and in the
 * `## Reading Figma` block stamped into every pipeline skill that reads a
 * design. Both depend on something *matching* — a skill description winning a
 * trigger, or the model already being inside a stamped skill. Neither fires when
 * someone is doing ordinary project work, points at a Figma frame, and the
 * Figma MCP is called directly. This hook is the floor under that case: it
 * cannot be missed by trigger-matching, because it runs on the call itself.
 *
 * It NEVER denies and never decides permission — it only attaches context, so
 * the worst a bug here can do is add or omit a paragraph. It also fires ONCE per
 * session: the discipline is worth stating before the first read, and pure noise
 * on the fifth.
 *
 * Output contract (PreToolUse):
 *   - print {hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext}}
 *   - print nothing -> no-op, normal flow
 */
'use strict';

const fs = require('fs');
const { once } = require('./lib/once.js');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}

let data = {};
try { data = JSON.parse(readStdin() || '{}'); } catch (e) { data = {}; }

const tool = String(data.tool_name || '');
// Only the reads where the discipline changes the outcome. The write tools
// (use_figma, create_new_file, ...) and the cheap lookups are none of our
// business, and get_variable_defs is the call we are asking FOR — nagging on it
// would be backwards.
//
// The server segment is matched loosely, not pinned to `plugin_figma_figma`:
// that name is what the Figma *plugin* registers, but a user who configures the
// Figma MCP server directly gets `mcp__figma__get_design_context`, and the whole
// point of this hook is to cover the case where nothing else matched.
// `figma` must be a whole underscore-delimited segment of the server name, so
// `mcp__figma__` and `mcp__plugin_figma_figma__` match while some unrelated
// `mcp__notfigmaatall__` does not.
if (!/^mcp__(?:[a-z0-9]+_)*figma(?:_[a-z0-9]+)*__(get_design_context|get_metadata|get_screenshot)$/.test(tool)) {
  process.exit(0);
}

// Once per session, not once per call: this is a nag about reading discipline,
// and repeating it on every read would train the reader to ignore it. The
// shared helper gives session scope when the key is reduced to the session id.
// A missing or unwritable temp dir falls through to "act", never to a crash.
if (!once('figma-read', JSON.stringify({ session_id: data.session_id || '' }))) {
  process.exit(0);
}

const context = [
  'twt: you are reading a Figma design. Before going further, load the',
  '`figma:figma-design-to-code` skill (mandatory prerequisite), and consider the',
  '`twt-figma-read` skill, which carries the full reading discipline.',
  '',
  'The two failures worth avoiding on this read:',
  '- Opening with get_design_context on a whole file. Call get_metadata first for',
  '  the cheap frame tree, then scope get_design_context to the frame you need.',
  '- Skipping get_variable_defs. Figma variables are the highest-confidence token',
  '  source in the file; without them you get hex codes and pixel numbers with no',
  '  way to tell a design token from a one-off value.',
  '',
  'Treat a screenshot as corroboration, never as the measurement. Report which',
  'values you measured and which you estimated.',
].join('\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: context,
  },
}));
