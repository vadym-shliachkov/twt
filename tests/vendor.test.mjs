// The closure walker decides what a generated unit must carry. Two blind spots
// shipped a broken plugin before they were pinned:
//
//   - it must follow COMPUTED data paths - tools/theme.mjs reaches
//     templates/themes through join(HERE, '..', 'templates', 'themes'), which
//     no import edge reveals. The walker that ignored those reported "0 files
//     to vendor" for a plugin whose every export would have died on a missing
//     theme directory;
//   - a directory reference must expand to its files, or the manifest records a
//     directory and the byte check has nothing to compare.
//
// The copy half must compare BYTES, because a same-length edit to a vendored
// copy is exactly the drift this machinery exists to catch.
//
// Everything here runs against scratch directories rather than the live repo,
// so the tests keep working once plugins/ becomes build output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { closureFrom, syncFiles } from '../tools/lib/vendor.mjs';

function scratch(files) {
  const root = mkdtempSync(join(tmpdir(), 'twt-vendor-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

// ---- half 1: deciding WHAT to carry ----------------------------------------

test('follows import edges transitively', () => {
  const root = scratch({
    'tools/a.mjs': 'import { b } from "./lib/b.mjs";\nexport const a = b;\n',
    'tools/lib/b.mjs': 'export const b = 1;\n',
  });
  const { files } = closureFrom(root, ['tools/a.mjs']);
  assert.deepEqual(files, ['tools/a.mjs', 'tools/lib/b.mjs']);
});

test('follows a computed data path no import edge reveals', () => {
  const root = scratch({
    'tools/theme.mjs': 'const HERE = "x";\nconst p = join(HERE, "..", "templates", "themes");\n',
    'templates/themes/theme.json': '{}\n',
    'templates/themes/css/doc.css': 'body{}\n',
  });
  const { files } = closureFrom(root, ['tools/theme.mjs']);
  assert.ok(files.includes('templates/themes/theme.json'), `got ${JSON.stringify(files)}`);
  assert.ok(files.includes('templates/themes/css/doc.css'), 'a directory expands to its files');
});

test('a directory reference expands to every file under it', () => {
  const root = scratch({
    'templates/blocks/a.md': 'a\n',
    'templates/blocks/nested/b.md': 'b\n',
  });
  const { files } = closureFrom(root, ['templates/blocks']);
  assert.deepEqual(files, ['templates/blocks/a.md', 'templates/blocks/nested/b.md']);
});

test('a DECLARED ref that resolves nowhere is reported broken', () => {
  const root = scratch({ 'tools/a.mjs': 'export const a = 1;\n' });
  const { files, broken } = closureFrom(root, ['tools/a.mjs', 'tools/ghost.mjs']);
  assert.deepEqual(files, ['tools/a.mjs']);
  assert.deepEqual(broken, ['tools/ghost.mjs']);
});

test('a DISCOVERED path that resolves nowhere is not broken', () => {
  // export-source-create.mjs has join(ROOT, ".twt-artifacts", "self-test") - an
  // output location it writes at runtime, not a dependency. Calling that broken
  // produced a phantom failure on the first real run.
  const root = scratch({
    'tools/a.mjs': 'const p = join(ROOT, ".twt-artifacts", "self-test");\n',
  });
  const { broken } = closureFrom(root, ['tools/a.mjs']);
  assert.deepEqual(broken, []);
});

test('a reference escaping the repo root is ignored, not followed', () => {
  const root = scratch({
    'tools/a.mjs': 'import "../../../etc/passwd";\nexport const a = 1;\n',
  });
  const { files } = closureFrom(root, ['tools/a.mjs']);
  assert.deepEqual(files, ['tools/a.mjs']);
});

test('output is sorted and deduplicated, and a cycle terminates', () => {
  const root = scratch({
    'tools/a.mjs': 'import "./c.mjs";\nimport "./b.mjs";\n',
    'tools/b.mjs': 'import "./a.mjs";\nimport "./c.mjs";\n',
    'tools/c.mjs': 'export const c = 1;\n',
  });
  const { files } = closureFrom(root, ['tools/a.mjs', 'tools/a.mjs']);
  assert.deepEqual(files, ['tools/a.mjs', 'tools/b.mjs', 'tools/c.mjs']);
});

// ---- half 2: making the copies ---------------------------------------------

test('syncFiles copies, then --check passes on the copy', () => {
  const from = scratch({ 'tools/a.mjs': 'hello\n' });
  const to = mkdtempSync(join(tmpdir(), 'twt-vendor-to-'));
  const w = syncFiles(['tools/a.mjs'], from, to);
  assert.deepEqual(w.copied, ['tools/a.mjs']);
  assert.equal(readFileSync(join(to, 'tools/a.mjs'), 'utf8'), 'hello\n');
  const c = syncFiles(['tools/a.mjs'], from, to, { check: true });
  assert.deepEqual(c.drifted, []);
  assert.deepEqual(c.missing, []);
});

test('--check catches a SAME-LENGTH edit to a copy', () => {
  // Byte comparison, not mtime or size. A same-length edit is precisely the
  // drift this exists to catch, and the one a size check would wave through.
  const from = scratch({ 'tools/a.mjs': 'hello\n' });
  const to = mkdtempSync(join(tmpdir(), 'twt-vendor-to-'));
  syncFiles(['tools/a.mjs'], from, to);
  writeFileSync(join(to, 'tools/a.mjs'), 'HELLO\n');
  const c = syncFiles(['tools/a.mjs'], from, to, { check: true });
  assert.deepEqual(c.drifted, ['tools/a.mjs']);
});

test('--check reports a missing copy and writes nothing', () => {
  const from = scratch({ 'tools/a.mjs': 'hello\n' });
  const to = mkdtempSync(join(tmpdir(), 'twt-vendor-to-'));
  const c = syncFiles(['tools/a.mjs'], from, to, { check: true });
  assert.deepEqual(c.missing, ['tools/a.mjs']);
  assert.deepEqual(c.copied, []);
});
