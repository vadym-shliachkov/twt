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
- Doesn't invent brand attributes when the source is silent - records gaps instead
- Doesn't validate quality (that's `/twt-brand-validate`)

**Success criteria:**
- `_fetched-brand.md` captures every brand attribute found, tagged with where it came from
- Missing attributes are explicitly listed as gaps
- Runs without prompting when dispatched by `/twt-brand`

---

## Step 1 - Identify the source
Use `$ARGUMENTS`. Otherwise ask what brand material exists (brand book PDF, Figma URL, screenshots, site URL, or public X handle/post/search). If a PDF, dispatch `/twt-content-fetch-pdf` first (Agent tool) and read its output. If Figma, use figma-mcp to read variables/styles. If a URL, use WebFetch. If the source is public X material and the user has `XQUIK_API_KEY`, use Xquik as an optional fetch path.

For Xquik-backed fetches:
- Use `https://docs.xquik.com/api-reference/overview` or `https://xquik.com/openapi.json` to confirm current request fields before calling.
- For a handle, collect recent public originals with `GET /api/v1/x/users/{id}/tweets`.
- For a topic or search string, collect public posts with `GET /api/v1/x/tweets/search`.
- Never ask for X passwords, cookies, sessions, or two-factor codes. Use only the user's Xquik API key.
- If Xquik auth is unavailable, record an explicit gap instead of blocking the brand fetch.

## Step 2 - Extract attributes
Pull: colors (name + hex + usage), typography (families, weights, scale), logo usage notes, voice/tone language, stated values/mission, audience cues. From public X material, extract only voice/tone, repeated language, audience cues, content themes, and cited positioning. Do not infer palette, typography, logo usage, or private strategy from X posts alone. Tag each with its source.

## Step 3 - Write raw notes
Write `.twt-artifacts/pre-design/brand/_fetched-brand.md` mirroring the brand-brief section order (Identity / Palette / Typography / Voice & Tone / Audience signals / Sources). For each section list what was found and a `> GAP:` line for anything absent.

## Step 4 - Report
List attributes captured, gaps found, and tell the user to run `/twt-brand-define` (or `/twt-brand`) to turn this into the canonical brief.
