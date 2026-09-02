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

test('a computed path resolving to the REPO ROOT is not a dependency', () => {
  // tools/wiki-init.mjs computes its own repo root with `const ROOT =
  // join(HERE, '..')`, purely so it can build a real path a line later. Treating
  // that as a dependency made the first real build vendor the ENTIRE repo into
  // the wiki unit - node_modules, docs, and plugins/ itself, which then fed the
  // next build its own output and made the tree grow every run.
  const root = scratch({
    'tools/wiki-init.mjs': [
      'const HERE = ".";',
      'const ROOT = join(HERE, "..");',
      'const a = join(ROOT, "templates", "wiki");',
    ].join('\n'),
    'templates/wiki/AGENTS.md': 'x\n',
    'node_modules/pkg/index.js': 'y\n',
    'README.md': 'z\n',
  });
  const { files } = closureFrom(root, ['tools/wiki-init.mjs']);
  assert.ok(files.includes('templates/wiki/AGENTS.md'), 'the real dependency is still found');
  assert.ok(!files.includes('README.md'), 'the repo root must not be expanded');
  assert.ok(!files.some((f) => f.startsWith('node_modules/')), 'node_modules must never be vendored');
  assert.equal(files.length, 2, `expected just the tool and its template, got ${JSON.stringify(files)}`);
});

test('the generated tree is never vendored back into itself', () => {
  // Otherwise each build carries the previous build's output and the tree
  // grows without bound - which is exactly what happened.
  const root = scratch({
    'tools/a.mjs': 'const p = join(ROOT, "plugins", "twt-demo");\n',
    'plugins/twt-demo/skills/x/SKILL.md': 'x\n',
  });
  const { files } = closureFrom(root, ['tools/a.mjs']);
  assert.deepEqual(files, ['tools/a.mjs']);
});

test('a HERE-anchored path resolves against the FILE, a ROOT-anchored one against the REPO', () => {
  // The walker cannot know what a variable holds, so it reads the variable's
  // NAME. HERE/__dirname mean the file's directory; ROOT/REPO mean the repo.
  // Guessing both anchors for every path pulled the repo's own README.md,
  // SKILLS.md and AGENTS.md into three units on the first real build.
  const root = scratch({
    'tools/a.mjs': [
      'const p = join(HERE, "..", "templates", "here-target.md");',
      'const q = join(ROOT, "templates", "root-target.md");',
    ].join('\n'),
    'templates/here-target.md': 'h\n',
    'templates/root-target.md': 'r\n',
  });
  const { files } = closureFrom(root, ['tools/a.mjs']);
  assert.ok(files.includes('templates/here-target.md'), 'HERE resolves against the file');
  assert.ok(files.includes('templates/root-target.md'), 'ROOT resolves against the repo');
});

test('a path anchored on a runtime output variable is not a dependency', () => {
  // ART, OUT, WIKI, REPORTS and friends name directories a tool WRITES at run
  // time. Resolving them against the repo root pulled unrelated files in.
  const root = scratch({
    'tools/a.mjs': [
      'const p = join(WIKI, "AGENTS.md");',
      'const q = join(OUT, "README.md");',
    ].join('\n'),
    'AGENTS.md': 'a\n',
    'README.md': 'b\n',
  });
  const { files } = closureFrom(root, ['tools/a.mjs']);
  assert.deepEqual(files, ['tools/a.mjs'], 'neither output path is a source dependency');
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

test('a bare top-level computed path is a scan or write target, not a dependency', () => {
  // join(REPO, 'tools') in launch-audit/harvest.mjs is a directory it SCANS at
  // run time; following it vendored all 78 files of tools/ into the qa unit.
  // join(ROOT, 'SKILLS.md') in gen-docs.mjs is a file it WRITES; following it
  // put the repo's own docs inside the site unit. No static walker can tell a
  // read from a write, but neither is ever one segment deep when it is real.
  const root = scratch({
    'tools/a.mjs': [
      'const p = join(ROOT, "tools");',
      'const q = join(ROOT, "SKILLS.md");',
      'const r = join(ROOT, "templates", "wiki");',
    ].join('\n'),
    'tools/unrelated.mjs': 'x\n',
    'SKILLS.md': 'y\n',
    'templates/wiki/AGENTS.md': 'z\n',
  });
  const { files } = closureFrom(root, ['tools/a.mjs']);
  assert.ok(!files.includes('tools/unrelated.mjs'), 'a scanned directory is not vendored');
  assert.ok(!files.includes('SKILLS.md'), 'a written file is not vendored');
  assert.ok(files.includes('templates/wiki/AGENTS.md'), 'a real two-segment dependency still is');
});

test('a DECLARED single-segment ref is still honoured', () => {
  // The depth rule applies only to paths the walker DISCOVERS. A ref a skill
  // author wrote deliberately is always followed.
  const root = scratch({ 'LICENSE': 'mit\n' });
  const { files } = closureFrom(root, ['LICENSE']);
  assert.deepEqual(files, ['LICENSE']);
});

test('the artifact namespace is never vendored', () => {
  // tools/export-source-create.mjs has join(ROOT, ".twt-artifacts", "self-test"),
  // a directory it WRITES during its self-test. Once a self-test had actually
  // run, that path existed and three segments deep it passed the depth rule -
  // so the export unit started carrying a generated deck as if it were source,
  // and --check then failed whenever the self-test reran.
  const root = scratch({
    'tools/a.mjs': 'const p = join(ROOT, ".twt-artifacts", "self-test", "deck.md");\n',
    '.twt-artifacts/self-test/deck.md': 'generated\n',
  });
  const { files } = closureFrom(root, ['tools/a.mjs']);
  assert.deepEqual(files, ['tools/a.mjs']);
});
