---
name: twt-direction-define
category: direction
description: (v1.0.1) Render 2–3 competing visual-direction style tiles and lock the chosen one into design-read.md
version: 1.0.1
accepts_arguments: true
inputs:
  - "Optional: number of directions (2 or 3, default 3); or a chosen direction slug / resolved answers (finalize mode)"
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/spec/specification.md
  - .twt-artifacts/design/design-read.md
  - references/external-design-skills.md
  - .twt-artifacts/design/direction/directions.md
writes:
  - .twt-artifacts/design/direction/directions.md
  - .twt-artifacts/design/direction/tiles/
  - .twt-artifacts/design/direction/index.html
  - .twt-artifacts/design/direction/decisions.md
  - .twt-artifacts/design/design-read.md
---

# /twt-direction-define

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before you load any external skill** (figma, design-taste-frontend, emil-design-eng, superpowers, …) or dispatch any sub-agent, run this one Bash line so those calls reach the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Before any tokens are committed, render the brand as **2–3 genuinely distinct visual directions** — small self-contained HTML "style tiles" built from real Phase-1 copy — so the user chooses the site's aesthetic **by looking**, not by reading dial numbers. The winning direction is locked into `design-read.md`, which every design sub-area inherits. This mirrors the pilot-page gate in Development: catch a wrong direction after one cheap artifact, not after the full design-system → components → layouts → mockups chain.

**Non-goals:**
- Not a design system — tiles are throwaway comparison artifacts; no `tokens.css`, no `components.md` (that's `/twt-design-system-define` / `/twt-component-define`)
- Doesn't invent copy — tiles reuse real headline/CTA/body lines from positioning/brand, and the **same content appears in every tile** so only the design varies
- Doesn't run when a Figma/exported design drives the project — that design is authoritative; direction exploration is for the no-source (greenfield) path
- Doesn't loop generating endless variants — one set, one pick, at most one revision pass

**Success criteria:**
- 2–3 tiles at `direction/tiles/<slug>.html`, each self-contained, each a visibly different aesthetic family, all sharing identical real content
- `index.html` compares them side by side with a per-direction spec table
- `directions.md` documents every candidate (family, type pairing, palette, shape/density, motion, dials) and carries a `chosen:` field
- On finalize, `design-read.md` reflects the chosen direction with `status: confirmed` (user picked) or `model-decided` (You decide / unattended)
- Idempotent: an existing tile set is refined or re-used, never silently re-rendered from scratch (rule 10)

---

## Step 1 — Dependency check & gate
Read whichever of these exist: `.twt-artifacts/pre-design/brand/brand-brief.md`, `.twt-artifacts/pre-design/positioning/positioning.md`, `.twt-artifacts/pre-design/spec/specification.md`, and `.twt-artifacts/design/design-read.md` (a *proposed* read may already exist from `/twt-design` Step 1a). If **none** of the three Phase-1 inputs exists, abort: "No brand/positioning/spec input — run /twt-pre-design (or at least /twt-brand) first." If the project is driven by a provided Figma/exported design (the dispatching orchestrator says so, or the user states it), stop and say direction is fixed by the provided design — nothing to explore.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Run Steps 3–4 (derive + render + write `directions.md` with `chosen:` empty), skip the interactive pick, and write `.twt-artifacts/design/direction/decisions.md` (decisions.md format — frontmatter `generated`/`area: direction`/`producer: twt-direction-define`/`status: open`; sections `## Open questions` (question — options [a,b,c] — model-leaning, plus an indented `- why it matters:` line), `## Model-decided assumptions (review)` (field = value — basis — reversible), `## Proposed rules (confirm before binding)`). The one mandatory open question is **"Which visual direction?"** — options are the tile slugs (plus `revise`), the leaning is your best-fit pick with a one-line why, and `why it matters:` names what binds to it (tokens, type, layout paradigm). After writing `decisions.md`, verify it (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file <its path>` — fix until it passes. Return the decisions block in your report. **Stay in-project:** never read outside this project for templates or examples; every format you need is in this skill.

If `$ARGUMENTS` additionally contains a resolved answer (a chosen direction slug, or adjustments — re-dispatch in refinement mode), apply it: revise the named tile if changes were requested (once), then jump to Step 6 to finalize, and set `decisions.md` `status: resolved`.

## Step 2 — Detect state (idempotency, rule 10)
**(Skipped in collect mode — see Step 1b.)** If `.twt-artifacts/design/direction/directions.md` already exists:
- With `chosen:` set → the direction was already decided. Ask via **AskUserQuestion** (single-select, header "Direction set"): **Keep** (report and stop) / **Re-open** (re-render and pick again) / **You decide** (default Keep).
- With tiles present but no choice → skip straight to the pick (Step 5), unless the user asked for new/changed directions.
- Never overwrite an existing tile set without the user choosing re-render.

## Step 3 — Derive the candidate directions
Ensure `design-taste-frontend` is installed per `references/external-design-skills.md` Step A (project-local auto-install; if the fetch fails, don't block — fall back to the inlined discipline below). Then derive **3 candidates** by default (`$ARGUMENTS` may set 2):
- When a *proposed* `design-read.md` exists, candidate #1 **is** that proposed read — the tiles make it visible; the others are true alternates.
- Candidates must be **genuinely distinct aesthetic families** (e.g. editorial/serif, minimal-geometric, bold-expressive, premium-dark, warm-humanist) — never three tints of one idea. Each pair of candidates must differ in at least: type pairing, hero/layout paradigm, and accent usage.
- **Brand facts win everywhere:** logo, any mandated palette values, and voice constraints hold in *every* candidate; candidates vary only what the brief leaves open.
- Taste discipline (design-taste-frontend §4.1/§4.2): no Inter-by-default — each candidate names a real, brief-appropriate pairing; one accent <80% saturation; the AI-purple glow and beige+brass premium-consumer palette are banned as defaults.
- Record per candidate: **name**, **slug** (kebab-case), one-line read, dials (DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY, 1–10), type pairing (specific families + roles), palette (bg / surface / ink / muted / accent as hex), shape (radius + border character), density/spacing character, motion character (easing/duration feel, from emil principles), and a one-line **why it fits** citing the brief.

## Step 4 — Render the tiles
Write one `tiles/<slug>.html` per candidate — **fully self-contained**: all CSS inline in a `<style>` block; a Google Fonts `<link>` is allowed; no JS. Fixed anatomy, same order in every tile, so directions compare fairly:
1. Mini header — wordmark + 3 nav labels + a button
2. Hero — real headline (≤2 lines) + subline + primary/secondary CTA pair
3. Type specimen — display / H2 / body / caption, each labeled with family + size
4. Palette strip — swatches with hex + role labels
5. One content card + one form field + a button-states row (default / hover / disabled shown statically side by side)
6. Footer strip

Rules: content is **identical across tiles** (same real copy pulled from positioning/brand — never lorem); only the design varies. The hero must express each candidate's layout paradigm (an editorial split vs a centered minimal vs a full-bleed bold — not one centered hero re-skinned). Body-text and button color pairings meet **WCAG AA** in every tile. Honor each candidate's dials (density → spacing/radius; variance → hero asymmetry).

Then write `index.html` — the comparison page (inline CSS only): a spec table with one column per direction (family, type pairing, accent, density, motion, one-line why), and each tile embedded via `<iframe>` (scaled down, e.g. `transform: scale(.5)` in a clipped wrapper) with its name and an "open full page" link to the tile file.

Finally write `directions.md`: frontmatter `generated` / `phase: design` / `area: direction` / `chosen: ""` / `chosen_at: ""`; a `# Visual directions` heading; one `## <Name> (<slug>)` section per candidate carrying every field from Step 3; and a closing `## Comparison` table (direction × type/accent/layout/motion/dials).

## Step 5 — The pick (interactive only; skipped in collect mode)
Report the path of `direction/index.html` and tell the user to open it in a browser before answering. Then ask via **AskUserQuestion** (single-select, header "Direction"): one option per direction (label = its name; description = the one-line read + type/accent summary) plus **You decide** (the model picks the best fit against the brief; per §4 this resolves only this question). A free-typed answer is a **revision request**: apply it to the named tile(s), re-render once, and re-ask once — no open-ended variant loop.

## Step 6 — Finalize
Set `chosen: <slug>` + `chosen_at` in `directions.md`. Then update `.twt-artifacts/design/design-read.md` so every downstream design sub-area inherits the winner — create it if absent, in this format: frontmatter `status:` + `visual_decision:`; `# Design Read`; a one-line read ("Reading this as <page kind> for <audience>, <vibe> language, leaning <aesthetic family>"); a **Dials** table (DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY, value 1–10 + why); **Direction notes** for Type / Color / Layout / Motion; **Constraints carried from Phase 1**; and a **User decisions** block (Choice / references to emulate-or-avoid / adjusted dials). Fill it from the chosen candidate: its dials, its type/color/layout/motion notes, `Choice: style tile "<name>"`, and set `status: confirmed` when the user picked, or `model-decided` on You-decide/unattended. A real brand/spec fact still wins over any tile value — never let a tile override a provided brand constraint.

## Step 7 — Report
Tell the user: the tiles and comparison page written (with paths), the chosen direction and what it locked into `design-read.md` (or the open decision returned, in collect mode), and what to run next — `/twt-design` continues with the design system, or standalone `/twt-design-system` builds tokens from the confirmed read.
