---
name: twt-mockup-define
category: mockup
description: (v1.3.0) Render fully-responsive plain-HTML/CSS page mockups from layouts, components, real content, and the facts ledger
version: 1.3.0
accepts_arguments: true
inputs:
  - Optional: which page(s) to (re)render; otherwise all layouts
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/design/layout/layouts/
  - .twt-artifacts/design/component/components.md
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/pre-design/spec/specification.md
  - .twt-artifacts/pre-design/curation/inventory.md
  - .twt-artifacts/pre-design/curation/outlines/
  - .twt-artifacts/pre-design/curation/facts.md
  - .twt-artifacts/design/design-read.md
  - references/external-design-skills.md
  - .twt-artifacts/design/mockup/validation-report.md
writes:
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/design/mockup/index.html
  - .twt-artifacts/design/mockup/styles.css
  - .twt-artifacts/design/mockup/decisions.md
  - .twt-artifacts/design/assets/manifest.md
---

# /twt-mockup-define

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before you load any external skill** (figma, design-taste-frontend, emil-design-eng, superpowers, …) or dispatch any sub-agent, run this one Bash line so those calls reach the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Render each page layout into a fully-responsive (desktop/tablet/mobile) plain-HTML/CSS hi-fi mockup populated with real Phase-1 content, plus a review `index.html`. Foundation values come from `tokens.css`; mockup-only layout CSS lives in `styles.css`.

**Non-goals:**
- Doesn't create production WordPress/Elementor output (Phase 3)
- Doesn't introduce new colour/type/spacing primitives — those come from `tokens.css`
- Doesn't use lorem/placeholder where real Phase-1 content exists
- Doesn't shell out to transform the HTML it writes — **no `perl -pe`/`sed -i` in-place edits, no `cat > x.mjs <<EOF … node x.mjs` heredoc scripts, no `cmd1 && cmd2` chains**. Edit pages with the **Edit** tool and read them with Read/Glob/Grep; those throwaway shell forms trip the obfuscation guard and prompt the user on every run, whereas the file tools are silent. (E.g. to swap an em-dash for a middot across pages, use Edit per file, not a `perl` loop.)

**Success criteria:**
- One `pages/<page-slug>.html` per layout, linking `../design-system/tokens.css` and `../styles.css` (relative to `pages/`)
- All three breakpoints handled in CSS; real content from outlines/inventory
- `index.html` links every page mockup
- Idempotent: re-renders only requested pages, refines (reading `validation-report.md`) (rule 10)

---

## Step 1 — Dependency check
Read `layouts/`, `components.md`, and `tokens.css`. If `layouts/` is empty, abort: "No layouts — run /twt-layout-define first." If `tokens.css` is missing, abort: "No design system — run /twt-design-system first."

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft the page mockups (`index.html`, `pages/<page>.html`) from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/design/mockup/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then write the drafts and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Detect state (idempotency, rule 10)
**(Skipped in collect mode — see Step 1b.)** If `pages/` has files, read any `validation-report.md`; enter refinement mode (address findings / requested pages). Before overwriting an existing page, ask via the **AskUserQuestion** tool (single-select, header "Overwrite?"):
- **Yes** — overwrite the existing page file
- **No** — skip this page and leave it unchanged
- **You decide** — I choose per page, defaulting to No (refine in place; never overwrite a user-edited file without confirmation)

Record the choice and continue.

## Step 3 — Prepare shared CSS
Write/refresh `styles.css` with mockup-only **layout** rules (grids, section spacing, container widths, responsive breakpoints). Use `var(--…)` from `tokens.css` for all foundation values; introduce no new colour/type/spacing primitives. If `.twt-artifacts/pre-design/spec/specification.md` exists, read its **Motion & Animation** section and reflect that direction (transitions, micro-interaction feel, easing/timing via `var(--motion-*)`, and the stated **reduced-motion** stance via a `@media (prefers-reduced-motion: reduce)` block). Define the three breakpoints from the design-system grid. This shared file must be **complete before Step 4** — the parallel page agents only read it, never write it. Also resolve every Step 2 overwrite decision now, so Step 4 is non-interactive; the result is a final set of page slugs to (re)render.

### Step 3′ — No-Figma anti-slop + motion polish
When the design wasn't driven by a Figma/exported source, apply the external design skills (per `references/external-design-skills.md`; read `.twt-artifacts/design/design-read.md` for the Design Read + dials, and project-local auto-install the skills if missing). Bake these into `styles.css` and pass them to the page agents:
- **`emil-design-eng` motion** — translate the spec's motion direction (or the dials' `MOTION_INTENSITY`) into real CSS: custom easing curves (`cubic-bezier(...)`, **never `ease-in`**), durations scaled by element type (<300ms for small UI), `:active` press feedback (e.g. `transform: scale(0.97)`, never `scale(0)`), hover/focus transitions on **transform/opacity only**, and a `@media (prefers-reduced-motion: reduce)` block that collapses motion. "Motion claimed = motion shown": if `MOTION_INTENSITY>4` the pages must actually move; if it can't be done cleanly, drop to static rather than ship half-built motion.
- **`design-taste-frontend` anti-slop** — carry §4.3–4.11 + §9 into the page agents (next step): real images via the asset manifest (never div-based fake screenshots), one locked accent + one radius scale, hero fits the viewport, **eyebrow restraint**, **zigzag cap**, **no em-dashes** anywhere, no decorative status dots / version stamps / locale strips / scroll cues.

## Step 4 — Render each page (in parallel)
`styles.css` is now final and each page writes its own `pages/<page-slug>.html`, so the pages are independent — **dispatch one Agent per page in a single batch of parallel Agent calls** (one message, multiple Agent tool uses), not one at a time. Give each agent a self-contained prompt instructing it to read `layouts/<page-slug>.md`, `components.md`, `tokens.css`, `styles.css`, the page's `outlines/<page>.md` / `inventory.md`, and `facts.md` (the reusable-facts + provided-assets ledger, if present), then write `pages/<page-slug>.html`:
- `<head>` links `../design-system/tokens.css` then `../styles.css`.
- Build sections in the layout's order, composing the documented components.
- Populate with **real content** pulled from `outlines/<page>.md` / `inventory.md` — never lorem where real content exists.
- **Bind reusable facts to `facts.md`** (when present): use the exact `canonical` string for tenure, counts, the self-descriptor noun, per-client metrics, etc. — the same fact must read identically everywhere it appears **on this page and across pages**. Never emit a value that contradicts the ledger; a CONFLICT / TBD / UNVERIFIED-ATTR fact renders with a visible `TBD` flag, not a guessed number. (No `facts.md`, e.g. Figma express → fall back to binding facts to `outlines`/`inventory` as before.)
- **Use provided assets before placeholders.** For logos/brand marks, reference the real file from `facts.md`'s provided-assets table whenever one covers the surface (e.g. the reversed-white logo on the Ink footer). Only synthesize a placeholder when **no** provided asset serves that surface, and then flag it `TBD`. Never hand-build a wordmark/logo (rects/paths spelling the name) when a provided file exists — that both violates brand logo rules and trips the design-taste "no hand-rolled decorative SVG" rule.
- **Interactive-claim integrity.** If a section's copy promises that an interactive control changes the output ("pick who you are and see your tailored read"), the JS must actually make that control change the output. A required input that only gates but never alters the result is a defect — either wire it to differentiate the output or remove the promise from the copy. Keep every no-JS / reduced-motion fallback.
- Ensure desktop/tablet/mobile all render correctly (responsive CSS in `styles.css`).
- Basic a11y: `alt` on images, sensible heading order, landmark elements.
- **Anti-slop (no-Figma):** follow the `design-taste-frontend` rules carried from Step 3′ — hero fits the viewport (headline ≤2 lines, CTA above the fold), ≤1 eyebrow per 3 sections, ≤4 distinct layout families reused across the page, real images from the asset manifest (no `<div>` fake screenshots, no hand-rolled decorative SVG), the locked single accent + one radius scale, full button contrast (WCAG AA), and **zero em-dashes** in any visible string.
- Write **only** its own `pages/<page-slug>.html`. It must **not** edit the shared `styles.css`; if a page needs a layout rule that `styles.css` lacks, the agent reports it back in its summary so the parent can add it to `styles.css` after the batch (then, if needed, re-dispatch that page).

Wait for all the page agents to finish before Step 5.

### Step 4′ — Pre-flight self-check (no-Figma)
Before writing `index.html`, run `design-taste-frontend` **§14 Pre-flight** across the rendered pages as a self-check (highest-signal items: zero em-dashes; one theme + one accent + one radius scale page-wide; hero fits viewport; eyebrow count ≤ ceil(sections/3); no three-equal-card rows; no fake div screenshots; motion-claimed = motion-shown; reduced-motion present; AA button/contrast). **Add three factual-integrity checks:** (1) **fact consistency** — every reusable fact matches its `facts.md` canonical and reads identically within each page *and* across all pages (no 20+/25+/"three-decades" split, no clients/engagements drift); (2) **provided assets** — real logos from the ledger are used wherever a variant covers the surface, with no hand-rolled wordmark placeholder standing in for an available file; (3) **interactive integrity** — every interactive control the copy references actually changes the output (no required-but-ignored input). Fix any failure in the offending page before proceeding. If a failure can't be fixed here (e.g. needs a missing layout rule in `styles.css`), add the shared rule, then re-dispatch that page. Record any judgment calls in `decisions.md`.

## Step 5 — Write `index.html`
Write `index.html` (at the mockup root) linking every `pages/<page-slug>.html` with the page title, for review.

## Step 6 — Asset manifest (sync)
Run (Bash) to extract all asset references from the rendered mockups deterministically:
```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/scan-manifest.mjs" "$CLAUDE_PROJECT_DIR/.twt-artifacts/design/mockup"
```
This outputs JSON `[{file, src, type, resolved, exists}]` covering `<img>`, `<video>`, and CSS `background-image` references. Use this list to identify which assets are referenced. For each entry where `exists: false` (local asset missing) or `exists: null` (external URL), ensure a manifest row exists. Ensure each has a row in `.twt-artifacts/design/assets/manifest.md` (create in the asset-manifest format — frontmatter `generated`/`phase: design`/`area: assets`, a `# Asset manifest` heading, and a table with columns id | type (image|video) | filename (kebab-case, web format) | placement (page → section → slot) | spec (dimensions/aspect/treatment) | alt | source (generate|stock|provided) | generation_prompt if absent; append missing rows, dedupe by `filename`). Use the SAME `filename` in the mockup markup and the manifest row so develop and QA can reconcile them. Run this **serially in this parent** (not in the parallel Step-4 agents). Each row carries id/type/filename/placement/spec/alt/source/generation_prompt; plan only, mark client-supplied assets `source: provided`. Do not generate binaries. **Cross-check logo/brand-mark references against `facts.md`'s provided-assets table:** if a mockup points at a synthesized placeholder for a surface the ledger lists as `provided`, that is a defect — fix the page to reference the real file. Only a surface with no provided variant keeps a placeholder, flagged `TBD`.

## Step 7 — Report
List the pages rendered, the `index.html` path, the asset rows synced to the manifest, and what to run next (`/twt-mockup-validate` or `/twt-design`). Note these are throwaway visual references, not the production build.
