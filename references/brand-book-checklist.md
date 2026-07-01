# Brand-book completeness checklist (canonical)

The canonical table of contents for a brand book, used by `twt-brand-fetch`
(coverage manifest), `twt-brand-define` (what to fill vs. mark TBD), and
`twt-brand-validate` (completeness + source-coverage evaluation).

**Tiers**
- **Core** — web-critical: a website build actually consumes these. Always evaluated; gaps escalate to WARNING (BLOCKER when missing *and* downstream-blocking).
- **Recommended** — strengthens the brand; build/flag only when sources carry enough signal. Gaps are informational.
- **Optional** — full brand-book completeness; build/flag only when sources carry enough signal. Gaps are informational.

**Coverage status** (recorded per part in `_coverage.md`, evaluated in the report):
`Found` · `Partial` · `Silent` (source had nothing to offer) · `Not-extracted` (signal existed but capture failed).

## Checklist

| Part | Tier | Brand-brief section it feeds | Definition | Build only if source carries signal |
|------|------|------------------------------|------------|--------------------------------------|
| Brand name | Core | Identity | The name and any naming rules | no |
| Mission / positioning | Core | Identity | What the brand does and the space it claims | no |
| Values | Core | Identity | Guiding principles | no |
| Audience signals | Core | Audience signals | Who the brand speaks to | no |
| Palette + usage | Core | Palette | Colors with hex and where each is used | no |
| Typography | Core | Typography | Families, scale, weights | no |
| Voice & tone | Core | Voice & Tone | Attributes + do/don't examples | no |
| Logo usage | Core | Identity | Basic logo do/don't, clear space, misuse | no |
| Imagery / illustration direction | Core | Identity | Photography/illustration style direction | no |
| Tagline | Recommended | Identity | Short brand line | yes |
| Messaging pillars | Recommended | Voice & Tone | 2-4 recurring message themes | yes |
| Elevator pitch | Recommended | Identity | One-paragraph description | yes |
| Iconography | Recommended | (visual) | Icon style rules | yes |
| Graphic elements | Recommended | (visual) | Recurring shapes/patterns | yes |
| Layout principles | Recommended | (visual) | Grid/spacing/composition rules | yes |
| Motion | Recommended | (visual) | Motion personality, key interactions | yes |
| Accessibility rules | Recommended | (visual) | Contrast/type/target rules | yes |
| Experience identity | Optional | (experience) | Product UI, onboarding, packaging, social, sales materials | yes |
| Governance | Optional | (governance) | Guidelines, templates, asset library, legal/trademark/licensing | yes |
| Brand story | Optional | Identity | Origin/narrative | yes |
| Personality / archetype | Optional | Identity | Archetype and personality traits | yes |

Parts whose "feeds" cell is `(visual)`/`(experience)`/`(governance)` map to the matching
area in the `twt-brand-validate` Step 2a item inventory rather than a dedicated
`brand-brief.md` heading.
