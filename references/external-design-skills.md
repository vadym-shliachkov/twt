# External design skills — install & use (no-Figma design phase)

When the design phase runs **without a Figma/exported-design source**, twt leans on two
external, community design skills to avoid templated "AI-slop" output and to get motion right.
This file is the single source of truth for **which** skills, **how to ensure they're installed**,
and **how to apply them**. Design skills reference this file rather than duplicating the logic.

## The two skills

| Installed skill name | Source | Role in the design phase |
|----------------------|--------|--------------------------|
| `design-taste-frontend` | `https://github.com/Leonxlnx/taste-skill` | **Design direction + anti-slop.** Brief inference ("Design Read"), the three dials (DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY), typography/color discipline, layout diversification, the AI-Tell ban list, and the pre-flight checklist. |
| `emil-design-eng` | `https://emilkowal.ski/skill` | **Motion & interaction polish.** Animation decision framework (whether/why/easing/duration), custom easing curves (never `ease-in`), `:active` press feedback, origin-aware reveals, animate-only-transform/opacity, `prefers-reduced-motion`. |

Both assume a React/Tailwind/Motion stack; twt emits **plain HTML/CSS** mockups and HTML/Elementor
production. Use the **stack-agnostic** layers — Design Read, dials, color/type/layout discipline,
AI-Tell bans, pre-flight (taste); easing/duration/feedback/reduced-motion principles (emil) — and
translate any React/Motion/GSAP code into the CSS / `var(--motion-*)` idiom the twt artifacts use.

## Step A — Ensure both are installed (no-Figma only)

For each skill, in order:

1. **Already available?** If the skill name appears in the session's available-skills list, or a
   `SKILL.md` exists at `~/.claude/skills/<name>/SKILL.md` (global) or
   `<project>/.claude/skills/<name>/SKILL.md` (project-local), it's installed — use it as-is.
2. **Missing → install into the *project*, not global.** Create
   `<project>/.claude/skills/<name>/` and fetch the skill body into `SKILL.md`:
   - `design-taste-frontend` ← try `https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/SKILL.md`
     (fall back to `.../master/SKILL.md`, then the repo page `https://github.com/Leonxlnx/taste-skill`
     to locate the SKILL.md path). Save under `.claude/skills/design-taste-frontend/SKILL.md`.
   - `emil-design-eng` ← fetch `https://emilkowal.ski/skill`; follow it to the raw `SKILL.md`
     (the page links the install source). Save under `.claude/skills/emil-design-eng/SKILL.md`.
   Preserve the skill's own `name:` frontmatter; if the upstream `name:` differs, keep the directory
   named after the installed name above.
3. **If a fetch fails** (offline / source moved): do **not** block. Tell the user the skill couldn't
   be auto-installed, give the source URL, and continue using the inlined fallback discipline
   (the Design Read + dials below, plus the anti-slop rules summarized in each skill). Note it in the
   report so the user can install manually and re-run.

Project-local installs are picked up by Claude Code on the next session; within the current run,
apply a skill by **invoking it via the `Skill` tool if it's already loadable, otherwise reading the
just-written `SKILL.md` and following it directly**.

## Step B — Produce the Design Read + dials once

Before designing, run `design-taste-frontend`'s **§0 Design Read** and **§1 dials** against the
Phase-1 inputs (`brand-brief.md`, `specification.md`, `positioning.md`) and write
`.twt-artifacts/design/design-read.md` (template: `templates/design-read.md`). This is produced
**once** by `/twt-design` (or by the first design sub-skill run standalone) and **inherited** by every
downstream design sub-skill — they read it instead of re-deriving the direction.

## Step C — Apply per sub-skill

| Sub-skill | Apply |
|-----------|-------|
| `twt-design-system-define` (greenfield/no-Figma) | taste §4.1 (no Inter-by-default; pick a brief-appropriate type pairing), §4.2 (one accent <80% sat; **ban** the AI-purple glow and the beige+brass premium-consumer palette as defaults), §6 contrast. Honor the dials' density → spacing/radius/shadow character. Feed emil's easing/duration principles into the **Motion** tokens. |
| `twt-layout-define` | taste §4.3 (anti-center bias when VARIANCE>4), §4.7 (hero discipline, eyebrow restraint, split-header ban, zigzag cap, section-layout-repetition ban). Drive section variety from DESIGN_VARIANCE. |
| `twt-component-define` | taste §4.4 (cards only for real hierarchy; one radius scale), §4.5 (full interactive states + button contrast), §3.C icon discipline. emil for `:active`/hover/focus motion specs. |
| `twt-mockup-define` | taste §4.3–4.11 + §9 AI-Tells while rendering; emil for all motion CSS (easing curves, durations, `prefers-reduced-motion`); run taste **§14 Pre-flight** as a self-check before writing pages. |
| `twt-mockup-validate` | score an **anti-slop / design-taste** criterion using taste §9 + §14 (em-dash ban, eyebrow-on-every-section, AI-purple, three-equal-cards, fake div screenshots, centered-hero bias, motion-claimed-not-shown). |

When a real Figma/brand source already fixes a decision (palette, type, motion), **that wins** — these
skills are for the no-source case and for catching slop, never for overriding a provided design.
