---
name: twt-spec-define
category: spec
description: (v1.1.2) Interview the user (brainstorming-style) into a north-star specification.md
version: 1.1.2
accepts_arguments: true
inputs:
  - Optional starting notes, a Figma URL, or answers; otherwise fully interactive
dependencies:
  hard: []
  soft:
    - figma-mcp
reads:
  - .twt-artifacts/pre-design/content/fetched/_manifest.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/spec/specification.md
  - .twt-artifacts/pre-design/spec/validation-report.md
writes:
  - .twt-artifacts/pre-design/spec/specification.md
  - .twt-artifacts/pre-design/spec/decisions.md
---

# /twt-spec-define

## Intent

**Purpose:** Produce the canonical `specification.md` — the project's **north-star intent**: vision & goals, functional requirements (capability-level), and — most important — the **visual style** and **motion/animation** direction. Built through a brainstorming-style interview that runs until the idea is clearly specified and the user confirms it, or refined from an existing spec.

**Non-goals:**
- Doesn't produce the detailed per-page feature breakdown (that's the IA step — `/twt-ia-define` — which derives from this spec)
- Doesn't critique its own output (that's `/twt-spec-validate`)
- Doesn't extract from external sources itself — it reads what `/twt-content-fetch`, `/twt-brand`, and (optionally) Figma already produced
- Never overwrites `specification.md` without explicit user consent

**Success criteria:**
- `specification.md` exists with every canonical section populated — each field either user-answered or model-decided (and model-decided ones logged under `## Assumptions`)
- The **Visual Style** and **Motion & Animation** sections are concrete (specific direction, not vague adjectives like "modern/clean" with nothing behind them)
- The interactive interview keeps asking while any area fails the concreteness gate (Step 4b) and ends with an explicit user reflect-and-confirm (with a safety cap); it does not stop merely because fields are non-empty
- On re-run with an existing spec, enters refinement mode (rule 10) rather than starting over
- No section contradicts `brand-brief.md`

---

## Step 1 — Detect mode (idempotency, CONVENTIONS rule 10)
If `.twt-artifacts/pre-design/spec/specification.md` exists → **refinement mode**: read it and any sibling `validation-report.md`; if findings exist, list them via the **AskUserQuestion** tool and ask which to address; only touch the chosen sections. If it does not exist → **from-scratch mode**.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft `specification.md` from the loaded context using best practice — including a concrete Visual Style and Motion direction — and for every choice you would otherwise have asked about (especially the visual direction), add an entry to `.twt-artifacts/pre-design/spec/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then write the draft and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize. In collect mode, the 2–3 art-direction options MUST be logged as the primary open question in `decisions.md` (header 'Art direction'), with `visual_direction: model-assumed` and the appropriate `figma:` value in the draft — so the orchestrator surfaces the direction choice to the user.

The brainstorming interview (Steps 3b–4b) is **interactive-only**; in collect mode there is no user, so draft best-effort and log to `decisions.md` every fork the concreteness gate (Step 4b) would have probed — especially any area it would flag vague (visual and motion above all), in addition to the art-direction open question already required above.

## Step 2 — Familiarize with provided information (before any question)
Load context so the interview is grounded, never generic:
- Read `.twt-artifacts/pre-design/content/fetched/_manifest.md` and skim the fetched content it points to (what the project is about, tone, offerings).
- Read `.twt-artifacts/pre-design/brand/brand-brief.md` (palette, typography, voice, audience) — the spec extends this, never contradicts it.
- If the user supplied a **Figma** URL (in `$ARGUMENTS` or when asked) and `mcp__plugin_figma_figma__*` tools are available, load the `figma:figma-use` skill, then pull `get_screenshot`, `get_metadata`, and `get_variable_defs` for visual/motion cues. If Figma MCP is unavailable, note it and continue.

Summarize back to the user, in 2-3 lines, what you understood from the above — so they know you're in context before the interview starts.

## Step 3 — Entry gate (do you have direction, or should I drive?)
**(Skipped in collect mode — see Step 1b.)** After Step 2's summary, ask via the **AskUserQuestion** tool (single-select, header "Direction"):
- **Interview me** — brainstorm the project together, one question at a time, until the idea is clearly specified.
- **On your decision** — drive it from the loaded context using best practice, then show me the draft to review.

If **On your decision**: fill every area yourself from the context + common practice, record each choice under `## Assumptions`, then jump to Step 5. If **Interview me**: proceed to Step 3b.

## Step 3b — Scope check (before deep questions)
**(Skipped in collect mode — see Step 1b.)** Assess scope first. If the project spans multiple **independent** subsystems (e.g. a marketing site + a separate web app + a standalone blog platform), flag it and help decompose: name the independent pieces, pick the **first** sub-scope to specify now, and note the rest for later spec cycles. A normal single-site project passes straight through — do not manufacture decomposition where there is one cohesive thing.

## Step 4 — Brainstorming interview (adaptive; until the idea is clear)
**(Skipped in collect mode — see Step 1b.)** Interview like a thoughtful design partner — **not** a fixed form:

- **One question at a time**, each driven by the previous answer. Prefer the **AskUserQuestion** tool for fixed-option forks — always offering 2–3 concrete best-practice candidates inferred from the loaded brand/content **plus** an explicit **"You decide"** option (§4). Use plain-text prompts for open input (names, URLs, pasted descriptions).
- **Dig into vagueness.** When an answer is an empty adjective — "modern", "clean", "minimal", "engaging", "professional" — with nothing behind it, do **not** accept it and move on. Ask a targeted follow-up that forces something specific and renderable (a reference site to emulate, a concrete trait, a real example).
- **Propose, don't just ask.** For any genuinely open direction, synthesize the loaded context into **2–3 named approaches** — each a short name + one-line vibe + the tradeoff — lead with your recommendation, and let the user pick / edit / reject. Required for **Visual Style** and **Motion** (art-direction options); apply the same pattern to any other open fork (tone, audience emphasis, scope priorities).
- **Reflect as you go.** Every few questions, restate "here's what I understand so far" in 1–2 lines so the idea visibly takes shape and the user can correct course early.
- **Weight the effort.** Spend the most questions on **Visual Style** and **Motion & Animation** (the north-star direction the design phase binds to); touch Vision & Goals, Functional Requirements, and Constraints & Non-goals through the same dialogue.

Areas to pin down (reached through dialogue, not marched through): Vision & Goals · Functional Requirements · **Visual Style** · **Motion & Animation** · Constraints & Non-goals. Pre-fill from brand-brief / content / Figma and confirm rather than re-ask where the answer is already implied.

## Step 4b — Concreteness gate + reflect-and-confirm (when to stop)
Do **not** stop just because every field is non-empty. Stop only when the idea is genuinely clear **and** the user confirms.

**Model gate — keep going while anything is vague.** Self-assess each area against this checklist; while any fails, ask a targeted follow-up (Step 4) rather than moving on:
- **Vision & Goals** — one *specific* vision line (not a platitude); ≥2 measurable success signals.
- **Functional Requirements** — must-have capabilities at feature level, realistic and scoped (not a wishlist); rough priority clear.
- **Visual Style** — concrete + renderable: specific aesthetic, palette lead (vs `brand-brief.md`), type intent, visual density, imagery style, light/dark stance. Empty adjectives fail.
- **Motion & Animation** — motion personality, key micro-interactions, transitions, easing/timing feel, scroll behavior, **reduced-motion stance**.
- **Constraints & Non-goals** — explicit tech/brand constraints and out-of-scope.

**Reflect-and-confirm.** Once every area passes, reflect the whole idea back — a 2–3 line synthesis plus the key decisions (chosen direction, priorities, non-goals) — then ask via the **AskUserQuestion** tool (single-select, header "Captured?"):
- **Yes, that's the idea** — proceed to Step 5 and write.
- **Keep refining** — the user names what's off; return to Step 4.
- **Adjust an area** — the user picks which; revisit just that area.

Write the spec only after an explicit **Yes**.

**Safety cap.** After roughly 8–10 substantive questions, or whenever the user says "just write it," stop escalating: present what's captured, mark any still-thin areas under `## Assumptions`, and ask confirm-or-continue rather than looping indefinitely.

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

## Step 6 — Report
Sections written/changed, how many fields were user-answered vs model-decided (point at `## Assumptions`), and suggest `/twt-spec-validate` next (or `/twt-spec` to loop automatically).
