import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// fileURLToPath (not a manual .pathname regex) so percent-encoded characters
// in the repo path (e.g. this repo lives under "C:\Work\~marketplace", and
// Node percent-encodes "~" to "%7E" in import.meta.url) are decoded correctly.
const TOOL = fileURLToPath(new URL('../tools/wiki-drain.mjs', import.meta.url));

function run(dir, args) {
  return execFileSync(process.execPath, [TOOL, dir, ...args], { encoding: 'utf8' });
}

// The scaffold's header comment indents its format example, so the example's
// "## " lines must never be counted as entries.
const PREAMBLE = `<!-- APPEND-ONLY. Drained by /twt-wiki (twt-wiki-define).
     Entry format:

     ## <ISO-8601 UTC> · decision|reason · <source>
     - **question:** ...
-->
`;

const ENTRY = (n) => `
## 2026-07-12T0${n}:00:00Z · decision · AskUserQuestion
- **question:** Question ${n}?
- **chosen:** Answer ${n}
`;

function newInbox(entryCount) {
  const dir = mkdtempSync(join(tmpdir(), 'twt-wiki-drain-'));
  mkdirSync(join(dir, '.project-wiki'));
  let text = PREAMBLE;
  for (let i = 1; i <= entryCount; i++) text += ENTRY(i);
  writeFileSync(join(dir, '.project-wiki', 'inbox.md'), text, 'utf8');
  return dir;
}

const inbox = (dir) => readFileSync(join(dir, '.project-wiki', 'inbox.md'), 'utf8');

test('--list numbers every entry in file order and never counts the header comment', () => {
  const dir = newInbox(3);
  const out = run(dir, ['--list']);
  assert.match(out, /^1: 2026-07-12T01.*Question 1\?/m);
  assert.match(out, /^2: 2026-07-12T02.*Question 2\?/m);
  assert.match(out, /^3: 2026-07-12T03.*Question 3\?/m);
  assert.match(out, /3 entries\./);
});

test('--drain removes exactly the named entries and keeps the rest byte-for-byte', () => {
  const dir = newInbox(4);
  run(dir, ['--drain', '1,3']);
  const text = inbox(dir);
  assert.equal(text, PREAMBLE + ENTRY(2) + ENTRY(4), 'kept content must be byte-identical, in order');
});

test('--drain all resets inbox.md to just the header comment', () => {
  const dir = newInbox(2);
  const out = run(dir, ['--drain', 'all']);
  // The blank separator line before the first entry belongs to the preamble
  // slice (byte-faithful split), so it survives - harmless: the hook appends
  // "\n## ..." regardless.
  assert.equal(inbox(dir), PREAMBLE + '\n', 'the format comment survives for the harvester');
  assert.match(out, /drained 2, kept 0/);
});

test('an out-of-range index aborts the whole drain and writes nothing', () => {
  const dir = newInbox(2);
  const before = inbox(dir);
  assert.throws(() => run(dir, ['--drain', '1,5']), /entry 5 does not exist/);
  assert.equal(inbox(dir), before, 'a partially-valid drain must not partially apply');
});

test('a non-numeric token aborts and writes nothing', () => {
  const dir = newInbox(1);
  const before = inbox(dir);
  assert.throws(() => run(dir, ['--drain', 'first']));
  assert.equal(inbox(dir), before);
});

test('entries appended after --list keep earlier indices valid (append-only stability)', () => {
  const dir = newInbox(2);
  run(dir, ['--list']);
  // A concurrent harvest appends mid-pass - indices 1 and 2 must still name the
  // same entries, and the new arrival must survive the drain untouched.
  appendFileSync(join(dir, '.project-wiki', 'inbox.md'), ENTRY(9), 'utf8');
  run(dir, ['--drain', '1']);
  assert.equal(inbox(dir), PREAMBLE + ENTRY(2) + ENTRY(9));
});

test('refuses to run without a wiki', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twt-wiki-drain-'));
  assert.throws(() => run(dir, ['--list']), /no \.project-wiki/);
});

test('--list on an empty inbox reports 0 entries', () => {
  const dir = newInbox(0);
  assert.match(run(dir, ['--list']), /0 entries\./);
});
