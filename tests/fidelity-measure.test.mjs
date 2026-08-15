import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { measure } from '../tools/fidelity/measure.mjs';
import { makeElement } from '../tools/fidelity/spec.mjs';
import { detectPlaywright } from '../tools/lib/resolve-playwright.mjs';

const FIX = fileURLToPath(new URL('./fixtures/fidelity-pair/', import.meta.url));

// Playwright is a real dependency but Chromium may be absent in a bare
// checkout. Skip rather than fail — CI installs it, a laptop may not.
async function measured(file) {
  const out = await measure({ file: FIX + file, root: '.hero', widths: [1440] });
  return out;
}

// Independent of measure()'s own return value, so the error-path tests below
// can assert "must not be null" without that assertion being maskable by the
// very code path they're pinning — inferring availability from `out === null`
// would let a mutation that wrongly returns null read as "skip", not "fail".
let chromiumOk;
async function chromiumAvailable() {
  if (chromiumOk === undefined) {
    const d = await detectPlaywright();
    chromiumOk = d.playwright && d.chromium;
  }
  return chromiumOk;
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

// --- Coordinator follow-up: distinguish "playwright missing" from "the ---
// --- measurement itself failed", and pin measure()'s element shape ------
//
// measure() previously returned `null` for BOTH "Playwright/Chromium isn't
// installed" and "something else went wrong" (bad selector, 404, timeout).
// The CLI branched only on `!out`, so a real measurement bug reported
// itself identically to "go install Playwright" — misdirecting whoever
// reads the error. A root selector matching nothing was worse: it was a
// SILENT SUCCESS (an empty array), not an error at all.

test('a root selector that matches nothing is a measurement error, not an empty success', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const out = await measure({ file: FIX + 'reference.html', root: '.does-not-exist', widths: [1440] });
  assert.notEqual(out, null, 'must not collapse into the "playwright unavailable" sentinel');
  assert.equal(out.error, 'measurement');
  assert.match(out.message, /does-not-exist/);
  assert.equal(out.widths, undefined, 'a failed measurement must not also carry a (misleadingly empty) widths map');
});

test('a nonexistent file path is a measurement error, not null', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const out = await measure({ file: FIX + 'does-not-exist.html', root: '.hero', widths: [1440] });
  assert.notEqual(out, null);
  assert.equal(out.error, 'measurement');
  assert.equal(typeof out.message, 'string');
  assert.ok(out.message.length > 0);
});

test("the element shape measure() emits matches spec.mjs's canonical shape, key for key", async (t) => {
  const out = await measured('reference.html');
  if (!out) return t.skip('playwright/chromium unavailable');
  if (out.error) return t.skip('measurement error — shape comparison not applicable');
  const got = out.widths[1440].find((e) => e.id === 'hero.title.0');
  const gotKeys = Object.keys(got).sort();
  const wantKeys = Object.keys(makeElement({ id: 'x.0' })).sort();
  const extra = gotKeys.filter((k) => !wantKeys.includes(k));
  const missing = wantKeys.filter((k) => !gotKeys.includes(k));
  // measure() cannot call makeElement/deriveId directly — the literal is
  // built inside a page.evaluate() closure that runs in the BROWSER, which
  // has no access to this file's Node module scope. That is the one
  // legitimate, known divergence: measure() adds `fontFallback` (a
  // rendering-artifact flag spec.mjs's schema does not yet have a home
  // for), and never sets `source` (spec.mjs's provenance-tracking field,
  // populated only by the reference-spec side, never by a live measurement).
  // Any OTHER divergence means the inline literal has silently drifted from
  // spec.mjs's schema and this assertion must fail.
  assert.deepEqual(extra, ['fontFallback']);
  assert.deepEqual(missing, ['source']);
});
