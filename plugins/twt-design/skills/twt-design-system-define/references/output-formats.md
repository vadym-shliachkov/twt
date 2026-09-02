# Output formats (twt-design-system-define)

Loaded on demand from SKILL.md Step 10 — read this file in full immediately before
writing `tokens.md` / `tokens.css`. It carries the exact `tokens.md` section
skeleton, the formatting rules, the two-layer `tokens.css` example, and the
opt-in export-file examples (Step 11). The normative rules themselves (two-layer
color architecture, distinctness rule, typography-is-more-than-size) live in
SKILL.md Steps 10a–10c; this file is the shapes, not the policy.

## The `tokens.md` skeleton (Step 10)

The file MUST include the following sections in this order:

```md
# Design System — <Project Name>

## 1. Overview
- design philosophy
- visual language
- UI consistency principles
- spacing philosophy
- interaction patterns
- accessibility direction
- responsive behavior assumptions
- confidence summary (how many tokens confirmed vs inferred)

## 2. Tokens
### 2.1 Colors           (table: name · HEX · RGB · HSL · role · usage · confidence)
### 2.2 Typography       (families · scale · weights · line-height · tracking · responsive · **Text styles** table)
### 2.3 Spacing          (scale · rhythm · responsive deltas)
### 2.4 Radius           (scale · category mapping)
### 2.5 Shadows          (elevation system · overlay · interactive)
### 2.6 Motion           (durations · easings · defaults)
### 2.7 Grid             (breakpoints · columns · gutters · container widths)
### 2.8 Iconography      (the ONE icon family · style variant · grid/stroke · size tokens · source URL · license)

## 3. Component Architecture (Tokens → Primitives → Components → Modules)
### 3.1 Tokens                   (pointer back to Section 2)
### 3.2 Primitives               (each: tokens consumed · variants · states)
### 3.3 Components               (each: which Primitives it composes)
### 3.4 Modules                  (each: which Components/Primitives it composes)
### 3.5 Inferred Components       (only if any)

> Keep the `### 3.2 / 3.3 / 3.4` **numbering** exactly — `gen-preview.mjs` and
> `gen-gallery.mjs` parse the inventory by section number — and keep each row's
> first cell as the bold component name (`| **Button** | … |`).

## 4. Pattern & Inconsistency Report
### 4.1 Findings table
### 4.2 Normalization recommendations
### 4.3 Conflict report           (multi-file merge only)

## 5. Accessibility
- contrast audit (token pairs · WCAG level — must match the gen-preview matrix, Step 10c)
- focus states
- keyboard navigation assumptions
- minimum touch targets
- typography scaling
- dark mode readiness

## 6. Responsive System
- breakpoint logic
- responsive typography rules
- responsive spacing rules
- adaptive layouts
- mobile behavior changes

## 7. Naming Convention
- the rule
- examples
- migration notes for drift

## 8. Token Exports
- **canonical export: `tokens.css`** — the sibling stylesheet every HTML artifact
  links (Step 10a); the single source of token *values*
- opt-in export files, written by Step 11 on request or mode: `tokens.json`
  (Style Dictionary–compatible), `tailwind.config.js`
- export-specific caveats only (e.g. Tailwind key mapping) — **never inline
  duplicate token tables or SCSS/JSON/Tailwind blocks here**; a second copy of
  the values goes stale the first time a token changes

## 9. Governance                  (analyse-existing runs only — see below)
- maintenance workflow
- how to add a component
- token expansion rules
- contribution workflow
- scalability recommendations

## 10. Migration Recommendations  (analyse-existing runs only — see below)
- prioritized cleanup
- refactor recommendations
- per-finding migration plan
```

**Sections 9–10 are conditional.** Write them only in **analyse-existing** runs
(there is a real, live system to govern and migrate) or when §4 contains
high-severity findings. In a pure greenfield run write a single line under each
heading: `Not applicable — greenfield build.` Enterprise-DS governance boilerplate
on a one-off site build is noise every downstream phase pays to read.

## Formatting rules

- Use tables for every token category.
- Use ASCII anatomy diagrams for components where helpful.
- Use hierarchy trees for the atomic structure.
- Use variant matrices for element states.
- Avoid vague wording or purely aesthetic commentary — every statement should be actionable.
- Mark every assumption explicitly. Separate **confirmed** vs **inferred**.

## `tokens.css` two-layer example (Step 10a)

```css
:root {
  /* ── Layer 1: Color primitives — solids ── */
  --color-ink:       #090E22;
  --color-white:     #FFFFFF;
  --color-slate:     #3A3F5C;
  /* ── Layer 1: Color primitives — alpha tones ── */
  --color-ink-a08:   rgba(9, 14, 34, .08);
  --color-white-a85: rgba(255, 255, 255, .85);

  /* ── Layer 2: Colors by purpose — var() only ── */
  --color-bg:            var(--color-white);
  --color-text:          var(--color-slate);
  --color-text-heading:  var(--color-ink);
  --color-primary:       var(--color-ink);
  --color-on-primary:    var(--color-white);
  --color-border:        var(--color-ink-a08);

  /* Typography — family, size, weight, line-height, tracking (not size alone) */
  --font-family-base:    "Inter", system-ui, sans-serif;
  --font-family-heading: "Inter", system-ui, sans-serif;
  --font-size-body-m:    1rem;
  --font-weight-regular: 400;
  --font-weight-medium:  500;
  --font-weight-bold:    700;
  --line-height-body-m:  1.5;
  --tracking-tight:      -0.01em;
  --tracking-wide:        0.04em;
  /* Spacing */
  --space-4: 16px;
  /* Radius */
  --radius-card: 16px;
  /* Shadows — reference color primitives via var(), never raw rgba */
  --shadow-e2: 0 2px 8px var(--color-ink-a08);
  /* Motion */
  --motion-duration-fast: 120ms;
}
```

## Opt-in export file examples (Step 11)

`tokens.json` (Style Dictionary–compatible):

```json
{
  "color": {
    "primary": { "value": "#0057FF" },
    "surface": { "value": "#FFFFFF" }
  },
  "radius": { "card": { "value": "16px" } },
  "space":  { "4":    { "value": "16px" } }
}
```

`tailwind.config.js`:

```js
module.exports = {
  theme: {
    extend: {
      colors:       { primary: '#0057FF', surface: '#FFFFFF' },
      borderRadius: { card: '16px' },
      spacing:      { 4: '16px' }
    }
  }
}
```

Values in either file are the confirmed/inferred values from `tokens.md` —
never introduce a value that isn't there.
