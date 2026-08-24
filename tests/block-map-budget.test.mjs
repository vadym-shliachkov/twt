import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { GRAY_CAP } from '../skills/twt-block-map/tools/block-map/identity.mjs';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../skills/twt-block-map/tools/block-map.mjs', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures/block-map-site', import.meta.url));

// ~4 chars per token is the conventional rough ratio; 15k tokens ~= 60k chars.
const BUDGET_CHARS = 60000;

// Structural no-dump defense. A literal-first-200-chars probe is evadable
// two ways (both confirmed live during task-13 review): reformatting a
// written artifact before printing it (JSON.stringify(JSON.parse(x)) is
// the SAME payload, differently whitespaced, so it never matches a
// pretty-printed file's exact prefix) and printing a SLICE of a written
// artifact starting anywhere other than byte 0 (an offset dump skips the
// probed prefix entirely). Both defeat a fixed-prefix string compare while
// reproducing exactly the failure this test exists to catch: a script
// dumping something already on disk back into model-visible stdout.
//
// Fix: normalize away insignificant JSON whitespace on BOTH sides (so
// pretty vs. compact formatting of the identical data normalizes to the
// same character stream), then scan the WHOLE of every written artifact —
// not just its first CHUNK chars — in non-overlapping CHUNK-sized windows.
// Any dump that includes a full CHUNK-aligned run of an artifact's content
// — reformatted or not, from any starting offset, of any length above
// CHUNK — necessarily contains at least one such window verbatim.
const CHUNK = 200;

// Absolute ceiling on stdout itself, independent of the substring scan
// above. The real CLI prints ~8-9 short lines, well under 1000 chars (see
// task-12 report; task-13 report re-measured 566-900 chars across engines
// and sources). 4000 chars leaves generous headroom for legitimate output
// growth while sitting far below the point where even a REFORMATTED
// (whitespace-compacted, so smaller than the pretty file on disk) artifact
// dump could hide inside the 60,000-char total budget without the
// substring scan catching it first — a second, independent gate rather
// than relying on one mechanism alone.
const STDOUT_CEILING = 4000;

function normalize(s) {
  return s.replace(/\s+/g, '');
}

// Every test in this file spawns its own temp --out dir; none were being
// cleaned up. Track and remove them after the run.
const tmpDirs = [];
function mktmp() {
  const d = mkdtempSync(join(tmpdir(), 'bm-'));
  tmpDirs.push(d);
  return d;
}
test.after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

test('stdout + summary.json + gray-band.json stay inside the token budget', async () => {
  const out = mktmp();
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static']);
  const total = stdout.length
    + readFileSync(join(out, 'summary.json'), 'utf8').length
    + readFileSync(join(out, 'gray-band.json'), 'utf8').length;
  assert.ok(total < BUDGET_CHARS, `model-visible payload was ${total} chars, budget ${BUDGET_CHARS}`);
});

test('stdout never exceeds an absolute character ceiling', async () => {
  const out = mktmp();
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static']);
  assert.ok(stdout.length < STDOUT_CEILING,
    `stdout was ${stdout.length} chars (ceiling ${STDOUT_CEILING}) — a reformatted or offset artifact dump could otherwise hide inside the wider 60,000-char budget`);
});

test('no script prints a substantial run of any written artifact to stdout, in any formatting or at any offset', async () => {
  const out = mktmp();
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static']);
  const normStdout = normalize(stdout);
  for (const f of readdirSync(out).filter((f) => f.endsWith('.json'))) {
    const normBody = normalize(readFileSync(join(out, f), 'utf8'));
    for (let i = 0; i + CHUNK <= normBody.length; i += CHUNK) {
      const chunk = normBody.slice(i, i + CHUNK);
      assert.ok(!normStdout.includes(chunk),
        `stdout contains a ${CHUNK}-char run of ${f} (normalized offset ${i}) — this is the ds-audit failure mode, and it evades both reformatting and offset tricks`);
    }
  }
});

test(`gray-band.json is capped at exactly GRAY_CAP (${GRAY_CAP}) pairs — and the official fixture genuinely exceeds it`, async () => {
  const out = mktmp();
  const { stdout } = await run('node', [TOOL, FIX, '--out', out, '--static']);
  const grayBand = JSON.parse(readFileSync(join(out, 'gray-band.json'), 'utf8'));
  assert.ok(grayBand.length <= GRAY_CAP, `gray-band.json exceeded GRAY_CAP: ${grayBand.length} > ${GRAY_CAP}`);
  // A bare `<= GRAY_CAP` check is vacuous — it passes identically whether
  // the cap is real or removed entirely (confirmed live: setting GRAY_CAP
  // to 100000 still satisfies `<=`). Prove the cap actually did something
  // on THIS run: the official 9-page fixture produces more raw gray
  // candidates (39, at time of writing) than GRAY_CAP (30), so the CLI's
  // own "N auto-split (over cap)" line must be present and positive, and
  // the emitted band must be exactly GRAY_CAP long, not merely <= it.
  const m = stdout.match(/(\d+) auto-split \(over cap\)/);
  assert.ok(m, 'expected stdout to report an over-cap count on the official fixture — if this fixture no longer exceeds GRAY_CAP, this test needs a fixture that does, or it goes vacuous again');
  assert.ok(Number(m[1]) > 0, 'the official fixture must produce MORE gray candidates than GRAY_CAP for this test to prove the cap does real work');
  assert.equal(grayBand.length, GRAY_CAP, 'once candidates exceed the cap, the emitted band must be exactly GRAY_CAP long');
});
