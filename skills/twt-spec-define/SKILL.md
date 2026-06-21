---
name: twt-spec-define
category: spec
description: (v1.0.2) Interview the user (brainstorming-style) into a north-star specification.md
version: 1.0.2
accepts_arguments: true
inputs:
  - Optional starting notes, a Figma URL, or answers; otherwise fully interactive
dependencies:
  hard: []
  soft:
    - figma-mcp
reads:
  - .twt-artifacts/pre-design/content-fetch/_manifest.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/spec/specification.md
  - .twt-artifacts/pre-design/spec/validation-report.md
writes:
  - .twt-artifacts/pre-design/spec/specification.md
  - .twt-artifacts/pre-design/spec/decisions.md
---

# /twt-spec-define

## Intent

**Purpose:** Produce the canonical `specification.md` — the project's **north-star intent**: vision & goals, functional requirements (capability-level), and — most important — the **visual style** and **motion/animation** direction. Built through a brainstorming-style interview that runs until every field is filled, or refined from an existing spec.

**Non-goals:**
- Doesn't produce the detailed per-page feature breakdown (that's the IA step — `/twt-ia-define` — which derives from this spec)
- Doesn't critique its own output (that's `/twt-spec-validate`)
- Doesn't extract from external sources itself — it reads what `/twt-content-fetch`, `/twt-brand`, and (optionally) Figma already produced
- Never overwrites `specification.md` without explicit user consent

**Success criteria:**
- `specification.md` exists with every canonical section populated — each field either user-answered or model-decided (and model-decided ones logged under `## Assumptions`)
- The **Visual Style** and **Motion & Animation** sections are concrete (specific direction, not vague adjectives like "modern/clean" with nothing behind them)
- On re-run with an existing spec, enters refinement mode (rule 10) rather than starting over
- No section contradicts `brand-brief.md`

---

## Step 1 — Detect mode (idempotency, CONVENTIONS rule 10)
If `.twt-artifacts/pre-design/spec/specification.md` exists → **refinement mode**: read it and any sibling `validation-report.md`; if findings exist, list them via the **AskUserQuestion** tool and ask which to address; only touch the chosen sections. If it does not exist → **from-scratch mode**.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft `specification.md` from the loaded context using best practice — including a concrete Visual Style and Motion direction — and for every choice you would otherwise have asked about (especially the visual direction), add an entry to `.twt-artifacts/pre-design/spec/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then write the draft and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize. In collect mode, the 2–3 art-direction options MUST be logged as the primary open question in `decisions.md` (header 'Art direction'), with `visual_direction: model-assumed` and the appropriate `figma:` value in the draft — so the orchestrator surfaces the direction choice to the user.

## Step 2 — Familiarize with provided information (before any question)
Load context so the interview is grounded, never generic:
- Read `.twt-artifacts/pre-design/content-fetch/_manifest.md` and skim the fetched content it points to (what the project is about, tone, offerings).
- Read `.twt-artifacts/pre-design/brand/brand-brief.md` (palette, typography, voice, audience) — the spec extends this, never contradicts it.
- If the user supplied a **Figma** URL (in `$ARGUMENTS` or when asked) and `mcp__plugin_figma_figma__*` tools are available, load the `figma:figma-use` skill, then pull `get_screenshot`, `get_metadata`, and `get_variable_defs` for visual/motion cues. If Figma MCP is unavailable, note it and continue.

Summarize back to the user, in 2-3 lines, what you understood from the above — so they know you're in context before the interview starts.

## Step 3 — Entry gate (do you have direction, or should I drive?)
**(Skipped in collect mode — see Step 1b.)** Ask via the **AskUserQuestion** tool (single-select, header "Direction"):
- **Interview me** — you have things to say about the project; walk through the questions together.
- **On your decision** — drive it from the loaded context using best practice, then show me the draft to review.

If **On your decision**: fill every field yourself from the context + common practice, recording each choice under `## Assumptions`, then jump to Step 5 and present the draft for review. If **Interview me**: proceed to Step 4.

## Step 4 — Gap-filling interview loop (until all gaps filled)
Walk the canonical sections **in this order, weighting Visual Style and Motion & Animation most heavily** (spend the most questions there): Vision & Goals → Functional Requirements → **Visual Style** → **Motion & Animation** → Constraints & Non-goals.

**Visual Style & Motion — propose, don't just ask (especially when no Figma):**
Instead of asking field-by-field, synthesize the loaded brand + content into **2–3 named art-direction options** and present them via the **AskUserQuestion** tool (header "Art direction") for the user to pick / edit / reject. Each option must specify:
- a short **name + one-line vibe** (e.g. "Editorial-minimal — calm, type-led, lots of whitespace")
- **palette rationale** relative to `brand-brief.md` (which brand colors lead, how used)
- **type pairing** (display + body intent)
- **visual density** (airy ↔ dense) and **imagery/illustration style**
- **light/dark stance**
- **motion personality** + key interactions + **reduced-motion stance**
The user's pick (possibly edited) becomes the Visual Style + Motion content. If they reject all, offer a fresh set. Record which option was chosen.

For **each other unresolved field** (Vision & Goals, Functional Requirements, Constraints & Non-goals), ask **one** question via the **AskUserQuestion** tool. Every such question MUST offer, as options:
1. **2-3 concrete best-practice candidate values** inferred from the loaded context (so the user can one-click a real answer — this is the "input" path; the tool's free-type escape also lets them type their own).
2. An explicit **"On your decision"** option — *description:* "I'll choose the best-practice fit from what's known and log it as an assumption."

If the user picks a candidate or free-types → record their answer. If the user picks **"On your decision"** → fill that field from best practice grounded in the loaded context, and add a line under `## Assumptions` naming the field and what you chose. Continue until **no field in any section is left blank**. (Pre-fill from brand-brief / content / Figma and confirm rather than re-ask where the answer is already implied.)

Field checklist per section (don't leave any blank):
- **Vision & Goals** — one-line vision; primary objective; 2-3 success signals.
- **Functional Requirements** — must-have capabilities at feature level (north-star list; IA expands the detail later).
- **Visual Style** — overall aesthetic direction; mood/keywords; visual density; imagery/illustration style; light/dark stance. Reject vagueness — pin down something specific and renderable.
- **Motion & Animation** — motion personality (e.g. calm/snappy/playful); key micro-interactions; page/section transitions; easing & timing feel; scroll behavior; **reduced-motion stance**.
- **Constraints & Non-goals** — tech/brand constraints; explicit out-of-scope.

## Step 5 — Write the spec
Write/update `.twt-artifacts/pre-design/spec/specification.md` (create the parent dir if needed). Confirm before overwriting an existing file (rule 10). Set `visual_direction: user-confirmed` only when the user actively picked/edited an art-direction option (interactive, or via a resolved `decisions.md` answer in collect mode); set `model-assumed` when it was filled autonomously without user confirmation. Set `figma: used` only if a Figma source actually informed the visual decisions, else `none`. Structure:
```
---
generated: <YYYY-MM-DD>
phase: pre-design
area: spec
visual_direction: <user-confirmed | model-assumed>
figma: <used | none>
---

# Project Specification

## Vision & Goals
<one-line vision · primary objective · success signals>

## Functional Requirements
<must-have capabilities, feature-level — north star; IA derives the detail>

## Visual Style
<aesthetic direction · mood/keywords · density · imagery style · light/dark>

## Motion & Animation
<motion personality · micro-interactions · transitions · easing/timing feel · scroll behavior · reduced-motion stance>

## Constraints & Non-goals
<constraints · explicit out-of-scope>

## Assumptions (model-decided)
<every field filled via "On your decision" — field: what was chosen and why — so the user/validator can revisit>

## Sources
<which content/brand/figma inputs informed this>
```
In refinement mode, only rewrite the sections the user chose; preserve the rest verbatim.

## Step 6 — Report
Sections written/changed, how many fields were user-answered vs model-decided (point at `## Assumptions`), and suggest `/twt-spec-validate` next (or `/twt-spec` to loop automatically).
