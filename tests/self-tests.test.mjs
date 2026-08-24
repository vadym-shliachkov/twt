import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Every bundled tool that carries a --self-test, run under CI. Before this
// runner existed, the whole export chain's self-tests only ran when someone
// remembered to invoke them by hand - CI stayed green through any breakage.
// Tools that need pandoc/chromium degrade internally (probe + SKIP / engine
// fallback), so a bare runner environment still passes; CI installs pandoc so
// the export-chain tests actually exercise.
// Repo-relative PATHS, not bare names. This list used to hold bare names joined
// onto `../tools/`, which could not express a tool that had moved into the skill
// directory that owns it - so when figma-dev-audit and figma-dev-report moved
// under skills/twt-figma-dev-audit/tools/, the names still resolved to
// tools/<name>.mjs and the runner silently stopped covering them. Spelling the
// path out makes a move a one-line edit here, and makes a stale entry fail
// immediately instead of quietly dropping coverage.
const TOOLS = [
  'tools/check-brand-validation-report.mjs', 'tools/check-decisions.mjs', 'tools/check-io.mjs',
  'tools/check-validation-report.mjs', 'tools/diff-tokens.mjs', 'tools/export-doctype.mjs',
  'tools/export-document.mjs', 'tools/export-html.mjs', 'tools/export-presentation.mjs',
  'tools/export-source-create.mjs', 'tools/export-theme-create.mjs', 'tools/export-transform.mjs',
  'skills/twt-figma-dev-audit/tools/figma-dev-audit.mjs',
  'skills/twt-figma-dev-audit/tools/figma-dev-report.mjs',
  'tools/gen-tokens-from-candidates.mjs', 'tools/house-style.mjs', 'tools/pdf-render.mjs',
  'tools/scan-manifest.mjs', 'tools/score-rubric.mjs', 'tools/split-blocks.mjs',
  'tools/theme.mjs', 'tools/wiki-facts-merge.mjs', 'tools/wiki-sources-mark.mjs',
];

for (const tool of TOOLS) {
  test(`${tool} --self-test`, () => {
    const p = fileURLToPath(new URL(`../${tool}`, import.meta.url));
    const r = spawnSync(process.execPath, [p, '--self-test'], { encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /AssertionError/, 'self-test printed an assertion failure');
  });
}
