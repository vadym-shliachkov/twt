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
  'continue': 'the run ended before reaching a final verdict — either it is still in progress, or this loop\'s own iteration bound (not `converged()`\'s cap) is what stopped it: an invalid-dispatch iteration can leave the VALID iteration count under the cap even at the last attempted iteration, so `converged()` legitimately reports `continue` with no iterations left to spend.',
  'criteria-drift': 'the criteria file changed after being frozen for this run (spec §4.3) — the run was aborted rather than grading against a rubric that moved mid-loop. Re-run after deciding, separately and deliberately, whether the rubric change was intended.',
};

export function renderReport(run, { criteria }) {
  const L = [];
  const iters = run.iterations;

  L.push(`# /twt-skill-test — ${run.skill}`, '');
  L.push('```');
  L.push(`dispatch-fidelity: ${run.dispatchFidelity} (working tree)`);
  L.push(`sub-skills resolved from: cache/twt-marketplace/twt/${run.pluginCacheVersion}`);
  L.push(`\${CLAUDE_PLUGIN_ROOT} substitutions: ${run.substitutions}`);
  // Per-iteration, not just the latest overwritten scalar above — a body
  // whose substitution count changes between iterations (e.g. a fix adds or
  // removes a reference) is worth noticing, and the scalar alone erases it
  // (spec §5.1 step 2).
  const subsByIter = run.substitutionsByIteration || {};
  const subKeys = Object.keys(subsByIter);
  L.push(`\${CLAUDE_PLUGIN_ROOT} substitutions per iteration: ${
    subKeys.length ? subKeys.map(n => `it.${n}=${subsByIter[n]}`).join(', ') : '(not recorded)'
  }`);
  L.push(`criteria: ${run.criteriaHash}`);
  L.push(`target: ${run.target}`);
  L.push('```', '');

  // A run inspected before its first `ledger` call (or one that died before
  // one) has stopReason === null from initRun — that is a real, explainable
  // state, not an "unknown" stop reason someone forgot to document.
  const stopReason = run.stopReason;
  const stopMeaning = stopReason == null
    ? 'no iteration has completed yet — this run stopped (or is being inspected) before its first `ledger` call.'
    : (STOP_MEANING[stopReason] || 'unknown.');
  L.push(`**Stop reason:** \`${stopReason}\` — ${stopMeaning}`, '');

  L.push('## Verdicts', '');
  // Header/separator/row cells are built as one array per row so a zero-
  // iteration run (columns = just Criterion/Dimension) never emits a
  // trailing empty delimiter cell (`|---|---||`), which is invalid GFM.
  const iterCols = iters.map(i => `it.${i.n}`);
  const headerCols = ['Criterion', 'Dimension', ...iterCols];
  L.push(`| ${headerCols.join(' | ')} |`);
  L.push(`|${headerCols.map(() => '---').join('|')}|`);
  for (const c of criteria) {
    const label = c.selfDeclared ? `${c.id} (self-declared)` : c.id;
    const cells = [label, c.dimension, ...iters.map(i => i.verdicts[c.id] ?? '—')];
    L.push(`| ${cells.join(' | ')} |`);
  }
  L.push('');

  // Findings — spec §6's tier format (BLOCKER/WARNING/SUGGESTION with
  // Where/Problem/Recommendation), matching templates/validation-report.md.
  // Out-of-boundary findings (a fix that would touch something other than
  // skills/<skill>/) are proposed patches, not findings, and get their own
  // section below — Step 4 never applies them.
  const findings = run.findings || [];
  const inBoundary = findings.filter(f => !f.outOfBoundary);
  const outOfBoundary = findings.filter(f => f.outOfBoundary);

  L.push('## Findings', '');
  if (!inBoundary.length) {
    L.push('None recorded.', '');
  } else {
    inBoundary.forEach((f, i) => {
      L.push(`### ${i + 1}. [${f.tier}] ${f.title}`);
      L.push(`- **Where:** ${f.where}`);
      L.push(`- **Problem:** ${f.problem}`);
      L.push(`- **Recommendation:** ${f.recommendation}`);
      L.push('');
    });
  }

  L.push('## Proposed patches', '');
  if (!outOfBoundary.length) {
    L.push('None — no finding this run pointed outside `skills/<skill>/`.', '');
  } else {
    outOfBoundary.forEach((f, i) => {
      L.push(`### ${i + 1}. ${f.title}`);
      L.push(`- **Where:** ${f.where}`);
      L.push(`- **Problem:** ${f.problem}`);
      L.push(`- **Proposed patch (not applied):** ${f.patch || f.recommendation}`);
      L.push('');
    });
  }

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
