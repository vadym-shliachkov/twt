import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncBlock, nextHeadingIndex } from '../tools/lib/stamp-block.mjs';

// Regression coverage for the fence-aware shared-block stamper in
// tools/gen-docs.mjs. Before the fix, nextHeadingIndex() only tracked
// backtick fences: a "## "-prefixed line inside a fenced example (which the
// canonical block text itself can legitimately contain in a fenced example)
// was mistaken for the section's real end boundary,
// truncating the re-stamp and causing the block to grow by the duplicated
// tail on every subsequent run — unbounded growth on every CI run.

const HEADING = /^## Demo Block[^\n]*\r?$/im;

/** A canonical block whose own text contains a "## "-prefixed line fenced
 * with the given fence marker (``` or ~~~) — the exact shape that broke the
 * naive scanner. */
function blockWithFencedHeading(fence) {
  return [
    '## Demo Block',
    'Intro line describing the block.',
    '',
    'Example entry:',
    fence,
    '## 2026-07-11T14:03:22Z · reason · demo-skill',
    '- nested content inside the fence',
    fence,
    '',
    'Trailing canonical sentence after the fence.',
  ].join('\n');
}

function bodyWithHeading() {
  return [
    '# Some Command',
    '',
    '## Demo Block',
    'stale body that should get replaced',
    '',
    '## Next Section',
    'This section must survive untouched.',
  ].join('\n');
}

for (const fence of ['```', '~~~']) {
  test(`stamping is idempotent when the canonical block fences a "## " line with ${fence}`, () => {
    const block = blockWithFencedHeading(fence);
    const target = { text: block, heading: HEADING };

    const first = syncBlock(bodyWithHeading(), target);
    const second = syncBlock(first, target);

    assert.equal(second, first, 'second stamp must be byte-identical to the first (no growth)');

    // The next real section must not have been consumed or duplicated.
    const nextSectionCount = (first.match(/## Next Section/g) || []).length;
    assert.equal(nextSectionCount, 1, '"## Next Section" must appear exactly once, not duplicated');
    assert.match(first, /This section must survive untouched\./);

    // The fenced example line inside the canonical block must be preserved
    // verbatim, not treated as the section boundary.
    assert.match(first, /## 2026-07-11T14:03:22Z · reason · demo-skill/);
  });
}

test('nextHeadingIndex ignores a "## " line fenced with backticks', () => {
  const text = ['```', '## not a real heading', '```', '## real heading'].join('\n');
  const idx = nextHeadingIndex(text);
  const found = text.slice(idx);
  assert.match(found, /^## real heading/);
});

test('nextHeadingIndex ignores a "## " line fenced with tildes', () => {
  const text = ['~~~', '## not a real heading', '~~~', '## real heading'].join('\n');
  const idx = nextHeadingIndex(text);
  const found = text.slice(idx);
  assert.match(found, /^## real heading/);
});

test('nextHeadingIndex treats a backtick fence and a tilde fence as independent (one cannot close the other)', () => {
  // A ~~~ fence opened, then a ``` line inside it must NOT close the ~~~
  // fence — so the "## " line that follows the stray ``` is still hidden,
  // and only the heading after the real ~~~ close counts.
  const text = [
    '~~~',
    '```',
    '## hidden by the still-open ~~~ fence',
    '~~~',
    '## real heading',
  ].join('\n');
  const idx = nextHeadingIndex(text);
  const found = text.slice(idx);
  assert.match(found, /^## real heading/);
});

test('nextHeadingIndex returns -1 when no real heading follows', () => {
  const text = ['some text', '```', '## fenced only', '```', 'trailing text'].join('\n');
  assert.equal(nextHeadingIndex(text), -1);
});
