---
name: twt-qa-a11y
category: qa
description: Audit built or served pages for accessibility (alt, headings, landmarks, labels, contrast)
version: 1.0.1
accepts_arguments: true
inputs:
  - Optional local path or http(s):// URL; else auto-detect site/ then Phase-2 mockups
dependencies:
  hard: []
  soft: []
reads:
  - site/
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/design/design-system/tokens.css
writes:
  - .twt-artifacts/qa/a11y-report.md
---

# /twt-qa-a11y

## Intent

**Purpose:** Read-only accessibility audit of the built HTML (local) or the rendered pages (live, best-effort) — image alt text, heading order, landmarks, form labels, and WCAG AA contrast for declared color pairs.

**Non-goals:**
- Doesn't edit anything (read-only)
- Doesn't run a full automated a11y engine — static structural checks only
- Live mode is best-effort (WebFetch returns model-processed content, not a raw DOM)

**Success criteria:**
- Writes `.twt-artifacts/qa/a11y-report.md` opening with a weighted **Scorecard → Health (0–100) / Band (Pass ≥80 / Revise 50–79 / Fail <50)**, followed by BLOCKER / WARNING / SUGGESTION findings, each as Where / Problem / Recommendation
- Flags images without alt, skipped heading levels, missing landmarks, unlabeled controls, and failing contrast pairs

---

## Step 1 — Mode & subject
Parse `$ARGUMENTS`. URL → **live mode** (`WebFetch` the entry page + up to 25 deduped internal pages). Else → **local mode** (`site/*.html`, else `mockup/pages/*.html`). If neither URL nor local HTML exists, abort: "No built HTML or URL to audit." Read `tokens.css` for contrast computation (local mode; in live mode compute contrast only where colors are inspectable).

## Step 2 — Run checks
Per page:
- **BLOCKER** — `<img>` without `alt`; a skipped heading level (e.g. `h1`→`h3`); no `<main>` or landmark element; a form control without an associated label; a declared text/background **token pair** that fails WCAG AA (< 4.5:1 for normal text).
- **WARNING** — more than one `<h1>`; a link/button with no discernible text; non-descriptive `alt` (e.g. "image").
- **SUGGESTION** — no skip-link; missing `lang` attribute; no focus-visible styling.

## Step 3 — Write report
Score each criterion 0–5 with concrete evidence (e.g. "5 of 18 images missing alt", "2 pages skip h2→h4", "3 form controls unlabeled", "1 token pair fails 4.5:1"). Use the formulas: `Weighted = Weight × Score / 5`, `Health = Σ Weighted`, `Band = Pass ≥80 / Revise 50–79 / Fail <50`.

Write `.twt-artifacts/qa/a11y-report.md`:
```
# Accessibility — QA report
Generated: <YYYY-MM-DD>  ·  Mode: <local|live>  ·  Pages: <n>

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Alt text coverage (images with valid alt) | 20 | <0-5> | <weighted> | <images missing alt / total images> |
| Heading order & landmarks (no skips, <main> present) | 25 | <0-5> | <weighted> | <pages with heading skips or missing landmarks> |
| Labels & roles (form controls, buttons, links) | 20 | <0-5> | <weighted> | <unlabeled / undescribed controls count> |
| Contrast (WCAG AA token pairs ≥4.5:1) | 25 | <0-5> | <weighted> | <failing color pairs found> |
| Focusable controls (skip-link, focus-visible, lang) | 10 | <0-5> | <weighted> | <missing skip-link, lang attr, focus-visible> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Summary
BLOCKER: <n> · WARNING: <n> · SUGGESTION: <n>

## Findings
### [BLOCKER] <title>
- Where: <page · element>
- Problem: <what's wrong>
- Recommendation: <how to fix>
```
Sort BLOCKER → WARNING → SUGGESTION. If clean, write "No findings — accessibility passes." In live mode, add a note: "Best-effort (rendered content via WebFetch) — re-run locally for exhaustive attribute checks."

## Step 4 — Report
State mode, pages, counts, and the report path. Modify no other file.
