#!/usr/bin/env node
// export-doctype.mjs — deterministic doc-type registry + structural detector for exports.
//
// DECISION TABLE (audit of every twt skill markdown artifact → profile):
// | Artifact (writer skill)                          | doc type              | profile |
// |--------------------------------------------------|-----------------------|---------|
// | analysis-report.md (twt-text-analysis)           | analysis-report       | report  |
// | validation-report.md (all *-validate)            | validation-report     | report  |
// | qa-report.md (twt-qa)                            | qa-report             | report  |
// | gaps.md (twt-qa)                                 | qa-gaps               | report  |
// | brand-brief.md (twt-brand-define)                | brand-brief           | brief   |
// | positioning.md (twt-positioning-define)          | positioning           | brief   |
// | specification.md (twt-spec-define)               | specification         | brief   |
// | pre-design-brief.md (twt-pre-design)             | pre-design-brief      | brief   |
// | design-brief.md (twt-design)                     | design-brief          | brief   |
// | site-instruction.md (twt-project-intake)         | site-instruction      | brief   |
// | sitemap.md (twt-ia-define)                       | sitemap               | spec    |
// | functional-scope.md (twt-ia-define)              | functional-scope      | spec    |
// | inventory.md (twt-curation-define)               | inventory             | spec    |
// | tokens.md (twt-design-system-define)             | tokens                | spec    |
// | components.md (twt-component-define)             | components            | spec    |
// | conventions.md (site/theme creators)             | conventions           | spec    |
// | layout-*.md / layouts (twt-layout-define)        | layout                | spec    |
// | design-read.md (external design skills)          | design-read           | spec    |
// | decisions.md / asset-manifest.md                 | decisions             | spec    |
// | any other *-report.md (fallback)                 | generic-report        | report  |
// | content-fetch output, curation outlines, logs    | (unregistered)        | generic |
// Unregistered files fall to structural fingerprints, then to 'generic'. New
// artifact → add one REGISTRY row, or accept generic rendering.
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export const PROFILES = ['report', 'brief', 'spec', 'generic', 'slides'];

// Filename registry — first match wins. `file` tests against the basename, lowercased.
export const REGISTRY = [
  { id: 'analysis-report',   profile: 'report', file: /^analysis-report[^/]*\.md$/ },
  { id: 'validation-report', profile: 'report', file: /^validation-report\.md$/ },
  { id: 'qa-report',         profile: 'report', file: /^qa-report\.md$/ },
  { id: 'qa-gaps',           profile: 'report', file: /^gaps\.md$/ },
  { id: 'brand-brief',       profile: 'brief',  file: /^brand-brief\.md$/ },
  { id: 'positioning',       profile: 'brief',  file: /^positioning\.md$/ },
  { id: 'specification',     profile: 'brief',  file: /^specification\.md$/ },
  { id: 'pre-design-brief',  profile: 'brief',  file: /^pre-design-brief\.md$/ },
  { id: 'design-brief',      profile: 'brief',  file: /^design-brief\.md$/ },
  { id: 'site-instruction',  profile: 'brief',  file: /^site-instruction\.md$/ },
  { id: 'sitemap',           profile: 'spec',   file: /^sitemap\.md$/ },
  { id: 'functional-scope',  profile: 'spec',   file: /^functional-scope\.md$/ },
  { id: 'inventory',         profile: 'spec',   file: /^inventory\.md$/ },
  { id: 'tokens',            profile: 'spec',   file: /^tokens\.md$/ },
  { id: 'components',        profile: 'spec',   file: /^components\.md$/ },
  { id: 'conventions',       profile: 'spec',   file: /^conventions\.md$/ },
  { id: 'layout',            profile: 'spec',   file: /^layout[a-z0-9-]*\.md$/ },
  { id: 'design-read',       profile: 'spec',   file: /^design-read\.md$/ },
  { id: 'decisions',         profile: 'spec',   file: /^(decisions|asset-manifest)\.md$/ },
  { id: 'generic-report',    profile: 'report', file: /^[a-z0-9-]+-report\.md$/ },
];

function stripFences(md) {
  return md.replace(/^(```+|~~~+)[\s\S]*?^\1/gm, '');
}

// Structural fingerprints, checked only when no filename match. Each returns
// evidence string or null. report needs >=2 hits; brief needs its kv run.
const REPORT_SIGNS = [
  (md) => /\b(BLOCKER|WARNING|SUGGESTION)\b/.test(md) ? 'severity markers (BLOCKER/WARNING/SUGGESTION)' : null,
  (md) => /\b\d{1,3}\/100\b/.test(md) ? 'NN/100 scores' : null,
  (md) => /^\|[^\n]*\b(Overall|Score|Severity|Finding)\b[^\n]*\|/mi.test(md) ? 'summary table with score/severity column' : null,
  (md) => /\*\*(Where|Problem|Recommendation):?\*\*/.test(md) ? 'Where/Problem/Recommendation blocks' : null,
];

function kvRunLength(md) {
  let max = 0, run = 0;
  for (const line of md.split(/\r?\n/).slice(0, 60)) {
    if (/^\s*[-*+]\s+\*\*[^*]+:?\*\*/.test(line)) { run++; max = Math.max(max, run); }
    else if (line.trim() !== '') run = 0;
  }
  return max;
}

export function classifyDoc({ markdown, filePath = '' }) {
  const name = basename(String(filePath)).toLowerCase();
  for (const entry of REGISTRY) {
    if (entry.file.test(name)) {
      return { docType: entry.id, profile: entry.profile, evidence: [`filename matches registry entry '${entry.id}'`] };
    }
  }
  const md = stripFences(markdown || '');
  const reportEvidence = REPORT_SIGNS.map((f) => f(md)).filter(Boolean);
  if (reportEvidence.length >= 2) {
    return { docType: 'structural-report', profile: 'report', evidence: reportEvidence };
  }
  const kv = kvRunLength(md);
  if (kv >= 4) {
    return { docType: 'structural-brief', profile: 'brief', evidence: [`run of ${kv} '**Label:** value' bullets near the top`] };
  }
  if (/^\|.*#[0-9a-f]{6}\b.*\|\s*$/mi.test(md)) {
    return { docType: 'structural-brief', profile: 'brief', evidence: ['hex color values inside a table (palette)'] };
  }
  return { docType: 'generic', profile: 'generic', evidence: ['no registry or structural match'] };
}

if (_isMain && process.argv.includes('--self-test')) {
  // filename matches
  assert.equal(classifyDoc({ markdown: '# x', filePath: 'C:/p/analysis-report.md' }).profile, 'report');
  assert.equal(classifyDoc({ markdown: '# x', filePath: 'C:/p/analysis-report-clean.md' }).docType, 'analysis-report');
  assert.equal(classifyDoc({ markdown: '# x', filePath: '/a/validation-report.md' }).profile, 'report');
  assert.equal(classifyDoc({ markdown: '# x', filePath: 'qa/gaps.md' }).profile, 'report');
  assert.equal(classifyDoc({ markdown: '# x', filePath: 'brand/brand-brief.md' }).profile, 'brief');
  assert.equal(classifyDoc({ markdown: '# x', filePath: 'ia/sitemap.md' }).profile, 'spec');
  assert.equal(classifyDoc({ markdown: '# x', filePath: 'design-system/tokens.md' }).profile, 'spec');
  // structural: report fingerprints
  const reportMd = ['# Audit', '', '- **Overall:** 82/100', '- **Findings:** 1 Problem',
    '', '| Block | Type | Overall | Finding Type |', '|---|---|---|---|', '| 1 | Heading | 90 | No issue |',
    '', '**BLOCKER** something'].join('\n');
  const r = classifyDoc({ markdown: reportMd, filePath: 'random-notes.md' });
  assert.equal(r.profile, 'report');
  assert.ok(r.evidence.length >= 2);
  // structural: brief fingerprints (kv run)
  const briefMd = ['# Thing', '', '- **Brand name:** Xivic', '- **Category:** AI firm',
    '- **Tagline:** AI Velocity', '- **Purpose:** Replace strategy churn'].join('\n');
  assert.equal(classifyDoc({ markdown: briefMd, filePath: 'notes.md' }).profile, 'brief');
  // generic fallback
  const g = classifyDoc({ markdown: '# Hello\n\nJust prose.', filePath: 'random.md' });
  assert.equal(g.docType, 'generic');
  assert.equal(g.profile, 'generic');
  // regressions: specific registry rule wins over the *-report catch-all
  assert.equal(classifyDoc({ markdown: '# x', filePath: 'layout-report.md' }).profile, 'spec');
  // regressions: hex in prose + unrelated table must not read as brief
  assert.equal(classifyDoc({ markdown: '# n\n\nRef #a1b2c3 in prose.\n\n| a | b |\n|---|---|\n| 1 | 2 |', filePath: 'notes.md' }).docType, 'generic');
  // regressions: hex inside a table row still detected as brief
  assert.equal(classifyDoc({ markdown: '# p\n\n| Name | Hex |\n|---|---|\n| Ink | #090E22 |', filePath: 'notes.md' }).profile, 'brief');
  console.log('export-doctype self-test: OK');
}

if (_isMain && !process.argv.includes('--self-test')) {
  const i = process.argv.indexOf('--input');
  if (i === -1) { console.error('Usage: node tools/export-doctype.mjs --input <file.md>'); process.exit(1); }
  const file = process.argv[i + 1];
  const res = classifyDoc({ markdown: readFileSync(file, 'utf8'), filePath: file });
  console.log(`docType: ${res.docType}\nprofile: ${res.profile}`);
  for (const e of res.evidence) console.log(`evidence: ${e}`);
}
