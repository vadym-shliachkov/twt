---
name: twt-component-define
category: component
description: Define component specs (components.md) and render a token-driven gallery.html
version: 1.3.1
accepts_arguments: true
inputs:
  - Optional: which components to (re)define; otherwise derive from IA/outlines
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/design/design-system/tokens.md
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/curation/outlines/
  - .twt-artifacts/design/design-read.md
  - references/external-design-skills.md
  - .twt-artifacts/design/component/validation-report.md
writes:
  - .twt-artifacts/design/component/components.md
  - .twt-artifacts/design/component/gallery.html
  - .twt-artifacts/design/component/decisions.md
---

# /twt-component-define

## Intent

**Purpose:** Document the component library the site needs — anatomy, variants, states, tokens, and responsive behavior per component, organized by **canonical atomic level (Atoms → Molecules → Organisms)** — and render the **exhaustive** variant/state catalog into a token-driven `gallery.html`. This is the **depth** counterpart to the design-system `preview.html` (**breadth** — every component once, organized by atomic level); here every component appears with all its variants and states.

**Non-goals:**
- Doesn't invent components the IA/outlines don't need
- Doesn't hardcode foundation values — components reference tokens from `tokens.css`
- Doesn't re-render the breadth evolution showcase (every component once, by level) — that's the design-system `preview.html`; this is the full variant/state catalog (depth)
- Doesn't build production code (Phase 3 owns that)

**Success criteria:**
- `components.md` documents each component with anatomy · variants · states · tokens · responsive behavior
- `gallery.html` renders every component/variant/state and links `../design-system/tokens.css`
- Idempotent: refines an existing `components.md` (reading `validation-report.md`) instead of overwriting (rule 10)

---

## Step 1 — Dependency check
Read `tokens.md` + `tokens.css`. If either is missing, abort: "No design system — run /twt-design-system first."

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft the component specs (`components.md`, `gallery.html`) from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/design/component/decisions.md` (use `templates/decisions.md`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then write the drafts and return the decisions block in your report. Do not loop on the user.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Detect state (idempotency, rule 10)
**(Skipped in collect mode — see Step 1b.)** If `components.md` exists, read it and any sibling `validation-report.md`; ask via the **AskUserQuestion** tool (single-select, header "State") before overwriting:
- **Use as-is** — keep the existing components.md unchanged and skip to Step 6
- **Refine** — enter refinement mode (address findings / requested components) instead of starting over
- **Rebuild** — discard the existing components.md and start from scratch
- **You decide** — I pick (Refine if a validation-report flags findings, else Use as-is); never Rebuild without confirmation

Record the choice and continue.

## Step 3 — Determine the component set
Derive the needed components from `sitemap.md` section types and the `outlines/`, and **bucket each by canonical atomic level**: **Atoms** (button, input, label, badge, icon, divider, chip), **Molecules** (nav-item, form-row, search-bar, card-header), **Organisms** (header, footer, hero, card, CTA strip, accordion). If `.twt-artifacts/design/design-system/tokens.md` Section 3 already lists an atomic hierarchy, reuse those names so the catalog and the design-system preview agree. Use `$ARGUMENTS` to scope to specific components when given. List the set and confirm with the user.

## Step 4 — Specify each component
For each component, write to `components.md`:
- **Anatomy** — parts / sub-elements
- **Variants** — e.g. primary / secondary / ghost
- **States** — default / hover / focus / active / disabled (as applicable)
- **Tokens used** — explicit token names from `tokens.md` (colour / space / radius / type / shadow)
- **Responsive** — desktop / tablet / mobile behavior
Mark anything inferred. Never use a value that isn't a token.

**No-Figma anti-slop polish.** When the design wasn't driven by a Figma/exported source, apply the external design skills (per `references/external-design-skills.md`; read `design-read.md` for the dials, and project-local auto-install the skills if missing). From `design-taste-frontend`: **§4.4** use cards only where elevation conveys real hierarchy and lock to one corner-radius scale; **§4.5** specify the **full** interactive-state cycle (loading/empty/error, not just the happy path) and verify button text meets WCAG AA against its background; **§3.C** keep icons from one family. From `emil-design-eng`: specify the **hover / focus / `:active`** micro-interaction per interactive component as motion tokens (custom easing, short durations, `scale(0.97)`-style press feedback, reduced-motion fallback) — recorded as the component's documented motion, not invented foundation values.

## Step 5 — Render `gallery.html` (exhaustive catalog)
Write `gallery.html`: a single page that links `../design-system/tokens.css`, then renders each component with **all variants and all states**, grouped under **Atoms / Molecules / Organisms** headings (matching the design-system preview's levels). Use only `var(--…)` for foundation values — no hardcoded colours/spacing. A small embedded `<style>` block for gallery layout only is fine. At the top, note the relationship: this is the exhaustive **depth** catalog (all variants × states); `../design-system/preview.html` shows **breadth** — every component once, by atomic level (the evolution).

## Step 6 — Report
List components written, both file paths, and what to run next (`/twt-component-validate` or `/twt-layout`).
