---
name: twt-brand-fetch
category: brand
description: (v1.0.0) Extract brand attributes from a brand book, Figma, or screenshots into raw notes
version: 1.0.0
accepts_arguments: true
inputs:
  - A brand book (PDF), Figma URL, screenshots, or a live site URL
dependencies:
  hard: []
  soft:
    - twt-content-fetch-pdf
    - figma-mcp
    - WebFetch
reads:
  - <brand source>
  - .twt-artifacts/pre-design/content-fetch/pdf/<filename>/index.md
writes:
  - .twt-artifacts/pre-design/brand/_fetched-brand.md
---

# /twt-brand-fetch

## Intent

**Purpose:** Pull whatever brand signal exists in a provided source (brand book PDF, Figma file, screenshots, live site) into a raw notes file that `/twt-brand-define` refines into the canonical brief.

**Non-goals:**
- Doesn't produce the canonical `brand-brief.md` (that's `/twt-brand-define`)
- Doesn't invent brand attributes when the source is silent — records gaps instead
- Doesn't validate quality (that's `/twt-brand-validate`)

**Success criteria:**
- `_fetched-brand.md` captures every brand attribute found, tagged with where it came from
- Missing attributes are explicitly listed as gaps
- Runs without prompting when dispatched by `/twt-brand`

---

## Step 1 — Identify the source
Use `$ARGUMENTS`. Otherwise ask what brand material exists (brand book PDF, Figma URL, screenshots, site URL). If a PDF, dispatch `/twt-content-fetch-pdf` first (Agent tool) and read its output. If Figma, use figma-mcp to read variables/styles. If a URL, use WebFetch.

## Step 2 — Extract attributes
Pull: colors (name + hex + usage), typography (families, weights, scale), logo usage notes, voice/tone language, stated values/mission, audience cues. Tag each with its source.

## Step 3 — Write raw notes
Write `.twt-artifacts/pre-design/brand/_fetched-brand.md` mirroring the brand-brief section order (Identity / Palette / Typography / Voice & Tone / Audience signals / Sources). For each section list what was found and a `> GAP:` line for anything absent.

## Step 4 — Report
List attributes captured, gaps found, and tell the user to run `/twt-brand-define` (or `/twt-brand`) to turn this into the canonical brief.
