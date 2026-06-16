<!-- TEMPLATE — copy to .twt-artifacts/design/assets/manifest.md -->
---
generated: <YYYY-MM-DD>
phase: design
area: assets
---

# Asset manifest

Every image/video the design needs. The model plans these; it does not generate binaries.
Place generated/stock/provided files at `.twt-artifacts/design/assets/<filename>` (and copy into the build's `assets/img|video/` at develop time).

| id | type | filename | placement (page → section → slot) | spec (dimensions / aspect / treatment) | alt | source | generation_prompt |
|----|------|----------|-----------------------------------|----------------------------------------|-----|--------|-------------------|
| hero-1 | image | home-hero.webp | home → hero → background | 2400×1200, 2:1, subtle dark overlay | "Team collaborating in a bright studio" | generate | "Wide cinematic photo of a diverse product team collaborating in a sunlit modern studio, shallow depth of field, muted brand-teal accents, editorial, no text" |

## Notes
- `type`: image | video. `source`: generate | stock | provided.
- One row per asset. `filename` is the exact name the build will reference (kebab-case, web format: webp/avif/mp4).
- `alt` is required for images (accessible description); for decorative-only assets write `alt: ""` and note "decorative".
- `generation_prompt` must be concrete enough to hand to an image/video model.
