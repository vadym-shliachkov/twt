// guard.mjs — git tree state → may-we-commit decision.
//
// A dirty tree blocks committing because the harness stages explicit paths and
// must never sweep up unrelated work. It never blocks the RUN — report-only and
// working-tree fixes proceed, and the report says the tree was dirty.
import { execFileSync } from 'node:child_process';

export function gitGuard(repoRoot) {
  const out = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  const clean = out.trim() === '';
  return { clean, mayCommit: clean, entries: clean ? [] : out.trim().split(/\r?\n/) };
}
