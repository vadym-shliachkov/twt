// twt-figma-read-guard: the always-on floor under ad-hoc Figma reads.
//
// The hook exists because both other mechanisms depend on something matching —
// a skill description winning a trigger, or the model already being inside a
// stamped skill. These tests pin the behaviour that makes it safe to leave
// always on: it fires on the reads that matter, exactly once per session, and
// is silent (exit 0, no output) on every other path including malformed input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HOOK = fileURLToPath(new URL('../hooks/twt-figma-read-guard.js', import.meta.url));

function run(payload) {
  return execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

// A fresh session id per call, so ordering between tests can never matter.
const sid = () => `test-${randomUUID()}`;

for (const tool of ['get_design_context', 'get_metadata', 'get_screenshot']) {
  test(`attaches context on ${tool}`, () => {
    const out = run({ session_id: sid(), tool_name: `mcp__plugin_figma_figma__${tool}` });
    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(parsed.hookSpecificOutput.additionalContext, /get_variable_defs/);
    assert.match(parsed.hookSpecificOutput.additionalContext, /get_metadata first/);
    assert.match(parsed.hookSpecificOutput.additionalContext, /figma:figma-design-to-code/);
  });
}

test('fires once per session, then stays silent', () => {
  const session = sid();
  const first = run({ session_id: session, tool_name: 'mcp__plugin_figma_figma__get_design_context' });
  assert.notEqual(first.trim(), '', 'first call in a session must attach context');
  for (let i = 0; i < 3; i++) {
    const again = run({ session_id: session, tool_name: 'mcp__plugin_figma_figma__get_design_context' });
    assert.equal(again.trim(), '', 'repeat calls in the same session must be silent');
  }
});

test('separate sessions each get the context once', () => {
  const a = run({ session_id: sid(), tool_name: 'mcp__plugin_figma_figma__get_metadata' });
  const b = run({ session_id: sid(), tool_name: 'mcp__plugin_figma_figma__get_metadata' });
  assert.notEqual(a.trim(), '');
  assert.notEqual(b.trim(), '');
});

// A directly-configured Figma MCP server registers `mcp__figma__*`, not the
// plugin's `mcp__plugin_figma_figma__*`. The hook exists for exactly the case
// where nothing else matched, so pinning it to the plugin's server name would
// leave that case uncovered.
for (const tool of [
  'mcp__figma__get_design_context',
  'mcp__figma__get_metadata',
  'mcp__figma__get_screenshot',
]) {
  test(`fires for a directly-configured server: ${tool}`, () => {
    const out = run({ session_id: sid(), tool_name: tool });
    assert.notEqual(out.trim(), '');
    assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /get_variable_defs/);
  });
}

// get_variable_defs is the call the hook is asking FOR — nagging on it is backwards.
for (const tool of [
  'mcp__plugin_figma_figma__get_variable_defs',
  'mcp__figma__get_variable_defs',
  'mcp__plugin_figma_figma__use_figma',
  'mcp__plugin_figma_figma__create_new_file',
  'mcp__plugin_figma_figma__whoami',
  'mcp__notfigmaatall__get_metadata',
  'Bash',
  'Read',
  '',
]) {
  test(`silent on ${tool || '(no tool name)'}`, () => {
    assert.equal(run({ session_id: sid(), tool_name: tool }).trim(), '');
  });
}

test('silent on malformed stdin rather than throwing', () => {
  const out = execFileSync(process.execPath, [HOOK], { input: 'not json at all', encoding: 'utf8' });
  assert.equal(out.trim(), '');
});

test('never returns a permission decision — it must not gate the call', () => {
  const out = run({ session_id: sid(), tool_name: 'mcp__plugin_figma_figma__get_design_context' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(parsed.permissionDecision, undefined);
});
