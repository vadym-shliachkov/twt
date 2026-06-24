#!/usr/bin/env node
/**
 * twt-scope-guard — PreToolUse permission hook.
 *
 * Policy: anything that happens INSIDE the project folder is auto-allowed;
 * anything that reaches OUTSIDE the project folder is left to the normal
 * permission flow (i.e. you get the usual approval prompt).
 *
 * "Project folder" is $CLAUDE_PROJECT_DIR (the directory Claude Code was
 * launched in), falling back to process.cwd().
 *
 * This hook NEVER denies outright — the worst it does is stay silent, which
 * means "decide the normal way" (prompt). So a parsing miss can only ever
 * cause an extra prompt, never an unwanted auto-approval.
 *
 * Output contract (PreToolUse):
 *   - print  {permissionDecision:"allow"}  -> auto-approve
 *   - print nothing                        -> fall through to normal flow
 */
'use strict';

const fs = require('fs');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}

/**
 * Canonicalize a path for prefix comparison:
 *   - strip surrounding quotes
 *   - backslashes -> forward slashes
 *   - lowercase (Windows is case-insensitive; good enough elsewhere)
 *   - "C:/x" -> "/c/x" so Windows and MSYS forms compare equal
 *   - drop trailing slashes
 */
function canon(p) {
  if (!p) return '';
  let s = String(p).replace(/^["']+/, '').replace(/["']+$/, '');
  s = s.replace(/\\/g, '/').toLowerCase();
  const m = s.match(/^([a-z]):\/(.*)$/);
  if (m) s = '/' + m[1] + '/' + m[2];
  s = s.replace(/\/+$/, '');
  return s;
}

// I/O sinks that aren't meaningfully "outside the project".
const DEVNULL = new Set([
  '/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr',
  '/dev/zero', '/dev/tty', '/dev/urandom', '/dev/random',
]);

function isInside(child, root) {
  if (!child) return true;
  if (!root) return false;
  return child === root || child.startsWith(root + '/');
}

// Does a regex hit look like a real filesystem path, or is it an arithmetic /
// regex artifact (e.g. ")/1.055" from "(x)/1.055", or "3:1")? Drive-letter
// tokens (C:\, C:/) always count. A POSIX "/x" token counts only when its
// first segment starts with a path-like char (letter, ".", "_", "~") OR it has
// two or more segments (e.g. /2023/report). This drops bare numeric segments
// like "/1.055" that come from arithmetic inside a command or heredoc, so they
// no longer trigger a needless prompt.
function looksLikePath(raw) {
  if (/^[A-Za-z]:[\\/]/.test(raw)) return true;
  if (raw[0] !== '/') return false;
  if (/^\/[A-Za-z._~]/.test(raw)) return true;
  return (raw.match(/\//g) || []).length >= 2;
}

function allow(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function defer() { process.exit(0); } // no output -> normal permission flow

function main() {
  let data;
  try { data = JSON.parse(readStdin() || '{}'); } catch (e) { return defer(); }

  const root = canon(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) return defer();

  const tool = data.tool_name || '';
  const inp = data.tool_input || {};

  // File-path / search tools: a single explicit path (often optional).
  if (['Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep'].includes(tool)) {
    const c = canon(inp.file_path || inp.notebook_path || inp.path || '');
    if (!c || !c.startsWith('/')) return allow('relative path inside project');
    return isInside(c, root) ? allow('path inside project') : defer();
  }

  // Bash: scan the command for absolute paths that escape the project.
  if (tool === 'Bash') {
    const cmd = String(inp.command || '');
    // Absolute-path tokens: POSIX "/x..." or Windows "C:/x" / "C:\x".
    // We require a token boundary before the path so we don't match the inner
    // "/sub" of a relative path like "dir/sub" (those stay in-project). The
    // boundary is matched as a leading group `(?:^|[^pathchar])` rather than a
    // lookbehind, so this parses on older Node too (lookbehind needs Node 9+).
    // The first char after the slash/drive must be a real path char, so we
    // also skip awk/sed/grep regexes like /^foo/ or \.\./ that contain "/".
    const re = /(?:^|[^A-Za-z0-9._~/\\-])((?:[A-Za-z]:[\\/]|\/)[A-Za-z0-9._~][^\s"'`<>|;)&]*)/g;
    let m;
    while ((m = re.exec(cmd)) !== null) {
      const raw = m[1];
      // Advance one char past this match's start so a single shared delimiter
      // can still bound the next token (mirrors the old zero-width lookbehind);
      // re-examining a token is harmless, missing one is not.
      re.lastIndex = m.index + 1;
      if (!looksLikePath(raw)) continue;
      const c = canon(raw);
      if (!c.startsWith('/')) continue;
      if (DEVNULL.has(c)) continue;
      if (isInside(c, root)) continue;
      return defer(); // a path points outside the project -> let the user decide
    }
    return allow('command stays within project');
  }

  // Every other tool: don't interfere.
  return defer();
}

main();
