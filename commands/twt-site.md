---
name: twt-site
category: site
description: (v1.10.1) Master orchestrator — run the full pre-design to QA pipeline with approval pauses, a design-already-done shortcut, per-phase review reports, a post-Design text-quality pass, an always-on dispatch trace, and a prominent content-approval callout
version: 1.10.1
accepts_arguments: true
inputs:
  - Optional `site-instruction.md` (project root or `.twt-artifacts/`) — pre-supplied brief that pre-fills intake/phases/target/per-phase guidance; the orchestrator asks only for what it omits
  - Optional notes, a live URL, or a hint of which phase to start from
  - Optional first token `auto` — fully unattended run; everything after it is free-form context (notes, URLs, target hints)
dependencies:
  hard: []
  soft:
    - twt-pre-design
    - twt-design
    - twt-text-analysis
    - twt-develop
    - twt-site-dev
    - twt-content-approval-checklist
    - twt-qa
reads:
  - site-instruction.md
  - .twt-artifacts/site-instruction.md
  - .twt-artifacts/pre-design/pre-design-brief.md
  - .twt-artifacts/design/design-brief.md
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
  - .twt-artifacts/qa/qa-report.md
  - .twt-artifacts/qa/gaps.md
writes:
  - .twt-artifacts/site-log.md
  - .twt-artifacts/pre-design/phase-review.md
  - .twt-artifacts/design/phase-review.md
  - .twt-artifacts/<html-site|elementor-theme>/phase-review.md
  - .twt-artifacts/content/text-analysis/
  - .twt-artifacts/content-approval/content-approval-checklist.xlsx
---

# /twt-site

## Intent

**Purpose:** Run the entire twt pipeline — Pre-design → Design → Content approval checklist → Development → QA — as a single guided command. The user picks which phases to run and the build target up front, then approves (or repeats/stops) at a pause after each phase, with that phase's outstanding BLOCKERs surfaced before the decision. With the first token `auto`, the whole run is unattended: every choice is inferred from the provided input, existing artifacts, and defaults — zero questions.

**Non-goals:**
- Doesn't reproduce any phase's logic — dispatches each phase wrapper via the Agent tool (rule 5)
- Doesn't add build or QA capability — only composes the existing wrappers
- Doesn't auto-proceed past BLOCKERs in interactive mode — the human approves every phase transition (auto mode defers them to the final summary instead)
- Auto mode never grants destructive consents (in-place file replacement, overwrite of user-confirmed targets) — children keep writing to artifacts only

**Success criteria:**
- Interactive: phase set chosen via an AskUserQuestion multi-select; build target via an AskUserQuestion single-select; after each phase an AskUserQuestion gate (Proceed / Re-run / Stop) that surfaces outstanding BLOCKERs
- Auto (`auto` first token): no AskUserQuestion and no prompts anywhere — phases/target inferred, gates auto-proceed, child decisions auto-resolved and logged
- Figma is a **design source**, not a build target: when a Figma link is provided, a dedicated **Figma-approach** question (Express vs. Design source) decides whether Pre-design + Design are skipped; the build target (HTML/Elementor) is asked separately. Express routes Development through `/twt-site-dev`
- When Development is selected, `.twt-artifacts/content-approval/content-approval-checklist.xlsx` is created or reused as a parallel approval artifact; approved rows are applied later only when the user explicitly runs `/twt-content-approval-implement`
- An optional **`site-instruction.md`** (project root or `.twt-artifacts/`) is read first when present: its values pre-fill the intake, phase set, Figma approach, build target, and per-phase guidance, and the orchestrator asks only for what the file leaves unspecified
- Ends with a summary of phases run, artifact locations, the QA verdict, the gaps file — and, in auto mode, every auto-decision taken and every deferred BLOCKER

---

## Step 0 — Mode
If the **first token** of `$ARGUMENTS` is `auto`, enable **auto mode**: strip the token and treat everything after it as free-form context (notes, a live or Figma URL, target hints like "elementor" or "html"). In auto mode this skill asks **nothing** — no AskUserQuestion, no plain-text prompts, no approval requests; every decision comes from that context, the existing `.twt-artifacts/` state, and the defaults named below. Without the leading `auto`, run interactively as before.

## Step 0·trace — Arm the dispatch tracer (always)
The run trace is **always on** — no flag. It captures every skill the run touches (twt phase wrappers dispatched via the Agent/Task tool, **and** any other Skill-tool call — other plugins, superpowers, system skills), each with its WHY and wall-time, and folds them into `site-log.md` at the end. The tracer is bundled at `${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js`.

- **Arm it now** (Bash): `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --arm "site $ARGUMENTS"`. This drops a sentinel so the already-wired `PreToolUse`/`PostToolUse` hooks (matching `Task|Agent|Skill|AskUserQuestion`) record events to `.twt-artifacts/.twt-debug/events.jsonl` for the whole run. The hooks are **inert in any session where the sentinel is absent**, so this affects only this run.
- **If that hook file is missing** (twt was installed globally without bundled hooks), continue **without** the trace — never block the run; the curated Timeline (Step 0a) still gives the dispatch narrative.
- **Prefix every dispatch prompt (Step 3) with a `WHY:` line** — `WHY: <one-line reason this phase/skill is being called now>` — so the trace records real intent instead of a guessed snippet.
- **There is no token column.** Per-skill token usage is not exposed to hooks; wall-time is the honest cost proxy. Do not promise token counts.

## Step 0a — Open the session log
Start a session log at `.twt-artifacts/site-log.md` (create the file/dir if missing) by **appending** a new `## Run <ISO timestamp>` section in the session-log format (a `# Session log` heading, then per invocation a `## Run <ISO timestamp>` section with **Command** / **Mode** (interactive|auto) / **Target** / **Requested** (one-line context) fields, a `### Timeline` of numbered entries — each either `[question] <header>` with the asked text + answer, or `[step] <phase>` with the skill used + a one-sentence why (in auto mode record `auto-decision: <value> (from <evidence|default>)`) — and a `### Outcome` block: phases/steps completed · outstanding BLOCKERs · key artifact paths) — never rewrite earlier runs. Record Command, Mode (interactive/auto), Target (tbd until Step 2), and the user's free-form Requested context. Then **keep the Timeline live for the whole run**: append one numbered entry for **every** question you ask (the phases menu, the target menu, the visual-direction surfacing, each per-phase gate, and any surfaced child `decisions.md` question) with the user's answer — or, in auto mode, the inferred `auto-decision: <value> (from <evidence|default>)` — and one entry for **every** phase wrapper you dispatch (`[step]` + the skill name + a **one-sentence** why). This logging is **not** skipped in auto mode — auto runs especially need the trail. (This curated Timeline is the human narrative; the **exhaustive** dispatch trace — every skill including non-twt ones, with wall-time — is auto-captured by the tracer armed in Step 0·trace and folded into this same file at Step 5, so you don't hand-list every Skill call here.)

## Step 0·instr — Project instruction file (read first if present)
Before the intake interview, check whether the project provides a **`site-instruction.md`** — look first at the project root (`./site-instruction.md`), then `.twt-artifacts/site-instruction.md`. **Use the Glob/Read tools, never a shell command.**

If found, **Read it in full before anything else** and treat it as the user's pre-supplied brief. It is free-form Markdown (no fixed schema) — parse it and **align whatever it states to the pipeline's decision points**, building a `<provided>` map across these slots:
- **Intake:** what/who · content sources · brand/design source (incl. any Figma link) · stage (new/redesign/extend)
- **Phases:** which of Pre-design / Design / Development / QA to run (and any to skip)
- **Figma approach:** express vs. design-source (only relevant if a Figma link is present)
- **Build target:** Static HTML vs. Elementor
- **Per-phase guidance:** anything aimed at a specific phase — brand voice/colors/fonts, positioning/audience notes, sitemap/IA preferences, page list, content rules, visual direction/dials, motion posture, QA emphasis, etc.

Record this as `<provided>` and append a Timeline entry summarizing what the instruction file supplied (and from where). Then, in **every step below**, treat a `<provided>` slot as already answered: **do not re-ask it** — use the file's value, state it back to the user once ("From site-instruction.md: …"), and only ask for the slots the file left blank or ambiguous. **Forward the relevant per-phase guidance** as context in each Step 3 dispatch prompt, so the sub-skills honor it instead of re-deriving from scratch.

If a `<provided>` value is internally contradictory or conflicts with the existing `.twt-artifacts/` state, don't silently pick one — surface that one conflict to the user (interactive) or log it as a deferred decision (auto), and continue.

If **no** `site-instruction.md` exists, skip this step and run the intake interview normally.

**Auto mode:** still read `site-instruction.md` if present (it's the richest context an unattended run can get); combine it with the free-form `$ARGUMENTS`. The file's values take precedence over inferred defaults; anything it doesn't cover falls back to the auto-mode inference rules in each step.

## Step 0b — Intake (project brief)
This is the **main-thread interview** that gives the pipeline something real to work from. The phases below are dispatched with `subagent-collect`, so the sub-skills will **not** ask the user anything — if you skip this step, they invent the brand, audience, and content from nothing. Gather it **here**, in the main thread, and forward it as context to every phase.

**Auto mode:** skip the interview — treat the free-form `$ARGUMENTS` context (plus any `site-instruction.md` from Step 0·instr) as the project brief; do not ask.

Otherwise, before choosing phases, collect the brief (free-form input stays plain-text per CONVENTIONS §4; the one fixed-option question uses **AskUserQuestion**). **Skip any item already supplied by `site-instruction.md` (Step 0·instr)** — state the supplied value back rather than re-asking; only ask for what's missing. **Ask the remaining questions one at a time** — pose a question, wait for the user's answer, then ask the next. Never stack them into a single multi-question prompt: a person answers more accurately, and gives you more to work with, when shown one question at a time.
1. **What & who** *(plain-text prompt)*: "In a sentence or two — what is this site for? The business/product, the goal of the site, and who the audience is."
2. **Content sources** *(plain-text prompt)*: "Paste anything I should build from — live site URL(s), PDF or doc paths, or type `none`. I'll ingest whatever you give me." Record each source.
3. **Brand / design source** *(plain-text prompt)*: "Any brand or design materials? A brand book, a Figma link, existing colors/fonts — paste a path/URL, or `none`."
4. **Stage** *(AskUserQuestion, single-select, header "Stage")*: **New build** (from scratch) · **Redesign** (replace an existing site) · **Extend** (add to an existing build) · **You decide**.
5. **Design status** *(AskUserQuestion, single-select, header "Design")* — ask explicitly so the run never forces a finished design back through Pre-design/Design:
   - **Design it for me** — no finished design yet; run Pre-design + Design normally (default).
   - **Already done — Figma** — there is a finished Figma design to build from. This **skips Pre-design + Design** and routes Development through `/twt-site-dev` (Express). If no Figma link was captured in Q3, ask for it now (plain text). Equivalent to choosing **Express** at Step 1·figma — don't ask the Figma-approach question again.
   - **Already done — existing artifacts** — a design already exists on disk (`.twt-artifacts/design/design-brief.md` / `design-system/`) or as an exported reference. This **skips the Design phase**; Development reuses the existing design. (Confirm the artifacts exist with Glob/Read; if they don't, fall back to running Design.)
   - **You decide** — infer from the presence of a Figma link, existing `.twt-artifacts/design/` artifacts, or a provided design reference; default to **Design it for me** when nothing is found.

   Record the answer as `<design-status>`. It overrides the default phase set in Step 1 (a "done" answer drops Pre-design+Design or Design) and pre-resolves Step 1·figma (a Figma "done" answer = Express). Skip this question if `site-instruction.md` already states the design is supplied/finished.

Record all answers (merged with the `<provided>` values from Step 0·instr) as the **project brief**. Append each Q&A to the session-log Timeline. If a Figma link was given in (3) or by the instruction file, note it — it drives the **Figma-approach** question in Step 1·figma (express vs. design-source), which is a *source* decision spanning Pre-design/Design/Development, **not** a build-target choice. If real content sources were given in (2), they will be handed to `/twt-pre-design` (which dispatches `/twt-content-fetch`) — do not re-ask for them later.

## Step 1 — Choose phases
**Auto mode:** run all four phases (Pre-design → Design → Development → QA), minus any the context clearly excludes (e.g. "QA only", "skip pre-design") and minus Pre-design/Design when a Figma link resolves the Figma-approach (Step 1·figma) to Express. Skip the menu.

**Honor `<design-status>` from Step 0b first.** If the user said the design is **already done — Figma**, set the Figma approach to Express (Step 1·figma becomes a no-op) and drop **Pre-design + Design** from the default set. If **already done — existing artifacts**, drop **Design** (and Pre-design unless the user still wants it). State the adjustment back ("Design is already done — skipping …") before showing or finalizing the phase set.

If `site-instruction.md` already specified the phase set (Step 0·instr), use it — state it back ("From site-instruction.md: running …") and skip the menu. Otherwise ask via the **AskUserQuestion** tool (multi-select, header "Phases") which phases to run — all selected by default (minus any dropped by `<design-status>`):
- **Pre-design** — raw materials → `pre-design-brief.md` (brand, positioning, IA, curation)
- **Design** — → `design-brief.md` (design system, components, layouts, mockups)
- **Development** — promote the design into a built site (HTML or Elementor)
- **QA** — audit the built output → `qa-report.md` + `gaps.md`
Record the selected, ordered set.

## Step 1·figma — Figma approach (only when a Figma link was provided)
Figma is a **design source**, not a build method — having one affects Pre-design, Design, **and** Development, so it is decided here, separately from the build target (Step 2). Run this step only when intake (Step 0b Q3) captured a Figma link **and** the phase set includes Pre-design or Design.

**If `<design-status>` (Step 0b) already resolved this** — "Already done — Figma" means Express — skip this question entirely; Pre-design + Design are already dropped and Development routes through `/twt-site-dev`.

**Auto mode:** a Figma link → infer **Express** (drop Pre-design + Design, route Development through `/twt-site-dev`). Record the inference and reason for the final summary; skip the menu.

If `site-instruction.md` already stated the Figma approach (Step 0·instr), use it (state it back) and skip the menu. Otherwise ask via the **AskUserQuestion** tool (single-select, header "Figma") how the Figma design should be used:
- **Express** — build straight from Figma via `/twt-site-dev`; **skips Pre-design + Design**. Best when the Figma file is the finished design and you just want it built.
- **Design source** — run the **full pipeline**, seeding the design system from Figma (Pre-design + Design still run, reading the Figma file). Best when the Figma is a starting point, not the final design.
- **You decide** — I pick the best fit (defaults to **Design source** when Pre-design/Design were selected and the Figma looks partial; **Express** when the file is clearly a complete design).

If **Express** is chosen, tell the user Pre-design and Design will be skipped, drop them from the phase set, and route Development through `/twt-site-dev`.

## Step 2 — Choose build target
The build target (how Development renders the site) is **independent** of whether a Figma design exists — both Express and the full pipeline still build to one of these. Ask only when Development is in the phase set.

**Auto mode:** infer the target from the context and skip the menu — "elementor"/"wordpress"/an existing `.twt-artifacts/elementor-theme/conventions.md` → **Elementor**; otherwise default **Static HTML**. Record the inference and its reason for the final summary.

If `site-instruction.md` already named the build target (Step 0·instr), use it (state it back) and skip the menu. Otherwise ask via the **AskUserQuestion** tool (single-select, header "Target") how Development should build:
- **Static HTML** — dependency-free `site/` (runs `/twt-develop --target html`, or `/twt-site-dev` with `--target html` under Express)
- **Elementor** — WordPress child theme (runs `/twt-develop --target elementor`, or `/twt-site-dev` with `--target elementor` under Express)
- **You decide** — I pick the best-fit (defaults to Static HTML; Elementor when the context/`conventions.md` indicates WordPress)

## Step 3 — Run the selected phases in order
For each phase still selected, in pipeline order, dispatch its wrapper via the Agent tool, then run the Step 4 pause before moving on:
- **Pre-design** → `/twt-pre-design`
- **Design** → `/twt-design`
- **Content quality (text-analysis)** → `/twt-text-analysis` (sub-step — runs after Design whenever Design is in the phase set; see the dedicated paragraph below)
- **Content approval checklist** → `/twt-content-approval-checklist` (whenever Development is selected; for Figma express, pass the Figma URL so current design copy, lorem/placeholder text, links, and media references are captured into the workbook before build)
- **Development** → `/twt-develop` (forwarding the chosen `--target`; it builds with currently available content and leaves approval implementation for a later explicit call) **or** `/twt-site-dev` (Figma express; it reuses/refines the workbook and builds with current Figma content)
- **QA** → `/twt-qa`

Dispatch every phase wrapper with `subagent-collect` (rule 13) and forward **the Step 0b project brief** (what/who, content sources, brand/design source, stage) plus any free-form `$ARGUMENTS` context as notes — this is the input the collect-mode sub-skills draft from, so pass it in full to every phase.

**Content quality (text-analysis) — sub-step after Design.** Whenever the **Design** phase is in the set (so real page copy exists), dispatch `/twt-text-analysis` after Design returns and **before** the Content approval checklist, so the workbook captures quality-checked copy. This is a **full-workflow-only** step — `/twt-site-dev` (Figma express) does **not** run it. Target each page's drafted copy: the curation outlines `.twt-artifacts/pre-design/curation/outlines/*.md` (preferred editable source) and, if present, the mockup copy under `.twt-artifacts/design/mockup/`. Dispatch per page with `subagent-collect`; the child writes `analysis-report.md` + `optimized.md` under `.twt-artifacts/content/text-analysis/<page-slug>/` and a sibling `decisions.md`, but **never edits the source non-destructively** (collect mode applies suggested copy only to its own `optimized.md`). **Interactive:** at the next gate, surface a one-line per-page quality summary (document Overall + how many blocks scored < 85); the user applies improvements through the normal content-approval / `/twt-content-optimize` flow. **Auto mode:** dispatch `/twt-text-analysis auto …` so blocks below 85 are rewritten and the improved copy is available for the content-approval workbook. It is non-destructive to built mockups and never blocks the run — a failed/empty analysis is reported, not fatal. Log the dispatch in the Timeline.

Treat the **Content approval checklist** as a required pre-development sub-step, not as an optional report line: when Development is selected, dispatch `/twt-content-approval-checklist` immediately after Design has completed (or, for Figma express, inside `/twt-site-dev` before build). After the child returns, verify `.twt-artifacts/content-approval/content-approval-checklist.xlsx` exists. If it does not exist, do **not** start Development; report that the content-approval workbook failed to materialize and surface the child error/output so the user can fix the source or dependency. In auto mode this is still a hard prerequisite for Development because later approval implementation depends on the workbook path.

**Visual-direction surfacing (interactive only, before Design).** When the Design phase is in the set, no Figma/exported design was provided, and this is **not** auto mode: after `/twt-design` returns, read `.twt-artifacts/design/decisions.md` for the open "Confirm site visual direction" decision and present it to the user via the **AskUserQuestion** tool (Approve / Adjust dials / Override / You decide — per `/twt-design` Step 1b). Then re-dispatch `/twt-design --only design-system … ` in refinement mode with the resolved direction so the confirmed `design-read.md` propagates before components/layouts/mockups bind to it. This is the rule-13 surfacing point — without it the visual direction silently stays inferred. **Auto mode skips this** (the proposed read is model-decided and logged in Step 5).

**Pilot-page surfacing (interactive only, during Development via `/twt-develop`).** A full multi-page build is the most expensive part of the run, so check one page before committing to all. When Development builds via `/twt-develop` (not Figma express) and this is **not** auto mode: `/twt-develop` (dispatched with `subagent-collect`) builds only the **pilot page** and returns an open "Pilot page built — approve to build the rest" decision in `.twt-artifacts/<html-site|elementor-theme>/decisions.md` with the pilot's path and the list of remaining pages. Read it and present the gate to the user via the **AskUserQuestion** tool (single-select, header "Pilot"): **Build the remaining N pages** / **Add one more pilot page** / **Adjust the pilot** / **Stop here**. On approve, re-dispatch `/twt-develop --target <target> pilot-approved` (with `subagent-collect`) to promote the rest; on adjust/add, forward the feedback and re-dispatch, then re-surface; on stop, leave the remaining pages unbuilt and record it. Log each gate Q&A to the Timeline. **Auto mode skips this** — dispatch `/twt-develop auto …` so it builds all pages in one pass.

Before dispatching a phase, check its prerequisite exists: Development (non-express) needs `.twt-artifacts/design/design-brief.md`; QA needs built output (`site/` or a theme). If a prerequisite is missing, raise it at the Step 4 pause instead of dispatching blindly (in auto mode: stop the pipeline there and report — never invent the missing input).

For the **Content approval checklist** pseudo-phase, pass the design brief, layouts, mockups, design-system artifacts, asset manifest, and any user notes. Include both canonical and legacy artifact locations when present: `.twt-artifacts/design/design-brief.md`, `.twt-artifacts/design/layout/layouts/`, `.twt-artifacts/design/layout/*.md`, `.twt-artifacts/design/mockup/pages/`, `.twt-artifacts/design/mockup/*.html`, `.twt-artifacts/design/mockup/index.html`, and pre-design sitemap/curation outlines. If the target is **Figma express**, pass the Figma URL as the primary content source and instruct the child to extract the visible design copy into `current content`, including lorem ipsum, placeholder copy, draft links, image labels, video references, and SEO-looking text. If the workbook already exists, instruct the child to preserve approved content and fill only newly discovered scope. In interactive mode, surface this as the approval workspace before Development; the user may proceed with partial approvals, but unready rows will not be implemented.

## Step 4 — Approval pause (after each phase)
Read the just-finished phase's output and count any **outstanding BLOCKERs**. **Use the Read / Glob / Grep tools to read every artifact** (briefs, `validation-report.md`, `decisions.md`) — never a Bash `cat`/`grep`/`sed`/`for`-loop, and never `cd` into an absolute path; a compound shell read prompts the user on every run, whereas the file tools are silent. To scan a set of sibling files, Glob the pattern (e.g. `.twt-artifacts/pre-design/*/decisions.md`) then Read/Grep each.
- Pre-design / Design: the `Outstanding BLOCKERs` section of `pre-design-brief.md` / `design-brief.md` (and the sub-area `validation-report.md`s).
- Development: the builders' reported reuse/issues.
- QA: the `verdict` and BLOCKER count in `.twt-artifacts/qa/qa-report.md` (+ the `gaps.md` items).

### Step 4a — Write the phase review (after Pre-design, Design, and Development)
Before the gate, distil what the phase's validators found into a **short, scannable review** the user can actually act on — not a wall of validation prose. Aggregate the findings you just read (every sub-area `validation-report.md`, the brief's Outstanding BLOCKERs, and the builders' reported issues) and write **`.twt-artifacts/<phase>/phase-review.md`** (`<phase>` = `pre-design` / `design` / the build dir `html-site` or `elementor-theme`). Use the Write tool. Structure it exactly as:

```markdown
# <Phase> review — <ISO timestamp>

One line: <N BLOCKERs · M WARNINGs · K suggestions> across <areas reviewed>.

| # | Severity | Problem | Why it matters | Suggested fix | Your decision / ✅ approve |
|---|----------|---------|----------------|---------------|---------------------------|
| 1 | BLOCKER  | <one concrete problem — name the artifact/area> | <1–2 sentences: the concrete consequence if shipped as-is> | <the specific change to make, or "—" if none> | <leave blank — user writes accept / fix / ignore, or ✅> |
```

Rules for the table:
- **One row per real problem**, ordered BLOCKER → WARNING → SUGGESTION. Do **not** list things that passed — only what needs a decision. If a phase has zero findings, write a single row stating "No issues found — review and approve" so the user still gets an explicit checkpoint.
- `Problem` is a concrete statement, not a metric dump (good: "Hero copy is lorem ipsum on Home"; bad: "content fidelity 60%"). `Why it matters` is 1–2 sentences of consequence. `Suggested fix` is the specific action or `—`.
- The last column is **left blank for the user** — it is their answer/approval area; never pre-fill it.
- Keep the whole table tight; if there are many low findings, keep the top BLOCKERs/WARNINGs as rows and roll the rest into one final "Other minor suggestions (N)" row.

After writing it, in interactive mode point the user to the file path on its own line at the gate ("Phase review: `.twt-artifacts/<phase>/phase-review.md` — N BLOCKERs, M WARNINGs; edit the last column to record your decisions"). In auto mode still **write** the review (it's the unattended run's audit trail), and reference it in the final summary.

**Auto mode — no gate:** auto-proceed to the next phase. Resolve any aggregated `decisions.md` open questions yourself: prefer an answer derivable from the free-form context, else accept the child's proposed/model-decided assumption, re-dispatch the relevant `*-define` in refinement mode with those answers (clearing `decisions.md` → resolved), and log every auto-decision for the final summary. BLOCKERs don't stop the run — record them as **deferred** and continue; stop only when the next phase's hard prerequisite is missing. Never re-run a phase more than once on the same inputs.

Otherwise ask via the **AskUserQuestion** tool (single-select, header "Next"):
- **Discuss visual direction** *(offer only when the next phase is Design and no Figma/exported design was provided)* — set the site's visual requirements *with the user before* Design runs, instead of reviewing them after the design system is built. Run the `/twt-design` Step 1b gate now: present the proposed Design Read (one-line read + the three dials + type/color/layout/motion notes) and ask via **AskUserQuestion** (Approve / Adjust dials / Override / You decide), then write `.twt-artifacts/design/design-read.md` with `status: confirmed` and clear the "Confirm site visual direction" decision in `decisions.md`. Then dispatch Design with the confirmed read — this makes the Step 3 post-Design surfacing a no-op. List this **first** and recommend it whenever the only outstanding BLOCKER is the unconfirmed visual direction.
- **Proceed to <next phase>** — continue the pipeline (describe as "finish" after the last phase). When the next phase is Design and the visual direction is still unconfirmed, proceeding here defers it to the post-Design art-direction pick (the Step 3 surfacing).
- **Re-run this phase** — dispatch the same phase wrapper again (e.g. after fixing inputs)
- **Stop here** — end the workflow; report what's done and what remains
When BLOCKERs are present, the option descriptions should recommend the right remedy and name the blocker count — for an unconfirmed-visual-direction BLOCKER that remedy is **Discuss visual direction** (a human pick, not a re-run, which can't resolve it). Continue the pipeline on **Proceed**, or after **Discuss visual direction** resolves.

## Step 5 — Final summary & finalize the log
**First**, finalize the curated session log: ensure every question/answer and every dispatched phase wrapper is in the Timeline, then fill the run's **Outcome** block (phases completed · outstanding BLOCKERs · key artifact paths) in `.twt-artifacts/site-log.md`. Do all `site-log.md` edits **before** the next step (the summarizer appends to end-of-file).

**Then** run (Bash) `node "${CLAUDE_PLUGIN_ROOT}/hooks/twt-debug-log.js" --summarize` — it folds the **full dispatch trace** (every Task/Agent dispatch and every Skill call — twt + any other plugin/superpowers/system skill, each with its WHY and wall-time) plus the **wall-time cost tables** (by phase + by skill) into `.twt-artifacts/site-log.md` as a final `### Dispatch trace` section under this run, then disarms the hooks. Do this **even on an early stop**, so a partial run still gets its trace folded. (If the tracer was never armed — hook missing — skip; the curated Timeline still stands.) There is no token column (not available to hooks).

Then report to the user: which phases ran, where each artifact lives (`pre-design-brief.md`, `design-brief.md`, the built `site/` or theme, `qa-report.md`, `gaps.md`), **the per-phase review files** (`.twt-artifacts/<phase>/phase-review.md`) the user should still triage, the QA verdict if QA ran, and any outstanding BLOCKERs or unready content rows the user chose to defer. **Call out the content-approval workbook explicitly** when Development ran: state its full path `.twt-artifacts/content-approval/content-approval-checklist.xlsx` and its row count on its own line (it is easy to miss under the `content-approval/` subdir), and make clear content approval is a **parallel** process — after stakeholders finish the workbook, run `/twt-content-approval-implement` to apply approved rows to the built blocks/pages. Point to **the single log** at `.twt-artifacts/site-log.md` (curated Timeline + auto-folded dispatch trace & cost). In auto mode additionally list **every auto-decision** (what was decided, from what evidence, or "default") and **every deferred BLOCKER** — this list is the user's review checklist for the unattended run.
