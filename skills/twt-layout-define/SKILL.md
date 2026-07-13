---
name: twt-layout-define
category: layout
description: (v1.2.3) Define per-page layout specs (section order, component slots, content map, breakpoints)
version: 1.2.3
accepts_arguments: true
inputs:
  - Optional: which page(s) to (re)define; otherwise all sitemap pages
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/curation/outlines/
  - .twt-artifacts/design/design-system/component/components.md
  - .twt-artifacts/design/design-read.md
  - references/external-design-skills.md
  - .twt-artifacts/design/layout/validation-report.md
writes:
  - .twt-artifacts/design/layout/layouts/
  - .twt-artifacts/design/layout/decisions.md
  - .twt-artifacts/design/assets/manifest.md
---

# /twt-layout-define

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before you load any external skill** (figma, design-taste-frontend, emil-design-eng, superpowers, …) or dispatch any sub-agent, run this one Bash line so those calls reach the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** For every page in the sitemap, define a layout spec — section order, the components each section composes, the mapping from sections to real Phase-1 outline content, and desktop/tablet/mobile behavior.

**Non-goals:**
- Doesn't render HTML (that's `/twt-mockup-define`)
- Doesn't define components (consumes `components.md`)
- Doesn't invent content — maps to Phase-1 outlines

**Success criteria:**
- One `layouts/<page-slug>.md` per sitemap page
- Every section names component(s) that exist in `components.md` and maps to an outline section
- All three breakpoints (desktop/tablet/mobile) defined per section
- Idempotent: refines existing layout files (reading `validation-report.md`) (rule 10)

---

## Step 1 — Dependency check
Read `sitemap.md`, `outlines/`, and `components.md`. If `components.md` is missing, abort: "No component library — run /twt-component-define first." If `sitemap.md` is missing, abort: "No sitemap — run the IA step (/twt-pre-design, or /twt-ia-define) first."

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft the per-page layout specs (`layouts/<page>.md`) from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/design/layout/decisions.md` (write it in the decisions.md format — frontmatter with `generated`/`area`/`producer`/`status: open`, then the sections `## Open questions` (each: question — options [a,b,c] — model-leaning — why it matters), `## Model-decided assumptions (review)` (field = value — basis — reversible), and `## Proposed rules (confirm before binding)`): the open question with 2–3 option candidates and your leaning, model-decided assumptions, and any proposed rule. Set `status: open`. Then write the drafts and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find templates, conventions, or format examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Detect state (idempotency, rule 10)
**(Skipped in collect mode — see Step 1b.)** If `layouts/` already has files, read them and any `validation-report.md`; enter refinement mode (address findings / requested pages) instead of starting over. Before overwriting an existing page file, ask via the **AskUserQuestion** tool (single-select, header "Overwrite?"):
- **Yes** — overwrite the existing page file
- **No** — skip this page and leave it unchanged
- **You decide** — I choose per page, defaulting to No (refine in place; never overwrite a user-edited file without confirmation)

Record the choice and continue.

## Step 3 — Determine page set
List the sitemap pages. Use `$ARGUMENTS` to scope to specific page slugs when given; otherwise process all. Resolve every interactive overwrite decision from Step 2 **now**, in this parent skill, so the dispatch in Step 4 is non-interactive. The result is a final set of page slugs to (re)write.

### Step 3′ — Anti-slop layout direction (no-Figma)
If `.twt-artifacts/design/design-read.md` exists, read it and pass its dials (especially `DESIGN_VARIANCE`) to the page agents below. If it's absent and no Figma drove the design, ensure `design-taste-frontend` is installed (per `references/external-design-skills.md` Step A — project-local auto-install if missing) and apply its layout discipline. Carry these `design-taste-frontend` rules into every page agent's prompt (Step 4): **§4.3** anti-center bias when `DESIGN_VARIANCE>4` (prefer split / asymmetric heroes); **§4.7** hero discipline (≤2-line headline, CTA above the fold), **eyebrow restraint** (≤1 per 3 sections), **split-header ban**, **zigzag alternation cap** (≤2 consecutive image+text splits), and the **section-layout-repetition ban** (a page of 8 sections uses ≥4 different layout families). These shape section order/variety only — they never invent content the outline lacks.

## Step 4 — Specify each page layout (in parallel)
Each page writes its own `layouts/<page-slug>.md` and reads only shared, read-only inputs, so the pages are independent — **dispatch one Agent per page in a single batch of parallel Agent calls** (one message, multiple Agent tool uses), not one at a time. Give each agent a self-contained prompt instructing it to:
- Read `sitemap.md` (its page's entry), `outlines/<page-slug>.md`, and `components.md`.
- Write `layouts/<page-slug>.md` with:
  - **Section order** — top → bottom
  - **Component slots** — each section names component(s) that MUST exist in `components.md`
  - **Content map** — each section → the matching content in `outlines/<page>.md`
  - **Responsive** — desktop / tablet / mobile treatment per section (driven by the design-system grid)
  - Flag any section whose content has no outline source, or whose component is missing, rather than inventing.
- Write **only** its own `layouts/<page-slug>.md` — touch no shared file.

Wait for all the page agents to finish before reporting.

## Step 5 — Asset manifest (media planning)
After the page layouts are written, scan them for sections that call for an image or video. For each, add a row to `.twt-artifacts/design/assets/manifest.md` (create it in the asset-manifest format — frontmatter `generated`/`phase: design`/`area: assets`, a `# Asset manifest` heading, and a table with columns id | type (image|video) | filename (kebab-case, web format) | placement (page → section → slot) | spec (dimensions/aspect/treatment) | alt | source (generate|stock|provided) | generation_prompt if absent; append missing rows, dedupe by `filename`). Run this **serially in this parent skill** (not in the parallel Step-4 agents) so the shared manifest is never written concurrently. Each row: stable `id`, `type` (image|video), exact `filename` (kebab-case, web format), `placement` (page → section → slot), `spec` (dimensions/aspect/treatment), `alt`, `source` (generate|stock|provided), and a concrete `generation_prompt`. Plan only — never claim a real asset exists; client-supplied ones are `source: provided`. Do not generate binaries.

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
List the layout files written, the asset rows added to the manifest, and what to run next (`/twt-layout-validate`, then `/twt-mockup-define`).
