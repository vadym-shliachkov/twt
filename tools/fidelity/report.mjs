// report.mjs — renders the two human-facing outputs. Pure string building: no
// I/O, so every shape is testable without a filesystem.
//
// validation-report.md follows CONVENTIONS 12 exactly (weighted Scorecard ->
// Decisions to confirm -> Findings -> Summary). The Band it prints is
// INFORMATIONAL: the loop's stop signal is the tolerance table, never this
// score (spec 3.2). Score-chasing stays banned.
'use strict';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const LABEL = { geometry: 'Geometry', typography: 'Typography',
                structure: 'Structure', colour: 'Colour' };

function severity(row, mode) {
  if (row.status === 'fail') return 'BLOCKER';
  if (row.status === 'warn') return 'WARNING';
  return 'SUGGESTION';
}

function recommendation(row, mode) {
  if (row.snapped) {
    return mode === 'strict'
      ? `Add the exact reference value to \`tokens.css\` as a new token via /twt-design-system-define, then rebuild. Never inline the literal.`
      : `Accept the snap, or re-run with \`--mode strict\` to add the exact value to \`tokens.css\` as a token.`;
  }
  if (row.prop === 'element' && row.got === 'missing') {
    return `Add the missing element and stamp it \`data-fid="${row.id}"\`.`;
  }
  if (row.prop === 'element' && row.got === 'extra') {
    return `Remove \`${row.id}\` — it has no counterpart in the reference.`;
  }
  return `Set \`${row.prop}\` to the reference value ${JSON.stringify(row.ref)}.`;
}

// A group's per-group score AND the overall Health can both be null — "no
// comparable rows" for a group, or "nothing at all was assessed" for
// Health. Every place either value reaches the page must route through
// here: printing a bare template literal anywhere leaks the string "null"
// into a human-facing report, which reads as worse than silence (a reader
// skimming for a number will take "null" as a typo, not as "unmeasured").
const fmtHealth = (health) => (health === null ? 'not assessed' : `${health}/100`);

export function renderValidationReport(diff, meta) {
  if (!diff || meta.unverified) {
    return [
      `# Fidelity — ${meta.target}`, '',
      `**NOT VERIFIED** — ${meta.unverified || 'no measurement was taken'}.`, '',
      'No score is reported because none was measured. Supply a local or staging URL',
      'via `--url` and re-run to get a measured report.', '',
    ].join('\n');
  }

  const est = (meta.provenance?.estimated ?? 0) > 0;
  const lines = [];
  lines.push(`# Fidelity — ${meta.target}${est ? ' (ESTIMATED)' : ''}`, '');
  lines.push(`**Source:** ${meta.source.kind} \`${meta.source.ref}\`  `);
  lines.push(`**Provenance:** ${meta.provenance.measured} measured / ${meta.provenance.estimated} estimated  `);
  lines.push(`**Mode:** ${meta.mode} · **Widths:** ${meta.widths.join(', ')} · **Iteration:** ${meta.iteration}`, '');
  if (est) {
    lines.push('> Every value in this report derives from an **estimated** reference spec.',
      '> The pixel diff, not the numbers, is the arbiter here.', '');
  }

  lines.push('## Scorecard', '');
  lines.push('| Criterion | Weight | Score | Evidence |', '|---|---|---|---|');
  for (const [key, weight] of Object.entries(diff.score.weights)) {
    const n = diff.rows.filter((r) => r.group === key).length;
    const bad = diff.rows.filter((r) => r.group === key && r.status !== 'pass').length;
    // per[key] === null means the group had no comparable rows at all. It scores
    // nothing and is excluded from Health's denominator — printing a number here
    // would claim an assessment that never happened.
    const score = diff.score.per[key] === null ? '—' : diff.score.per[key];
    const evidence = n === 0
      ? 'not assessed — no comparable properties'
      : `${n - bad}/${n} properties within tolerance`;
    lines.push(`| ${LABEL[key]} | ${weight} | ${score} | ${evidence} |`);
  }
  lines.push('');
  lines.push(diff.score.health === null
    ? '**Health:** not assessed  '
    : `**Health:** ${diff.score.health}/100 _(weighted over assessed categories only)_  `);
  lines.push(`**Band:** ${diff.score.band}`, '');
  lines.push('_The Band is informational. The gate is the tolerance table, not this score._', '');
  if (meta.pixdiff?.reported) {
    lines.push(`**Pixel diff:** ${meta.pixdiff.mismatch}% of pixels differ.`, '');
  }

  lines.push('## Decisions to confirm', '');
  const snaps = diff.rows.filter((r) => r.snapped);
  if (snaps.length === 0) lines.push('_None._', '');
  else {
    for (const s of snaps) lines.push(`- \`${s.id}\` · ${s.prop} — ${s.snapped}`);
    lines.push('');
  }

  lines.push('## Findings', '');
  const rank = { fail: 0, warn: 1 };
  const findings = diff.rows.filter((r) => r.status !== 'pass')
    .sort((a, b) => rank[a.status] - rank[b.status]);
  if (findings.length === 0) lines.push('_Every measured property is within tolerance._', '');
  for (const row of findings) {
    lines.push(`### ${severity(row, meta.mode)} — \`${row.id}\` ${row.prop}`, '');
    lines.push(`**Where:** \`${row.id}\` @${row.width}${row.how === 'heuristic' ? ' (matched heuristically — unstamped)' : ''}  `);
    const d = row.delta === null ? '' : ` (Δ${row.delta}${row.unit})`;
    lines.push(`**Problem:** ${row.prop} is ${JSON.stringify(row.got)} against a reference of ${JSON.stringify(row.ref)}${d}.${row.snapped ? ` ${row.snapped}.` : ''}  `);
    lines.push(`**Recommendation:** ${recommendation(row, meta.mode)}`, '');
  }

  lines.push('## Summary', '');
  // diff.score.health can be null here (a diff whose only groups were
  // unassessed) — route it through fmtHealth rather than interpolating
  // directly, or this line prints the literal text "(null/100)".
  lines.push(`Band **${diff.score.band}** (${fmtHealth(diff.score.health)}) with ${diff.counts.fail ?? 0} failing and ${diff.counts.warn ?? 0} warning properties across ${meta.widths.length} width(s). ${findings.length ? `The largest gap is \`${findings[0].id}\` ${findings[0].prop}.` : 'Nothing exceeds tolerance.'}`, '');

  return lines.join('\n');
}

export function renderHtml(diff, meta) {
  const rows = (diff?.rows ?? []).filter((r) => r.status !== 'pass').map((r) => `
    <tr class="${esc(r.status)}">
      <td><code>${esc(r.id)}</code></td><td>${esc(r.prop)}</td>
      <td>${esc(JSON.stringify(r.ref))}</td><td>${esc(JSON.stringify(r.got))}</td>
      <td>${esc(r.delta ?? '')}${esc(r.unit)}</td><td>${esc(r.status)}</td>
      <td>${esc(r.snapped ?? '')}</td>
    </tr>`).join('');

  return `<!doctype html>
<meta charset="utf-8">
<title>Fidelity — ${esc(meta.target)}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; max-width: 1200px; }
  .shots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  .shots figure { margin: 0; } .shots img { width: 100%; border: 1px solid #ddd; }
  table { border-collapse: collapse; width: 100%; margin-top: 2rem; }
  th, td { border: 1px solid #ddd; padding: .4rem .6rem; text-align: left; }
  tr.fail { background: #fff0f0; } tr.warn { background: #fffaf0; }
</style>
<h1>Fidelity — ${esc(meta.target)}</h1>
<p>${esc(meta.provenance.measured)} measured / ${esc(meta.provenance.estimated)} estimated ·
   mode ${esc(meta.mode)} · iteration ${esc(meta.iteration)}</p>
<div class="shots">
  <figure><img src="${esc(meta.images.reference)}" alt="reference"><figcaption>Reference</figcaption></figure>
  <figure><img src="${esc(meta.images.built)}" alt="build"><figcaption>Build</figcaption></figure>
  <figure><img src="${esc(meta.images.diff)}" alt="diff"><figcaption>Diff</figcaption></figure>
</div>
<table>
  <tr><th>Element</th><th>Property</th><th>Reference</th><th>Built</th><th>Δ</th><th>Status</th><th>Snap</th></tr>
  ${rows}
</table>`;
}
