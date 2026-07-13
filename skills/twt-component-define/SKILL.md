---
name: twt-component-define
category: component
description: (v1.3.9) Define component specs (components.md) and render a token-driven gallery.html (Primitives/Components/Modules)
version: 1.3.9
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
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft the component specs (`components.md`, `gallery.html`) from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/design/design-system/component/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then write the drafts and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

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
- **Page chrome** (layout, labels, section headings, legends, captions, navigation) must use the **doc-hub light skin** — the exact same canonical look `gen-preview.mjs` renders into `preview.html`, so the two sheets are visually indistinguishable. Hard-code these values in the `<style>` block — **never** use project `var(--…)` tokens for chrome. Copy the skin block below verbatim. **Component specimens** (the rendered previews of buttons, cards, inputs, etc.) must use only `var(--…)` references from `tokens.css` — no hardcoded colours or spacing. The tokens drive what the specimens look like; that's the whole point of the catalog.

**Load the chrome fonts** in `<head>` (Montserrat display + Inter body + IBM Plex Mono — the same three `preview.html` uses), then `../tokens.css`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700;800;900&display=swap">
<link rel="stylesheet" href="../tokens.css">
```

**Doc-hub light skin — paste this chrome `<style>` block verbatim** (all classes namespaced `gal-` so they never collide with specimen markup or `tokens.css`):
```css
:root{
  --gal-page:#ffffff; --gal-panel:#ffffff; --gal-panel-soft:#f8f9fc;
  --gal-ink:#090e22; --gal-text:#3a3f5c; --gal-muted:#7a82a8;
  --gal-rule:#dde0ee; --gal-rule-soft:rgba(122,130,168,.18);
  --gal-red:#ca221f; --gal-blue:#0b68b7; --gal-yellow:#f6c22b;
  --gal-action:#090e22; --gal-action-hover:#0e1630;
  --gal-font-heading:Montserrat,Avenir Next,ui-sans-serif,system-ui,sans-serif;
  --gal-font-body:Inter,Segoe UI,ui-sans-serif,system-ui,sans-serif;
  --gal-font-mono:"IBM Plex Mono",SFMono-Regular,Menlo,Consolas,monospace;
}
html{background:var(--gal-page)}
body{margin:0;min-width:320px;color:var(--gal-text);background:var(--gal-page);font-family:var(--gal-font-body);line-height:1.55;text-rendering:optimizeLegibility}
code{font-family:var(--gal-font-mono);font-size:.88em}
.gal-wrap{max-width:1120px;margin:0 auto;padding:64px 24px 96px}
.gal-head{padding:24px 0 52px;border-bottom:1px solid var(--gal-rule)}
.gal-project{display:block;margin:0 0 26px;color:var(--gal-blue);font-family:var(--gal-font-heading);font-size:clamp(1.45rem,3vw,2.15rem);font-weight:800;line-height:1.12}
.gal-project::after{content:"";display:block;width:72px;height:4px;margin:22px 0 0;background:linear-gradient(90deg,var(--gal-red) 0 33%,var(--gal-blue) 33% 66%,var(--gal-yellow) 66% 100%)}
.gal-head h1{max-width:760px;margin:0 0 18px;color:var(--gal-ink);font-family:var(--gal-font-heading);font-size:clamp(3rem,6.8vw,5.75rem);font-weight:800;line-height:.98}
.gal-head .gal-legend{max-width:760px;margin:0;color:var(--gal-text);font-size:1.05rem}
.gal-tier{margin:0;padding:64px 0;border-top:1px solid var(--gal-rule)}
.gal-tag{display:inline-flex;align-items:center;gap:10px;margin:0 0 8px;color:var(--gal-blue);font-family:var(--gal-font-heading);font-size:.82rem;font-weight:700}
.gal-tag::before{content:"";width:30px;height:6px;border-radius:999px;background:linear-gradient(90deg,var(--gal-yellow) 0 33%,var(--gal-red) 33% 66%,var(--gal-blue) 66% 100%)}
.gal-th{margin:0 0 18px;color:var(--gal-ink);font-family:var(--gal-font-heading);font-size:clamp(1.8rem,3.4vw,3rem);font-weight:800;line-height:1.05;text-wrap:balance}
.gal-sub{display:block;margin:56px 0 18px;color:var(--gal-ink);font-family:var(--gal-font-heading);font-size:1.05rem;font-weight:800}
.gal-legend{max-width:92ch;margin-bottom:20px;color:var(--gal-text);font-size:.92rem;line-height:1.6}
.gal-legend code{color:var(--gal-ink);background:var(--gal-panel-soft);border:1px solid var(--gal-rule-soft);padding:2px 6px;border-radius:4px}
/* component cells: name-first cards with a delimited specimen stage */
.gal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.gal-cell{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--gal-rule);border-radius:8px;background:var(--gal-panel);transition:transform 160ms ease-out,border-color 160ms ease-out,box-shadow 160ms ease-out}
@media (hover:hover) and (pointer:fine){.gal-cell:hover{transform:translateY(-2px);border-color:rgba(11,104,183,.42);box-shadow:0 10px 24px rgba(9,14,34,.06)}}
/* card header: WHAT it is, in ink — readable at first glance */
.gal-cell-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.gal-name{font-family:var(--gal-font-heading);font-size:.92rem;font-weight:800;color:var(--gal-ink);line-height:1.2}
.gal-meta{font-family:var(--gal-font-mono);font-size:.66rem;color:var(--gal-muted);text-align:right}
/* specimen stage: dashed canvas that separates live specimens from chrome text */
.gal-stage{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:14px;padding:14px;border:1px dashed var(--gal-rule);border-radius:6px}
.gal-stage--bare{padding:0;border:none;display:block}
/* one variant/state instance + its own micro-label (no positional guessing) */
.gal-var{display:flex;flex-direction:column;gap:5px;align-items:flex-start;max-width:100%}
.gal-var--row{flex-direction:row;align-items:center;gap:10px;flex-wrap:wrap}
.gal-var--fill{align-self:stretch}
.gal-varlabel{font-family:var(--gal-font-mono);font-size:.62rem;letter-spacing:.05em;text-transform:uppercase;color:var(--gal-muted)}
/* footnote: token refs / behavior notes only — never repeats the card name */
.gal-note{margin-top:auto;padding-top:10px;border-top:1px solid var(--gal-rule-soft);color:var(--gal-muted);font-size:.75rem;line-height:1.5}
/* guard: an <img> specimen must never overflow or squash */
.gal-cell img{max-width:100%;object-fit:contain}
@media (max-width:760px){.gal-wrap{padding:36px 16px 72px}.gal-head h1{font-size:clamp(2.6rem,14vw,4.2rem)}.gal-tier{padding:48px 0}.gal-sub{margin:44px 0 16px}}
```
Use a header that mirrors preview's (`<p class="gal-project">Project name: …</p><h1>Component Gallery</h1>`), a `gal-tier` section per level (Primitives / Components / Modules) introduced by a `gal-tag` pill + `gal-th` heading, and `gal-cell` panels for each component's variant × state matrix. Keep the specimen markup inside the cells token-only.

**Cell anatomy — name first, one label per instance.** Every `gal-cell` reads top-to-bottom: *what it is → the thing itself → footnotes*, so a first glance answers "what am I looking at":
1. `<header class="gal-cell-head"><span class="gal-name">Button · primary</span><span class="gal-meta">--color-primary</span></header>` — component (and variant) name in ink; optionally one key token, mono, right-aligned.
2. `<div class="gal-stage">` — the dashed specimen canvas. **Each variant/state instance is its own** `<div class="gal-var">` (`gal-var--row` for chip-sized items sitting side by side, `gal-var--fill` for full-width fields) containing the specimen followed by `<span class="gal-varlabel">hover</span>` — a micro-label attached to the instance it names. Never describe states as a run-on list in one shared label ("default / hover / selected") that forces the reader to map labels to specimens positionally.
3. Optional `<span class="gal-note">` — token references or behavior notes only; never repeat the name the head already shows, and skip the note entirely when it would add nothing.
Full-bleed dark modules (hero, footer) use `<div class="gal-stage gal-stage--bare">` so the module surface replaces the canvas.

**Dark-surface modules — on-ink override rule.** Any specimen on a dark surface (`--color-surface-contrast`, a hero gradient, an inverted footer) must explicitly override **every** text primitive that appears inside it — body, caption, heading, nav, link — to the design's on-dark text token. Never rely on a text class's default light-surface color cascading in: a bare `.spec-body` on an Ink hero renders dark-on-dark and disappears. Pattern — one scope class, one rule set: `.spec-on-ink :is(.spec-body,.spec-caption,.spec-h3,.spec-nav){color:var(--color-text-on-ink)}`, then `class="spec-hero spec-on-ink"` / `class="spec-ink spec-on-ink"`. After writing the file, re-scan every dark module's descendants for a text class the scope rule doesn't cover.

**Logo / image specimens.** Give logos an explicit `height` and `width:auto` — and inside any **column** flex container ( `.spec-stack`-style ), also an explicit `align-self:flex-start`: the flex default `align-self:stretch` widens the image to the column while the height stays fixed, visibly distorting the wordmark. (Don't blanket-force `align-self` in CSS — that would break vertical centering of logos in flex *rows* like a site-header.)

At the top, note the relationship: this is the exhaustive **depth** catalog (all variants × states); `../preview.html` shows **breadth** — every token rendered live. Both sheets share the doc-hub light skin so they read as one system.

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
List components written, both file paths, and what to run next (`/twt-component-validate`, then `/twt-layout-define`).
