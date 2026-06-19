# twt Marketplace — Typical Workflows

Editorial guidance on how the skills compose. Hand-edited. See `architecture.md` (auto-generated) for the canonical dependency map.

---

## Run the whole pipeline (one command)

```
/twt-site                      ← guided end-to-end run
    │  pick phases (checkboxes) + target (HTML / Elementor / Figma express)
    ├── /twt-pre-design              ─┐
    ├── /twt-design                   │  pauses after each phase:
    ├── /twt-develop (or express)     │  Proceed · Re-run · Stop (BLOCKERs surfaced)
    └── /twt-qa                      ─┘
```

`/twt-site` composes the four phase wrappers below; every phase (and every
sub-skill) is still callable on its own. It pauses for approval between phases and never
proceeds past BLOCKERs without your say-so.

## Build a WordPress site, start to finish

```
/twt-elementor-theme-creator        ← once per project
        │
        ├── (optional) /twt-design-system            ← define tokens before building widgets
        │
        └── /twt-elementor-block-creator             ← repeat per widget or page
                  │
                  └── (auto, when needed) → dispatches /twt-design-system-define
```

## Audit / migrate a design system

```
/twt-design-system                   ← standalone; analyses Figma + existing system
        └─ writes tokens.md, tokens.css, preview.html, migration-plan.md, conflict report
```

## Pull existing site copy for reference

```
/twt-content-fetch-site              ← standalone; outputs Markdown mirror of the site
```

## Phase 1 — Pre-design (raw materials → Phase-2 brief)

```
/twt-pre-design                      ← one call runs the whole phase in order
    │
    ├── /twt-content-fetch           ← A: dispatches site/pdf/doc fetchers
    ├── /twt-brand                   ← B: [fetch] → define → validate (bounded loop)
    ├── /twt-positioning             ← D: define → validate (bounded loop)
    ├── /twt-ia                      ← E: define → validate (single pass)
    └── /twt-curation                ← C: define → validate (single pass)
              │
              └── synthesizes → .twt-artifacts/pre-design/pre-design-brief.md
```

Every skill is also callable standalone. To fix one area after validation, run its
`*-define` skill (it reads the sibling `validation-report.md`), or run the bare
`/twt-<area>` orchestrator to run one define→validate pass automatically (§9 single-pass).

## Phase 2 — Design (pre-design brief → Phase-3 build brief)

```
/twt-design                          ← one call runs the whole phase in order
    │
    ├── /twt-design-system           ← tokens.md + tokens.css + preview.html  [SHARED SPINE]
    ├── /twt-component               ← components.md + gallery.html
    ├── /twt-layout                  ← layouts/<page>.md
    └── /twt-mockup                  ← pages/<page>.html (responsive, real content)
              │
              └── synthesizes → .twt-artifacts/design/design-brief.md
```

The design system is the cross-phase **shared source of truth** at `.twt-artifacts/design/design-system/`
— Development reads it whether or not a full Design phase ran. `/twt-design-system` has two entry modes:
greenfield (derive from the Phase-1 brand-brief) or analyse-existing (Figma/screenshots/live site).

Every skill is callable standalone. To fix one area after validation, run its `*-define` skill (it reads the
sibling `validation-report.md`), or run the bare `/twt-<area>` orchestrator to run one define→validate
pass automatically (§9 single-pass). All HTML artifacts link the single `tokens.css`.

## Phase 3 — Development (design brief OR Figma → built site)

Two entry points, two build targets. Both share the design-system spine and an
ensure-scaffold → build core.

```
/twt-develop                         ← FULL path: promote the Phase-2 design
    │   Menu: target? 1) HTML  2) Elementor
    │   reads design-brief.md + mockup/pages/*.html + tokens.css
    ├── ensure scaffold (theme-creator / html-site-creator if conventions.md missing)
    └── per page → builder (elementor-block-creator / html-block-creator)

/twt-site-dev <figma-url>       ← EXPRESS path: short, from Figma
    │   Menu: target? 1) HTML  2) Elementor
    ├── /twt-design-system-define     ← analyse-existing mode → tokens spine
    ├── ensure scaffold (theme-creator / html-site-creator if missing)
    └── builder (elementor-block-creator / html-block-creator)
```

**Static HTML target** (`html` category) is pure HTML + CSS under `site/`: chrome lives once
in `partials/` and is **inlined** into every page by `/twt-html-block-creator` (re-inlined on
change — zero runtime deps). `tokens.css` is **mirrored** from the design-system spine, never
re-authored; all CSS is token-only.

**Elementor target** (`elementor` category) is unchanged: `/twt-elementor-theme-creator`
scaffolds the child theme once, `/twt-elementor-block-creator` builds widgets/pages.

Both targets read `.twt-artifacts/design/design-system/` (the cross-phase shared spine).
Output auditing is Phase 4 (QA) — Phase 3 ships no `*-validate` skills.

## Phase 4 — QA (built output → qa-report.md + gaps.md)

Static analysis by default; pass a URL to audit a live site.

```
/twt-qa                              ← LOCAL: audit files on disk
    │   detects site/ and/or a hello-elementor-* theme
    ├── /twt-qa-content              ← sitemap coverage · real content · lorem/empty
    ├── /twt-qa-design               ← token-only CSS · structure (source-only)
    ├── /twt-qa-a11y                 ← alt · headings · landmarks · contrast
    ├── /twt-qa-links                ← internal links resolve · responsive tiers
    └── /twt-qa-elementor            ← theme code hygiene (no content — it's in the DB)

/twt-qa https://site.name            ← LIVE: crawl rendered pages (≤25) via WebFetch
    └── runs content + links + a11y  ← the ONLY way to audit Elementor content
        (design + elementor skipped — source-only)

both modes → .twt-artifacts/qa/qa-report.md   (findings + PASS/FAIL verdict)
           → .twt-artifacts/qa/gaps.md         (client-ready outstanding content & links)
```

Every audit is read-only and standalone-callable; it writes only its own `<dimension>-report.md`.
The wrapper aggregates `qa-report.md` (verdict driven solely by BLOCKERs) and synthesizes the
`gaps.md` punch-list from the content + links audits. QA never auto-fixes — it reports; you resolve.
