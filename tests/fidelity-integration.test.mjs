// fidelity-integration.test.mjs — the end-to-end proof (Task 11 of the
// twt-fidelity plan). Tasks 1-10 tested every piece of this chain in
// isolation (spec, tolerance, diff, measure, pixdiff, report). Nothing before
// this file ever ran measure() -> diffSpec() -> toSummary() back to back
// against a fixture pair whose real differences were independently
// documented ahead of time. That is the one failure mode unit tests cannot
// see: two correct-in-isolation pieces that disagree about units, sign, or
// property names the moment they are wired together.
//
// The fixture pair (tests/fixtures/fidelity-pair/{reference,drifted}.html)
// differs by exactly four documented amounts, plus one deliberate fifth
// difference (the <title> text) that sits outside the `.hero` root measure()
// walks and can never reach an element diff. Every assertion below was
// checked against the real, live output of measure()/diffSpec() before being
// written — see task-11-report.md for the verification trail, including one
// fixture defect this task found and fixed (an undocumented box.w drift; see
// the comment in reference.html/drifted.html).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { measure } from '../tools/fidelity/measure.mjs';
import { makeSpec, makeElement } from '../tools/fidelity/spec.mjs';
import { diffSpec, toSummary } from '../tools/fidelity/diff.mjs';
import { detectPlaywright } from '../tools/lib/resolve-playwright.mjs';

const FIX = fileURLToPath(new URL('./fixtures/fidelity-pair/', import.meta.url));

// deltaE's fail threshold for bg.color (see tools/fidelity/tolerance.mjs
// TOLERANCES['bg.color'].warn) — named here rather than inlined so the
// assertion below reads as "past the documented threshold", not a magic 3.
const TOLERANCES_WARN_BG = 3;

// Independent-availability-gate pattern, reused verbatim from
// tests/fidelity-measure.test.mjs and tests/fidelity-pixdiff.test.mjs: probe
// chromium via detectPlaywright(), never via measure()'s own return value.
// Task 4 of this plan discovered its first mutation attempt was masked
// because the gate skipped on `!out` — a mutation that made the function
// under test wrongly return null registered as "chromium unavailable"
// instead of a failure. Gating on an independent probe means a broken
// measure()/diffSpec() surfaces here as a hard assertion failure, not a skip.
let chromiumOk;
async function chromiumAvailable() {
  if (chromiumOk === undefined) {
    const d = await detectPlaywright();
    chromiumOk = d.playwright && d.chromium;
  }
  return chromiumOk;
}

async function pair() {
  const ref = await measure({ file: FIX + 'reference.html', root: '.hero', widths: [1440] });
  const got = await measure({ file: FIX + 'drifted.html', root: '.hero', widths: [1440] });
  // Chromium was already confirmed available by the caller's gate — a null
  // here would be a real regression in measure(), not an environment gap,
  // and must fail loudly rather than be swallowed as a skip.
  assert.notEqual(ref, null, 'measure() returned null on reference.html although chromium is confirmed available');
  assert.notEqual(got, null, 'measure() returned null on drifted.html although chromium is confirmed available');
  assert.equal(ref.error, undefined, `measure() failed on reference.html: ${ref.message}`);
  assert.equal(got.error, undefined, `measure() failed on drifted.html: ${got.message}`);
  const spec = makeSpec({
    target: 'hero', source: { kind: 'url', ref: 'fixture' }, widths: [1440],
    elements: ref.widths[1440].map((e) => makeElement(e)),
  });
  return { spec, got: got.widths[1440].map((e) => makeElement(e)) };
}

test('the chain catches every documented drift and invents none', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const p = await pair();

  // Boundary: exactly the .hero subtree was measured (hero.0, hero.title.0,
  // hero.cta.0) — nothing from outside the root, including the <title> text
  // (the deliberate fifth difference between the two fixtures), ever entered
  // the element set this diff runs against.
  assert.equal(p.spec.elements.length, 3);
  assert.equal(p.got.length, 3);

  const diff = diffSpec(p.spec, p.got, { mode: 'system', width: 1440 });
  const fails = diff.rows.filter((r) => r.status === 'fail');

  const find = (id, prop) => fails.find((r) => r.id === id && r.prop === prop);

  // DRIFT 1: hero padding 96 -> 80
  const pad = find('hero.0', 'spacing.padding');
  assert.ok(pad, 'padding drift must be caught');
  assert.equal(pad.delta, -16);

  // DRIFT 2 + 3: title 56/64 -> 48/56
  assert.equal(find('hero.title.0', 'type.size').delta, -8);
  assert.equal(find('hero.title.0', 'type.lineHeight').delta, -8);

  // DRIFT 4: cta background rgb(232,255,90) -> rgb(224,245,80). The brief's
  // own text names this "DRIFT 4" but never asserted it is actually caught —
  // only that IF it fails, the property is on the allow-list. Assert it
  // positively: a colour drift this real must not go silently unreported.
  const bg = find('hero.cta.0', 'bg.color');
  assert.ok(bg, 'cta background-colour drift must be caught');
  assert.equal(bg.ref, 'rgb(232, 255, 90)');
  assert.equal(bg.got, 'rgb(224, 245, 80)');
  assert.ok(bg.delta > TOLERANCES_WARN_BG, `deltaE ${bg.delta} should exceed the fail threshold`);

  // Boundary: every pair was matched by its data-fid stamp, never by the
  // heuristic fallback — the fixtures are fully stamped, so a run that had
  // to fall back to heuristic matching would itself be a defect in the
  // matcher, silently trusting the least reliable path when the most
  // reliable one was available.
  for (const r of diff.rows) {
    assert.equal(r.how, 'stamp', `${r.id} ${r.prop} matched via '${r.how}', expected the data-fid stamp path`);
  }

  // No invented failures: every failing property is one of the four we drifted
  // (plus their two direct geometric consequences: the shorter hero padding
  // shrinks hero.0's own box.h, and it moves both children up — box.y on each).
  const drifted = new Set(['spacing.padding', 'type.size', 'type.lineHeight', 'box.h', 'box.y', 'bg.color']);
  for (const f of fails) {
    assert.ok(drifted.has(f.prop),
      `unexpected failure on ${f.id} ${f.prop} — the fixtures differ only in the documented ways`);
  }

  // Boundary: the title's own box.h (line-height 64 -> 56, delta -8) sits
  // exactly AT the warn threshold (TOLERANCES['box.h'].warn === 8), so it
  // must classify as 'warn', not 'fail' — pinning the <= boundary in
  // comparePx against a real measured delta rather than a synthetic one.
  const titleH = diff.rows.find((r) => r.id === 'hero.title.0' && r.prop === 'box.h');
  assert.ok(titleH, 'title box.h must be a compared row');
  assert.equal(titleH.status, 'warn');
  assert.equal(titleH.delta, -8);
});

test('a build identical to the reference scores a clean pass', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const ref = await measure({ file: FIX + 'reference.html', root: '.hero', widths: [1440] });
  assert.notEqual(ref, null, 'measure() returned null although chromium is confirmed available');
  assert.equal(ref.error, undefined, `measure() failed: ${ref.message}`);
  const els = ref.widths[1440].map((e) => makeElement(e));
  const spec = makeSpec({ target: 'hero', source: { kind: 'url', ref: 'fixture' }, widths: [1440], elements: els });
  const diff = diffSpec(spec, els, { mode: 'system', width: 1440 });
  assert.equal(diff.counts.fail ?? 0, 0);
  assert.equal(diff.counts.warn ?? 0, 0, 'a build identical to its own reference must carry zero warnings too');
  assert.equal(diff.score.health, 100);
  assert.equal(diff.score.band, 'Pass');
});

test('the summary handed to the model stays inside its budget', async (t) => {
  if (!(await chromiumAvailable())) return t.skip('playwright/chromium unavailable');
  const p = await pair();
  const summary = toSummary(diffSpec(p.spec, p.got, { mode: 'system', width: 1440 }), {});
  const bytes = Buffer.byteLength(JSON.stringify(summary));
  assert.ok(bytes < 60_000, `summary is ${bytes} bytes — the model must never receive a payload this size`);
  assert.equal(JSON.stringify(summary).includes('<div'), false);
});
