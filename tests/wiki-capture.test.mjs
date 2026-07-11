import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (e.g. this repo lives under "C:\Work\~marketplace", and
// Node percent-encodes "~" to "%7E" in import.meta.url) are decoded correctly.
const HOOK = fileURLToPath(new URL('../hooks/twt-wiki-capture.js', import.meta.url));

/** Run the hook with `payload` on stdin and CLAUDE_PROJECT_DIR=projectDir. Returns stdout. */
function runHook(payload, projectDir) {
  return execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
  });
}

function newProject({ withWiki }) {
  const dir = mkdtempSync(join(tmpdir(), 'twt-wiki-'));
  if (withWiki) mkdirSync(join(dir, '.project-wiki'));
  return dir;
}

const ASK_PAYLOAD = {
  tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [{
      question: 'Which accent for the primary CTA?',
      header: 'Accent',
      options: [
        { label: 'Orange', description: 'High contrast on the dark hero' },
        { label: 'Brand navy', description: 'On-brand' },
      ],
    }],
  },
  tool_response: { answers: { 'Which accent for the primary CTA?': 'Orange' } },
};

const inbox = (dir) => join(dir, '.project-wiki', 'inbox.md');

test('writes nothing when .project-wiki/ does not exist', () => {
  const dir = newProject({ withWiki: false });
  runHook(ASK_PAYLOAD, dir);
  assert.equal(existsSync(inbox(dir)), false, 'hook must be inert without a wiki');
});

test('appends question, options and chosen answer when the wiki exists', () => {
  const dir = newProject({ withWiki: true });
  runHook(ASK_PAYLOAD, dir);
  const text = readFileSync(inbox(dir), 'utf8');
  assert.match(text, /· decision · AskUserQuestion/);
  assert.match(text, /\*\*question:\*\* Which accent for the primary CTA\?/);
  assert.match(text, /\*\*options:\*\* Orange \| Brand navy/);
  assert.match(text, /\*\*chosen:\*\* Orange/);
  assert.match(text, /^## \d{4}-\d{2}-\d{2}T[\d:]+Z/m, 'heading starts with an ISO-8601 UTC timestamp');
});

test('appends rather than overwrites', () => {
  const dir = newProject({ withWiki: true });
  writeFileSync(inbox(dir), '## 2020-01-01T00:00:00Z · decision · AskUserQuestion\n- **question:** old\n');
  runHook(ASK_PAYLOAD, dir);
  const text = readFileSync(inbox(dir), 'utf8');
  assert.match(text, /\*\*question:\*\* old/, 'existing content survives');
  assert.match(text, /\*\*chosen:\*\* Orange/, 'new content added');
});

test('ignores tools other than AskUserQuestion', () => {
  const dir = newProject({ withWiki: true });
  runHook({ tool_name: 'Bash', tool_input: { command: 'ls' } }, dir);
  assert.equal(existsSync(inbox(dir)), false);
});

test('records raw payload when the answer cannot be parsed, losing nothing', () => {
  const dir = newProject({ withWiki: true });
  runHook({
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] },
    tool_response: 'an unexpected string shape',
  }, dir);
  const text = readFileSync(inbox(dir), 'utf8');
  assert.match(text, /\*\*question:\*\* Q\?/);
  assert.match(text, /\*\*raw:\*\*/, 'unparseable response is preserved verbatim');
});

test('never throws and always exits 0 on malformed input', () => {
  const dir = newProject({ withWiki: true });
  assert.doesNotThrow(() => execFileSync(process.execPath, [HOOK], {
    input: 'not json at all',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  }));
});
