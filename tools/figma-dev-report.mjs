#!/usr/bin/env node
// figma-dev-report.mjs - Layer 4 of /twt-figma-dev-audit: findings.json in,
// readiness-report.md (+ .html) out.
//
// Owns the three anti-noise mechanics. Prose asking for restraint does not
// survive a 400-frame file; these do:
//   1. Confidence: Low never reaches here (the engine rejects it) - such
//      concerns arrive as decisions[] instead.
//   2. Max 5 issue blocks per category, withheld counts always stated.
//   3. Low severity never renders as an issue block - roll-up table only.
//
// Usage:
//   node tools/figma-dev-report.mjs <findings.json> --out <dir>
//   node tools/figma-dev-report.mjs --self-test
//
// Exit 2 on a missing or unreadable findings file.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { validateFinding, SEVERITIES } from './figma-dev-audit.mjs';

// Layer 3 (the model pass) writes findings.json DIRECTLY - it never goes
// through finding(), so none of the engine's guards apply to what it wrote.
// This renderer is the last reader before a client sees the report, so it
// defends the boundary it does not control, twice over:
//
//   validateFinding()  rejects the file outright (Confidence: Low, an owner
//                      outside the vocabulary, an invented category)
//   the defaults below keep a merely INCOMPLETE finding renderable instead
//                      of throwing "Cannot read properties of undefined"
//
// Both are needed: validation catches the bad file, the defaults keep a
// partially-good one useful.
const locOf = (f) => {
  const l = f.location ?? {};
  return { page: l.page ?? '', frame: l.frame ?? '', layers: l.layers ?? [] };
};

// A model-authored `severity: "Blocker"` whose `blocking` field disagreed used
// to count as a Blocker in the Summary and read "Not ready" in the matrix
// while "Blocking issues" said "None." - the most misleading state this
// report can be in.
//
// Severity is the authority and blocking follows from it, because every other
// number on the page (the Summary counts, all six matrix rows) is already
// derived from severity alone. Deriving this one from `f.blocking ?? ...`
// would only cover a MISSING field and leave the identical contradiction
// reachable through an explicit `"blocking": false` - the same broken report,
// one keystroke away. A non-Blocker may still opt in by setting the flag.
const isBlocking = (f) => f.severity === 'Blocker' || f.blocking === true;

export const ROW_CATEGORIES = {
  responsive: ['Responsive coverage', 'Auto Layout & sizing'],
  components: ['Components & code mapping'],
  states: ['States', 'Forms', 'Interaction, flows & animation'],
  assets: ['Assets & exports', 'Effects & implementation cost', 'Fonts'],
  accessibility: ['Content flexibility & a11y risk'],
  platform: ['Platform/CMS risk'],
  // 'Handoff hygiene' is deliberately absent: it measures handoff quality,
  // not build readiness. Its findings still render in the report body.
};

// The matrix keys are internal identifiers. Printing them raw made six rows of
// lowercase one-word labels that say less than the categories they aggregate -
// a reader cannot tell what "assets" or "states" was actually measured over.
export const ROW_LABELS = {
  responsive: 'Responsive & Auto Layout',
  components: 'Components & code mapping',
  states: 'States, forms & interaction',
  assets: 'Assets, effects & fonts',
  accessibility: 'Content flexibility & a11y',
  platform: 'Platform / CMS',
};

const PER_CATEGORY_CAP = 5;
const ROLLUP_EXAMPLES = 2;

export function readiness(findings) {
  const out = {};
  for (const [row, cats] of Object.entries(ROW_CATEGORIES)) {
    const mine = findings.filter((f) => cats.includes(f.category));
    const n = (s) => mine.filter((f) => f.severity === s).length;
    const blocker = n('Blocker'), high = n('High'), medium = n('Medium'), low = n('Low');
    const status = blocker >= 1 || high >= 3 ? 'Not ready'
      : high >= 1 || medium >= 3 ? 'Ready with assumptions'
      : 'Ready';
    out[row] = { status, blocker, high, medium, low };
  }
  return out;
}

// The one sentence a reader takes away if they read nothing else. Every number
// in it is already on the page - this only stops the reader having to assemble
// the verdict themselves out of a 6-row matrix and a count table.
export function verdict(findings) {
  const rows = readiness(findings);
  const notReady = Object.entries(rows).filter(([, v]) => v.status === 'Not ready');
  const assumed = Object.entries(rows).filter(([, v]) => v.status === 'Ready with assumptions');
  const blockers = findings.filter((f) => f.severity === 'Blocker').length;
  const n = (c, s) => `${c} ${s}${c === 1 ? '' : 's'}`;

  if (notReady.length) {
    return {
      status: 'Not ready',
      line: `${blockers ? n(blockers, 'blocker') : 'Severity volume'} across the file — `
        + `${n(notReady.length, 'area')} cannot be built as designed: `
        + `${notReady.map(([k]) => ROW_LABELS[k]).join(', ')}.`,
    };
  }
  if (assumed.length) {
    return {
      status: 'Ready with assumptions',
      line: `No blockers. ${n(assumed.length, 'area')} can be built only on assumptions a developer `
        + `should not be making alone: ${assumed.map(([k]) => ROW_LABELS[k]).join(', ')}.`,
    };
  }
  return { status: 'Ready', line: 'No blocking or high-severity findings — the file can be handed to development as it stands.' };
}

// How the report was produced, stated on the report.
//
// This exists because of a real run: on an 84,704-node file the scan could not
// return, the rule engine never executed, and all 24 findings were written by
// hand - and the report that came out was indistinguishable from one backed by
// a full deterministic scan. The only trace was a sentence the model had
// stuffed into --scope, where the renderer then presented it as "only pages
// and frames matching this were scanned".
//
// A degraded run is legitimate and still worth reading. Looking undegraded is
// not. So this never blocks rendering - it makes the method impossible to miss.
export function provenance(data) {
  const meta = data.meta || {};
  const findings = data.findings || [];
  const out = [];
  const measured = findings.filter((f) => f.source === 'rule').length;

  if (meta.method !== 'rule-engine') {
    out.push({ level: 'warning', text: 'The deterministic rule engine did not produce this report — '
      + 'every finding below is model judgment, not a measured scan. Coverage is therefore '
      + 'illustrative rather than exhaustive: absence of a finding is not evidence of absence.' });
  } else if (findings.length && !measured) {
    // meta says the engine ran, yet not one finding came from a rule. Either
    // the file is genuinely clean of all 18 rule conditions, or findings.json
    // was rewritten by hand over an engine-produced envelope.
    out.push({ level: 'warning', text: 'No finding in this report came from the rule engine, '
      + 'though the file claims one ran. Treat every finding below as model judgment until '
      + '`findings.json` is checked.' });
  }
  if (meta.truncated) {
    out.push({ level: 'warning', text: `The scan hit its node budget and stopped walking, so part of `
      + `the file was never examined. Re-run with a \`--scope\` limiting the audit to the frames that matter.` });
  }
  const sampling = Object.entries(meta.sampling || {});
  if (sampling.length) {
    out.push({ level: 'note', text: 'Some rules matched more nodes than the scan returned, so their '
      + 'findings are drawn from a sample: '
      + sampling.map(([rule, s]) => `${rule} matched ${s.matched.toLocaleString('en-US')} nodes, ${s.kept} sampled`).join('; ')
      + '. The counts above are the sample, not the file.' });
  }
  return out;
}

// This is not just a size limit, it is a severity priority queue: a flat
// per-category counter only keeps the right findings if, within a category,
// every Blocker is encountered before any High, before any Medium.
//
// It used to TRUST its caller for that ordering, on the grounds that the
// engine pre-sorts. But Layer 3 appends model-authored findings to the end of
// findings.json without re-sorting, so a model-authored High landing after
// five rule Mediums in one category was the one withheld while the Mediums
// rendered. The precondition is therefore removed rather than documented:
// sort here, defensively. A stable sort over four known values costs nothing
// and leaves an already-sorted array untouched.
export function applyCaps(findings) {
  const shown = [];
  const withheld = {};
  const lows = {};
  const seen = {};

  const rank = (f) => {
    const i = SEVERITIES.indexOf(f.severity);
    return i < 0 ? SEVERITIES.length : i;   // unknown severity sorts last
  };
  const ordered = [...findings].sort((a, b) => rank(a) - rank(b));

  for (const f of ordered) {
    if (f.severity === 'Low') {
      if (!lows[f.category]) lows[f.category] = { count: 0, examples: [] };
      lows[f.category].count += 1;
      if (lows[f.category].examples.length < ROLLUP_EXAMPLES) lows[f.category].examples.push(f);
      continue;
    }
    seen[f.category] = (seen[f.category] || 0) + 1;
    if (seen[f.category] <= PER_CATEGORY_CAP) shown.push(f);
    else withheld[f.category] = (withheld[f.category] || 0) + 1;
  }
  return { shown, withheld, lows };
}

// Field order is the reading order, and the reading order is a priority order:
// what is wrong (title) -> how bad (severity) -> why it costs you (impact) ->
// what to do (action) -> the evidence and bookkeeping that back it up.
//
// The old block listed all seven fields as one flat bullet list, so "Category:
// Fonts" carried the same visual weight as the paragraph explaining that the
// build cannot start. Impact and action are the only two lines most readers
// need, so they lead and the rest recedes below them.
const block = (f) => {
  const loc = locOf(f);
  // A file-level finding (FN002 counts fonts across the whole file) has no
  // page, no frame and no layers. Printing " / " with a link to nowhere
  // reads as a broken report; state "whole file" and carry what link there is.
  const where = loc.page
    ? `${loc.page} / ${loc.frame}${loc.layers.length ? ` / ${loc.layers.join(', ')}` : ''}`
    : 'whole file';
  return [
    `#### ${f.title}`,
    '',
    `**${f.severity}** · ${f.category}`,
    '',
    `**Impact —** ${f.impact || '_not yet assessed_'}`,
    '',
    `**Do this —** ${f.action || '_not yet assessed_'}`,
    '',
    `- **Where:** ${where}${f.link ? ` — [open in Figma](${f.link})` : ''}`,
    `- **Detected:** ${f.detected}`,
    `- **Owner:** ${f.owner}  ·  **Confidence:** ${f.confidence}  ·  **Blocking:** ${isBlocking(f) ? 'Yes' : 'No'}`,
    '',
  ].join('\n');
};

export function renderMarkdown(data) {
  const { meta, findings, decisions } = data;
  const { shown, withheld, lows } = applyCaps(findings);
  const rows = readiness(findings);
  const count = (s) => findings.filter((f) => f.severity === s).length;
  const L = [];

  L.push(`# Developer readiness — ${meta.file}`, '');
  L.push(`Platform: **${meta.platform}** · Scanned: ${meta.scannedAt} · ${meta.frameCount} frames, ${meta.nodeCount} nodes`, '');
  // A scoped report covers part of the file. Saying so in the header is the
  // only thing standing between it and being read as a whole-file verdict.
  // Backticks around a short scope expression read as code; around a
  // paragraph of model-authored method notes they read as an unbroken wall.
  if (meta.scope) {
    const raw = String(meta.scope).replace(/[.;,\s]+$/, '');
    const s = raw.length <= 60 ? `\`${raw}\`` : raw;
    L.push(`**Scope:** ${s} — only pages and frames matching this were scanned; the rest of the file is not covered by this report.`, '');
  }
  L.push(meta.dsAuditReport
    ? `Related: design-system findings live in \`${meta.dsAuditReport}\` and are not repeated here.`
    : 'There is no design-system audit on record — token, colour and spacing-consistency findings are out of scope for this report. Run `/twt-design-system-audit` for those.');
  L.push('');

  const v = verdict(findings);
  L.push(`## Verdict: ${v.status}`, '', v.line, '');
  for (const n of provenance(data)) {
    L.push(`> **${n.level === 'warning' ? 'Method warning' : 'Method note'}:** ${n.text}`, '');
  }

  L.push('## Summary', '');
  L.push('| | Count |', '|---|---|');
  L.push(`| Total issues | ${findings.length} |`);
  L.push(`| Blockers | ${count('Blocker')} |`);
  L.push(`| High | ${count('High')} |`);
  L.push(`| Medium | ${count('Medium')} |`);
  L.push(`| Low | ${count('Low')} |`);
  L.push(`| Decisions required | ${decisions.length} |`, '');

  L.push('## Development readiness', '');
  L.push('| Area | Status | Blocker | High | Medium | Low |', '|---|---|---|---|---|---|');
  for (const [row, r] of Object.entries(rows)) {
    L.push(`| ${ROW_LABELS[row]} | **${r.status}** | ${r.blocker} | ${r.high} | ${r.medium} | ${r.low} |`);
  }
  L.push('', '_Handoff hygiene is excluded from this matrix — it measures handoff quality, not build readiness._', '');

  L.push('## Blocking issues', '');
  const blockers = shown.filter(isBlocking);
  L.push(blockers.length ? blockers.map(block).join('\n') : '_None._');
  L.push('');

  L.push('## Decisions required', '');
  if (!decisions.length) L.push('_None._');
  for (const d of decisions) {
    L.push(`- **${d.question}**`, `  - Why it cannot be answered from the file: ${d.why}`, `  - Owner: ${d.owner}`);
  }
  L.push('');

  L.push('## All issues', '');
  const shownNonBlocking = shown.filter((f) => !isBlocking(f));
  // Categories to render: every category with a shown non-blocking finding,
  // PLUS every category with a withheld count - even if every shown finding
  // in that category was a Blocker (already printed above) or the cap was
  // consumed entirely by higher-severity findings. Without the second half
  // of this union, a category whose cap overflow happened to be Blockers
  // (e.g. 6 Blockers, cap 5) would have its withheld count computed but
  // never printed anywhere: it doesn't appear in "Blocking issues" (that
  // section has no withheld notice of its own) and it wouldn't appear here
  // either, because the old code only visited categories that had a shown
  // *non-blocking* finding to key off. That silently truncates a Blocker
  // with no count stated, which is exactly what this report must never do.
  const cats = [...new Set([...shownNonBlocking.map((f) => f.category), ...Object.keys(withheld)])];
  if (!cats.length) L.push('_None._');
  for (const cat of cats) {
    L.push(`### ${cat}`, '');
    const items = shownNonBlocking.filter((x) => x.category === cat);
    if (items.length) {
      for (const f of items) L.push(block(f));
    } else {
      L.push('_All shown issues in this category are Blockers — see Blocking issues above._', '');
    }
    if (withheld[cat]) {
      L.push(`_${withheld[cat]} further ${cat} issue(s) withheld by the per-category cap — the complete set is in \`findings.json\`._`, '');
    }
  }

  if (Object.keys(lows).length) {
    L.push('## Low-severity roll-up', '');
    L.push('| Category | Count | Examples |', '|---|---|---|');
    for (const [cat, v] of Object.entries(lows)) {
      const ex = v.examples
        .map((f) => `[${locOf(f).layers[0] || f.nodeIds?.[0] || f.title}](${f.link || ''})`).join(', ');
      L.push(`| ${cat} | ${v.count} | ${ex} |`);
    }
    L.push('', '_Complete list in `findings.json`._', '');
  }

  return L.join('\n');
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

// slug() drops digits, which is right for a CSS class ("not-ready") and wrong
// for an element id: "MODEL-hygiene-1" and "MODEL-hygiene-2" would collide on
// the same anchor and one of the two links would land on the wrong finding.
const anchor = (s) => `f-${String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

// Three things this stylesheet is doing on purpose, because a flat report of 24
// findings is unreadable and the first version of this page was exactly that:
//
//  1. WEIGHT FOLLOWS IMPORTANCE. Title and impact are ink at full size; the
//     recommended action sits in a tinted band; evidence, location, owner and
//     confidence are small and muted. Nothing is hidden - it is ranked.
//  2. SEVERITY IS NEVER COLOUR ALONE. Every severity cue is a pill carrying the
//     word, tinted from the fixed status palette; the number in a stat tile
//     stays ink and a coloured rule beside it carries identity. That survives
//     colour-blindness, greyscale printing and forced-colors.
//  3. A SCREENSHOT IS A THUMBNAIL, NOT A PANEL. get_screenshot returns the
//     node's full render bounds, and on a frame that overflows its own height
//     that is mostly empty canvas - a 651x900 capture whose content stops 40%
//     down used to reserve 900px of page. Capped at 280px and made clickable,
//     the full-resolution file is one click away and costs no vertical space.
const CSS = `
:root{--bg:#fff;--fg:#16181d;--mut:#5c6470;--faint:#8b939f;--line:#e3e6ea;
--card:#fbfbfc;--sunk:#f2f4f7;--accent:#1f5fbf;
--critical:#d03b3b;--serious:#ec835a;--warning:#fab219;--good:#0ca30c;--none:#8b939f;
--tint:12%}
@media(prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8eaed;--mut:#a4adb9;
--faint:#7b848f;--line:#2a2e35;--card:#191c21;--sunk:#22262d;--accent:#7fb0ff;--tint:20%}}
*{box-sizing:border-box}
body{margin:0;padding:2.25rem 1.25rem 5rem;background:var(--bg);color:var(--fg);
font:15px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
-webkit-font-smoothing:antialiased}
main{max-width:62rem;margin:0 auto}
h1{font-size:1.75rem;line-height:1.25;margin:0 0 .4rem;letter-spacing:-.01em}
h2{font-size:.82rem;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);
font-weight:700;margin:3rem 0 .9rem;padding-bottom:.45rem;border-bottom:1px solid var(--line)}
h3{font-size:1.02rem;font-weight:650;margin:2rem 0 .7rem;letter-spacing:-.005em}
h3 .n{font-weight:400;color:var(--faint);font-size:.86rem}
h4{font-size:1.06rem;line-height:1.35;font-weight:650;margin:.15rem 0 .55rem;letter-spacing:-.005em}
p{margin:0 0 .7rem}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.head{color:var(--mut);font-size:.86rem;margin:0 0 1.1rem}
.head strong{color:var(--fg)}
.callout{background:var(--sunk);border-left:3px solid var(--faint);border-radius:0 5px 5px 0;
padding:.7rem .9rem;font-size:.86rem;color:var(--mut);margin:0 0 .9rem}
.callout strong{color:var(--fg)}
.callout.warning{border-left-color:var(--critical);color:var(--fg);
background:color-mix(in srgb,var(--critical) 7%,var(--sunk))}
.callout.note{border-left-color:var(--warning)}
.callout code{font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.95em}

/* verdict - the one line a reader takes away */
.verdict{display:flex;gap:.85rem;align-items:flex-start;border:1px solid var(--line);
border-left:4px solid var(--none);border-radius:8px;padding:1rem 1.1rem;background:var(--card);margin:0 0 .4rem}
.verdict.not-ready{border-left-color:var(--critical);background:color-mix(in srgb,var(--critical) 6%,var(--card))}
.verdict.ready-with-assumptions{border-left-color:var(--warning);background:color-mix(in srgb,var(--warning) 8%,var(--card))}
.verdict.ready{border-left-color:var(--good);background:color-mix(in srgb,var(--good) 6%,var(--card))}
.verdict .vt{font-size:1.15rem;font-weight:700;letter-spacing:-.01em;white-space:nowrap}
.verdict .vl{color:var(--mut);font-size:.92rem;margin:.15rem 0 0}
@media(max-width:640px){.verdict{flex-direction:column;gap:.3rem}}

/* stat tiles - label + ink value, a coloured rule carries the severity */
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:.6rem;margin:0 0 1rem}
.tile{border:1px solid var(--line);border-radius:8px;padding:.7rem .8rem .75rem;background:var(--card)}
.tile .k{display:block;font-size:.75rem;color:var(--mut);letter-spacing:.02em}
.tile .v{display:block;font-size:1.7rem;font-weight:650;line-height:1.15;margin-top:.15rem}
.tile .rule{display:block;width:1.6rem;height:3px;border-radius:2px;background:var(--none);margin:.4rem 0 0}
.tile.critical .rule{background:var(--critical)}.tile.serious .rule{background:var(--serious)}
.tile.warning .rule{background:var(--warning)}.tile.good .rule{background:var(--good)}
.tile.zero .v{color:var(--faint)}

table{width:100%;border-collapse:collapse;margin:.2rem 0 .8rem;font-size:.9rem}
.scroll{overflow-x:auto}
th,td{text-align:left;padding:.55rem .65rem;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;
white-space:nowrap}
td.num{text-align:right;font-variant-numeric:tabular-nums;width:4.5rem}
td.num.z{color:var(--faint)}
tbody tr:last-child td{border-bottom:0}
.q{font-weight:600}

/* pills - the word is always present, the tint only reinforces it */
.pill{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.04em;
text-transform:uppercase;padding:.15rem .5rem;border-radius:999px;white-space:nowrap;
background:var(--sunk);color:var(--mut);border:1px solid transparent}
.pill.critical{background:color-mix(in srgb,var(--critical) var(--tint),transparent);
color:var(--critical);border-color:color-mix(in srgb,var(--critical) 35%,transparent)}
.pill.serious{background:color-mix(in srgb,var(--serious) var(--tint),transparent);
color:color-mix(in srgb,var(--serious) 80%,var(--fg));border-color:color-mix(in srgb,var(--serious) 40%,transparent)}
.pill.warning{background:color-mix(in srgb,var(--warning) var(--tint),transparent);
color:color-mix(in srgb,var(--warning) 65%,var(--fg));border-color:color-mix(in srgb,var(--warning) 45%,transparent)}
.pill.good{background:color-mix(in srgb,var(--good) var(--tint),transparent);
color:color-mix(in srgb,var(--good) 75%,var(--fg));border-color:color-mix(in srgb,var(--good) 35%,transparent)}

/* issue card */
.issue{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--none);
border-radius:8px;padding:1rem 1.1rem 1.05rem;margin:0 0 .9rem}
.issue.blocker{border-left-color:var(--critical)}
.issue.high{border-left-color:var(--serious)}
.issue.medium{border-left-color:var(--warning)}
.issue-top{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:.35rem}
.issue-top .cat{font-size:.78rem;color:var(--mut)}
.issue-top .go{margin-left:auto;font-size:.8rem;font-weight:600;white-space:nowrap}
.impact{font-size:.97rem;color:var(--fg);margin:0 0 .7rem;max-width:64ch}
.do{background:var(--sunk);border-radius:6px;padding:.6rem .75rem;font-size:.9rem;margin:0 0 .75rem}
.do b{display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;
color:var(--mut);margin-bottom:.15rem}
.ev{display:grid;grid-template-columns:1fr auto;gap:1rem;align-items:start}
@media(max-width:640px){.ev{grid-template-columns:1fr}}
.ev p{font-size:.83rem;color:var(--mut);margin:0 0 .35rem;max-width:78ch}
.ev .lbl{color:var(--faint);font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;
font-weight:700;margin-right:.35rem}
.foot{font-size:.76rem;color:var(--faint);margin:.6rem 0 0;padding-top:.55rem;
border-top:1px solid var(--line)}

/* screenshot thumbnail - a fixed 200x150 window onto the TOP of the capture,
   because get_screenshot returns the node's whole render bounds and on an
   overflowing frame the lower half of that is empty canvas. Cropping to the
   top shows the part that carries the evidence; the untouched full-size file
   is one click away. */
.shot{margin:0;width:200px}
.shot a{display:block;width:200px;height:150px;overflow:hidden;border:1px solid var(--line);
border-radius:5px;background:var(--sunk)}
.shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
.shot figcaption{font-size:.72rem;color:var(--faint);margin-top:.3rem;text-align:right}
@media(max-width:640px){.shot,.shot a{width:100%}}

.none{color:var(--faint);font-style:italic}
@media print{body{padding:0}.issue{break-inside:avoid}.shot img{max-height:200px}}
`;

// f.shot is model-written, so it is checked rather than trusted: only a
// relative path inside the report's own shots/ directory renders. Anything
// else (an absolute path, a remote URL, a traversal) is dropped - this page
// is handed to clients and must make no external request.
const shotSrc = (f) => (typeof f.shot === 'string' && f.shot.startsWith('shots/') && !f.shot.includes('..')
  ? f.shot : null);

// Every Figma link leaves for a new tab. The report is the reader's place in a
// 24-finding review; navigating it away to Figma and making them come back with
// the browser's Back button loses their scroll position and any open detail.
const NEWTAB = 'target="_blank" rel="noopener"';

const SEV_TONE = { Blocker: 'critical', High: 'serious', Medium: 'warning', Low: '' };

const issueHtml = (f) => {
  const loc = locOf(f);
  const shot = shotSrc(f);
  const where = loc.page
    ? `${esc(loc.page)} / ${esc(loc.frame)}${loc.layers.length ? ' / ' + esc(loc.layers.join(', ')) : ''}`
    : 'whole file';
  // Reading order = priority order. Severity and title answer "what is wrong",
  // impact answers "why do I care", the action band answers "what do I do" -
  // those three carry the card. Evidence, location, owner and confidence are
  // the audit trail: present, checkable, and visibly subordinate.
  return `
<article class="issue ${slug(f.severity)}" id="${esc(anchor(f.id || f.title))}">
  <div class="issue-top">
    <span class="pill ${SEV_TONE[f.severity] || ''}">${esc(f.severity)}</span>
    <span class="cat">${esc(f.category)}</span>
    ${f.link ? `<a class="go" href="${esc(f.link)}" ${NEWTAB}>Open in Figma &#8599;</a>` : ''}
  </div>
  <h4>${esc(f.title)}</h4>
  <p class="impact">${esc(f.impact || 'Impact not yet assessed.')}</p>
  <div class="do"><b>Do this</b>${esc(f.action || 'No action recorded.')}</div>
  <div class="ev">
    <div>
      <p><span class="lbl">Detected</span>${esc(f.detected)}</p>
      <p><span class="lbl">Where</span>${where}</p>
    </div>
    ${shot ? `<figure class="shot"><a href="${esc(shot)}" ${NEWTAB}><img src="${esc(shot)}" alt="${esc(f.title)} in context" loading="lazy"></a><figcaption>Full size &#8599;</figcaption></figure>` : ''}
  </div>
  <p class="foot">Owner ${esc(f.owner)} &middot; Confidence ${esc(f.confidence)} &middot; Blocking: ${isBlocking(f) ? 'Yes' : 'No'}</p>
</article>`;
};

const tile = (k, v, tone) =>
  `<div class="tile ${tone}${v ? '' : ' zero'}"><span class="k">${esc(k)}</span><span class="v">${v}</span><span class="rule"></span></div>`;

export function renderHtml(data) {
  const { meta, findings, decisions } = data;
  const { shown, withheld, lows } = applyCaps(findings);
  const rows = readiness(findings);
  const count = (s) => findings.filter((f) => f.severity === s).length;
  const blockers = shown.filter(isBlocking);
  const rest = shown.filter((f) => !isBlocking(f));
  // Union with withheld's keys - see the matching comment in renderMarkdown:
  // a category whose cap overflow is entirely Blockers has no shown
  // non-blocking finding to key off, so without this union its withheld
  // count would never be printed anywhere in the page.
  const cats = [...new Set([...rest.map((f) => f.category), ...Object.keys(withheld)])];

  const v = verdict(findings);
  const STATUS_TONE = { 'Not ready': 'critical', 'Ready with assumptions': 'warning', Ready: 'good' };
  const num = (n) => `<td class="num${n ? '' : ' z'}">${n}</td>`;
  // A scope expression ("Pricing") reads as code; a paragraph of prose - which
  // is what a model-authored scope note usually is - does not, and setting it
  // in monospace makes the most important caveat on the page the hardest line
  // to read.
  // Trailing punctuation, then an em-dash clause, reads as two broken
  // sentences - a scope value is often a list that ends in a full stop.
  const scopeRaw = String(meta.scope || '').replace(/[.;,\s]+$/, '');
  const scopeText = meta.scope && (scopeRaw.length <= 60
    ? `<code>${esc(scopeRaw)}</code>` : esc(scopeRaw));

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Developer readiness — ${esc(meta.file)}</title>
<style>${CSS}</style></head><body><main>
<h1>Developer readiness — ${esc(meta.file)}</h1>
<p class="head">Platform <strong>${esc(meta.platform)}</strong> &middot; scanned ${esc(meta.scannedAt)} &middot; ${meta.frameCount} frames, ${meta.nodeCount} nodes</p>

<div class="verdict ${slug(v.status)}">
  <span class="vt">${esc(v.status)}</span>
  <p class="vl">${esc(v.line)}</p>
</div>
${provenance(data).map((n) => `<p class="callout ${n.level}"><strong>${n.level === 'warning' ? 'Method warning' : 'Method note'}:</strong> ${esc(n.text)}</p>`).join('')}

<h2>Summary</h2>
<div class="tiles">
${tile('Total issues', findings.length, '')}
${tile('Blockers', count('Blocker'), 'critical')}
${tile('High', count('High'), 'serious')}
${tile('Medium', count('Medium'), 'warning')}
${tile('Low', count('Low'), '')}
${tile('Decisions', decisions.length, '')}
</div>
${meta.scope ? `<p class="callout"><strong>Scope:</strong> ${scopeText} &mdash; only pages and frames matching this were scanned; the rest of the file is not covered by this report.</p>` : ''}
<p class="callout">${meta.dsAuditReport
  ? `Related: design-system findings live in <code>${esc(meta.dsAuditReport)}</code> and are not repeated here.`
  : 'There is no design-system audit on record — token, colour and spacing-consistency findings are out of scope for this report.'}</p>

<h2>Development readiness</h2>
<div class="scroll"><table><thead><tr><th>Area</th><th>Status</th><th class="num">Blocker</th><th class="num">High</th><th class="num">Medium</th><th class="num">Low</th></tr></thead><tbody>
${Object.entries(rows).map(([row, r]) => `<tr id="row-${esc(row)}"><td>${esc(ROW_LABELS[row])}</td><td class="status ${slug(r.status)}"><span class="pill ${STATUS_TONE[r.status]}">${esc(r.status)}</span></td>${num(r.blocker)}${num(r.high)}${num(r.medium)}${num(r.low)}</tr>`).join('')}
</tbody></table></div>
<p class="callout">Handoff hygiene is excluded from this matrix — it measures handoff quality, not build readiness. Its findings still appear below.</p>

<h2>Blocking issues</h2>
${blockers.length ? blockers.map(issueHtml).join('') : '<p class="none">None.</p>'}

<h2>Decisions required</h2>
${decisions.length ? `<div class="scroll"><table><thead><tr><th>Question</th><th>Why it is not in the file</th><th>Owner</th></tr></thead><tbody>
${decisions.map((d) => `<tr><td class="q">${esc(d.question)}</td><td>${esc(d.why)}</td><td>${esc(d.owner)}</td></tr>`).join('')}</tbody></table></div>`
  : '<p class="none">None.</p>'}

<h2>All issues</h2>
${cats.length ? cats.map((cat) => {
  const items = rest.filter((f) => f.category === cat);
  return `<h3>${esc(cat)} <span class="n">${items.length}${withheld[cat] ? ` shown, ${withheld[cat]} withheld` : ''}</span></h3>${items.map(issueHtml).join('')}${withheld[cat] ? `<p class="callout">${withheld[cat]} further ${esc(cat)} issue(s) withheld by the per-category cap — complete set in <code>findings.json</code>.</p>` : ''}`;
}).join('')
  : '<p class="none">None.</p>'}

${Object.keys(lows).length ? `<h2>Low-severity roll-up</h2>
<div class="scroll"><table><thead><tr><th>Category</th><th class="num">Count</th><th>Examples</th></tr></thead><tbody>
${Object.entries(lows).map(([cat, l]) => `<tr><td>${esc(cat)}</td>${num(l.count)}<td>${l.examples.map((f) => (f.link ? `<a href="${esc(f.link)}" ${NEWTAB}>${esc(locOf(f).layers[0] || f.nodeIds?.[0] || f.title)}</a>` : esc(locOf(f).layers[0] || f.nodeIds?.[0] || f.title))).join(', ')}</td></tr>`).join('')}
</tbody></table></div><p class="callout">Complete list in <code>findings.json</code>.</p>` : ''}
</main></body></html>`;
}

function runSelfTest() {
  const r = readiness([{ category: 'Responsive coverage', severity: 'Blocker' }]);
  assert.equal(r.responsive.status, 'Not ready');
  assert.equal(r.components.status, 'Ready');
  assert.equal(Object.keys(r).length, 6);

  const many = Array.from({ length: 9 }, (_, i) => ({
    id: `X-${i}`, category: 'Auto Layout & sizing', severity: 'Medium',
  }));
  const caps = applyCaps(many);
  assert.equal(caps.shown.length, 5);
  assert.equal(caps.withheld['Auto Layout & sizing'], 4);

  const lowOnly = applyCaps([{ id: 'a', category: 'Handoff hygiene', severity: 'Low' }]);
  assert.equal(lowOnly.shown.length, 0);
  assert.equal(lowOnly.lows['Handoff hygiene'].count, 1);

  const html = renderHtml({
    meta: { file: 'T', url: '', platform: 'web', scannedAt: 'now', dsAuditReport: null,
            nodeCount: 1, frameCount: 1 },
    findings: [], decisions: [],
  });
  assert.match(html, /<!doctype html>/i);
  assert.doesNotMatch(html, /<script\s+src=/i);
  console.log('figma-dev-report self-test: OK');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return runSelfTest();

  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? argv[outIdx + 1] : null;
  const src = argv.find((a) => !a.startsWith('--') && a !== outDir);
  if (!src || !outDir) {
    console.error('usage: node tools/figma-dev-report.mjs <findings.json> --out <dir>');
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(src, 'utf8'));
  } catch (e) {
    console.error(`cannot read findings file ${src}: ${e.message}`);
    process.exit(2);
  }

  // The last gate before a client reads this. Layer 3 wrote straight into
  // findings.json without passing finding(), so "Confidence: Low is never a
  // finding" - the property this whole feature exists to hold - is only
  // actually enforced if it is checked HERE. Fail loudly and name the
  // finding; do not render a report that quietly launders a guess.
  for (const f of data.findings || []) {
    try {
      validateFinding(f);
    } catch (e) {
      console.error(`invalid finding in ${src}: ${e.message}`);
      console.error('Confidence: Low is never a finding - move it to decisions[] as a question.');
      process.exit(2);
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'readiness-report.md'), renderMarkdown(data), 'utf8');
  writeFileSync(join(outDir, 'readiness-report.html'), renderHtml(data), 'utf8');
  console.log(`wrote ${join(outDir, 'readiness-report.md')} and readiness-report.html`);
}

if (process.argv[1]?.endsWith('figma-dev-report.mjs')) main();
