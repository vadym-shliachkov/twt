// PostToolUse hook for /twt skills marketplace.
// Reads the Claude Code hook payload from stdin. When the edited file is a
// twt skill (skills/<category>/twt-<name>.md), emits a system-reminder
// asking Claude to check whether the project's documentation files
// (architecture.md, README.md) need to be updated to reflect the change.

var fs = require('fs');

var raw;
try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { process.exit(0); }

var payload;
try { payload = JSON.parse(raw); } catch (e) { process.exit(0); }

var file =
  (payload.tool_input && payload.tool_input.file_path) ||
  (payload.tool_response && payload.tool_response.filePath) ||
  '';

if (!file) process.exit(0);

// Match skills/<anything-but-sep>/twt-<anything-but-sep>.md
// Accepts both forward and back slashes (Windows + POSIX).
var skillRe = /[\/\\]skills[\/\\][^\/\\]+[\/\\]twt-[^\/\\]+\.md$/i;
if (!skillRe.test(file)) process.exit(0);

var projectDir = process.env.CLAUDE_PROJECT_DIR || '';
var prefix = projectDir ? projectDir + '/' : '';

var message =
  'A twt skill file was just modified:\n  ' + file + '\n\n' +
  'Check whether these project docs need to be updated to reflect this change:\n\n' +
  '  1. ' + prefix + 'architecture.md\n' +
  '     - Mermaid diagram (skill nodes, artifact nodes, dependency edges)\n' +
  '     - Per-skill section (inputs, dependencies, reads, writes)\n' +
  '     - Cross-skill dependency table\n' +
  '     - Artifact namespace summary\n\n' +
  '  2. ' + prefix + 'README.md\n' +
  '     - "Available commands" table (skill name, category, description)\n' +
  '     - Directory structure block (only if a new category folder was added)\n\n' +
  '  3. ' + prefix + 'SKILLS.md\n' +
  '     - Per-skill H2 section (Usage block, "What it does" steps, Output structure, Options table)\n' +
  '     - Add a new H2 section for any new skill; remove the section for any deleted skill\n' +
  '     - Keep section order consistent with skill discovery (category-grouped)\n\n' +
  'Trigger update if: new skill added, skill removed/renamed, category folder added, ' +
  'artifact paths changed, inputs/outputs changed, options/usage changed, or a cross-skill ' +
  'dependency was added or removed. If nothing user-visible changed (refactor, wording, ' +
  'internal step reordering), say so briefly and move on without touching the docs.';

var out = {
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext: message
  }
};
process.stdout.write(JSON.stringify(out));
