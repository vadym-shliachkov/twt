---
name: twt-project-intake
category: intake
description: (v1.0.0) Normalize messy project notes into a clean site-instruction.md for /twt-site
version: 1.0.0
accepts_arguments: true
inputs:
  - Messy project notes, URLs, Figma links, document paths, constraints, or `--from <path>`
  - Optional `--root` to write `site-instruction.md` at the project root instead of `.twt-artifacts/site-instruction.md`
dependencies:
  hard: []
  soft: []
reads:
  - $ARGUMENTS
  - site-instruction.md
  - .twt-artifacts/site-instruction.md
  - .twt-artifacts/pre-design/pre-design-brief.md
  - .twt-artifacts/design/design-brief.md
writes:
  - .twt-artifacts/site-instruction.md
  - site-instruction.md (only with --root or explicit user confirmation)
  - .twt-artifacts/intake/intake-report.md
---

# /twt-project-intake

## Intent

**Purpose:** Convert messy project notes, links, Figma references, document paths, and constraints into a clear `site-instruction.md` that `/twt-site` can read before its intake interview. This gives the full pipeline a reusable, human-editable brief instead of making each phase infer intent from scattered notes.

**Non-goals:**
- Does not run `/twt-site`, fetch source content, build pages, or validate downstream artifacts
- Does not silently overwrite an existing instruction file
- Does not invent binding project decisions when the notes are ambiguous; it records open questions instead

**Success criteria:**
- Writes a structured `site-instruction.md` covering intake, sources, phase choices, Figma approach, build target, and per-phase guidance when those can be inferred
- Preserves ambiguous or missing inputs as explicit open questions instead of hiding them
- If an instruction file already exists, enters refinement mode and merges new notes without discarding previous user decisions
- Ends with a concise report naming the file written, major inferred decisions, open questions, and the suggested next `/twt-site` command

---

## Step 1 - Gather the raw intake material

Parse `$ARGUMENTS` for optional flags:
- `--from <path>`: read that project-relative file as the primary raw intake source.
- `--root`: target `site-instruction.md` in the project root.

If `$ARGUMENTS` includes free-form notes, URLs, or paths, use them as raw intake material. If `$ARGUMENTS` is empty and no `--from` file is provided, ask one plain-text question:

```
Paste the messy project notes, URLs, Figma links, document paths, constraints, or type `none` if you want me to start from existing artifacts.
```

Stay inside the current project. Read only project-relative files explicitly supplied by the user or the existing instruction/artifact files listed in frontmatter. Do not search sibling folders, home directories, or arbitrary absolute paths for context.

## Step 2 - Detect refinement mode

Check for an existing instruction file in this order:
1. `site-instruction.md`
2. `.twt-artifacts/site-instruction.md`

If either exists, read it and enter refinement mode. Preserve previous explicit decisions unless the new notes clearly override them or the user directly asks to replace them. If both exist, prefer the root `site-instruction.md` as the current canonical file and treat the artifact copy as secondary context.

Target path:
- Use `site-instruction.md` when `--root` is present or when an existing root instruction file is being refined.
- Otherwise use `.twt-artifacts/site-instruction.md`.
- If writing to the root would create a new file and `--root` was not provided, ask for confirmation first; default to `.twt-artifacts/site-instruction.md`.

If the chosen target already exists, do not overwrite blindly. Merge the new normalized material into the existing structure and keep an `## Source notes` section so the user can see what changed.

## Step 3 - Normalize the evidence

Extract and classify what the user supplied. Prefer explicit statements over inference.

Classify sources:
- `http://` or `https://` URL that is not Figma or Google Docs: live site or web source.
- Figma URLs: design source.
- `.pdf`: PDF source.
- `.doc`, `.docx`, Google Docs, `.md`, `.txt`: document source.
- Local image names or folders: brand/design/media source.
- Phrases like "WordPress", "Elementor", "static HTML", "landing page", "QA only", "skip design": pipeline constraints.

Infer these slots when evidence is strong:
- What and who: business/product, site purpose, audience, primary conversion goal.
- Content sources: URLs, docs, PDFs, existing sites, copy decks.
- Brand/design source: Figma, brand book, screenshots, color/font notes, existing identity.
- Stage: new build, redesign, or extend.
- Phases: Pre-design, Design, Development, QA.
- Figma approach: Express or Design source.
- Build target: Static HTML or Elementor.
- Per-phase guidance: notes aimed at pre-design, design, development, content approval, or QA.

When the evidence is weak, record an open question. Do not ask live unless the missing answer blocks a useful instruction file. A useful file may contain open questions; `/twt-site` can still use the known slots and ask only for what remains.

## Step 4 - Resolve only high-impact ambiguity

Ask live questions only when the instruction file would otherwise be misleading. Ask one question at a time.

Use plain text for free-form missing details. For fixed choices, use AskUserQuestion:
- Stage: New build / Redesign / Extend / You decide.
- Figma approach, only when a Figma link exists and the notes do not make intent clear: Express / Design source / You decide.
- Build target, only when Development is likely and no target is clear: Static HTML / Elementor / You decide.

If the user chooses "You decide", record the selected default plus the evidence behind it in `## Model-decided assumptions`.

Default choices when the user delegates:
- Stage: redesign when an existing live site is provided; otherwise new build.
- Figma approach: Express when the Figma appears to be the finished design and the user asks to build it; otherwise Design source.
- Build target: Elementor when WordPress, Elementor, child theme, or existing theme artifacts are mentioned; otherwise Static HTML.
- Phases: all phases unless the notes explicitly scope the run, such as "QA only", "build from this Figma", or "skip pre-design".

## Step 5 - Write site-instruction.md

Write the instruction file in this format. Keep it concise, but include enough context that `/twt-site` can skip already answered intake questions.

```
# Site instruction

Generated by: /twt-project-intake
Last updated: <YYYY-MM-DD>
Status: draft | ready-with-open-questions | ready

## Project brief

What/who: <business, site purpose, audience, conversion goal>
Stage: <new build | redesign | extend | open question>

## Sources

### Content sources
- <source> - <why it matters or what it contains>

### Brand and design sources
- <source> - <Figma, brand book, screenshots, color/font notes, etc.>

## Pipeline decisions

Phases: <Pre-design, Design, Development, QA | scoped set | open question>
Figma approach: <Express | Design source | not applicable | open question>
Build target: <Static HTML | Elementor | open question>

## Per-phase guidance

### Pre-design
- <audience, positioning, IA, content, brand notes>

### Design
- <visual direction, typography, color, motion, component, layout constraints>

### Content approval
- <approval workflow, missing content, stakeholder review notes>

### Development
- <target, platform, technical constraints, integration notes>

### QA
- <accessibility, responsive, content, link, platform-specific emphasis>

## Open questions

- <question> - why it matters

## Model-decided assumptions

- <assumption> - evidence: <source/evidence/default>

## Source notes

<short normalized summary of the raw notes; preserve URLs and paths exactly>

## Suggested next command

`/twt-site`
```

Set `Status` as:
- `ready` when no open questions remain.
- `ready-with-open-questions` when the file is useful but `/twt-site` should still ask about open items.
- `draft` when the input is too sparse to guide the pipeline.

If the user supplied an existing instruction file, preserve any user-authored sections that are not part of this schema under:

```
## Additional notes from previous instruction
```

## Step 6 - Write the intake report

Also write `.twt-artifacts/intake/intake-report.md`:

```
# Project intake report

Generated: <YYYY-MM-DD>
Instruction file: <path>

## Inferred decisions

| Slot | Value | Evidence |
|------|-------|----------|
| <slot> | <value> | <evidence> |

## Open questions

- <question> - <impact>

## Sources classified

| Source | Type | Notes |
|--------|------|-------|
| <source> | <type> | <notes> |

## Next step

Run `<suggested command>` after reviewing the instruction file.
```

The report is a companion for the human. `/twt-site` reads the instruction file, not this report.

## Step 7 - Report

Tell the user:
- Which instruction file was written or refined.
- Whether the output is ready, ready with open questions, or draft.
- The main inferred decisions: phases, Figma approach, build target, and stage.
- Any open questions that remain.
- The next command to run, usually `/twt-site` or `/twt-site auto` if the instruction file is complete enough for unattended execution.
