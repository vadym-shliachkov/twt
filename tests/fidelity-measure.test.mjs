import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { measure } from '../tools/fidelity/measure.mjs';

const FIX = fileURLToPath(new URL('./fixtures/fidelity-pair/', import.meta.url));

// Playwright is a real dependency but Chromium may be absent in a bare
// checkout. Skip rather than fail — CI installs it, a laptop may not.
async function measured(file) {
  const out = await measure({ file: FIX + file, root: '.hero', widths: [1440] });
  return out;
}

test('measure reads the data-fid stamp as the element id', async (t) => {
  const out = await measured('reference.html');
  if (!out) return t.skip('playwright/chromium unavailable');
  const ids = out.widths[1440].map((e) => e.id);
  assert.deepEqual(ids.sort(), ['hero.0', 'hero.cta.0', 'hero.title.0']);
});

test('measure captures typography exactly as computed', async (t) => {
  const out = await measured('reference.html');
  if (!out) return t.skip('playwright/chromium unavailable');
  const title = out.widths[1440].find((e) => e.id === 'hero.title.0');
  assert.equal(title.type.size, 56);
  assert.equal(title.type.lineHeight, 64);
  assert.equal(title.type.weight, 700);
  assert.equal(title.type.letterSpacing, -1.12);
});

test('measure captures spacing, radius and colour', async (t) => {
  const out = await measured('reference.html');
  if (!out) return t.skip('playwright/chromium unavailable');
  const hero = out.widths[1440].find((e) => e.id === 'hero.0');
  assert.deepEqual(hero.spacing.padding, [96, 24, 96, 24]);
  assert.equal(hero.spacing.gap, 24);
  assert.equal(hero.bg.color, 'rgb(11, 11, 15)');
  const cta = out.widths[1440].find((e) => e.id === 'hero.cta.0');
  assert.deepEqual(cta.radius, [28, 28, 28, 28]);
});

test('an unstamped element gets a positional id, flagged as positional', async (t) => {
  const out = await measure({ file: FIX + 'unstamped.html', root: '.hero', widths: [1440] });
  if (!out) return t.skip('playwright/chromium unavailable');
  const el = out.widths[1440].find((e) => e.id !== 'hero.0');
  assert.equal(el.positionalId, true);
});

test('measure flags a font-family fallback rather than reporting the requested font', async (t) => {
  const out = await measured('reference.html');
  if (!out) return t.skip('playwright/chromium unavailable');
  const title = out.widths[1440].find((e) => e.id === 'hero.title.0');
  // Arial is present on CI; the point is the field exists and is boolean.
  assert.equal(typeof title.fontFallback, 'boolean');
});

test('the drifted fixture really differs from the reference by the documented amounts', async (t) => {
  const a = await measured('reference.html');
  const b = await measured('drifted.html');
  if (!a || !b) return t.skip('playwright/chromium unavailable');
  const t1 = a.widths[1440].find((e) => e.id === 'hero.title.0');
  const t2 = b.widths[1440].find((e) => e.id === 'hero.title.0');
  assert.equal(t1.type.size - t2.type.size, 8);
  assert.equal(t1.type.lineHeight - t2.type.lineHeight, 8);
  const h1 = a.widths[1440].find((e) => e.id === 'hero.0');
  const h2 = b.widths[1440].find((e) => e.id === 'hero.0');
  assert.equal(h1.spacing.padding[0] - h2.spacing.padding[0], 16);
});

// --- Extra coverage beyond the brief -----------------------------------
//
// The brief's suite proves the happy path against a single fixture at a
// single width. None of it would catch: --widths silently returning the
// same set under every key, box coordinates leaking viewport offset instead
// of root-relative offset, or a display:none element leaking into the
// output. Each of the three below is built to fail against a plausible
// wrong implementation, not just to exercise a code path.

test('--widths produces one distinct element set per width, not the same set repeated', async (t) => {
  const out = await measure({ file: FIX + 'widths.html', root: '.hero', widths: [1440, 375] });
  if (!out) return t.skip('playwright/chromium unavailable');
  const wide = out.widths[1440].find((e) => e.id === 'hero.0');
  const narrow = out.widths[375].find((e) => e.id === 'hero.0');
  // .hero is 50% width: 720 at 1440, 187.5 at 375. If the CLI's --widths
  // loop reused one page/one viewport for every entry, these would be equal.
  assert.equal(wide.box.w, 720);
  assert.equal(narrow.box.w, 187.5);
  assert.notEqual(wide.box.w, narrow.box.w);
});

test('box coordinates are relative to the root element, not the viewport', async (t) => {
  const out = await measure({ file: FIX + 'offset.html', root: '.hero', widths: [1440] });
  if (!out) return t.skip('playwright/chromium unavailable');
  const title = out.widths[1440].find((e) => e.id === 'hero.title.0');
  // .hero sits at margin-left:300px, padding:20px. In viewport coordinates
  // the title would land at x=320. Root-relative, it must land at x=20 —
  // the padding alone, with the root's own offset subtracted out.
  assert.equal(title.box.x, 20);
});

test('a display:none element is excluded from the measured set entirely', async (t) => {
  const out = await measure({ file: FIX + 'hidden.html', root: '.hero', widths: [1440] });
  if (!out) return t.skip('playwright/chromium unavailable');
  const ids = out.widths[1440].map((e) => e.id);
  assert.ok(ids.includes('hero.title.0'), 'visible sibling must still be captured');
  assert.ok(!ids.includes('hero.ghost.0'), 'display:none element must not appear in the output');
});

test('letter-spacing: normal measures as 0, never null', async (t) => {
  const out = await measured('reference.html');
  if (!out) return t.skip('playwright/chromium unavailable');
  // .hero__cta declares no letter-spacing (computed value "normal"). It is a
  // real, comparable value of 0 — distinct from type.lineHeight's "normal",
  // which measure() records as null because line-height is unknowable
  // without forcing layout. Collapsing the two into the same sentinel would
  // make tolerance.mjs's `missing()` skip a property that should be graded.
  const cta = out.widths[1440].find((e) => e.id === 'hero.cta.0');
  assert.equal(cta.type.letterSpacing, 0);
  assert.notEqual(cta.type.letterSpacing, null);
});
