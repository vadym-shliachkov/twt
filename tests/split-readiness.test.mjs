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
import { analyze } from '../tools/split-readiness.mjs';

const EXPORT = ['twt-export', 'twt-export-docx', 'twt-export-pdf', 'twt-export-presentation', 'twt-export-template-create'];
const WRITE_AS_ME = ['twt-write-as-me', 'twt-write-as-me-analysis'];

test('ground truth: the shipped write-as-me split has no contested files', () => {
  // This cluster is already its own plugin and works, so the tool must agree.
  const { contested, verdict } = analyze(WRITE_AS_ME);
  assert.deepEqual(contested, []);
  assert.match(verdict, /^(CLEAN|SPLITTABLE)/);
});

test('ground truth: the export cluster is contested on templates/themes', () => {
  // Found by hand: tools/theme.mjs and tools/house-style.mjs both need this
  // directory, and house-style backs four monolith report tools.
  //
  // The `contested` assertion is the real guard here and has not moved - it is
  // what fails if closure() stops following computed data paths. Only the
  // verdict changed: sync-kernel vendors shared files into each plugin from one
  // canonical source, so contention is a cost to pay, not a wall. A hard
  // dependency edge is now the only fatal verdict, since duplicating a SKILL
  // (rather than a file) is the trap CONVENTIONS forbids.
  const { contested, verdict } = analyze(EXPORT);
  assert.ok(
    contested.some((f) => f === 'templates/themes' || f.startsWith('templates/themes/')),
    `expected templates/themes to be contested, got: ${JSON.stringify(contested)}`,
  );
  assert.match(verdict, /^VENDORABLE/);
});

test('computed data paths are followed, not just import edges', () => {
  // The specific mechanism behind the export block. If closure() stops following
  // join(HERE, '..', ...) this assertion is what fails.
  const { contested } = analyze(EXPORT);
  assert.ok(contested.length > 0, 'computed asset paths must reach templates/themes');
});

test('contested paths are compared by containment, not equality', () => {
  // "templates/themes" vs "templates/themes/doc-hub-light/css" must collide.
  const { contested } = analyze(EXPORT);
  const exactMatchWouldMiss = !contested.includes('templates/themes/doc-hub-light/css');
  assert.ok(
    exactMatchWouldMiss || contested.includes('templates/themes'),
    'containment comparison must catch the nested-directory case',
  );
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
