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
import { vendorPlanFor, syncFiles } from '../tools/sync-kernel.mjs';

const EXPORT_ROOT = 'plugins/twt-export';
// The refs twt-export's skills actually make, as plugin-relative paths.
const EXPORT_REFS = [
  'tools/export-document.mjs', 'tools/export-presentation.mjs',
  'tools/export-source-create.mjs', 'tools/export-theme-create.mjs',
];

// ---- half 1: deriving WHAT to vendor ---------------------------------------

test('derivation reaches a dependency of an OWNED file, not just of a missing one', () => {
  // The bug that shipped a broken plugin. The first walker only followed the
  // closure of refs the plugin was MISSING, so tools/theme.mjs - which the
  // export plugin OWNS - was never opened, and the templates/themes tree it
  // reaches was never vendored. sync-kernel reported "0 files to vendor" and
  // every export would have died on a missing theme directory.
  const { vendor } = vendorPlanFor(EXPORT_ROOT, EXPORT_REFS);
  assert.ok(
    vendor.some((f) => f.startsWith('templates/themes')),
    `themes must be vendored, got: ${JSON.stringify(vendor.slice(0, 10))}`,
  );
});

test('derivation follows computed data paths, not just imports', () => {
  // tools/theme.mjs reaches templates/themes through
  //   join(HERE, '..', 'templates', 'themes')
  // which no import edge reveals. Regress to imports-only and the export plugin
  // ships without its themes.
  const { vendor } = vendorPlanFor(EXPORT_ROOT, EXPORT_REFS);
  assert.ok(vendor.filter((f) => f.startsWith('templates/themes/')).length > 5,
    'the themes tree must be reached through the computed path and expanded to files');
});

test('an already-vendored file stays classified as vendored, not owned', () => {
  // The drift hole. Once a file has been copied in it exists inside the plugin,
  // and the obvious "exists here, therefore owned" rule dropped it from the
  // checked set -- so an EDITED vendored file passed --check reporting OK.
  // templates/themes is present in the plugin right now; it must still be
  // reported as vendored so every copy keeps getting compared.
  const { vendor, owned } = vendorPlanFor(EXPORT_ROOT, EXPORT_REFS);
  assert.ok(vendor.some((f) => f.startsWith('templates/themes')),
    'a present vendored copy must remain in the vendored set');
  assert.ok(!owned.some((f) => f.startsWith('templates/themes')),
    'a file that also exists in the monolith is a copy, never owned');
});

test("a plugin's own moved-in files are owned, never vendored", () => {
  // tools/theme.mjs moved OUT of the monolith, so it exists in one place only.
  // If this flips to vendored, sync-kernel would try to copy a file that is not
  // in the monolith and report it broken.
  const { owned, vendor } = vendorPlanFor(EXPORT_ROOT, EXPORT_REFS);
  assert.ok(owned.includes('tools/export-document.mjs'));
  assert.ok(!vendor.includes('tools/export-document.mjs'));
});

test('a self-contained plugin needs nothing vendored', () => {
  // Ground truth: twt-write-as-me ships alone and works.
  const { vendor } = vendorPlanFor('plugins/twt-write-as-me', ['tools/write-as-me-contamination.mjs']);
  assert.deepEqual(vendor, [], `write-as-me must need nothing, got: ${JSON.stringify(vendor)}`);
});

test('a declared ref that exists nowhere is reported broken', () => {
  const { broken } = vendorPlanFor(EXPORT_ROOT, ['tools/does-not-exist.mjs']);
  assert.deepEqual(broken, ['tools/does-not-exist.mjs']);
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
