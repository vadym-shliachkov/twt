// tools/launch-audit/scan/content.mjs — category 1, the mechanical half.
//
// The approval half (has the client signed off?) is Layer A + the interview;
// this module only answers "is there still placeholder text in the build".
// BOUNDARY: /twt-qa-content owns lorem detection for the QA verdict. Here the
// same signal is re-measured, because a launch verdict must not depend on
// whether QA happened to have run.
//
// NO MECHANICAL RECONCILIATION HAPPENS, and this comment used to claim one:
// "every finding derived from it is reconciled against gaps.md in the report,
// never double-listed". It was never implemented — nothing in the repo so much
// as matched /reconcil/ outside that sentence. It is also not implementable at
// this layer: HARV002 and HARV003 CITE qa-report.md and gaps.md as counts
// ("3 unresolved BLOCKERs", "5 open items"), and gaps.md's items are free
// prose with no file, no line, and no schema — there is no key on which a
// citation and a scanner finding could be matched. So one leftover lorem block
// really can surface three times: CONT001 (here, with the file and line),
// HARV002 (cited from qa-report.md) and HARV003 (cited from gaps.md).
//
// Reconciling them is therefore the model's job, and the command file now says
// so explicitly in Step 6 rather than a code comment asserting an automation
// that does not exist. A false promise of de-duplication is worse than an
// honest statement of the overlap: the promise stops anyone from looking.
const LOREM = /\b(lorem ipsum|dolor sit amet|consectetur adipiscing)\b/i;
const MARKER = /\b(TODO|FIXME|XXX|TBD|PLACEHOLDER|LOREM)\b/;
const TAGS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
// Two lorem-phrase matches are the same placeholder block iff everything
// between them is punctuation/whitespace ("amet, consectetur", "amet\n\n<p>"
// is NOT ok because it crosses a tag) — content-aware, not a length guess.
const GAP_OK = /^[\s,.;:!?'"-]*$/;

export function run(ctx) {
  const counts = { lorem_blocks: 0, placeholder_markers: 0, empty_headings: 0, empty_slots: 0 };
  const findings = [];
  for (const f of ctx.html) {
    const src = ctx.read(f);
    // Blank script/style bodies char-by-char, leaving embedded newlines in
    // place, so a JS "TODO" comment in a vendored library is not reported as
    // missing page copy — while every OTHER finding's line number still maps
    // to the real source line (blanking whole lines out would corrupt it).
    const prose = src.replace(TAGS, (m) => m.replace(/[^\n]/g, ' '));
    const file = ctx.rel(f);

    // A single lorem-ipsum paragraph typically contains several of these
    // phrases back to back ("Lorem ipsum dolor sit amet, consectetur
    // adipiscing…"); adjacent hits separated only by whitespace/punctuation
    // are one placeholder block, not one finding per phrase.
    let loremBlock = null;
    for (const m of prose.matchAll(new RegExp(LOREM.source, 'gi'))) {
      if (loremBlock && GAP_OK.test(prose.slice(loremBlock.end, m.index))) {
        loremBlock.end = m.index + m[0].length;
        continue;
      }
      if (loremBlock) {
        counts.lorem_blocks++;
        findings.push({ kind: 'lorem', file, line: ctx.lineOf(prose, loremBlock.index), detail: loremBlock.text });
      }
      loremBlock = { index: m.index, end: m.index + m[0].length, text: m[0] };
    }
    if (loremBlock) {
      counts.lorem_blocks++;
      findings.push({ kind: 'lorem', file, line: ctx.lineOf(prose, loremBlock.index), detail: loremBlock.text });
    }
    for (const m of prose.matchAll(new RegExp(MARKER.source, 'g'))) {
      // A LOREM marker already counted as a lorem block is not a second problem.
      if (/lorem/i.test(m[0])) continue;
      counts.placeholder_markers++;
      findings.push({ kind: 'placeholder_marker', file, line: ctx.lineOf(prose, m.index), detail: m[0] });
    }
    for (const m of prose.matchAll(/<(h[1-6])\b[^>]*>\s*<\/\1>/gi)) {
      counts.empty_headings++;
      findings.push({ kind: 'empty_heading', file, line: ctx.lineOf(prose, m.index), detail: `empty <${m[1]}>` });
    }
    for (const m of prose.matchAll(/<(p|li|td)\b[^>]*>\s*<\/\1>/gi)) {
      counts.empty_slots++;
      findings.push({ kind: 'empty_slot', file, line: ctx.lineOf(prose, m.index), detail: `empty <${m[1]}>` });
    }
  }
  return { counts, findings };
}
