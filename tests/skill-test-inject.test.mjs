import { test } from 'node:test';
import assert from 'node:assert/strict';

const { prepareInjection } =
  await import(new URL('../tools/lib/skill-test/inject.mjs', import.meta.url).href);

const BODY = `---
name: twt-demo
version: 1.0.0
---

# /twt-demo

## Step 1
Run: \`node "\${CLAUDE_PLUGIN_ROOT}/tools/a.mjs"\`
Then: \`node "\${CLAUDE_PLUGIN_ROOT}/tools/b.mjs"\`
`;

const OPTS = { projectRoot: 'C:/tmp/target', repoRoot: 'C:/Work/~marketplace' };

test('every plugin-root reference is substituted and counted', () => {
  const { prompt, substitutions } = prepareInjection(BODY, OPTS);
  assert.equal(substitutions, 2);
  assert.equal(prompt.includes('CLAUDE_PLUGIN_ROOT'), false);
  assert.ok(prompt.includes('C:/Work/~marketplace/tools/a.mjs'));
});

test('the project root is named in the preamble', () => {
  assert.ok(prepareInjection(BODY, OPTS).prompt.includes('C:/tmp/target'));
});

test('the Skill-tool prohibition is present — a stale cached copy would invalidate the run', () => {
  const { prompt } = prepareInjection(BODY, OPTS);
  assert.match(prompt, /Do NOT call the Skill tool/);
});

test('the body is delimited so the grader-facing transcript is unambiguous', () => {
  const { prompt } = prepareInjection(BODY, OPTS);
  assert.ok(prompt.includes('--- BEGIN SKILL ---'));
  assert.ok(prompt.includes('--- END SKILL ---'));
  assert.ok(prompt.includes('# /twt-demo'));
});

test('args are appended verbatim, and their absence is explicit', () => {
  assert.match(prepareInjection(BODY, { ...OPTS, args: '--scope ia' }).prompt, /Arguments: --scope ia/);
  assert.match(prepareInjection(BODY, OPTS).prompt, /Arguments: \(none\)/);
});

test('a body with no plugin-root references reports zero substitutions', () => {
  assert.equal(prepareInjection('# plain\n', OPTS).substitutions, 0);
});
