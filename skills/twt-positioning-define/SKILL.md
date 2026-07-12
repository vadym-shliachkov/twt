---
name: twt-positioning-define
category: positioning
description: (v1.0.2) Build or refine positioning.md — audience, value props, promotion priorities
version: 1.0.2
accepts_arguments: true
inputs:
  - Optional answers; otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-brand-define
    - twt-content-fetch
reads:
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/content/fetched/
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/positioning/validation-report.md
writes:
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/positioning/decisions.md
---

# /twt-positioning-define

## Intent

**Purpose:** Produce the canonical `positioning.md` — who we speak to, the ranked value propositions, what to promote vs. downplay, and the market context — built from scratch or refined.

**Non-goals:**
- Doesn't define brand attributes (reads brand-brief.md as context only)
- Doesn't define site structure (that's `/twt-ia-define`)
- Doesn't critique itself (that's `/twt-positioning-validate`); never overwrites without consent

**Success criteria:**
- `positioning.md` has all canonical sections populated or marked TBD
- Each value prop is tied to a specific audience need
- Re-run enters refinement mode (rule 10) rather than starting over

---

## Step 1 — Detect mode (rule 10)
If `positioning.md` exists → **refinement mode**: read it and any sibling `validation-report.md`; if findings exist, list them via the **AskUserQuestion** tool and ask which to address; only touch the chosen sections. Else → **from-scratch mode**.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft `positioning.md` from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/positioning/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then write the draft and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Gather soft context
**(Skipped in collect mode — see Step 1b.)** If present, read `brand-brief.md` (voice/audience signals) and `.twt-artifacts/pre-design/content/fetched/` (what the client actually emphasizes). Use as input; if absent, rely on interview (degrade gracefully).

## Step 3 — Interview / refine
Walk: Audience segments (+needs) → Value propositions (rank, tie each to a need) → Promotion priorities (elevate/de-emphasize) → Market context (alternatives, differentiation). Refinement mode touches only chosen sections.

## Step 4 — Write
Write/update `.twt-artifacts/pre-design/positioning/positioning.md` with the canonical sections. Mark unknowns TBD. Confirm before overwrite.

## Wiki capture — record what you decided and why
If `.project-wiki/` exists at the project root (use Glob/Read to check — never a shell command), append your reasoning to `.project-wiki/inbox.md` before you finish. The wiki's capture hook already records what the **user** chose; this records what **you** decided and, crucially, **why** — which nothing else in the pipeline preserves.

Append one entry per judgment that a human would need to re-make if it were lost:
- a decision you made autonomously (collect mode, or an unattended run)
- a factual `CONFLICT` you resolved, or refused to resolve
- a validator BLOCKER you overruled, and on what grounds
- an idea you raised but did not scope
- a free-form answer the user typed at a plain-text prompt (a direction, a constraint, pasted guidance) that shaped what you produced — the capture hook sees only AskUserQuestion menus, so this is the one place a typed answer gets recorded; put their words in **decision:** verbatim, not paraphrased

Append (never rewrite — `inbox.md` is append-only, and the curator drains it):

```
## <UTC timestamp, e.g. 2026-07-11T14:03:22Z — no milliseconds, matching the capture hook> · reason · <this skill's name>
- **decision:** <what you settled>
- **why:** <the reason — the evidence, the tradeoff, the constraint that forced it>
- **evidence:** <path, URL, or artifact this rests on>
- **reversible:** <yes|no>
```

Write nothing else in `.project-wiki/`. Curated pages have exactly one writer, and it is not you.

If `.project-wiki/` does not exist, skip this step silently — the wiki is opt-in.

## Step 5 — Report
Sections written/changed, TBDs, suggest `/twt-positioning-validate`.
