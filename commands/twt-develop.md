---
name: twt-develop
category: develop
description: (v1.3.13) Phase 3 full path — promote the Phase-2 design into the chosen build target
version: 1.3.13
accepts_arguments: true
inputs:
  - Optional --target html|elementor|inherit (else menu); optional page scope; optional continuation tokens `pilot-approved` and `modifications-approved` (Step 4, evaluated in that reverse order — see Continuation tokens)
dependencies:
  hard: []
  soft:
    - twt-html-site-creator
    - twt-html-block-creator
    - twt-elementor-theme-creator
    - twt-elementor-block-creator
    - twt-inherit-define
    - twt-inherit-block-creator
    - twt-content-approval-checklist
    - twt-assets-produce
    - twt-figma-dev-audit
reads:
  - .twt-artifacts/design/design-brief.md
  - .twt-artifacts/design/mockup/index.html
  - .twt-artifacts/design/mockup/pages/
  - .twt-artifacts/design/mockup/*.html
  - .twt-artifacts/design/layout/layouts/
  - .twt-artifacts/design/layout/*.md
  - .twt-artifacts/design/design-system/component/components.md
  - .twt-artifacts/design/design-system/tokens.css
  - .twt-artifacts/design/assets/manifest.md
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
  - .twt-artifacts/figma-dev-audit/readiness-report.md
writes:
  - site/assets/css/sections.css            # html target — merged section-CSS deltas (Step 4c)
  - site/assets/css/general.css             # html target — merged deltas
  - <THEME>/assets/css/widgets.css          # elementor target — merged widget-CSS deltas
  - <THEME>/assets/css/design-system.css    # elementor target — merged token deltas
  - the host project's source tree          # inherit target — new files freely; existing files only after one consolidated approval
---

# /twt-develop

> **Trace self-logging (when dispatched).** If this skill is running in collect mode (`subagent-collect` in `$ARGUMENTS`, i.e. dispatched by an orchestrator), the main-thread trace hooks cannot see your tool calls. So **immediately before every Agent/Skill dispatch or external-skill load** (figma, design-taste-frontend, emil-design-eng, superpowers, …), run this one Bash line so the complete skill-call tree reaches the run log:
> `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --event "dispatch <skill-name> | <one-line why>"`
> It is a silent no-op when no trace is armed (standalone runs). Keep `<one-line why>` plain text — no quotes, braces, or shell metacharacters — so it never trips a permission prompt.

## Intent

**Purpose:** Drive Phase 3 from the Phase-2 handoff: pick a build target, ensure its scaffold exists, promote the design into production code using currently available content, and keep the content approval workbook running as a parallel confirmation track. It dispatches the builders; for multi-page promotion it runs one serial **foundation page** to seed the reuse pool, then promotes the rest as a **parallel batch**, and merges their shared-file deltas — **except for the `inherit` target**, which promotes every remaining page **serially** instead (Step 4b-inherit), to preserve its single consolidated-approval contract rather than optimize for speed.

**Non-goals:**
- Doesn't do QA (Phase 4)
- Doesn't reproduce builder/scaffolder logic — dispatches each via the Agent tool (rule 5)
- Doesn't start from Figma — that's the express path, `/twt-site-dev`

**Success criteria:**
- Target chosen (HTML or Elementor); the target's scaffold is ensured (created if its `conventions.md` is missing)
- `.twt-artifacts/content-approval/content-approval-checklist.xlsx` is created or refreshed as a parallel approval artifact, without blocking Development and without applying approved rows automatically
- Each Phase-2 mockup page is promoted into the target via the matching builder, using the content currently available from Figma, content-fetch artifacts, layouts, mockups, and asset manifests
- A **foundation page** is promoted first (serial) to seed reuse; it doubles as a **pilot** that the user reviews at a gate before the remaining pages are built — so a wrong direction is caught after 1 page, not after all of them
- After the pilot is approved, the remaining pages are promoted as a **single parallel batch**, then their shared-file deltas are merged and de-duplicated serially — **except `inherit`**, which promotes the remaining pages **serially, one at a time** (Step 4b-inherit) instead of a parallel batch, because its consolidated-approval contract wins over the speed optimization
- Approved workbook rows are **not** applied by this skill; after stakeholder confirmation, the user explicitly runs `/twt-content-approval-implement` to update the corresponding blocks/pages
- Reports what was built per page and anything to follow up before Phase 4

---

## Step 0·setup — Ensure the permission allowlist (run /twt-setup first if absent)
Check (Glob/Read — never a shell command) that `.claude/settings.json` exists at the project root (`$CLAUDE_PROJECT_DIR/.claude/settings.json`).
- **Missing, interactive (main thread):** ask via **AskUserQuestion** (single-select, header "Setup"): **Run /twt-setup now** (recommended — merges the curated allowlist so routine calls stop prompting) · **Skip** (expect per-call prompts) · **You decide**. On run: dispatch `/twt-setup` (Agent tool), wait, continue.
- **Missing, unattended** (auto mode, or dispatched as a subagent): seed silently — `node "${CLAUDE_PLUGIN_ROOT}/tools/seed-permissions.js" "$CLAUDE_PROJECT_DIR/.claude"` — note it, continue.
- **Present:** continue without asking (the seeder is idempotent).
- Seeder unavailable (global install without bundled tools): warn once and continue — **never block the run**.
- **Keep every Bash call allowlist-matchable (applies to the whole run):** the seeded rules match commands that *start with the binary* (`node "<path>/tool.mjs" <args>`). Never prefix a command with `VAR=` assignments (`CLAUDE_PROJECT_DIR=… node …` matches nothing), never write multi-line scripts that set and expand shell variables (`OUT=…; node … "$OUT"`), and never combine `cd` with pipes or redirection — those shapes can't be statically analyzed, so they force a manual prompt even when the binary is allowlisted. One command per Bash call, literal paths as arguments; the bundled tools take the project dir as an argument and read no env vars.

## Step 1 — Target

Parse `--target html|elementor|inherit` from `$ARGUMENTS`. If absent, ask via the **AskUserQuestion** tool (single-select, header "Target") What is the build target?:
- **Static HTML/CSS** — dependency-free static site
- **Elementor (WordPress)** — Hello Elementor child theme with widgets
- **Use this project's existing stack** — build into the current codebase in its own idiom (runs `/twt-inherit-define` to discover conventions, then `/twt-inherit-block-creator`)
- **You decide** — I pick the best-fit target from the project context (existing `inherited/conventions.md`, `elementor-theme/conventions.md`, or `html-site/conventions.md`, or other hints; defaults to Static HTML/CSS)

Record the choice as `<target>` and continue.

**Target descriptor.** Resolve `<target>` once and use the descriptor for the rest of the run:

| target | conventions | builder | platform | assets root |
|---|---|---|---|---|
| `html` | `.twt-artifacts/html-site/conventions.md` | `/twt-html-block-creator` | `web` | `site/assets` |
| `elementor` | `.twt-artifacts/elementor-theme/conventions.md` | `/twt-elementor-block-creator` | `wordpress` | `<THEME>/assets` |
| `inherit` | `.twt-artifacts/inherited/conventions.md` | `/twt-inherit-block-creator` | `wordpress` if the host is a WordPress theme, else `web` | the **File layout** section of the inherited `conventions.md` — never a path this skill invents |

**Dispatch modes (§13) — binding for every Agent call in this skill.** A dispatched skill that would ask the user something must be dispatched with `subagent-collect` **and** have its returned `decisions.md` surfaced, because `AskUserQuestion` does not work inside a subagent. "Collect-and-surface" below means: pass the flag, then, if this run is interactive, present the child's decisions via `AskUserQuestion` on the main thread and re-dispatch with the answers; if this run is itself in collect mode, aggregate them into your own report and let the orchestrator above surface them.

| Step | Dispatch | Mode |
|---|---|---|
| 0·setup | `/twt-setup` | plain — interactive-only, and the one question it needs is asked here before dispatching |
| 2a | `/twt-content-approval-checklist` | collect (no user-facing gate to surface) |
| 3 | `/twt-elementor-theme-creator`, `/twt-html-site-creator` | plain — scaffolders, no gate |
| 3 | `/twt-inherit-define` | **collect-and-surface** — its Step 7 review gate is user-facing |
| 3a | `/twt-assets-produce` | collect, decisions aggregated upward |
| 3b | `/twt-figma-dev-audit` | collect (advisory; its own proceed prompt is asked here, on the main thread) |
| 4a / 4b | `/twt-html-block-creator`, `/twt-elementor-block-creator` | plain — they write only into twt-created scaffolds |
| 4a / 4b-inherit | `/twt-inherit-block-creator` | **collect-and-surface** — its Step 5 consolidated write approval is user-facing |

No inherit dispatch in this skill is left mode-unstated. A bare `(Agent tool)` on either inherit skill is a defect, not a shorthand.

## Step 2 — Read the Phase-2 design

Read `.twt-artifacts/design/design-brief.md`, `.twt-artifacts/design/mockup/index.html` + page mockups from `mockup/pages/*.html` or the legacy/current fallback `mockup/*.html`, layouts from `layout/layouts/*.md` or `layout/*.md`, `component/components.md`, the design-system spine `design-system/tokens.css`, and the asset manifest `.twt-artifacts/design/assets/manifest.md` (planned images/videos with exact filenames + alt).

If `design-brief.md` is absent, stop and tell the user: "No Phase-2 design found. Run /twt-design first, or use /twt-site-dev to start from a Figma link."

## Step 2a — Run content approval in parallel

Dispatch `/twt-content-approval-checklist` via the Agent tool with `subagent-collect`, passing the page list, layouts, mockups, design-system artifacts, content-fetch artifacts if present, and asset manifest as context. This creates or refreshes the stakeholder workbook in parallel with development so missing copy/media/SEO can be confirmed later.

If the workbook already exists, instruct the child to preserve approved content and ready flags, and append/fill only newly discovered scope. Do not treat the workbook as an implementation input during this skill. Development proceeds with the content currently available in Figma/content fetch/design artifacts; later, after approval is complete, the user calls `/twt-content-approval-implement` explicitly to update corresponding blocks with approved content.

After the child returns, verify `.twt-artifacts/content-approval/content-approval-checklist.xlsx` exists. If it is missing, stop before scaffold/build work and report the child output plus the source paths that were passed in. Do not silently continue without the workbook; Development may proceed with unapproved current content only after the approval artifact exists as the stakeholder review surface.

## Step 3 — Ensure scaffold

- `<target>` = **elementor**: if `.twt-artifacts/elementor-theme/conventions.md` is missing, dispatch `/twt-elementor-theme-creator` (Agent tool). If present, continue.
- `<target>` = **html**: if `.twt-artifacts/html-site/conventions.md` is missing, dispatch `/twt-html-site-creator` (Agent tool). If present, continue.
- `<target>` = **inherit**: if `.twt-artifacts/inherited/conventions.md` is missing, dispatch `/twt-inherit-define` (Agent tool) **with `subagent-collect`**, then surface what it returns per the rule below. If present, continue. There is **no scaffolder for this target** — the scaffold is the host project, which already exists; `/twt-inherit-define` discovers its conventions rather than creating them.

  **Surface its review gate before anything builds (§13).** `/twt-inherit-define`'s Step 7 is the checkpoint that makes adapting to a host safe: the user confirms the stack, styling system, exemplars and asset root that everything downstream binds to. It is an `AskUserQuestion` gate, and `AskUserQuestion` **does not work inside a subagent** — so dispatching it bare (no `subagent-collect`) either stalls it or skips it silently. Always pass the flag, then:
  - **This run is interactive (main thread — no `subagent-collect` in your own `$ARGUMENTS`):** Read `.twt-artifacts/inherited/decisions.md`, present its `## Open questions` and `## Proposed rules (confirm before binding)` to the user via **AskUserQuestion** (one question per open decision, each with a **"You decide"** option that accepts the recorded `model-leaning`), then re-dispatch `/twt-inherit-define` with `subagent-collect` **in refinement mode with the answers** so it rewrites `conventions.md` and sets `status: resolved`.
  - **This run is itself in collect mode** (`subagent-collect` in your own `$ARGUMENTS`, i.e. `/twt-site` dispatched you): do **not** ask. Aggregate the child's decisions block into **your own report** and stop before Step 4 — the orchestrator above you is the surfacing point, and it re-dispatches you once the user has answered.
  - Surfacing **must happen here, before Step 4**: `/twt-inherit-block-creator` writes to the same `.twt-artifacts/inherited/decisions.md`, so an unsurfaced conventions decision left lying there is overwritten by the first build and lost.

## Step 3a — Produce & sync assets (best-effort, never blocks)

Read `.twt-artifacts/design/assets/manifest.md`. If it exists and has rows whose `status` is missing, `planned`, or `missing-provided`, dispatch `/twt-assets-produce` (Agent tool) **with `subagent-collect`** so the pool (`.twt-artifacts/design/assets/img|video|icons|meta/`) is as full as it can get before pages are built; aggregate its `decisions.md` upward per rule 13. If the dispatch fails or the manifest is absent, note it and continue — builders already emit manifest-correct paths for missing files.

Then **sync the pool into the build target**: copy the pool's populated subdirectories into the build's asset root, per the Step 1 descriptor — html target → `site/assets/img|video|icons|meta/`, elementor target → the theme's `assets/img|video|icons|meta/` (per its `conventions.md`), inherit target → the asset root named in `.twt-artifacts/inherited/conventions.md`'s **File layout** section (never a path this skill invents; if that section names no static-asset root, skip the sync, note it in the Step 5 report, and leave the pool as the deliverable).

- **html / elementor:** one simple `cp -r "<pool-subdir>" "<build-assets-dir>"` per subdirectory (Bash) — no loops or chains; skip subdirectories that don't exist. The destination is a scaffold twt created, so an overwrite costs nothing that wasn't ours.
- **inherit — never `cp -r`.** The destination here is the **host's real static-asset root**, part of a repo somebody else owns, and `cp -r` merges *and overwrites same-named files*. That is a MODIFY performed outside the consolidated-approval contract, and the prose "never overwrite a newer file with an older pool copy" is not something `cp -r` does. Use the **no-clobber** form instead — one Bash call per subdirectory: `cp -rn "<pool-subdir>" "<host-assets-dir>"` — so a pool file whose name already exists in the host is **skipped, never written**. Then Glob both trees and **report every collision by name** in the Step 5 report ("`hero.jpg` already existed in the host asset root — the pool copy was not applied"), so the user can resolve it deliberately. New asset files that land are CREATEs and flow freely, per the target's contract; a same-named host file is a MODIFY and is out of scope for a best-effort sync.

Rows still `pending-stock`/`pending-video`/`missing-provided` after the sync go into the Step 5 report as expected QA gaps.

## Step 3b — Developer readiness check (advisory)

Run before the first build dispatch (Step 4): a blocker in the Figma file is cheaper to catch before any page is promoted than after.

**Skip silently** unless a Figma URL is present in `$ARGUMENTS` or recorded in the design artifacts (Grep `.twt-artifacts/design/design-brief.md` and `.twt-artifacts/design/design-system/tokens.md` for a `figma.com` link) — no prompt, no warning, no log entry.

If `.twt-artifacts/figma-dev-audit/readiness-report.md` already exists: **standalone interactive**, ask via **AskUserQuestion** (single-select, header "Readiness"): **Reuse the existing report** (recommended) / **Re-run the audit** / **You decide**. **Collect mode (dispatched by an orchestrator) or an unattended `auto` run**, reuse and log it without asking.

Otherwise dispatch `/twt-figma-dev-audit` via the Agent tool with `subagent-collect`, prefixing the prompt with a `WHY:` line for the dispatch trace, passing the Figma URL and `<target>` as the platform hint (`elementor` → `--platform wordpress`, `html` → `--platform web`, `inherit` → `--platform wordpress` if the host is a WordPress theme per the descriptor, else `--platform web`).

When it returns, state the Blocker and High counts and the report path. **Standalone interactive**, ask via **AskUserQuestion** (single-select, header "Proceed"): **Proceed anyway** (the audit is advisory; findings do not block the build) / **Stop and fix first** (pause here; nothing further runs) / **You decide**. **Collect mode or an unattended `auto` run, always continue** — record the counts, the report path, and the decision to continue for the Step 5 report, and move on. An unattended run must never halt on this.

The audit writes only under `.twt-artifacts/figma-dev-audit/` and changes nothing the rest of this run depends on.

## Step 4 — Promote pages (pilot first, gate, then parallel batch)

Pages are independent **except** for the shared files each builder appends to — HTML: `sections.css` / `general.css`, the inlined `partials/`, the `tokens.css` mirror; Elementor: `widgets.css` / `design-system.css`, the `$map` registry in `class-<slug>-elementor.php`, `wpml-config.xml`. Promoting every page fully in parallel would both **race** on those shared files and **defeat reuse-first** (each agent, starting from the same baseline, re-creates the same hero/CTA). So promote in phases, with a pilot checkpoint before the expensive full batch. (`<target>` = **inherit** shares the pilot pass and its gate below, then takes a different, serial path afterward — see Step 4b-inherit.)

Take the page list from `mockup/pages/`, falling back to page-level `mockup/*.html` files except `index.html` (respect any page scope from `$ARGUMENTS`). The **home/index** page — or the first page if there is no home — is the **foundation page** / **pilot**. The matching builder is:
- `<target>` = **html** → `/twt-html-block-creator`
- `<target>` = **elementor** → `/twt-elementor-block-creator`
- `<target>` = **inherit** → `/twt-inherit-block-creator`

**Continuation tokens.** This step accepts two, and they **compose** — one is about which pages still need building, the other is about writes the user has already approved. Evaluate them in this order, never the other way round:

**1. `modifications-approved` (inherit only) — handled FIRST, before any continuation skip.** It means: the user has seen the write plan sitting open in `.twt-artifacts/inherited/decisions.md` and approved it. Before anything else in Step 4:
- Read `.twt-artifacts/inherited/decisions.md` and take the page named on its `## Proposed rules (confirm before binding)` section's `Plan for page:` line (the builder writes it there; fall back to the pilot page if the file predates that field).
- **Re-dispatch `/twt-inherit-block-creator` for that page with `subagent-collect modifications-approved`** and wait. Its pre-approved branch applies the approved MODIFYs, treats the CREATEs the earlier run already wrote as its own output rather than as unplanned edits, and marks the decision `status: resolved`.
- Record the applied MODIFYs for the Step 5 report, then continue with the rest of Step 4.

This must not be skipped by anything, because **`pilot-approved` short-circuits straight past Step 4a** — so on a run carrying both tokens (the normal shape when `/twt-site` surfaces the write approval and the pilot review in one pass), evaluating `pilot-approved` first would jump to Step 4b-inherit and the pilot page's approved modifications would never be applied at all. A `modifications-approved` run with no open, unresolved plan in `decisions.md` is a no-op: note it and move on, never re-apply a plan already marked `status: resolved`.

**2. `pilot-approved` — handled second.** The pilot was already built and approved in a prior pass — **skip Steps 4a and the gate** and go straight to the pages not yet built: Step 4b-inherit's serial loop for `<target>` = **inherit**, Step 4b's parallel batch for html/elementor.

### Step 4a — Foundation / pilot pass (serial)
Dispatch the builder for the **foundation page only** (Agent tool, passing its mockup HTML + `layouts/<page>.md`). It writes its page file *and* the shared files, priming the reuse pool: the common sections/widgets, chrome, and shared CSS now exist for every other page to reuse. If there is only one page, you're done — skip to Step 5.

**Dispatch mode.** `html`/`elementor`: dispatch normally — those builders write only into scaffolds twt created and have no user-facing gate. **`inherit`: dispatch with `subagent-collect`, then run the write-approval surfacing below.** `/twt-inherit-block-creator` is the one builder that writes into a repo somebody else owns, and its Step 5 consolidated approval is an `AskUserQuestion` — which **does not work inside a subagent** (§13). Dispatched bare it stalls or is silently skipped, and the user's single most important requirement for this target ("explain the whole scope at once, don't ask many times") is never met at all.

<a id="inherit-write-approval"></a>**Inherit write-approval surfacing (§13).** After an `inherit` builder dispatch returns, Read `.twt-artifacts/inherited/decisions.md`. Its `## Proposed rules (confirm before binding)` section holds the full MODIFY list the builder deferred (collect mode always takes the safe *new files only* path and defers). Then:
- **This run is interactive (main thread — no `subagent-collect` in your own `$ARGUMENTS`):** present the whole scope **once**, in the builder's own shape — the CREATE count, then each MODIFY path with what changes and its line estimate — and ask via **AskUserQuestion** (single-select, header "Changes"): **Approve the whole plan** / **New files only — report the modifications as TODOs** / **Stop** / **You decide** (defers every MODIFY to TODOs — the conservative default for a gate that writes into a real repo). On approve, **re-dispatch the same builder for the same page with `subagent-collect modifications-approved`**; it applies the MODIFYs under its pre-approved branch without asking again. On any other answer, leave the TODOs as reported and carry them to Step 5.
- **This run is itself in collect mode** (`/twt-site` dispatched you): do **not** ask. Return the builder's decisions block verbatim in your own report and leave the MODIFYs deferred — the orchestrator above you surfaces it and re-dispatches you.
- **Auto / unattended:** never ask and never auto-approve a MODIFY. Leave every modification as a TODO and list them in Step 5. Silence is not consent for edits to a repo the user did not hand us.

### Step 4a-gate — Pilot review (checkpoint before the full set)
The pilot is the cheap proof of how the design lands in `<target>`. Gate on it before spending tokens promoting every remaining page.

- **Auto / unattended** (the run was started in `auto`): skip the gate — build all remaining pages (`<target>` = **inherit** → Step 4b-inherit's serial loop; html/elementor → Step 4b's parallel batch). Note in the report that the pilot was auto-approved.
- **Collect mode** (`subagent-collect` in `$ARGUMENTS`, e.g. dispatched by `/twt-site`): do **not** build the rest and do **not** ask. Record an open decision in the target's decisions file — `.twt-artifacts/html-site/decisions.md` (html), `.twt-artifacts/elementor-theme/decisions.md` (elementor), or `.twt-artifacts/inherited/decisions.md` (inherit) — "Pilot page `<page>` built at `<path>`; approve to promote the remaining N pages, adjust the pilot, or stop" (`status: open`, list the remaining pages) — and **return** that decision + the pilot path in your report. The orchestrator surfaces the gate and re-dispatches `/twt-develop` with `pilot-approved` to continue — and, for inherit, with `modifications-approved` alongside it if it surfaced the builder's write plan in the same pass. Both tokens together are the normal shape; Step 4's Continuation tokens rule applies the approved writes **before** `pilot-approved` skips ahead. Stop here.
  **For `inherit`, merge — never overwrite.** `/twt-inherit-block-creator` writes its own deferred MODIFY plan into that same `.twt-artifacts/inherited/decisions.md` during Step 4a. Read it first and **add** your pilot question to its `## Open questions` section, leaving its `## Proposed rules (confirm before binding)` list intact; a blind rewrite here silently discards the write plan the user is supposed to approve. Re-validate afterwards (one Bash call): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file ".twt-artifacts/inherited/decisions.md"` — fix until it exits 0. Return **both** decisions (the pilot gate and the write plan) in your report so the orchestrator can surface them together in one pass rather than two.
- **Standalone interactive:** present the pilot to the user (the built page path; invite them to open it) and ask via the **AskUserQuestion** tool (single-select, header "Pilot"):
  - **Build the remaining N pages** — proceed to Step 4b (html/elementor) or Step 4b-inherit (inherit), per the branch below.
  - **Add one more pilot page** — build one representative interior page serially (same reuse pool), then re-show this gate, so an interior layout is seen before committing.
  - **Adjust the pilot first** — collect feedback (plain text), re-dispatch the builder for the pilot page(s) with it, then re-show this gate.
  - **Stop here** — finish with only the pilot built; go to Step 5 and report what remains.
  Only on **Build the remaining** continue: `<target>` = **inherit** goes to Step 4b-inherit below; html/elementor continue to Step 4b.

### Step 4b-inherit — Serial promotion (inherit only)
`<target>` = **inherit** never enters the parallel batch (Step 4b) or the delta merge (Step 4c) below — this is a deliberate exclusion, not an oversight, and it stays that way even though the pilot pass and its gate above are shared with html/elementor. `/twt-inherit-block-creator`'s defining contract is **one consolidated approval covering every write in the batch** (its Intent: "gets one consolidated approval for the whole batch before touching anything the user didn't already agree to"). Step 4b's parallel-promotion contract exists purely as a **speed optimization** for html/elementor, and when the two conflict, the contract wins, not the optimization. Concretely, dispatching this builder in parallel breaks three ways:
- **Interactively**, N parallel builders would each surface their own approval — multiplying exactly the prompt the consolidated-approval contract exists to prevent.
- **In collect mode**, N parallel invocations would race-write the single shared `.twt-artifacts/inherited/decisions.md`.
- Step 4b's premise below — "each page file is disjoint, so there is no write conflict" — does not hold for this target: the builder's predictable MODIFY set (route registration, nav config, global stylesheet import) is shared across pages by construction, unlike a fresh `site/<page>.html`.

So for inherit, promote the remaining pages **one at a time, serially**: dispatch the builder for the next page (Agent tool, **with `subagent-collect`**, passing its mockup HTML + `layouts/<page>.md`), wait for it to return, **run the [inherit write-approval surfacing](#inherit-write-approval) from Step 4a for that page's returned `decisions.md`**, then dispatch the next — until every remaining page is built. The flag and the surfacing are not optional here: without the flag the builder's approval `AskUserQuestion` fires inside a subagent and stalls or vanishes; without the surfacing every MODIFY is permanently deferred to a TODO and the user is never asked at all. Skip Step 4b and Step 4c entirely for this target; go straight to Step 5 once the last page returns.

**Known cost, stated on purpose:** each page gets its own approval prompt, so an N-page inherit build asks N times (plus the conventions gate in Step 3). The builder's predictable MODIFY set — route registration, nav/menu config, the global stylesheet import — is **shared across pages by construction**, so the same nav file can come up in every one of those prompts. A single cross-page consolidated plan is the right end state and is **not built in this version**; it is recorded as a follow-up. Say this plainly in the Step 5 report rather than letting the user discover it at prompt three.

### Step 4b — Parallel batch (remaining pages; html/elementor only)
Dispatch **every page not yet built** (the set after the pilot and any pilot-added interior pages) in a **single batch of parallel Agent calls** (one message, multiple Agent tool uses), each passing the page's mockup HTML + `layouts/<page>.md`. Pass the asset manifest to each builder: media must use the **exact `filename` and `alt` from the manifest** (place real files under the build's `assets/img|video/`); where an asset file isn't present yet, emit the correct `<img src>`/path with the manifest's alt and leave the file to be supplied — never invent a different filename. In every agent's prompt, include the **parallel-promotion contract**:

> Parallel mode — return deltas, don't write shared files. Reuse-first against the shared files the foundation pass already wrote. Write **only** your own disjoint page file (`site/<page>.html`, or `import/<page-slug>/import.json` + its `assets/`). Do **not** write or append to any shared file (`sections.css`, `general.css`, `widgets.css`, `design-system.css`, the `$map` registry, `wpml-config.xml`, or `partials/`). Instead **return in your report** any new shared-file deltas as text — new section-/widget-CSS blocks, new tokens, new `$map`/WPML entries, and any partial change — only for sections that genuinely aren't already in the reuse pool.

Each page file is disjoint, so there is no write conflict. Wait for the whole batch to finish.

### Step 4c — Merge deltas (serial; html/elementor only)
Apply the returned deltas to the shared files yourself, one at a time, **de-duplicating**: if two pages returned the same new section (same purpose/selector), add it once and point both pages at it. Then, if any page needed a partial change, re-inline the partial into every page; re-mirror `tokens.css` if a token was added. Finally run the builder's own inline build checks across all pages (every page links the CSS / registers its widgets; no literals; links resolve; chrome identical; no lorem where real content exists).

## Step 5 — Report

State: target, pages promoted, whether a scaffold was created, reuse decisions surfaced from the builders, whether the content approval workbook was created/refreshed, and any outstanding items to resolve before Phase 4 (QA). Explicitly say that approved workbook content is not auto-applied by Development; after stakeholder approval, run `/twt-content-approval-implement` to update the corresponding blocks/pages.

**For `<target>` = inherit, additionally and explicitly:**
- **How many approval prompts this build asked for, and why** — state the number plainly: **one** for the inherited conventions (Step 3's review gate, only on the first run for this host) **+ one write approval per page promoted** (Steps 4a and 4b-inherit) **+ the one pilot-review gate** (Step 4a-gate, interactive runs only). So a three-page interactive first run asks five times: conventions, pilot-page writes, pilot review, then one write approval for each of the two remaining pages. Say *why*: each page is built by a separate serial builder run, and each run gets its own consolidated approval covering only its own writes. Note that the shared MODIFY set (route registration, nav/menu config, the global stylesheet import) means the **same file can appear in several of those prompts** — that is a known limitation of the current per-page plan, not a sign anything went wrong, and a single cross-page consolidated plan is a recorded follow-up rather than shipped behaviour. A user who understands this at the end of the run is not surprised by it on the next one.
- **Every file created in the host tree, every file modified, and every MODIFY still outstanding as a TODO** — aggregated across all page builds, deduplicated, with the page that wanted each one.
- **Asset-sync collisions** from Step 3a: pool files skipped because a same-named file already existed in the host asset root, and where they still sit in the pool.
- Any **dependency decisions** the builders surfaced (packages a block needed that the host doesn't have — never installed, always reported).
