#!/usr/bin/env node
// skill-test.mjs — deterministic half of /twt-skill-test.
//
// The skill owns judgment (criteria derivation, dispatch, grading, fixing);
// this script owns everything mechanical, so a three-iteration loop's
// bookkeeping is a file rather than something a model has to remember.
//
//   node tools/skill-test.mjs seed      <target> --skill <name> [--fixture <f>]
//   node tools/skill-test.mjs inject    <skill> --run <runDir> --target <dir> [--args "..."]
//   node tools/skill-test.mjs criteria  <skill> --file <path> [--freeze <runDir>] [--check <runDir>]
//   node tools/skill-test.mjs ledger    <runDir> --iteration N --verdicts <file> [--fixes a,b]
//   node tools/skill-test.mjs converged <runDir> [--cap N]
//   node tools/skill-test.mjs finding   <runDir> --tier BLOCKER|WARNING|SUGGESTION --title <t> --where <w> --problem <p> --recommendation <r> [--out-of-boundary true] [--patch <text>]
//   node tools/skill-test.mjs report    <runDir>
//   node tools/skill-test.mjs guard     <repoRoot>
//   node tools/skill-test.mjs clean     <target>
//
// Exit: 0 ok · 1 usage · 2 internal · 3 ownership refusal · 4 criteria drift.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seedTarget, cleanTarget } from './lib/skill-test/marker.mjs';
import { parseCriteria, criteriaHash, selfDeclaredIds } from './lib/skill-test/criteria.mjs';
import { prepareInjection } from './lib/skill-test/inject.mjs';
import { initRun, appendIteration, appendFinding, readRun, converged } from './lib/skill-test/ledger.mjs';
import { renderReport } from './lib/skill-test/report.mjs';
import { gitGuard } from './lib/skill-test/guard.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.error('usage: node tools/skill-test.mjs seed|inject|criteria|ledger|converged|finding|report|guard|clean <arg> [options]');
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name, dflt = undefined) => {
  // `--name=value` is the escape hatch for a value that legitimately starts
  // with `--` (a pasted `--live` arg, a diff beginning `---`) — checked first
  // and unconditionally, so it always wins regardless of what follows it.
  const eqPrefix = `--${name}=`;
  const eqArg = argv.find(a => a.startsWith(eqPrefix));
  if (eqArg !== undefined) return eqArg.slice(eqPrefix.length);

  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  // A trailing flag (nothing follows it) or a flag immediately followed by
  // another flag's name must default rather than silently reading `undefined`
  // (which stringifies to "undefined"/NaN downstream) or swallowing the next
  // flag's name as if it were this flag's value. A value that legitimately
  // starts with `--` (e.g. a skill's own `--live` flag, a diff's `---` line)
  // must be passed via `--name=value` above, not this space-separated form —
  // there is no way to tell the two apart from the token alone.
  return (v === undefined || v.startsWith('--')) ? dflt : v;
};

const [cmd, arg1] = argv;
if (!cmd || !arg1 || arg1.startsWith('--')) usage();

try {
  if (cmd === 'seed') {
    seedTarget(arg1, { skill: flag('skill', ''), runDir: flag('run', ''), fixture: flag('fixture', 'happy') });
    console.log(`seed: ${arg1} (fixture ${flag('fixture', 'happy')})`);

  } else if (cmd === 'clean') {
    console.log(cleanTarget(arg1) ? `clean: removed ${arg1}` : `clean: ${arg1} absent — nothing to do`);

  } else if (cmd === 'criteria') {
    const file = flag('file') || join(REPO, 'tests', 'skill-criteria', `${arg1}.md`);
    const md = readFileSync(file, 'utf8');
    const list = parseCriteria(md);
    const hash = criteriaHash(md);
    const freezeDir = flag('freeze');
    const checkDir = flag('check');
    if (freezeDir) {
      mkdirSync(freezeDir, { recursive: true });
      initRun(freezeDir, {
        skill: arg1, criteriaHash: hash, criteriaFile: file,
        scope: (flag('scope', 'contract,dispatch,quality')).split(','),
        // Default 'false', not 'true': a malformed/valueless --tree-clean
        // must not silently flip toward "the tree was clean" when it wasn't
        // measured — the safer default is to assume it was dirty.
        target: flag('target', ''), startTreeClean: flag('tree-clean', 'false') === 'true',
        dispatchFidelity: 'injected', pluginCacheVersion: flag('cache-version', 'unknown'),
        substitutions: 0, selfDeclared: selfDeclaredIds(list), stopReason: null, commit: null,
        criteriaIds: list.map(c => c.id),
      });
      console.log(`criteria: frozen ${hash} (${list.length} criteria)`);
    } else if (checkDir) {
      const frozen = readRun(checkDir).criteriaHash;
      if (frozen !== hash) {
        console.error(`skill-test: criteria drift — frozen ${frozen}, now ${hash}. The rubric may not change mid-run (spec §4.3).`);
        process.exit(4);
      }
      console.log(`criteria: unchanged ${hash}`);
    } else {
      console.log(JSON.stringify({ hash, criteria: list }, null, 2));
    }

  } else if (cmd === 'inject') {
    const runDir = flag('run');
    if (!runDir) usage();
    const skillMd = readFileSync(join(REPO, 'skills', arg1, 'SKILL.md'), 'utf8');
    const { prompt, substitutions } = prepareInjection(skillMd, {
      projectRoot: flag('target', ''), repoRoot: REPO, args: flag('args'),
    });
    const iter = flag('iteration', '1');
    const outDir = join(runDir, `iteration-${iter}`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'prompt.md'), prompt, 'utf8');
    const run = readRun(runDir);
    // Recorded PER ITERATION, not just as one overwritten scalar: a body whose
    // ${CLAUDE_PLUGIN_ROOT} count changes between iterations (e.g. a fix adds
    // or removes a reference) is worth noticing, and iteration 3 overwriting
    // iteration 1's count would make that invisible (spec §5.1 step 2).
    run.substitutionsByIteration = run.substitutionsByIteration || {};
    run.substitutionsByIteration[iter] = substitutions;
    // Kept for the fidelity header, which reports "this run" at a glance —
    // the per-iteration map above is the record that actually matters.
    run.substitutions = substitutions;
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(run, null, 2) + '\n', 'utf8');
    console.log(join(outDir, 'prompt.md'));
    console.log(`substitutions: ${substitutions}`);

  } else if (cmd === 'ledger') {
    const verdicts = JSON.parse(readFileSync(flag('verdicts'), 'utf8'));
    const fixes = (flag('fixes', '') || '').split(',').filter(Boolean);
    appendIteration(arg1, {
      n: Number(flag('iteration', '1')), verdicts, fixes,
      invalidDispatch: flag('invalid-dispatch', 'false') === 'true',
    });
    console.log(`ledger: iteration ${flag('iteration', '1')} recorded`);

  } else if (cmd === 'converged') {
    const run = readRun(arg1);
    const reason = converged(run, { cap: Number(flag('cap', '3')) });
    run.stopReason = reason;
    writeFileSync(join(arg1, 'run.json'), JSON.stringify(run, null, 2) + '\n', 'utf8');
    console.log(reason);

  } else if (cmd === 'finding') {
    appendFinding(arg1, {
      tier: flag('tier', 'WARNING'),
      title: flag('title', ''),
      where: flag('where', ''),
      problem: flag('problem', ''),
      recommendation: flag('recommendation', ''),
      outOfBoundary: flag('out-of-boundary', 'false') === 'true',
      patch: flag('patch', null),
    });
    console.log('finding: recorded');

  } else if (cmd === 'report') {
    const run = readRun(arg1);
    const md = readFileSync(run.criteriaFile, 'utf8');
    writeFileSync(join(arg1, 'report.md'), renderReport(run, { criteria: parseCriteria(md) }), 'utf8');
    console.log(join(arg1, 'report.md'));

  } else if (cmd === 'guard') {
    console.log(JSON.stringify(gitGuard(arg1), null, 2));

  } else {
    usage();
  }
} catch (e) {
  console.error(e.message);
  process.exit(e.exitCode || 2);
}
