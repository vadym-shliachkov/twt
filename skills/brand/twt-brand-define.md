---
name: twt-brand-define
category: brand
description: Build or refine the canonical brand-brief.md through guided dialogue
version: 1.0.2
accepts_arguments: true
inputs:
  - Optional starting notes or answers; otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-brand-fetch
reads:
  - .twt-artifacts/pre-design/brand/_fetched-brand.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/brand/validation-report.md
writes:
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/brand/decisions.md
---

# /twt-brand-define

## Intent

**Purpose:** Produce the canonical `brand-brief.md` — palette, typography, voice/tone, values, audience signals — either from scratch via interview or by refining an existing brief (including addressing validation findings).

**Non-goals:**
- Doesn't fetch from external sources (that's `/twt-brand-fetch`)
- Doesn't critique its own output (that's `/twt-brand-validate`)
- Never overwrites `brand-brief.md` without explicit user consent

**Success criteria:**
- `brand-brief.md` exists with all canonical sections populated or explicitly marked TBD
- On re-run with an existing brief, enters refinement mode rather than starting over
- Voice section has at least 3 attributes with do/don't examples

---

## Step 1 — Detect mode (idempotency, CONVENTIONS rule 10)
If `brand-brief.md` exists → **refinement mode**: read it and any sibling `validation-report.md`; if findings exist, list them and ask which to address. If it does not exist → **from-scratch mode**: read `_fetched-brand.md` if present to seed answers.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft the brand-brief from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/brand/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then write the draft brand-brief and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Interview / refine
**(Skipped in collect mode — see Step 1b.)** Walk the canonical sections one at a time (Identity → Palette → Typography → Voice & Tone → Audience signals). Ask focused questions; pre-fill from fetched notes where available and confirm rather than re-ask. In refinement mode, only touch the sections the user chose.

## Step 3 — Write the brief
Write/update `.twt-artifacts/pre-design/brand/brand-brief.md` with sections: `# Brand Brief`, `## Identity`, `## Palette` (table: name | hex | usage), `## Typography`, `## Voice & Tone` (attributes + do/don't), `## Audience signals`, `## Sources`. Mark unknowns `TBD` rather than guessing. Confirm before overwriting.

## Step 4 — Report
Sections written/changed, any remaining TBDs, and suggest `/twt-brand-validate` next.
