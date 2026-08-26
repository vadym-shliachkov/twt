// ledger.mjs — the run's verdict record and its stop decision.
//
// The ledger is a file rather than model memory precisely so "no-progress" is
// computable: a loop that thrashes on the same finding for three rounds buys
// nothing, and detecting that is what bounds the cost (spec §5.1 step 7).
//
// Requires meta.criteriaIds: the full, ordered list of criterion ids from the
// frozen rubric. This is persisted by initRun() to enable converged() to detect
// incomplete verdict maps: if the grader omits any expected criterion instead of
// marking it UNVERIFIABLE, we fail loudly rather than certifying a false pass.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'run.json';

export function readRun(runDir) {
  return JSON.parse(readFileSync(join(runDir, FILE), 'utf8'));
}

function write(runDir, run) {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, FILE), JSON.stringify(run, null, 2) + '\n', 'utf8');
  return run;
}

export function initRun(runDir, meta) {
  return write(runDir, { ...meta, startedAt: new Date().toISOString(), iterations: [], findings: [] });
}

export function appendIteration(runDir, { n, verdicts, fixes = [], invalidDispatch = false }) {
  const run = readRun(runDir);
  run.iterations.push({ n, verdicts, fixes, invalidDispatch, at: new Date().toISOString() });
  return write(runDir, run);
}

// A finding survives independently of the verdict ledger: a contract BLOCKER
// (root-honouring violation) or an out-of-boundary proposed patch (spec §5.1
// step 8 / Step 4) both need a place to land that isn't the pass/fail map, so
// renderReport can render them even on a run that never reaches converged-pass.
export function appendFinding(runDir, finding) {
  const run = readRun(runDir);
  run.findings = run.findings || [];
  run.findings.push({ ...finding, at: new Date().toISOString() });
  return write(runDir, run);
}

function sameVerdicts(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every(k => a[k] === b[k]);
}

function bail(message) {
  const e = new Error(`skill-test: ${message}`);
  e.exitCode = 2;
  throw e;
}

export function converged(run, { cap = 3 } = {}) {
  // An iteration where the runner reached for the Skill tool graded a stale
  // cached copy; it is evidence about the runner, not about the skill.
  const valid = run.iterations.filter(i => !i.invalidDispatch);
  if (!valid.length) return 'continue';

  // Must have the frozen rubric's expected criterion ids to certify completeness.
  if (!Array.isArray(run.criteriaIds) || !run.criteriaIds.length) {
    bail('Run ledger cannot certify a pass without its criteriaIds set');
  }

  const last = valid[valid.length - 1];

  // Derive failing (and, below, the self-declared test) from the FROZEN
  // rubric's own id list — never from Object.keys(last.verdicts). The grader
  // is a fresh subagent and can hallucinate an id that was never in the
  // rubric; iterating its keys would let a phantom non-self-declared PASS
  // silently upgrade an all-self-declared result from converged-pass-weak to
  // converged-pass. A criterion absent from the verdict map is not-passing,
  // same as UNVERIFIABLE.
  const failing = run.criteriaIds.filter(id => last.verdicts[id] !== 'PASS');

  if (!failing.length) {
    const selfDeclared = new Set(run.selfDeclared || []);
    return run.criteriaIds.some(id => !selfDeclared.has(id)) ? 'converged-pass' : 'converged-pass-weak';
  }

  // Checked before the cap: three rounds of the same verdict map is the cheaper
  // and more informative stop, and it should be the reason reported.
  const prev = valid[valid.length - 2];
  if (prev && sameVerdicts(prev.verdicts, last.verdicts)) return 'no-progress';

  if (valid.length >= cap) return 'iteration-cap';
  return 'continue';
}
