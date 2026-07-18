---
name: twt-component-define
category: component
description: (v1.3.13) Define component specs (components.md) and render a token-driven gallery.html (Primitives/Components/Modules)
version: 1.3.13
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

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch or external-skill load** (figma, design-taste-frontend, emil-design-eng, superpowers, …), run this one Bash line so the complete skill-call tree reaches the run log:
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
- `gallery.html` is scaffolded by `gen-gallery.mjs` (chrome + cell shells), links `../tokens.css`, and every `gal:fill` slot is filled with the component's variants/states (`--check` reports zero unfilled slots and zero inventory mismatches)
- Idempotent: refines an existing `components.md` (reading `validation-report.md`) instead of overwriting (rule 10)

---

## Step 1 — Dependency check
Read `tokens.md` + `tokens.css`. If either is missing, abort: "No design system — run /twt-design-system first."

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft the component specs (`components.md`, `gallery.html`) from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/design/design-system/component/decisions.md` (decisions.md format — frontmatter `generated`/`area`/`producer`/`status: open`; sections `## Open questions` (question — options [a,b,c] — model-leaning, plus an indented `- why it matters:` line), `## Model-decided assumptions (review)` (field = value — basis — reversible), `## Proposed rules (confirm before binding)`). Set `status: open`. After writing `decisions.md`, verify it (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file <its path>` — fix until it passes; three consumers (the orchestrator's surface-up flow, gen-report, wiki-harvest) parse this exact format, and a drifted section title is silently invisible to them. Then write the drafts and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

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
Structure `components.md` with one `## Primitives` / `## Components` / `## Modules` section per tier and one `### <Component name>` heading per component — `gen-gallery.mjs` parses exactly these headings to scaffold the gallery cells, so keep them literal (no numbering, no extra words in the tier headings).

For each component, write under its `###` heading:
- **Anatomy** — parts / sub-elements
- **Variants** — e.g. primary / secondary / ghost
- **States** — default / hover / focus / active / disabled (as applicable)
- **Tokens used** — explicit token names from `tokens.md` (colour / space / radius / type / shadow)
- **Responsive** — desktop / tablet / mobile behavior
Mark anything inferred. Never use a value that isn't a token.

**No-Figma anti-slop polish.** When the design wasn't driven by a Figma/exported source, apply the external design skills (per `references/external-design-skills.md`; read `design-read.md` for the dials, and project-local auto-install the skills if missing). From `design-taste-frontend`: **§4.4** use cards only where elevation conveys real hierarchy and lock to one corner-radius scale; **§4.5** specify the **full** interactive-state cycle (loading/empty/error, not just the happy path) and verify button text meets WCAG AA against its background; **§3.C** keep icons from one family — specifically the family recorded in `tokens.md` §2.8 (Iconography) when present (name each icon Primitive/slot by that family's glyph names, so `/twt-assets-produce` can fetch the real SVGs); if `tokens.md` lacks §2.8, note it as a gap for the design-system refinement rather than picking a family here. From `emil-design-eng`: specify the **hover / focus / `:active`** micro-interaction per interactive component as motion tokens (custom easing, short durations, `scale(0.97)`-style press feedback, reduced-motion fallback) — recorded as the component's documented motion, not invented foundation values.

## Step 5 — Render `gallery.html` (scaffold, fill, check)
`gallery.html` lives at `.twt-artifacts/design/design-system/component/gallery.html` — **inside** the design-system folder so that the `preview.html` link (`component/gallery.html`) resolves. It renders each component with **all variants and all states**, grouped under Primitives / Components / Modules.

### 5a — Scaffold (script)
Run (Bash):
```
node "${CLAUDE_PLUGIN_ROOT}/tools/gen-gallery.mjs" "$CLAUDE_PROJECT_DIR" --scaffold
```
**Run this command directly — do not hunt for the tool** (`${CLAUDE_PLUGIN_ROOT}` is always set; its only flags are `--scaffold` and `--check`). It writes the full page chrome — the doc-hub light skin (same canonical look `gen-preview.mjs` gives `preview.html`), the font links, the `../tokens.css` link, one `gal-tier` section per level, and one `gal-cell` shell per component from `components.md` / `tokens.md §3` — each cell holding a `<!-- gal:fill <Name> … -->` slot. **Never edit the `data-gal-chrome` style block or hand-write your own chrome** — the skin is script-owned now, exactly like preview's. If the existing `gallery.html` predates the scaffolder and must be preserved, skip the scaffold and only fill/fix in place.

⚠️ Scaffolding **overwrites** `gallery.html`. In refinement mode (Step 2 = Refine), only re-scaffold when the component set changed; otherwise edit the existing file's slots in place.

### 5b — Fill every slot (model)
Replace each `gal:fill` comment with that component's variant × state matrix, and put specimen CSS **only** in the `data-gal-specimens` style block. Rules:

- **Token-only specimens.** Every specimen value is `var(--…)` from `tokens.css` — no raw hex/rgba/px/font literals. (Chrome may hardcode; specimens never.)
- **Cell anatomy — one label per instance.** Each variant/state instance is its own `<div class="gal-var">` (`gal-var--row` for chip-sized items side by side, `gal-var--fill` for full-width fields): the specimen, then `<span class="gal-varlabel">hover</span>`. Never one run-on label ("default / hover / selected") that maps to specimens positionally. Optionally set the cell's `gal-meta` to one key token, and add a `gal-note` for token refs / behavior notes only (skip it when it adds nothing).
- **Dark-surface modules — on-ink override rule.** Any specimen on a dark surface (`--color-surface-contrast`, a hero gradient, an inverted footer) must explicitly override **every** text primitive inside it — body, caption, heading, nav, link — to the on-dark text token, via one scope class + one rule set: `.spec-on-ink :is(.spec-body,.spec-caption,.spec-h3,.spec-nav){color:var(--color-text-on-ink)}`, then `class="spec-hero spec-on-ink"`. Never rely on a text class's light-surface default cascading in — a bare `.spec-body` on an Ink hero disappears. Full-bleed dark modules use `<div class="gal-stage gal-stage--bare">` so the module surface replaces the dashed canvas.
- **Logo / image specimens.** Give logos an explicit `height` and `width:auto` — and inside any **column** flex container, an explicit `align-self:flex-start` (the flex default `stretch` distorts the wordmark). Don't blanket-force `align-self` in CSS — that breaks vertical centering in flex rows.

### 5c — Check (script) and fix
Run (Bash):
```
node "${CLAUDE_PLUGIN_ROOT}/tools/gen-gallery.mjs" "$CLAUDE_PROJECT_DIR" --check
```
It prints a ` ```json ` block: `unfilled_slots[]` (must end empty), `inventory_missing[]`/`inventory_extras[]` (gallery vs `components.md` + `tokens.md §3` — resolve every mismatch), `raw_values[]` (hardcoded literals in specimen CSS — replace with tokens), `imgs_missing_height[]`, and `dark_surface_suspects[]` (static-cascade heuristic — confirm each, then fix real ones with the on-ink scope pattern). Fix and re-run until `unfilled_slots`, `inventory_missing`, and `dark_surface_suspects` are empty; justify anything you deliberately keep in `components.md`. Don't write your own checker script — this is the only Bash this step needs.

## Step 6 — Report
List components written, both file paths, and what to run next (`/twt-component-validate`, then `/twt-layout-define`).
