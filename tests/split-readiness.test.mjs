// split-readiness: the tool that decides whether a cluster can become a plugin.
//
// These tests are regression guards for two blind spots that each produced a
// WRONG "clean" verdict during the packaging work, and would have led to a
// broken split had they not been caught by hand:
//
//   1. Following only import edges. tools/theme.mjs reaches templates/themes
//      through join(HERE, '..', 'templates', 'themes') — a computed data path.
//      Nothing imports it, so the export cluster looked clean.
//   2. Comparing contested paths by string equality. The export side reaches
//      "templates/themes"; tools/house-style.mjs reaches
//      "templates/themes/doc-hub-light/css" for four monolith report tools.
//      Different strings, one directory, still only one plugin can own it.
//
// A false CLEAN here is worse than no tool at all, so both stay pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, pathsOverlap } from '../tools/split-readiness.mjs';

const EXPORT = ['twt-export', 'twt-export-docx', 'twt-export-pdf', 'twt-export-presentation', 'twt-export-template-create'];
const WRITE_AS_ME = ['twt-write-as-me', 'twt-write-as-me-analysis'];

test('ground truth: the shipped write-as-me split has no contested files', () => {
  // This cluster is already its own plugin and works, so the tool must agree.
  const { contested, verdict } = analyze(WRITE_AS_ME);
  assert.deepEqual(contested, []);
  assert.match(verdict, /^(CLEAN|SPLITTABLE)/);
});

test('a cluster whose computed-path dependency is contested reports it', () => {
  // This guard used to ride on the export cluster, which is now its own plugin
  // with templates/themes vendored in -- so it is correctly no longer contested
  // and could not keep proving anything. Retargeted, not deleted: the mechanism
  // under test is unchanged.
  //
  // tools/house-style.mjs reaches templates/themes/doc-hub-light/css through a
  // computed join(), and backs six monolith skills. Split twt-launch-audit out
  // and that directory is needed on both sides. If closure() stops following
  // computed data paths this returns [] and the assertion fires.
  const { contested, verdict } = analyze(['twt-launch-audit']);
  assert.ok(
    contested.some((f) => f === 'templates/themes' || f.startsWith('templates/themes/')),
    `expected templates/themes contested via house-style, got: ${JSON.stringify(contested)}`,
  );
  assert.match(verdict, /^VENDORABLE/);
});

test('a split-out cluster is no longer contested on what was vendored to it', () => {
  // The other half of the same fact, and the payoff of the split: twt-export
  // owns its tools and carries its own themes, so nothing is contested and it
  // is cleanly separable. A regression that re-contested it would show here.
  const { contested } = analyze(EXPORT);
  assert.deepEqual(contested, [], `export is its own plugin now, got: ${JSON.stringify(contested)}`);
});

test('computed data paths are followed, not just import edges', () => {
  // If closure() stops following join(HERE, '..', ...) this is what fails.
  // Anchored on launch-audit for the same reason as above -- export no longer
  // exercises it now that it is split out.
  const { contested } = analyze(['twt-launch-audit']);
  assert.ok(contested.length > 0, 'computed asset paths must reach templates/themes');
});

test('contested paths are compared by containment, not equality', () => {
  // "templates/themes" vs "templates/themes/doc-hub-light/css" must collide:
  // different strings, one directory, and a directory travels as a unit.
  //
  // This used to be asserted through the export cluster's real contested list.
  // When export became its own plugin that data stopped containing the nested
  // case, and the test started passing for the wrong reason. Testing the rule
  // itself is what the guard was always about.
  assert.ok(pathsOverlap('templates/themes', 'templates/themes/doc-hub-light/css'));
  assert.ok(pathsOverlap('templates/themes/doc-hub-light/css', 'templates/themes'));
  assert.ok(pathsOverlap('tools/lib/sources.mjs', 'tools/lib/sources.mjs'));
  // A shared prefix that is not a path boundary must NOT collide.
  assert.ok(!pathsOverlap('templates/themes', 'templates/themes-old'));
  assert.ok(!pathsOverlap('tools/lib', 'tools/library'));
  assert.ok(!pathsOverlap('tools/a.mjs', 'tools/b.mjs'));
});

test('a single-skill cluster still reports its shared libraries', () => {
  const { contested } = analyze(['twt-figma-dev-audit']);
  assert.ok(
    contested.includes('tools/lib/contrast.mjs'),
    `expected tools/lib/contrast.mjs to be contested, got: ${JSON.stringify(contested)}`,
  );
});

test('inbound and outbound edges are both reported', () => {
  const { inbound, outbound } = analyze(['twt-content-fetch']);
  assert.ok(inbound.length > 0, 'twt-content-fetch is dispatched by the pipeline');
  assert.ok(Array.isArray(outbound));
  for (const e of [...inbound, ...outbound]) {
    assert.ok(['hard', 'soft'].includes(e.kind));
    assert.equal(typeof e.from, 'string');
    assert.equal(typeof e.to, 'string');
  }
});

test('an unknown skill name is reported rather than silently ignored', () => {
  const { missing, verdict } = analyze(['twt-not-a-real-skill']);
  assert.deepEqual(missing, ['twt-not-a-real-skill']);
  assert.match(verdict, /^UNKNOWN/);
});

test('cluster members never appear as their own dependencies', () => {
  const { inbound, outbound } = analyze(EXPORT);
  const members = new Set(EXPORT);
  for (const e of inbound) assert.ok(!members.has(e.from), `${e.from} is a member, not an outsider`);
  for (const e of outbound) assert.ok(!members.has(e.to), `${e.to} is a member, not an outsider`);
});
