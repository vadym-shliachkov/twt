// report.mjs — render run.json into the human-facing report.
//
// The fidelity header leads because a verdict cannot be read correctly without
// it: for an orchestrator, a dispatch FAIL under injection may mean "the
// orchestrator is broken" or "your edited parent is driving children three
// versions old" (spec §6, §9.6).
const STOP_MEANING = {
  'converged-pass': 'every criterion passed, including at least one not self-declared by the skill.',
  'converged-pass-weak': 'every criterion passed, but ALL of them were self-declared by the skill itself — this is a weak result (spec §9.3).',
  'no-progress': 'the verdict map was identical two iterations running; the loop was thrashing and stopped early.',
  'iteration-cap': 'cap reached with failures outstanding.',
  'invalid-dispatch-cap': 'the runner called the Skill tool for the tested skill (or another twt: skill) 3 times running, despite the injected prompt explicitly forbidding it. The run was aborted rather than looping indefinitely — this is a finding about the runner, not about the skill under test.',
};

export function renderReport(run, { criteria }) {
  const L = [];
  const iters = run.iterations;

  L.push(`# /twt-skill-test — ${run.skill}`, '');
  L.push('```');
  L.push(`dispatch-fidelity: ${run.dispatchFidelity} (working tree)`);
  L.push(`sub-skills resolved from: cache/twt-marketplace/twt/${run.pluginCacheVersion}`);
  L.push(`\${CLAUDE_PLUGIN_ROOT} substitutions: ${run.substitutions}`);
  L.push(`criteria: ${run.criteriaHash}`);
  L.push(`target: ${run.target}`);
  L.push('```', '');

  L.push(`**Stop reason:** \`${run.stopReason}\` — ${STOP_MEANING[run.stopReason] || 'unknown.'}`, '');

  L.push('## Verdicts', '');
  L.push(`| Criterion | Dimension | ${iters.map(i => `it.${i.n}`).join(' | ')} |`);
  L.push(`|---|---|${iters.map(() => '---').join('|')}|`);
  for (const c of criteria) {
    const label = c.selfDeclared ? `${c.id} (self-declared)` : c.id;
    const cells = iters.map(i => i.verdicts[c.id] ?? '—');
    L.push(`| ${label} | ${c.dimension} | ${cells.join(' | ')} |`);
  }
  L.push('');

  const withFixes = iters.filter(i => i.fixes.length);
  L.push('## Fixes applied', '');
  if (!withFixes.length) L.push('None — this was a report-only run, or no fix was attempted.', '');
  for (const i of withFixes) {
    L.push(`**Iteration ${i.n}:**`);
    for (const f of i.fixes) L.push(`- \`${f}\``);
    L.push('');
  }

  L.push('## Landing', '');
  if (run.commit) {
    L.push(`Committed locally as \`${run.commit}\`. It has **not been pushed** and will not be — \`/twt-skill-test\` has no push flag (spec §2.3).`);
    L.push('Until you push, the **installed plugin still runs the older version**: this fix does not reach your other sessions.', '');
  } else if (run.startTreeClean === false) {
    L.push('No commit was made — the working tree was already dirty when the run started.', '');
  } else {
    L.push('No commit was made — no fixes were applied.', '');
  }

  L.push('## Known limitations of this verdict', '');
  L.push('- The blind grader is prompt-blinded, not sandboxed (spec §9.1).');
  L.push('- Sub-skills resolved to the cached plugin copy, not the working tree (spec §9.6).');
  L.push('- Invalid-dispatch detection relies on the runner\'s own self-report plus a side-channel check of this repo\'s own artifact tree — it can miss a runner that consulted the cached plugin copy while still completing the injected instructions.');
  L.push('');

  return L.join('\n');
}
