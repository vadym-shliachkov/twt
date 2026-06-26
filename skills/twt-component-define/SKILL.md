---
name: twt-component-define
category: component
description: (v1.3.5) Define component specs (components.md) and render a token-driven gallery.html (Primitives/Components/Modules)
version: 1.3.5
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
  - .twt-artifacts/design/design-system/component/validation-report.md
writes:
  - .twt-artifacts/design/design-system/component/components.md
  - .twt-artifacts/design/design-system/component/gallery.html
  - .twt-artifacts/design/design-system/component/decisions.md
---

# /twt-component-define

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before you load any external skill** (figma, design-taste-frontend, emil-design-eng, superpowers, …) or dispatch any sub-agent, run this one Bash line so those calls reach the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Document the component library the site needs — anatomy, variants, states, tokens, and responsive behavior per component, organized by **component-hierarchy level (Primitives → Components → Modules)** — and render the **exhaustive** variant/state catalog into a token-driven `gallery.html`. This is the **depth** counterpart to the design-system `preview.html` (**breadth** — every component once, organized by level); here every component appears with all its variants and states. (Levels are the atomic-design model relabelled: Atoms → Primitives, Molecules → Components, Organisms → Modules.)

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
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft the component specs (`components.md`, `gallery.html`) from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/design/component/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then write the drafts and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Detect state (idempotency, rule 10)
**(Skipped in collect mode — see Step 1b.)** If `components.md` exists, read it and any sibling `validation-report.md`; ask via the **AskUserQuestion** tool (single-select, header "State") before overwriting:
- **Use as-is** — keep the existing components.md unchanged and skip to Step 6
- **Refine** — enter refinement mode (address findings / requested components) instead of starting over
- **Rebuild** — discard the existing components.md and start from scratch
- **You decide** — I pick (Refine if a validation-report flags findings, else Use as-is); never Rebuild without confirmation

Record the choice and continue.

## Step 3 — Determine the component set
Derive the needed components from `sitemap.md` section types and the `outlines/`, and **bucket each by component-hierarchy level**: **Primitives** (button, input, label, badge, icon, divider, chip), **Components** (nav-item, form-row, search-bar, card-header), **Modules** (header, footer, hero, card, CTA strip, accordion). If `.twt-artifacts/design/design-system/tokens.md` Section 3 already lists the hierarchy (§3.2 Primitives / §3.3 Components / §3.4 Modules), reuse those names so the catalog and the design-system preview agree. Use `$ARGUMENTS` to scope to specific components when given. List the set and confirm with the user.

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
Write `gallery.html` at `.twt-artifacts/design/design-system/component/gallery.html` — it lives **inside** the design-system folder so that the `preview.html` link (`component/gallery.html`) resolves correctly. The file links `../tokens.css` (one level up, into `design-system/`), then renders each component with **all variants and all states**, grouped under **Primitives / Components / Modules** headings.

**Chrome vs. specimens — two separate style layers:**
- **Page chrome** (layout, labels, section headings, legends, captions, navigation) must use the **doc-hub light palette** so gallery.html and preview.html look visually consistent: background `#f7f3e8` (warm cream), primary text `#101214`, secondary/muted text `#363b42`, border `rgba(16,18,20,.14)`, font `Inter, ui-sans-serif, system-ui, sans-serif`. Hard-code these values in the `<style>` block — never use project tokens for chrome.
- **Component specimens** (the actual rendered previews of buttons, cards, inputs, etc.) must use only `var(--…)` references from `tokens.css` — no hardcoded colours or spacing. The tokens drive what the specimens look like, which is the whole point of the catalog.

At the top, note the relationship: this is the exhaustive **depth** catalog (all variants × states); `../preview.html` shows **breadth** — every token rendered live.

## Step 6 — Report
List components written, both file paths, and what to run next (`/twt-component-validate`, then `/twt-layout-define`).
