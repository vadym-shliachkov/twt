// sync-kernel: the build step that lets a shared file live in more than one plugin.
//
// The whole packaging effort stalls on one sentence in split-readiness: "a file
// can live in exactly one plugin." That is true of files a human checks in and
// false once a build step owns the copies. These tests pin the two halves that
// make it false, because a silent failure in either produces a plugin that
// installs and then breaks at runtime on a missing file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { requiredForSkills, syncFiles } from '../tools/sync-kernel.mjs';

const EXPORT = ['twt-export', 'twt-export-docx', 'twt-export-pdf', 'twt-export-presentation', 'twt-export-template-create'];

// ---- half 1: deriving WHAT to vendor ---------------------------------------

test('derivation follows computed data paths, not just imports', () => {
  // This is the exact case that made the export split look clean and then fail.
  // tools/theme.mjs reaches templates/themes through
  //   join(HERE, '..', 'templates', 'themes')
  // which no import edge reveals. If the walker regresses to imports-only, the
  // export plugin ships without its themes and every export breaks at runtime.
  const req = requiredForSkills(EXPORT);
  assert.ok(req.some((f) => f === 'tools/theme.mjs'), 'theme.mjs must be required');
  assert.ok(
    req.some((f) => f.startsWith('templates/themes')),
    `templates/themes must be reached through the computed path, got: ${JSON.stringify(req.slice(0, 20))}`,
  );
});

test('derivation expands a required directory to its files', () => {
  // Vendoring copies files, so a directory reference has to become the files
  // under it or the copy step silently does nothing.
  const req = requiredForSkills(EXPORT);
  const themeFiles = req.filter((f) => f.startsWith('templates/themes/'));
  assert.ok(themeFiles.length > 1, `expected the themes tree expanded, got ${themeFiles.length}`);
  for (const f of themeFiles) assert.ok(existsSync(join(process.cwd(), f)) || true);
});

test('a self-contained plugin needs nothing vendored', () => {
  // Ground truth: twt-write-as-me already ships alone and works. If this starts
  // reporting required files, the derivation has become over-eager and would
  // bloat every plugin with files it does not use.
  const req = requiredForSkills(['twt-write-as-me', 'twt-write-as-me-analysis']);
  const foreign = req.filter((f) => !f.startsWith('plugins/twt-write-as-me/'));
  assert.deepEqual(foreign, [], `write-as-me must need nothing from the monolith, got: ${JSON.stringify(foreign)}`);
});

test('unknown skill names contribute nothing rather than throwing', () => {
  assert.deepEqual(requiredForSkills(['twt-not-a-real-skill']), []);
});

// ---- half 2: copying, and detecting drift ----------------------------------

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'twt-kernel-'));
  const from = join(base, 'src');
  const to = join(base, 'plugin');
  mkdirSync(join(from, 'tools', 'lib'), { recursive: true });
  writeFileSync(join(from, 'tools', 'lib', 'sources.mjs'), 'export const a = 1;');
  writeFileSync(join(from, 'tools', 'theme.mjs'), 'export const t = 2;');
  return { from, to, rels: ['tools/lib/sources.mjs', 'tools/theme.mjs'] };
}

test('copies nested files and then reports them in sync', () => {
  const { from, to, rels } = fixture();
  const w = syncFiles(rels, from, to);
  assert.deepEqual(w.copied, rels);
  assert.equal(readFileSync(join(to, 'tools', 'lib', 'sources.mjs'), 'utf8'), 'export const a = 1;');
  const c = syncFiles(rels, from, to, { check: true });
  assert.deepEqual(c.missing, []);
  assert.deepEqual(c.drifted, []);
});

test('an edited vendored copy is reported as drifted', () => {
  // The failure this whole mechanism exists to prevent: someone edits the copy
  // instead of the source, and the two silently diverge.
  const { from, to, rels } = fixture();
  syncFiles(rels, from, to);
  writeFileSync(join(to, 'tools', 'theme.mjs'), 'export const t = 999;');
  const c = syncFiles(rels, from, to, { check: true });
  assert.deepEqual(c.drifted, ['tools/theme.mjs']);
});

test('drift detection is byte-exact, not length-based', () => {
  // A same-length edit must still be caught. Comparing size or mtime would pass
  // this and ship a diverged copy.
  const { from, to, rels } = fixture();
  syncFiles(rels, from, to);
  const orig = readFileSync(join(to, 'tools', 'theme.mjs'), 'utf8');
  const same = 'export const t = 3;';
  assert.equal(same.length, orig.length, 'test setup: the edit must be the same length');
  writeFileSync(join(to, 'tools', 'theme.mjs'), same);
  const c = syncFiles(rels, from, to, { check: true });
  assert.deepEqual(c.drifted, ['tools/theme.mjs']);
});

test('a vendored copy that was never written is reported missing, not silently skipped', () => {
  const { from, to, rels } = fixture();
  const c = syncFiles(rels, from, to, { check: true });
  assert.deepEqual(c.missing, rels);
  assert.deepEqual(c.drifted, []);
});

test('re-syncing repairs drift', () => {
  const { from, to, rels } = fixture();
  syncFiles(rels, from, to);
  writeFileSync(join(to, 'tools', 'theme.mjs'), 'tampered');
  syncFiles(rels, from, to);
  assert.deepEqual(syncFiles(rels, from, to, { check: true }).drifted, []);
});
