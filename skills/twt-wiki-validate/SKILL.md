---
name: twt-wiki-validate
category: wiki
description: (v1.0.3) Lint the project wiki's health — structure, links, provenance, freshness — and write a validation-report.md (read-only critic)
version: 1.0.3
accepts_arguments: false
inputs:
  - (none — reads the whole .project-wiki/)
dependencies:
  hard: []
  soft:
    - twt-wiki-define
reads:
  - .project-wiki/
  - .twt-artifacts/
writes:
  - .project-wiki/validation-report.md
---

# /twt-wiki-validate

## Intent

**Purpose:** Act as the wiki's health critic. The deterministic layer (`tools/wiki-lint.mjs`) decides everything a script can decide — missing files, dead links, invalid frontmatter, stale pages, live CONFLICTs, an inbox nobody drains. This skill adds only what needs judgment: contradictions between pages and newer sources, and recurring terms with no page. It writes a structured `validation-report.md` and changes nothing else.

**Non-goals:**
- Does not fix anything — recommends only. No curated page, no inbox entry, no source is ever modified or deleted (CONVENTIONS §11, §17).
- Does not curate (that is `twt-wiki-define`) or ingest (that is `twt-wiki-fetch`).
- Does not re-derive or second-guess the lint script's findings — the deterministic layer is ground truth for what it checks.

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (criteria summing to 100) yielding a **Health 0–100 + Band**.
- Every `wiki-lint.mjs` finding appears in the report verbatim (tier, where, problem, recommendation) — none dropped, none softened.
- Judgment findings (contradictions, uncovered recurring terms) each cite the specific pages/sources that disagree.
- Findings use BLOCKER / WARNING / SUGGESTION with Where / Problem / Recommendation.
- `.project-wiki/validation-report.md` is the **only** file written — the wiki is committed to git by default, so the report's git history is the dated trail; no second copy is kept.
- If the wiki does not exist, aborts pointing to `/twt-wiki`.

---

## Step 1 — Require a wiki, load its schema
Use Glob/Read to check `.project-wiki/AGENTS.md` exists. If not, abort: "No wiki — run /twt-wiki first." Read it; it is the wiki's own schema and wins over this skill's assumptions.

## Step 2 — Run the deterministic layer
Run (Bash, single command):

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-lint.mjs" "$CLAUDE_PROJECT_DIR" --json
```

It checks: required files present; the operating manual not older than the plugin's template; frontmatter valid (including the idea-lifecycle status vocabulary); index links resolve and every page is indexed; body cross-links resolve; collection pages no other page links to (orphans in the graph sense); citations exist; cited sources not newer than the page's `updated` date; superseded pages link a living successor; `needs-review` pages whose why was never captured; `facts.md` CONFLICT/TBD/UNVERIFIED-ATTR rows; a live legacy facts ledger still sitting beside the canonical `.project-wiki/facts.md`; open questions; inbox entries pending past the age threshold.

Carry every finding into the report **verbatim**. Do not re-check what it already decided, and never soften a tier.

## Step 3 — Judgment layer (read-only)
Two checks a script cannot make. Read wiki pages with the file tools (CONVENTIONS §15), following citations into `raw/` and `.twt-artifacts/` where needed:

1. **Contradictions with newer sources.** For each `status: current` page, compare its claims against sources ingested *after* its `updated` date (check `sources.md`'s Ingested column and `log.md`) and against any cited artifact the lint flagged as changed. A page asserting what a newer source contradicts is a **WARNING** — name both sides with paths. Never resolve the contradiction yourself; that is the curator's job, and only with a human.
2. **Recurring terms with no home.** A person, company, product, or term of art appearing in two or more pages/sources without an `entities/` page or `glossary.md` row is a **SUGGESTION** — knowledge the wiki repeats but never consolidates.

Report only what you actually observed, with paths — never a finding you cannot cite.

## Step 4 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Integrity — links, citations, supersession chains resolve | 25 | No dead index links or citations; every superseded page points at a living successor. Driven by lint's BLOCKERs. |
| Provenance — claims cited, whys real or honestly absent | 25 | Claims carry source/artifact/URL citations; no fabricated-looking rationale; `_not captured_` gaps are marked, not papered over. |
| Freshness — pages current vs sources, inbox drained | 20 | No stale-vs-source pages; no inbox entries past the age threshold; contradictions with newer sources surfaced. |
| Coverage — recurring knowledge has a home | 15 | Recurring entities/terms have pages; facts needed downstream are in the ledger, not scattered. |
| Navigability — index complete, summaries present | 15 | Every page indexed with a summary; an agent reading outward from `index.md` can reach everything. |

After assigning scores, run (Bash):
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Integrity","weight":25,"score":<s1>},{"criterion":"Provenance","weight":25,"score":<s2>},{"criterion":"Freshness","weight":20,"score":<s3>},{"criterion":"Coverage","weight":15,"score":<s4>},{"criterion":"Navigability","weight":15,"score":<s5>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the Total row, `band` for the Band. Never recompute arithmetic manually.

## Step 5 — Write the report (and nothing else)
Write `.project-wiki/validation-report.md`:

```markdown
# Validation report — project wiki
Generated: <ISO timestamp>  ·  Validator: /twt-wiki-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Integrity | 25 | <0-5> | <w> | <evidence> |
| Provenance | 25 | <0-5> | <w> | <evidence> |
| Freshness | 20 | <0-5> | <w> | <evidence> |
| Coverage | 15 | <0-5> | <w> | <evidence> |
| Navigability | 15 | <0-5> | <w> | <evidence> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Decisions to confirm
- <judgment call the user must approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <page / path>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to do>

## Summary
<one paragraph tying the band to the top findings, ending with what to run next>
```

Number lint findings first (they are already tier-sorted), then judgment findings. This file is the only write this skill ever makes — the wiki is committed to git by default, so the report's own git history serves as the dated trail of past lints.

Then verify its structure (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-validation-report.mjs" --file .project-wiki/validation-report.md` — if it fails, fix the report until it passes. The check is structural (scorecard arithmetic, band consistency, finding format, required sections); passing it never replaces this rubric's judgment.

## Step 6 — Report
Print BLOCKER/WARNING/SUGGESTION counts, Health and Band, and both report paths. End with: "Wiki validation never blocks work by itself. BLOCKERs mean the wiki misleads — fix them via /twt-wiki (curation) or by answering what it flags; findings needing a human are listed under Decisions to confirm."
