---
name: twt-content-validate
category: content
description: (v1.1.1) Score text quality (clarity, brevity, UX writing) with evidence-backed reasoning per criterion
version: 1.1.1
accepts_arguments: true
inputs:
  - Optional subject — a file path, pasted text, or nothing (then prompt for one)
dependencies:
  hard: []
  soft:
    - twt-content-fetch-site
reads:
  - the subject text (user-supplied file or pasted text, or a .twt-artifacts content artifact)
  - .twt-artifacts/pre-design/brand/brand-brief.md
writes:
  - .twt-artifacts/content/validation/<subject-slug>/validation-report.md
---

# /twt-content-validate

## Intent

**Purpose:** Read-only content-quality critic — score any text against an 8-criterion UX-writing rubric (Information Style / «Пиши и сокращай», NN/g, GOV.UK content design) and write a `validation-report.md` where **every score is justified by verbatim evidence and explicit reasoning**. It rates and explains; it never rewrites (that's `/twt-content-optimize`).

**Non-goals:**
- Never edits the subject text or any upstream artifact (rule 11 — writes only its own report)
- Doesn't rewrite or suggest full replacement drafts (findings carry short suggested rewrites only)
- Doesn't audit IA/sitemap coverage or lorem placeholders on built pages (that's `/twt-qa-content`)

**Success criteria:**
- `.twt-artifacts/content/validation/<subject-slug>/validation-report.md` opens with the fixed 8-criterion weighted **Scorecard** (weights sum to 100) yielding **Health 0–100 + Band** (Pass ≥80 / Revise 50–79 / Fail <50) — per-subject path, so reports for different texts never overwrite each other
- A `## Rating reasoning` section gives, per criterion: the score rationale, ≥1 verbatim quote from the subject as evidence, and improvement opportunities — no score without a quote
- Every criterion scoring ≤3 yields at least one Finding (Where / Problem / Recommendation / Suggested rewrite / Expected impact)
- The report names the subject (path or "pasted text") so a future run can compare

---

## Step 1 — Resolve the subject
Parse `$ARGUMENTS` (strip a `subagent-collect` token first; remember if present — rule 13):
- A path to an existing file → read it as the subject.
- Something that **looks like** a file path (extension, slashes) but doesn't exist → don't score the path string as text; say the file wasn't found and prompt for a correction (in collect mode, write it to `decisions.md` and stop).
- An `http(s)://` URL → abort with the hint: "Fetch the page first with /twt-content-fetch-site, then validate the saved markdown."
- Any other non-trivial text → treat the text itself as the subject.
- Empty → prompt (plain text, free-form): "Paste the text to evaluate, or give a file path." In collect mode don't prompt — write the missing-subject question to a sibling `decisions.md` and stop.

Record a subject label (the relative path, or `pasted-text (<first 6 words>…)`) and a kebab-case `<subject-slug>` derived from the file name (sans extension) or the first words of pasted text — it names the per-subject report folder.

## Step 2 — Load context
Read `.twt-artifacts/pre-design/brand/brand-brief.md` if present — brand voice is context, not a criterion: copy that is intentionally on-voice is not penalised as "marketing cliché" unless it is also empty of meaning. Evaluate in the subject's own language; the rubric is language-agnostic.

## Step 3 — Score the rubric (rating logic)
Score each criterion **0–5** against its anchors. Weights are fixed and sum to 100:

| Criterion | Weight | 5 looks like | 2 looks like |
|-----------|-------:|--------------|--------------|
| Clarity | 20 | Plain words, short sentences; jargon absent or explained on first use | Bureaucratic phrasing, nested clauses, unexplained terms |
| Conciseness | 15 | No filler; every sentence earns its place | Pervasive filler/repetition; ~30%+ could be cut without losing meaning |
| Specificity | 15 | Concrete facts, numbers, explicit actions | Vague claims dominate ("high quality", "soon", "many") |
| User value | 15 | Benefit-led, reader-focused ("you get…") | Company-centric self-description; benefit left implicit |
| Active voice | 10 | Active constructions; the actor in each instruction is obvious | Passives hide who does what |
| Scanability | 10 | Headings, lists, short paragraphs; key points visually obvious | Walls of text; key points buried mid-paragraph |
| UX writing quality | 10 | Labels/CTAs/errors say exactly what happens next | Ambiguous actions; "Submit", "Click here", dead-end errors |
| Content density | 5 | Each sentence adds information | Clichés and empty claims fill space |

Rating rules (binding):
- **Evidence or no score** — each criterion's rating must rest on at least one verbatim quote from the subject; intermediate scores (1, 3) mean "between the anchors", and the reasoning must say in which direction and why.
- Scores are **evaluative**, never presence-based ("has headings" is not Scanability 5; "a reader finds any key point within one glance per section" is).
- If a criterion genuinely doesn't apply (e.g. Scanability for a 4-word button label), mark it **N/A** and redistribute its weight proportionally across the rest; say so in the reasoning. In the Scorecard, an N/A row shows Weight 0 and Score "N/A", and the remaining weights are rescaled so the table still totals 100.
- After assigning all scores, run (Bash) to compute weighted sums and health:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/tools/score-rubric.mjs" '[{"criterion":"Clarity","weight":20,"score":<s1>},{"criterion":"Conciseness","weight":15,"score":<s2>},{"criterion":"Specificity","weight":15,"score":<s3>},{"criterion":"User value","weight":15,"score":<s4>},{"criterion":"Active voice","weight":10,"score":<s5>},{"criterion":"Scanability","weight":10,"score":<s6>},{"criterion":"UX writing quality","weight":10,"score":<s7>},{"criterion":"Content density","weight":5,"score":<s8>}]'
  ```
  Use `rows[i].weighted` for the **Weighted** column, `health` for the **Total** row and the `**Health:**` line, and `band` for the Band verdict. Never recompute arithmetic manually.

## Step 4 — Derive findings
For every criterion scoring ≤3, write at least one Finding. Severity: **BLOCKER** = the reader can't understand or act (wrong/ambiguous instruction, impenetrable passage); **WARNING** = quality loss (filler, passive pile-ups, vague claims); **SUGGESTION** = polish. Each finding carries a one-line **Suggested rewrite** and an **Expected impact** — phrased as a contribution ("contributes toward Clarity 3→4"), since several findings usually share one criterion's uplift and must not each claim the full point. Collect into **Decisions to confirm** any judgment inferred as a rule (e.g. "treated industry term X as known to this audience").

## Step 5 — Write the report
Write `.twt-artifacts/content/validation/<subject-slug>/validation-report.md`:
```markdown
# Validation report — content
Generated: <ISO>  ·  Validator: /twt-content-validate  ·  Subject: <label>

## Scorecard
| Criterion | Weight | Score (0-5) | Weighted | Evidence |
|-----------|-------:|------------:|---------:|----------|
| Clarity | 20 | <0-5> | <w> | <one-line why> |
| Conciseness | 15 | <0-5> | <w> | <…> |
| Specificity | 15 | <0-5> | <w> | <…> |
| User value | 15 | <0-5> | <w> | <…> |
| Active voice | 10 | <0-5> | <w> | <…> |
| Scanability | 10 | <0-5> | <w> | <…> |
| UX writing quality | 10 | <0-5> | <w> | <…> |
| Content density | 5 | <0-5> | <w> | <…> |
| **Total** | **100** | | **<0-100>** | |

**Health: <0-100> — Band: <Pass ≥80 | Revise 50-79 | Fail <50>**

## Rating reasoning
### Clarity — <score>/5
- **Why:** <2-4 sentences of rationale against the anchors>
- **Evidence:** "<verbatim quote>" <· more quotes as needed>
- **Opportunities:** <what would raise the score>
<repeat for all 8 criteria>

## Decisions to confirm
- <inferred rule / judgment call>  (or: none)

## Findings
### 1. [BLOCKER] <title>
- **Where:** <section / line / quote location>
- **Problem:** <which criterion, what's wrong and why, with evidence>
- **Recommendation:** <what to change>
- **Suggested rewrite:** <one-line replacement>
- **Expected impact:** contributes toward <criterion a→b>

## Summary
<one paragraph tying the band to the top findings>
```
Write ONLY this file.

## Step 6 — Report
Print Health, Band, and BLOCKER/WARNING/SUGGESTION counts, then the fix hint: "To improve the text, run /twt-content-optimize (auto or per-suggestion review)."
