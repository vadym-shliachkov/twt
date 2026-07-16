---
name: twt-audience-define
category: audience
description: (v1.0.1) Build or refine personas.md — personas seeded from positioning segments, with journey stages and conversion actions
version: 1.0.1
accepts_arguments: true
inputs:
  - Optional answers; otherwise interactive
dependencies:
  hard: []
  soft:
    - twt-positioning-define
    - twt-brand-define
    - twt-content-fetch
reads:
  - .twt-artifacts/pre-design/positioning/positioning.md
  - .twt-artifacts/pre-design/brand/brand-brief.md
  - .twt-artifacts/pre-design/content/fetched/
  - .twt-artifacts/pre-design/ia/sitemap.md
  - .twt-artifacts/pre-design/audience/personas.md
  - .twt-artifacts/pre-design/audience/validation-report.md
writes:
  - .twt-artifacts/pre-design/audience/personas.md
  - .twt-artifacts/pre-design/audience/decisions.md
---

# /twt-audience-define

## Intent

**Purpose:** Deepen positioning's audience segments into the canonical `personas.md` — 2–4 concrete personas (goals, jobs-to-be-done, objections, information needs, device/context, tone preference) plus per-persona journey stages ending in a conversion action — so IA, curation, layout, and text quality have an audience signal to decide against.

**Non-goals:**
- Doesn't define audience segments — every persona traces to a segment in `positioning.md` (aborts if positioning is missing); never invents a segment positioning doesn't have
- Doesn't define the sitemap or page priorities (that's `/twt-ia-define`, which reads this artifact)
- Doesn't fabricate demographic or research data — persona details are grounded in positioning, brand, and fetched content, or marked TBD
- Doesn't critique itself (that's `/twt-audience-validate`); never overwrites without consent

**Success criteria:**
- 2–4 personas, each naming its source positioning segment and the value prop(s) it responds to
- Every persona has a journey (entry intent → discovery → proof → conversion stages) with information needs per stage and one concrete conversion action
- Journeys are stage-based; when `ia/sitemap.md` already exists at run time, each stage is additionally bound to a page
- Re-run enters refinement mode (rule 10) rather than starting over

---

## Step 1 — Detect mode (rule 10)
If `.twt-artifacts/pre-design/audience/personas.md` exists → **refinement mode**: read it and any sibling `validation-report.md`; if findings exist, list them via the **AskUserQuestion** tool and ask which to address; only touch the chosen sections. Else → **from-scratch mode**.

## Step 1b — Collect mode (CONVENTIONS rule 13)
If `$ARGUMENTS` contains the token `subagent-collect`, run in **collect mode**: do NOT call `AskUserQuestion`. Draft `personas.md` from the loaded context using best practice, and for every choice you would otherwise have asked about, add an entry to `.twt-artifacts/pre-design/audience/decisions.md` (decisions.md format — frontmatter `generated`/`area`/`producer`/`status: open`; sections `## Open questions` (each bullet: question — `options: [a, b, c]` — `model-leaning: <choice>`, plus an indented `- why it matters:` line), `## Model-decided assumptions (review)` (each bullet: field = value — `basis: <why>` — `reversible: yes|no`), `## Proposed rules (confirm before binding)` — the `options:`/`model-leaning:`/`basis:`/`reversible:` keys are literal, colons included; the checker below rejects bullets without them). Set `status: open`. After writing `decisions.md`, verify it (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file <its path>` — fix until it passes; three consumers (the orchestrator's surface-up flow, gen-report, wiki-harvest) parse this exact format, and a drifted section title is silently invisible to them. Then write the draft and return the decisions block in your report. Do not loop on the user. **Stay in-project:** work only inside this project — never read files outside it (no sibling project folders, no home directory) to find formats or examples; every format you need is specified in this skill.

If `$ARGUMENTS` additionally contains resolved answers (re-dispatch in refinement mode), apply them, set `decisions.md` `status: resolved`, and finalize.

## Step 2 — Load inputs (positioning is required)
Read `.twt-artifacts/pre-design/positioning/positioning.md` — its audience segments are the seed. If absent, **abort**: "No positioning.md found — run /twt-positioning-define first." Then read soft context if present, degrading gracefully when absent:
- `brand/brand-brief.md` — voice and tone boundaries each persona's tone preference must not contradict
- `content/fetched/` — how the client describes their customers, testimonials, case-study language
- `ia/sitemap.md` — only if it already exists (standalone run after IA): enables page binding in Step 4

## Step 3 — Personas (interview / refine)
For each positioning segment worth deepening (usually all primaries; ask which via the **AskUserQuestion** tool when there are more than 4), build a persona:
- **Name + source segment** — a short memorable handle, and the exact positioning segment it comes from
- **Goals** — what they're trying to achieve (from segment needs)
- **Jobs-to-be-done** — the tasks that bring them to this site
- **Objections** — what makes them hesitate; what proof overcomes it
- **Content & information needs** — what they must find to move forward
- **Device & context** — where/how they arrive (mobile on-site? desk research? referral?)
- **Tone preference** — how they want to be spoken to, within brand-brief voice bounds
- **Value props addressed** — which positioning value prop(s) this persona responds to

Ground every attribute in a source (segment need, fetched testimonial, brand voice) or mark it TBD — no invented research.

## Step 4 — Journeys
Per persona, walk the four stages — **entry intent → discovery → proof → conversion** — capturing per stage: what the persona is thinking, the information needs that must be met, and (only when the IA sitemap `ia/sitemap.md` exists — not the crawled `_sitemap.md` under `content/fetched/site/`) which page serves that stage; the page-or-`—` rule applies to **every** stage row. End each journey with **one concrete conversion action** (e.g. "submits the contact form with a project brief", not "converts"). When the sitemap doesn't exist yet, leave the Page column as `—` — IA runs after this skill in the pipeline and records the stage→page mapping in its own `sitemap.md` (`serves:` notes); a later refinement run of this skill may fill the column from that mapping.

## Step 5 — Write
Write/update `.twt-artifacts/pre-design/audience/personas.md` (confirm before overwrite — except in collect mode, where the dispatch itself is the consent: refine in place without asking and log the overwrite as a reviewable assumption in `decisions.md`):
```markdown
---
generated: <YYYY-MM-DD>
area: audience
producer: twt-audience-define
---

# Audience personas

Seeded from positioning.md audience segments — no segment invented here.

## Personas
### <Persona name>  (segment: <positioning segment>)
- **Goals:** …
- **Jobs-to-be-done:** …
- **Objections:** … (overcome by: …)
- **Content & information needs:** …
- **Device & context:** …
- **Tone preference:** …
- **Value props addressed:** <from positioning.md>

## Journeys
### <Persona name>
| Stage | Thinking | Information needs | Page |
|-------|----------|-------------------|------|
| Entry intent | … | … | <page or —> |
| Discovery | … | … | … |
| Proof | … | … | … |
| Conversion | … | … | … |
- **Conversion action:** <one concrete action>
```

## Step 6 — Report
Personas written (with their source segments), journeys bound or left for IA, TBDs and open decisions, suggest `/twt-audience-validate`.
