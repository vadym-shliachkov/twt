import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const { MARKER, assertOwned, seedTarget, cleanTarget } =
  await import(new URL('../tools/lib/skill-test/marker.mjs', import.meta.url).href);

const newDir = () => mkdtempSync(join(tmpdir(), 'twt-st-'));

test('seedTarget stamps the marker with its metadata', () => {
  const root = join(newDir(), 'target');
  seedTarget(root, { skill: 'twt-ia-define', runDir: 'r1', fixture: 'happy' });
  const meta = JSON.parse(readFileSync(join(root, MARKER), 'utf8'));
  assert.equal(meta.skill, 'twt-ia-define');
  assert.equal(meta.fixture, 'happy');
  assert.ok(meta.created);
});

test('seedTarget REFUSES a non-empty unmarked tree with exit code 3', () => {
  const root = join(newDir(), 'real-project');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'important.md'), 'a real project file');
  let err;
  assert.throws(() => {
    try {
      seedTarget(root, { skill: 's', runDir: 'r', fixture: 'happy' });
    } catch (e) {
      err = e;
      throw e;
    }
  });
  assert.equal(err.exitCode, 3);
  assert.match(err.message, /REFUSING/);
  // the guard must not have deleted anything on its way to refusing
  assert.ok(existsSync(join(root, 'important.md')));
});

test('seedTarget re-seeds a tree it already owns, discarding prior contents', () => {
  const root = join(newDir(), 'target');
  seedTarget(root, { skill: 's', runDir: 'r1', fixture: 'happy' });
  writeFileSync(join(root, 'iteration-1-junk.md'), 'x');
  seedTarget(root, { skill: 's', runDir: 'r2', fixture: 'happy' });
  assert.equal(existsSync(join(root, 'iteration-1-junk.md')), false);
  assert.equal(JSON.parse(readFileSync(join(root, MARKER), 'utf8')).runDir, 'r2');
});

test('cleanTarget REFUSES an unmarked tree and returns false for an absent one', () => {
  const root = join(newDir(), 'real-project');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'important.md'), 'x');
  let err;
  assert.throws(() => {
    try {
      cleanTarget(root);
    } catch (e) {
      err = e;
      throw e;
    }
  });
  assert.equal(err.exitCode, 3);
  assert.ok(existsSync(join(root, 'important.md')));
  assert.equal(cleanTarget(join(newDir(), 'never-existed')), false);
});

test('cleanTarget removes a marked tree', () => {
  const root = join(newDir(), 'target');
  seedTarget(root, { skill: 's', runDir: 'r', fixture: 'happy' });
  assert.equal(cleanTarget(root), true);
  assert.equal(existsSync(root), false);
});

test('assertOwned passes on a marked tree', () => {
  const root = join(newDir(), 'target');
  seedTarget(root, { skill: 's', runDir: 'r', fixture: 'happy' });
  assert.doesNotThrow(() => assertOwned(root));
});
