// ledger.mjs — the run's verdict record and its stop decision.
//
// The ledger is a file rather than model memory precisely so "no-progress" is
// computable: a loop that thrashes on the same finding for three rounds buys
// nothing, and detecting that is what bounds the cost (spec §5.1 step 7).
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
  return write(runDir, { ...meta, startedAt: new Date().toISOString(), iterations: [] });
}

export function appendIteration(runDir, { n, verdicts, fixes = [], invalidDispatch = false }) {
  const run = readRun(runDir);
  run.iterations.push({ n, verdicts, fixes, invalidDispatch, at: new Date().toISOString() });
  return write(runDir, run);
}

function sameVerdicts(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every(k => a[k] === b[k]);
}

export function converged(run, { cap = 3 } = {}) {
  // An iteration where the runner reached for the Skill tool graded a stale
  // cached copy; it is evidence about the runner, not about the skill.
  const valid = run.iterations.filter(i => !i.invalidDispatch);
  if (!valid.length) return 'continue';

  const last = valid[valid.length - 1];
  const ids = Object.keys(last.verdicts);
  const failing = ids.filter(id => last.verdicts[id] !== 'PASS');

  if (ids.length && !failing.length) {
    const selfDeclared = new Set(run.selfDeclared || []);
    return ids.some(id => !selfDeclared.has(id)) ? 'converged-pass' : 'converged-pass-weak';
  }

  // Checked before the cap: three rounds of the same verdict map is the cheaper
  // and more informative stop, and it should be the reason reported.
  const prev = valid[valid.length - 2];
  if (prev && sameVerdicts(prev.verdicts, last.verdicts)) return 'no-progress';

  if (valid.length >= cap) return 'iteration-cap';
  return 'continue';
}
