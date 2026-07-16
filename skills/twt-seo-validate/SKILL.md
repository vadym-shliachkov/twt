---
name: twt-seo-validate
category: seo
description: (v1.0.1) Critique seo-map.md — coverage, slug/keyword integrity, meta limits, redirect completeness; write validation-report.md
version: 1.0.1
accepts_arguments: false
inputs:
  - (none — reads seo-map.md and upstream artifacts)
dependencies:
  hard:
    - twt-seo-define
  soft: []
reads:
  - .twt-artifacts/pre-design/seo/seo-map.md
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/content/fetched/site/
writes:
  - .twt-artifacts/pre-design/seo/validation-report.md
---

# /twt-seo-validate

## Intent

**Purpose:** Act as an SEO-map critic — check sitemap coverage, slug uniqueness and consistency, keyword cannibalization, meta length limits (deterministic character counts), and redirect-map completeness against the fetched old-site sitemap, and write a structured `validation-report.md`.

**Non-goals:**
- Writes only its own `validation-report.md` (rule 11); never edits seo-map.md
- Recommends fixes, doesn't apply them
- Doesn't judge keyword choices against live search data (none exists in the pipeline) — it judges internal coherence and grounding

**Success criteria:**
- `validation-report.md` opens with a weighted **Scorecard** (5 criteria, weights summing to 100) yielding a **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50)
- Meta title/description overruns are found by counting characters, not by trusting the stated counts
- A `## Decisions to confirm` section lists inferred rules for user approval (or states none)
- Every finding has Where / Problem / Recommendation, with Problem citing evidence
- Any criterion scoring ≤3 yields at least one Finding (BLOCKER if it breaks downstream)
- If `seo-map.md` is missing, aborts pointing to `/twt-seo-define`

---

## Step 1 — Load the artifact (hard dependency)
Read `.twt-artifacts/pre-design/seo/seo-map.md`. If absent, abort: "No seo-map.md found — run /twt-seo-define first." Do not create it. Also read `ia/sitemap.md` (coverage baseline), `positioning/positioning.md` (theme grounding), and `content/fetched/site/<domain>/_sitemap.md` if present (redirect baseline).

## Step 2 — Deterministic checks
Before scoring, verify mechanically (Read/Grep — count, don't trust the artifact's own numbers):
- every sitemap page has a `## Pages` entry; list any missing
- no two entries share a slug; slugs match the sitemap path hierarchy
- no two entries share a primary keyword (cannibalization)
- every meta title ≤60 characters and meta description ≤155 — recount each string yourself
- when a fetched `_sitemap.md` exists, every old URL appears exactly once in `## Redirects` with action `redirect` (and a real target page) or `gone` (with a reason)

Each violation feeds the rubric below and becomes a Finding.

## Step 3 — Score the rubric (evaluative, with evidence)
Score each criterion 0–5 (5 = excellent) with a one-line evidence note. Weights are fixed and sum to 100:

| Criterion | Weight | What "good" means |
|-----------|-------:|-------------------|
| Sitemap coverage | 25 | Every sitemap page has a complete entry; no orphan entries for pages the sitemap doesn't have. |
| Slug integrity | 20 | Slugs unique, kebab-case, consistent with sitemap paths. |
| Keyword differentiation | 20 | One distinct primary keyword per page; secondaries support, not duplicate, another page's primary; themes trace to positioning/content. |
| Meta quality & limits | 20 | Drafts within limits, concrete, lead with keyword or brand appropriately, no boilerplate repetition across pages. |
| Redirect completeness | 15 | On redesigns every old URL is mapped or justified `gone`; no redesign → full marks if the section says so explicitly. |

After assigning all scores, run (Bash) to compute weighted sums and health:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Sitemap coverage","weight":25,"score":<s1>},{"criterion":"Slug integrity","weight":20,"score":<s2>},{"criterion":"Keyword differentiation","weight":20,"score":<s3>},{"criterion":"Meta quality & limits","weight":20,"score":<s4>},{"criterion":"Redirect completeness","weight":15,"score":<s5>}]'
```
Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

For any criterion scoring ≤3, write a **Finding** (BLOCKER if it breaks downstream — e.g. duplicate slugs corrupt the content-approval workbook's `seo:slug` rows and the built site's URLs; an unmapped old URL loses a live page on launch; WARNING if it degrades quality; SUGGESTION otherwise). Findings must explain *why*, citing the offending entry.

Collect into **Decisions to confirm** any judgment the validator is inferring as a rule (e.g. "treating the blog archive as `CollectionPage` schema", "assuming the old `/news/` section is intentionally dropped").

## Step 4 — Write the report
Write `.twt-artifacts/pre-design/seo/validation-report.md`:
```markdown
# Validation report — seo
Generated: <ISO timestamp>  ·  Validator: /twt-seo-validate

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Sitemap coverage | 25 | <0-5> | <w> | <why> |
| Slug integrity | 20 | <0-5> | <w> | <why> |
| Keyword differentiation | 20 | <0-5> | <w> | <why> |
| Meta quality & limits | 20 | <0-5> | <w> | <why> |
| Redirect completeness | 15 | <0-5> | <w> | <why> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Decisions to confirm
- <inferred rule / judgment call to approve before it binds>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <page entry / redirect row in seo-map.md>
- **Problem:** <what's wrong and why, with evidence>
- **Recommendation:** <what to change>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

Then verify its structure (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-validation-report.mjs" --file <the report path written above>` — if it fails, fix the report until it passes. The check is structural (scorecard arithmetic, band consistency, finding format, required sections); passing it never replaces this rubric's judgment.

## Step 5 — Report
Print BLOCKER/WARNING/SUGGESTION counts and end with the fix hint: "To address these, run /twt-seo-define (or /twt-seo for the one-pass workflow)."
