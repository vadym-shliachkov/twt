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

test('accepts a bare {question: answer} map with no `answers` wrapper', () => {
  // The sibling twt-debug-log hook hedges with `r.answers || r`, so the real
  // payload may arrive unwrapped. Either shape must yield a real `chosen:`.
  const dir = newProject({ withWiki: true });
  runHook({
    ...ASK_PAYLOAD,
    tool_response: { 'Which accent for the primary CTA?': 'Orange' },
  }, dir);
  const text = readFileSync(inbox(dir), 'utf8');
  assert.match(text, /\*\*chosen:\*\* Orange/, 'unwrapped answer map must still be parsed');
  assert.equal(/\*\*raw:\*\*/.test(text), false, 'must not fall back to raw when the answer is recoverable');
});

test('an unrelated response object is not mistaken for an answer map', () => {
  const dir = newProject({ withWiki: true });
  runHook({ ...ASK_PAYLOAD, tool_response: { unrelated: 'noise' } }, dir);
  const text = readFileSync(inbox(dir), 'utf8');
  assert.equal(/\*\*chosen:\*\*/.test(text), false, 'must not invent an answer');
  assert.match(text, /\*\*raw:\*\*/, 'falls back to raw instead');
});

test('raw field is never empty when tool_response is absent entirely', () => {
  const dir = newProject({ withWiki: true });
  runHook({ tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Q?' }] } }, dir);
  const text = readFileSync(inbox(dir), 'utf8');
  assert.match(text, /\*\*raw:\*\* \(no tool_response in payload\)/, 'absent payload is stated, not blank');
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

test('captures the header chip, the chosen option description, and the user note', () => {
  const dir = newProject({ withWiki: true });
  runHook({
    ...ASK_PAYLOAD,
    tool_response: {
      answers: { 'Which accent for the primary CTA?': 'Orange' },
      annotations: { 'Which accent for the primary CTA?': { notes: 'Client explicitly vetoed navy' } },
    },
  }, dir);
  const text = readFileSync(inbox(dir), 'utf8');
  assert.match(text, /\*\*header:\*\* Accent/, 'the header chip is the best topical routing signal');
  assert.match(text, /\*\*detail:\*\* High contrast on the dark hero/, 'the chosen option description is the closest thing to a rationale');
  assert.match(text, /\*\*notes:\*\* Client explicitly vetoed navy/, 'a user note is the user explaining their own choice - never drop it');
});

test('skips operational plumbing headers (Setup, Wiki, Sync, Save, Ingest or focus)', () => {
  const dir = newProject({ withWiki: true });
  runHook({
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [{
        question: 'Run /twt-setup now?',
        header: 'Setup',
        options: [{ label: 'Run /twt-setup now' }, { label: 'Skip' }],
      }],
    },
    tool_response: { answers: { 'Run /twt-setup now?': 'Skip' } },
  }, dir);
  assert.equal(existsSync(inbox(dir)), false, 'run mechanics are not project knowledge - nothing should be written');
});

test('a skipped plumbing question does not suppress a real question in the same call', () => {
  const dir = newProject({ withWiki: true });
  runHook({
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [
        { question: 'Run /twt-setup now?', header: 'Setup', options: [{ label: 'Skip' }] },
        { question: 'Which accent?', header: 'Accent', options: [{ label: 'Orange' }] },
      ],
    },
    tool_response: { answers: { 'Run /twt-setup now?': 'Skip', 'Which accent?': 'Orange' } },
  }, dir);
  const text = readFileSync(inbox(dir), 'utf8');
  assert.match(text, /\*\*question:\*\* Which accent\?/, 'the real question is captured');
  assert.equal(/Run \/twt-setup now/.test(text), false, 'the plumbing question is not');
});

test('never throws and always exits 0 on malformed input', () => {
  const dir = newProject({ withWiki: true });
  assert.doesNotThrow(() => execFileSync(process.execPath, [HOOK], {
    input: 'not json at all',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  }));
});
