#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--file") out.file = argv[++i];
    else if (arg.startsWith("--file=")) out.file = arg.slice("--file=".length);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (!out.file) out.file = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node tools/check-brand-validation-report.mjs --file .twt-artifacts/pre-design/brand/validation-report.md",
  ].join("\n");
}

function hasHeading(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\s*$`, "m").test(markdown);
}

function evaluate(markdown) {
  const failures = [];
  const requiredHeadings = [
    "# Validation report — brand",
    "## Scorecard",
    "## Detailed brand component evaluation",
    "## Brand-book completeness & source coverage",
    "## Critical assessment",
    "## Before design proceeds",
    "## Decisions to confirm",
    "## Findings",
    "## Summary",
  ];

  for (const heading of requiredHeadings) {
    if (!hasHeading(markdown, heading)) failures.push(`Missing heading: ${heading}`);
  }

  const scorecardChecks = [
    ["Score (0-5)", "Scorecard must include Score (0-5)."],
    ["Weighted", "Scorecard must include Weighted values."],
    ["Health:", "Report must include numeric Health."],
    ["Band:", "Report must include Band."],
    ["Palette contrast / WCAG AA", "Scorecard must include palette contrast / WCAG AA criterion."],
    ["Palette fit to context & audience", "Scorecard must include palette fit criterion."],
    ["Voice distinctiveness & consistency", "Scorecard must include voice criterion."],
    ["Positioning/message clarity", "Scorecard must include positioning criterion."],
    ["Completeness & internal coherence", "Scorecard must include completeness criterion."],
  ];
  for (const [needle, message] of scorecardChecks) {
    if (!markdown.includes(needle)) failures.push(message);
  }

  const detailChecks = [
    ["Evaluation method:", "Detailed item blocks must include evaluation method."],
    ["Item health:", "Detailed item blocks must include item health."],
    ["Metric values:", "Detailed item blocks must include metric values."],
    ["Pros:", "Detailed item blocks must include pros."],
    ["Cons / risks:", "Detailed item blocks must include cons / risks."],
    ["Design handoff note:", "Detailed item blocks must include design handoff note."],
  ];
  for (const [needle, message] of detailChecks) {
    if (!markdown.includes(needle)) failures.push(message);
  }

  const completenessChecks = [
    ["Tier coverage", "Completeness section must include per-tier coverage."],
    ["Source coverage", "Completeness section must include source-coverage attribution."],
  ];
  for (const [needle, message] of completenessChecks) {
    if (!markdown.includes(needle)) failures.push(message);
  }

  const metricRows = [
    "Clarity:",
    "Relevance:",
    "Distinctiveness:",
    "Consistency:",
    "Actionability:",
    "Evidence quality:",
    "Accessibility / usability:",
    "Governance readiness:",
  ];
  for (const metric of metricRows) {
    if (!markdown.includes(metric)) failures.push(`Detailed metric values must include ${metric}`);
  }

  for (const field of ["Where:", "Problem:", "Recommendation:"]) {
    if (!markdown.includes(field)) failures.push(`Findings must include ${field}`);
  }

  if (/^\|\s*Dimension\s*\|\s*Assessment\s*\|/m.test(markdown)) {
    failures.push("Compact Dimension/Assessment scorecard is not allowed for final brand validation.");
  }
  if (/\*\*Band:\s*(GREEN|YELLOW|RED)/i.test(markdown)) {
    failures.push("Traffic-light Band is not allowed; use Pass / Revise / Fail with Health 0-100.");
  }

  return failures;
}

function checkFile(file) {
  if (!file) throw new Error(`Missing --file.\n${usage()}`);
  if (!existsSync(file)) throw new Error(`Report not found: ${file}`);
  const markdown = readFileSync(file, "utf8");
  const failures = evaluate(markdown);
  if (failures.length) {
    console.error(`Brand validation report failed ${failures.length} check(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    return false;
  }
  console.log("Brand validation report structure: OK");
  return true;
}

function selfTest() {
  const good = `# Validation report — brand

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|---|---:|---:|---:|---|
| Palette contrast / WCAG AA | 25 | 4 | 20 | ok |
| Palette fit to context & audience | 20 | 4 | 16 | ok |
| Voice distinctiveness & consistency | 20 | 4 | 16 | ok |
| Positioning/message clarity | 20 | 4 | 16 | ok |
| Completeness & internal coherence | 15 | 4 | 12 | ok |
**Health: 80 — Band: Pass**

## Detailed brand component evaluation
- **Evaluation method:** audit
- **Item health:** 4 / 5
- **Metric values:**
  - Clarity: 4 — clear
  - Relevance: 4 — relevant
  - Distinctiveness: 3 — somewhat distinctive
  - Consistency: 4 — aligned
  - Actionability: 4 — usable
  - Evidence quality: 3 — sourced
  - Accessibility / usability: N/A — not applicable because this test item is verbal
  - Governance readiness: 4 — repeatable
- **Pros:** clear
- **Cons / risks:** limited
- **Design handoff note:** use

## Brand-book completeness & source coverage

**Tier coverage:** Core 100% · Recommended 50% · Optional 0%

| Part | Tier | In brief | Source coverage | Recommendation |
|---|---|---|---|---|
| Palette + usage | Core | Complete | n/a | keep |
| Motion | Recommended | Missing | Silent | add if brief expands |

## Critical assessment
Good.

## Before design proceeds
Proceed.

## Decisions to confirm
None.

## Findings
### 1. [WARNING] Test
- **Where:** Palette
- **Problem:** Test
- **Recommendation:** Fix

## Summary
Ok.
`;
  const bad = `# Brand Brief — Validation Report

## Scorecard
| Dimension | Assessment |
|---|---|
| Palette | Pass |

**Band: GREEN — Strong**
`;
  assert.deepEqual(evaluate(good), []);
  assert(evaluate(bad).length > 0);
  const dir = join(ROOT, ".twt-artifacts", "self-test", "brand-report-check");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "validation-report.md");
  writeFileSync(p, good, "utf8");
  assert.equal(checkFile(p), true);
  console.log("check-brand-validation-report self-test: OK");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) selfTest();
  else if (args.help) console.log(usage());
  else process.exit(checkFile(args.file) ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
