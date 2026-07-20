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
const TOOLS = [
  'check-brand-validation-report', 'check-decisions', 'check-io',
  'check-validation-report', 'diff-tokens', 'export-doctype',
  'export-document', 'export-html', 'export-presentation',
  'export-source-create', 'export-theme-create', 'export-transform',
  'gen-tokens-from-candidates', 'house-style', 'pdf-render', 'scan-manifest',
  'score-rubric', 'split-blocks', 'theme', 'wiki-facts-merge', 'wiki-sources-mark',
];

for (const tool of TOOLS) {
  test(`tools/${tool}.mjs --self-test`, () => {
    const p = fileURLToPath(new URL(`../tools/${tool}.mjs`, import.meta.url));
    const r = spawnSync(process.execPath, [p, '--self-test'], { encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stdout + r.stderr, /AssertionError/, 'self-test printed an assertion failure');
  });
}
