---
name: twt-wiki-define
category: wiki
description: (v1.0.7) Drain the wiki inbox and curate it into cited decision, idea, entity, and fact pages
version: 1.0.7
accepts_arguments: true
inputs:
  - Optional focus (a page, a topic, or "inbox only"); otherwise curates everything pending
dependencies:
  hard: []
  soft:
    - twt-wiki-fetch
reads:
  - .project-wiki/AGENTS.md
  - .project-wiki/inbox.md
  - .project-wiki/index.md
  - .project-wiki/overview.md
  - .project-wiki/sources.md
  - .project-wiki/raw/
  - .project-wiki/decisions/
  - .project-wiki/entities/
  - .project-wiki/ideas/
  - .project-wiki/facts.md
  - .project-wiki/open-questions.md
  - .project-wiki/glossary.md
  - .project-wiki/analyses/
  - .project-wiki/log.md
writes:
  - .project-wiki/decisions/
  - .project-wiki/entities/
  - .project-wiki/ideas/
  - .project-wiki/facts.md
  - .project-wiki/open-questions.md
  - .project-wiki/glossary.md
  - .project-wiki/index.md
  - .project-wiki/overview.md
  - .project-wiki/inbox.md
  - .project-wiki/log.md
---

# /twt-wiki-define

## Intent

**Purpose:** Turn raw capture into memory. Drain `inbox.md` and newly ingested sources into curated, cited pages that a human or an agent can actually navigate.

**Non-goals:**
- Does not ingest sources (that is `twt-wiki-fetch`).
- Does not copy artifacts into the wiki. It **links** to `.twt-artifacts/` paths.
- Does not delete a source file, a curated page, or an undrained inbox entry.
- Does not silently resolve a contradiction.

**Success criteria:**
- Every `inbox.md` entry inside this run's scope (all of it, unless a focus argument narrowed the pass — see Step 2b) is either promoted to a page/row or explicitly dismissed with a reason; any entry left because it was genuinely unclear stays in the inbox, undrained, and is called out in the report.
- Every claim on a curated page cites a source path, artifact path, URL, or `log.md` entry — never a path into `inbox.md`, which this skill empties.
- `index.md` lists every page with a current one-line summary.
- Contradictions are marked `status: needs-review`, never overwritten.
- Re-running enters refinement mode (CONVENTIONS §10).

---

## Step 1 — Detect mode (CONVENTIONS §10)
Read `.project-wiki/index.md`. If curated pages already exist, this is **refinement mode**: you are merging into an existing wiki, not building one. Never overwrite a `decisions/`, `entities/`, or `ideas/` page — or a `facts.md`/`open-questions.md`/`glossary.md` row — wholesale; merge into it and preserve its existing citations. These hold decisions a human made and cannot be re-asked for free.

`index.md` is different: it is a synthesized catalog, not hand-fed content, and Step 7 regenerates it fresh from the current page set on every run (via `tools/wiki-index.mjs`) — that is not "overwriting a page" in the sense this step forbids. `overview.md` is not purely synthesized, though — it can carry hand-added prose about the project that no page or artifact restates, so Step 7 **merges** into its existing text rather than regenerating it from scratch. Treat it like any other curated page: update, don't duplicate or discard.

If `.project-wiki/AGENTS.md` does not exist, stop: the wiki has not been initialized. Tell the user to run `/twt-wiki`.

## Step 2 — Read the operating manual
Read `.project-wiki/AGENTS.md`. It is the wiki's own schema and it wins over your assumptions — if it and this skill disagree, follow `AGENTS.md` and say so in your report.

## Step 2b — Apply a focus argument (if given)
Check `$ARGUMENTS` (see `skills/twt-curation-define/SKILL.md` Step 1b for the sibling pattern this follows). If it is empty, this is a full pass — curate everything pending and skip to Step 3 unchanged.

If `$ARGUMENTS` names a focus, it narrows Steps 3–5 to that scope only:
- **`inbox only`** — drain `inbox.md` as normal, but skip Step 4 entirely: do not synthesize any source from `sources.md` this run.
- **A topic** (e.g. `pricing`, `design-system`) — in Step 3, group and promote only inbox entries whose content matches the topic; in Step 4, synthesize only sources relevant to it. Leave every non-matching inbox entry exactly as found.
- **A page path** (e.g. `decisions/2026-07-11-cta-color.md` or `entities/acme-corp`) — narrow Steps 3–5 to inbox entries and sources that bear on that one page. Leave everything else untouched.

A focus never excuses Step 5 (contradictions) or Step 8's undrained-entry rule for whatever it *does* touch. In the Step 9 report, say explicitly which entries were left because they were out of this run's focus (by design, not a failure) versus left because they were genuinely unclear (see Step 8).

## Step 3 — Drain the inbox
Read `.project-wiki/inbox.md`. It is append-only capture: each entry is a `## ` section whose heading is `<ISO-8601 UTC> · <kind> · <source>`, with `- **key:** value` fields. `kind` is `decision` (a human answered a question) or `reason` (a skill recorded its reasoning).

Group related entries — a `decision` and the `reason` that explains it usually belong on one page. Then route each group:

| Entry is about | Goes to |
|---|---|
| A choice that is now settled | `decisions/YYYY-MM-DD-<slug>.md` |
| Something wanted but not yet scoped | `ideas/<slug>.md` |
| A person, company, audience, competitor, product | `entities/<slug>.md` |
| A reusable factual value (a date, a count, a claim) | a row in `facts.md` |
| A term of art, a naming rule, or a banned word ("never say agency") | a row in `glossary.md` — Terms or Banned words table |
| Something still unresolved | a row in `open-questions.md` |
| Noise (a trivial or superseded choice) | dismiss it — but say which entries you dismissed, and why, in your report |

`facts.md`, `open-questions.md`, and `glossary.md` already exist with headers the scaffolder seeded — append rows that match them exactly rather than inventing a new layout:

```
facts.md:           | fact | canonical | status | sources (value@source) |   (## Canonical facts)
open-questions.md:  | Question | Why it matters | Blocked | Raised |
glossary.md:        | Term | Means |            (## Terms)
                    | Never say | Say instead | Why |   (## Banned words)
```

`facts.md` is the one curated file with a **second sanctioned writer**: `twt-curation-define` reconciles pipeline facts directly into it (CONVENTIONS §17). **Never hand-edit its fact rows** — merge each through the bundled merger (Bash; one call may carry several `--row` flags):

`node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-facts-merge.mjs" "$CLAUDE_PROJECT_DIR" --row "fact|canonical|STATUS|value@source"`

It appends or merges by fact key and enforces never-silently-flip mechanically: two disagreeing RESOLVED values become a `CONFLICT` row carrying both sources; a weaker claim never degrades a settled row; pass `RESOLVED` over an existing `CONFLICT` only when a human ruled. Leave its `## Provided assets` table to the pipeline; you never write that section.

For a fact row: `Status` is `RESOLVED` when there is one source or all sources agree (`Canonical value` = the settled value), `CONFLICT` when sources disagree (see Step 5), `UNVERIFIED-ATTR` when a generic example is pinned to a named entity without re-sourcing, or `TBD` when needed but absent everywhere. `Sources` lists each contributing value as `value@source`.

**A decision page looks like this** — the `why` is the reason the page exists at all, and it must be a *real* reason, never a manufactured one:

```
---
title: Primary CTA is orange, not brand navy
type: decision
status: current
updated: 2026-07-11
summary: navy failed hero contrast; orange clears AA
sources:
  - .twt-artifacts/design/design-system/tokens.css
tags: [design-system, color]
---

# Primary CTA is orange, not brand navy

**Decided:** the primary CTA uses the orange accent.

**Why:** brand navy failed WCAG AA against the dark hero (2.9:1). Orange clears it at 4.8:1.

**Evidence:** [tokens.css](../../.twt-artifacts/design/design-system/tokens.css) — captured via AskUserQuestion, 2026-07-11T14:03:22Z.

**Reversible:** yes — reverting means re-solving hero contrast.

**Superseded by:** _none_
```

**When there is no paired reason, do not invent one.** The capture hook only ever emits `question` / `options` / `chosen` (or `raw`) — it never records *why* a choice was made; a `why` exists only when a separate `kind: reason` entry was also captured alongside the `decision` (a mechanism not every skill uses yet). If Step 3's grouping finds a `decision` with no matching `reason` entry, that page legitimately has no rationale on record. Fabricating a plausible-sounding one — even a cautious, "probably because..." guess — is never acceptable: it fabricates provenance in a system whose entire purpose is trustworthy provenance, which is worse than an honest gap. Write the `why` as explicitly unknown instead, and mark the page for human follow-up:

```
**Why:** _not captured — the choice was recorded, the reason was not._
```

...and set that page's `status: needs-review` (not `current`) until a human supplies the reason or confirms the page doesn't need one.

Note what the evidence line does *not* do: it does not cite `.project-wiki/inbox.md#<timestamp>` as a `sources:` path. Step 8 empties `inbox.md` in this same run, so a link into it would be dead before the page is even saved. `AGENTS.md` lists exactly four things a claim may cite — source path, artifact path, URL, or `log.md` entry — inbox.md is deliberately not one of them. Record the inbox timestamp as plain provenance text in the body instead, the way the example does.

**An idea page** carries `type: idea` and `status: raw | shaped | scoped | shipped | dropped`, plus what it is, why it might matter, and what would have to be true to scope it.

**An entity page looks like this** — entities are also where `type: concept` pages live (there is no `concepts/` folder). Note the `## Decisions` list: it is the back-link half of the cross-linking rule below.

```
---
title: Acme Corp
type: entity
status: current
updated: 2026-07-12
summary: the client — B2B logistics, 200 staff, rebranding from "Acme Shipping"
sources:
  - raw/meetings/2026-07-10-kickoff.md
tags: [client]
---

# Acme Corp

**What:** the client. B2B logistics, ~200 staff, three product lines.

**Voice constraint:** never "agency" for themselves; "firm" ([glossary](../glossary.md)).

## Decisions
- [Primary CTA is orange, not brand navy](../decisions/2026-07-11-cta-color.md) — their brand navy failed hero contrast
```

**Cross-link every page you touch (both directions).** The wiki is a graph, not a set of drawers — a page no other page links to is knowledge nothing trails to. When a decision names an entity, link the entity from the decision **and** add the decision to the entity's `## Decisions` list; when two decisions relate (one constrains, supersedes, or motivated the other), link them both ways; an idea that came out of a decision links it. Use relative Markdown links, as in the examples. Before finishing, check each page you created or updated: does at least one *other* collection page link to it? If nothing does, either add the missing link where it naturally belongs or say in your report why the page legitimately stands alone.

## Step 4 — Synthesize newly ingested sources
For each source in `sources.md` not yet reflected on any page, read it from the location in that row's `Where` column. That location is not always under `raw/`: per `twt-wiki-fetch`, a binary or fetched extract is copied into `raw/...`, but a file already in the repo (or a very large file) is registered by its original project-relative path instead and was never copied. Read whichever path the row actually names, then fold what matters into existing entity/concept pages. **One source usually touches several pages** — the client entity, a competitor entity, a fact row, a glossary term — not just one; walk the source's claims and route each to its home, cross-linking as you go (see Step 3's rule). **Update, never duplicate** — a second page about the same entity is a bug. Create a new page only when the knowledge is durable and has no home.

## Step 5 — Handle contradictions honestly (do not resolve them silently)
When a new source contradicts a current page, or two sources disagree:
- Set the affected page to `status: needs-review`.
- Record both values with their sources.
- For a factual value, add or update its row in `facts.md`: `Status` = `CONFLICT`, `Canonical value` = `TBD`, `Sources` = each disagreeing value as `value@source` — **never silently pick a side.**
- Add a row to `open-questions.md`.
- Surface every one of these in your report.

## Step 6 — Link artifacts, never copy them
When a claim is evidenced by a twt artifact, cite it as a **relative path** into `.twt-artifacts/`. Never copy an artifact's content into a wiki page. Artifacts regenerate; a copy is stale the moment the skill re-runs.

## Step 7 — Update the index and overview
Give every curated page you created or touched this run a one-line `summary:` field in its frontmatter — the index is compiled from it (a page without one is cataloged by title alone). Then regenerate `index.md` (Bash, single command) — never rewrite it by hand; a freehand rewrite is how a page gets silently orphaned:

`node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-index.mjs" "$CLAUDE_PROJECT_DIR"`

It catalogs every page by collection with its title, `summary`, `status`, and `updated` date — including `analyses/` pages saved by `/twt-wiki-query`, which you index but never author or edit.

For `overview.md`, do not regenerate it: read its current text and merge in only what changed in the project's what/who/where-it-stands, preserving any hand-added prose that this run's changes don't invalidate.

## Step 8 — Drain the inbox and log
Never rewrite `inbox.md` by hand — a freehand rewrite is how a captured decision gets lost. Drain with the tool instead (Bash):

1. `node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-drain.mjs" "$CLAUDE_PROJECT_DIR" --list` — prints every entry, numbered in file order (do this at the start of Step 3 if you prefer; capture only ever appends, so the numbers stay stable for the whole pass).
2. Collect the numbers of exactly the entries you promoted to a page/row or explicitly dismissed this pass — and no others.
3. `node "${CLAUDE_PLUGIN_ROOT}/tools/wiki-drain.mjs" "$CLAUDE_PROJECT_DIR" --drain <n,m,...>` — or `--drain all` when every entry was handled. The tool removes only the named entries and preserves everything else byte-for-byte — the header comment, the order, and each undrained entry verbatim. An invalid number aborts the whole drain without writing anything.

**Never drain an entry you left because you were unsure.** Leave it in the inbox and say so in your report — this is the one rule that cannot bend, since losing a captured decision defeats the entire point of the inbox.

Append to `log.md`:

```
## <YYYY-MM-DD> — curate
Drained <n> inbox entries: <n> decisions, <n> ideas, <n> entities, <n> facts, <n> dismissed. <n> left undrained.
Contradictions raised: <n>.
```

## Step 9 — Report
Tell the user:
- Pages created and updated, with paths
- Every contradiction raised, and where it now lives
- Every inbox entry dismissed, and why
- Every inbox entry left undrained, and why
- What still needs a human decision
