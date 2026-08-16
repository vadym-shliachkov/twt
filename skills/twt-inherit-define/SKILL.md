---
name: twt-inherit-define
category: inherit
description: (v1.0.3) Discover an existing project's architecture and derive build conventions from it
version: 1.0.3
accepts_arguments: true
inputs:
  - Optional project root (defaults to the working directory); optional --workspace <name>; optional --exact
dependencies:
  hard: []
  soft: []
reads:
  - .twt-artifacts/design/design-system/tokens.css
  - the host project's source tree (read-only)
writes:
  - .twt-artifacts/inherited/detection.json
  - .twt-artifacts/inherited/conventions.md
  - .twt-artifacts/inherited/exemplars.md
  - .twt-artifacts/inherited/token-map.md
  - .twt-artifacts/inherited/host-style.json
  - .twt-artifacts/inherited/decisions.md
  - .twt-artifacts/inherited/<tailwind.config.extension.js|_tokens.scss|theme.tokens.js>
---

# /twt-inherit-define

## Intent

**Purpose:** Read an existing project's codebase — its own framework, styling system, component idiom, and file layout — and derive `.twt-artifacts/inherited/conventions.md`, the contract every later `inherit`-target step (the block creator, the target descriptor, asset sync) reads instead of assuming a twt-scaffolded layout.

**Non-goals:**
- **Never modifies the host project.** This skill is read-only on the codebase it inspects — every file it writes lives under `.twt-artifacts/inherited/`. Only the builder (`/twt-inherit-block-creator`) ever writes into the host.
- Does not scaffold a new project structure (there's already one — that's the point of `inherit`).
- Does not install any dependency, config, or tool into the host.
- Does not retrofit the host's existing components to match the design system. It documents the host's idiom as-is; making anything conform to it is later work, done with the user watching.

**Success criteria:**
- `conventions.md` opens with a `## Detected` block (stack, styling system, component idiom, routing, asset root — each with confidence and evidence) and has all seven sections (Partials, Scoping, Tokens, Responsive tiers, Content, Reuse-first, File layout) populated from real exemplar files, each citing the file it was learned from.
- The **File layout** section names the host's actual static-asset root — a later step (asset sync) has nothing to bind to if this is vague or missing.
- No `medium`-confidence, load-bearing signal was ever silently promoted into a written convention without the user seeing it first.
- The user saw the Detected block, the exemplar paths, and the token-map summary and explicitly accepted them — via the Step 7 review gate in an interactive run, or via `decisions.md` in collect mode — before the run reports success.

---

## Step 1 — Refinement check (§10)

Check (Glob/Read — never a shell command) whether `.twt-artifacts/inherited/conventions.md` already exists.

- **Exists:** ask via **AskUserQuestion** (single-select, header "Conventions"): **Refine the existing conventions** (recommended — description: "re-scan and re-derive, but keep the exemplars that still hold up") / **Re-derive from scratch** (description: "ignore the previous run, pick fresh exemplars") / **You decide** (picks Refine — it's the lower-risk default, and either choice still ends at the Step 7 review gate before anything changes). Never overwrite `conventions.md` without one of these three answers.
- **In collect mode** (`subagent-collect` present in `$ARGUMENTS`): don't ask — default to **Refine**, and record that as a model-decided assumption in `decisions.md` (format in Step 7) rather than skipping the record entirely.
- **Doesn't exist:** proceed as **from-scratch** (nothing to refine).

Carry the chosen mode (`refine` | `scratch`) through Steps 2-5: it governs whether Step 4 prefers previously-chosen exemplars and whether Step 5's write is described as a refinement or a fresh derivation in the Step 8 report. It does **not** skip the Step 7 review gate in either mode — that gate is a separate checkpoint (do you accept *this run's* result), not a substitute for this one (may I re-derive *at all*).

## Step 2 — Scan

One Bash call:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/inherit/scan.mjs" "$CLAUDE_PROJECT_DIR" --out ".twt-artifacts/inherited/detection.json"
```

If `$ARGUMENTS` supplied an explicit project-root path, substitute it for `$CLAUDE_PROJECT_DIR` in that one call (`scan.mjs`'s first positional accepts any absolute path) — it stays a single Bash call either way.

- **Exit 2:** a usage error in this step's own call (e.g. `--out` with no path after it) — that's a bug in how this step constructed the command, not a host-project condition; fix the call and retry once.
- **Exit 3:** the root was missing or wasn't a directory. Stop and report the exact message `scan.mjs` printed to stderr — do not retry with a guessed path.
- **Exit 4:** the scan itself succeeded but the output could not be written (the message starts `could not write`). `scan.mjs` already creates the output directory, so this means something else blocks the path — a read-only location, a permission problem, or a *file* where a directory is needed. Report the exact stderr message and the path; do not retry with a guessed path, and never confuse this with exit 3 (the root was fine).
- **Exit 0:** continue. **Read `detection.json`** with the Read tool (never shell) to load `packageManager`, `deps`, `scripts`, `configs`, `extensions`, `dirSignals`, `workspaces`, `wordpress`, `candidates.componentDirs`, and `signals`.

## Step 3 — Resolve ambiguity before reading anything

Resolve every load-bearing ambiguity from `detection.json`'s structured data alone, before Step 4 opens a single source file.

**Workspace.** If `workspaces.length > 1`:
- If `$ARGUMENTS` carries `--workspace <name>` matching one of `workspaces[].name`, use it directly — no question.
- Otherwise ask via **AskUserQuestion** (single-select, header "Workspace"): one option per workspace, each labeled with its `name` and described with its detected framework (the highest-confidence `signals` claim whose evidence overlaps that workspace's `dir`, or "framework not yet detected" if none does) — plus **"You decide"**, which picks the workspace whose `deps` best match the design work already done in this project (e.g. the one holding the frontend framework this project's design system targets) and states why in one sentence.
- Once resolved, restrict everything downstream — `candidates.componentDirs`, the routing directory, the asset-root search in Step 5 — to paths under that workspace's `dir`. Ignore `componentDirs` entries outside it.
- `workspaces.length <= 1`: nothing to resolve; the whole tree is in scope (or the single workspace, if there is exactly one).

**The WordPress ruling.** If `detection.json.wordpress` is non-null, the stack is settled: it's a WordPress theme named `wordpress.themeName` (with `wordpress.template` as its parent, if set). **Do not ask "is this WordPress?"** even though the `wordpress` signal in `signals[]` caps at `medium` confidence — both of its evidence items (the `style.css` Theme Name header and `functions.php`) are kind `file`, so the grading formula can never promote it past `medium` no matter how certain the identification is. That's a grading artifact of `scan.mjs`'s two-independent-kinds rule, not real doubt. Treat `wordpress` non-null as `high` confidence for the purposes of this step and the Detected block, and skip straight to the framework/styling/idiom/routing checks below for everything `wordpress.json` doesn't already answer.

**Framework.** `scan.mjs` emits framework and styling claims into one flat `signals[]` array with no built-in tie-break, and a real project routinely carries several framework-shaped claims at once — an Astro or Nuxt project lists `vite` as a dependency too, which is normal and not ambiguity, not a competing framework identification. Resolve to a single framework claim with this precedence, highest tier wins: **meta-framework** (`next`, `nuxt`, `astro`, `svelte`, `angular`) beats **bundler** (`vite`), which beats **bare UI library** (`react`, `vue`). Take the highest-tier claim that has a `signals[]` entry.
- That claim's own confidence is `high`, or the WordPress ruling above already settled the stack: proceed, no question.
- That claim is `medium` confidence, **or** more than one claim occupies the same top tier (a genuine tie — e.g. two meta-framework claims present, which the precedence order alone can't break): this is the confidence-driven question below.

**Styling system.** Same shape, different precedence (mirrors `adapters.mjs`'s `PRECEDENCE`): `tailwind` > `css-modules` > `theme-object` > `scss` > `css-vars`. Take the highest-precedence claim that has a `signals[]` entry, or `none` if no styling claim is present at all.
- `high` confidence, or the WordPress ruling above already settled it: proceed, no question.
- `medium` confidence: this is the confidence-driven question below.

**The confidence-driven question**, for either framework or styling system landing in the medium/tied case above: ask via **AskUserQuestion** (single-select, header matching the aspect — "Framework" or "Styling system"): the detected claim(s) (one option per tied or medium-confidence claim, labeled with its name, described with its evidence) / a free-type override (the tool's built-in escape covers this — don't add a manual "Other" option) / **"You decide"** (accepts the highest-tier/highest-precedence claim and says why the evidence, though thin or tied, is still the best read).

**Component idiom.** `detection.json` only gives `candidates.componentDirs` as `{dir, count}` pairs — it doesn't itemize which extensions make up that count. Glob `candidates.componentDirs[0]/*` (and the second-ranked dir too, if its count is close) to see the actual file extensions among `.tsx`/`.jsx`/`.vue`/`.svelte`/`.astro`/`.php`.
- A single extension accounts for the top dir's files, or the top dir's count is clearly ahead of the second-ranked dir (not a near-tie): confident, proceed.
- Mixed extensions in the top dir, or the top two dirs are within one or two files of each other in count: `medium` — ask via **AskUserQuestion** (single-select, header "Component idiom"): one option per candidate directory (labeled with its dominant extension, described with its file count), plus **"You decide"** picking the top-ranked one.
- (`candidates.componentDirs` empty entirely is Step 4's problem, not this step's — it asks the user to name a file there, not here.)

**Routing.** Read from `dirSignals` filtered to the routing-shaped entries (`app`, `pages`, `src/routes`, `resources/views`, `template-parts`).
- Exactly one present: confident, that's the routing directory.
- More than one present (e.g. both `pages` and `app` — a partial framework-router migration): `medium` — ask via **AskUserQuestion** (single-select, header "Routing") which one is current, with **"You decide"** picking the more recently-conventional one for the detected framework (e.g. `app` over `pages` for Next.js) and saying so.
- None present: note "no routing directory detected" in the Detected block; Step 4's route-exemplar pick is skipped and the report says why.

**In collect mode:** skip every `AskUserQuestion` call above. For each ambiguity, take the "You decide" branch's stated resolution and record it under `## Open questions` in `decisions.md` (format in Step 7) rather than silently deciding and moving on — a `medium` signal silently promoted to a decision with no record is exactly the failure this step exists to prevent, collect mode or not.

## Step 4 — Pick exemplars

Scope to `candidates.componentDirs[0]` (within the resolved workspace, if any).

- **Empty (no `componentDirs` at all):** say so plainly, then ask the user — **plain text**, this is free-form input, not a fixed-option choice — to name a representative component file themselves. Use whatever they name as the sole component exemplar and continue.
- **Refinement mode (Step 1) and an existing `exemplars.md`:** prefer its previously-chosen paths if they still exist on disk and their directory is still `candidates.componentDirs[0]` (or still top-ranked within the resolved workspace). Only re-pick a path that's gone or whose directory ranking changed.
- **Otherwise:** use `candidates.componentDirs[0].files` from `detection.json` — `scan.mjs` already measured every file in the top-ranked directories and reports each as `{ file, lines }`. **Do not Read files to measure them.** Reading a whole directory to pick three exemplars is a token budget spent on arithmetic the scanner did for free; on a host with 150 components it is 150 reads to choose 3.
  - Drop anything with a **`lines` count of 5 or fewer** — that reads as a one-line/near-empty barrel or type-only re-export, the same class `scan.mjs` already excludes for bare `.ts` files, applied here to whatever the actual extension is.
  - Rank the survivors by `lines` and pick the **finalists** from the middle of that ranking: aim for **2-3 of median size** — explicitly not the smallest survivor (still likely thin/atypical) and not the largest (more likely accumulated legacy code than the current idiom). Both extremes teach the wrong lesson to whatever reads `conventions.md` next.
  - **Boundary rule (small directories).** "Median, excluding both extremes" degenerates on a tiny survivor set — on 2 files it selects nothing, on 3 it selects one. So: **1 survivor** → use it and say in the report that it is the only candidate, so it is atypical by necessity; **2 or 3 survivors** → use *all of them* (there is no meaningful extreme to exclude); **4 or more** → apply the median rule above. Never return an empty exemplar set while survivors exist.
  - If the top directory has `filesTruncated: true`, `scan.mjs` hit its per-directory measurement cap — the ranking is over the measured subset, which is fine; note it in the report.
  - **Fallback only** (a directory `scan.mjs` reported no `files` array for — e.g. a dir ranked below the measured top few, or one the user named in the empty-`componentDirs` branch above): Glob it and Read at most **25** files to measure them, then apply the same rules. Never Read an uncapped directory listing.

Then, regardless of mode:
- Pick **one route/page file** from the routing directory Step 3 resolved (skip if Step 3 found none): Glob its files, prefer an index/home route if one is obviously present, else the first non-trivial file.
- Read the chosen component exemplars' import statements and pick **whatever they import for styles** (a `.module.css`/`.scss` sibling, a theme-object import, a shared `tokens`/`variables` file) as an additional exemplar, if it resolves to a discrete file. If styling is class-name-only (Tailwind utility classes with no imported style file), note that explicitly instead of forcing a styles exemplar that doesn't exist.

Write `.twt-artifacts/inherited/exemplars.md`:

```
# Exemplars

Source: `<candidates.componentDirs[0]>` (within `<workspace dir, if any>`), n files considered.

- `<path>` — <one line: why this file, e.g. "median-sized component (48 lines) — typical, not a barrel, not oversized legacy">
- `<path>` — <...>
- `<path>` (route/page) — <one line, or "no routing directory detected — skipped" if Step 3 found none>
- `<path>` (styles, imported by `<component path>`) — <one line, or "styling is class-name-only — no discrete styles file to cite">
```

## Step 5 — Read the exemplars and write conventions.md

Read **only** the files chosen in Step 4 — nothing else in the host tree gets opened at this stage.

**Determine the asset root** before writing the File layout section: Glob the stack-appropriate candidates in priority order — `public/`, `static/`, `assets/` for most JS frameworks (Next/Vite/Astro/Nuxt default to `public/`); for a WordPress theme, the theme directory's own `assets/` or `dist/` subfolder — and confirm with Glob/Read that a candidate actually holds images/fonts/icons before naming it.
- Exactly one real candidate: use it.
- Two or more real candidates: ask via **AskUserQuestion** (single-select, header "Asset root") — one option per candidate path, plus **"You decide"** (picks the one referenced by the exemplars read so far, e.g. an `<img src="/...">` path in the route exemplar, and says so).
- Zero candidates found: ask the user directly — **plain text**, free-form — to name the path themselves. A wrong or missing asset root here breaks the asset-sync step that reads this file later, so never guess silently.

Write `.twt-artifacts/inherited/conventions.md`:

```
# Conventions — inherited from <one-line stack summary>

## Detected

| Aspect | Value | Confidence | Evidence |
|---|---|---|---|
| Stack | <framework/theme name> | <high\|medium> | <from signals[] or the WordPress ruling> |
| Styling system | <system> | <high\|medium> | <...> |
| Component idiom | <extension/pattern> | <high\|medium> | <...> |
| Routing | <directory, or "none detected"> | <high\|medium\|n/a> | <...> |
| Asset root | <path> | <high\|medium> | <...> |

## Partials

<How chrome/layout composition works in this host, cited from the route/page exemplar and/or a layout file it imports — a Next.js layout.tsx, a WP get_header()/get_footer() pair, a Vue App.vue + router-view, etc.>
— from `<exemplar path>`

## Scoping

<How CSS scoping actually works here, observed from the styles exemplar — module scoping, utility classes, a BEM prefix convention, theme-object keys>
— from `<exemplar path>`

## Tokens

<Where design values live in this host today (a theme object, CSS custom properties, a Tailwind config scale, an SCSS variables partial) — this is what `token-map.md` (Step 6) maps the design system onto>
— from `<exemplar path>`

## Responsive tiers

<Breakpoints actually found in the exemplars — media queries, Tailwind responsive prefixes, container queries — or "none observed in the exemplars read" if genuinely absent>
— from `<exemplar path>`

## Content

<How content is sourced in the route/page exemplar — hardcoded JSX/template, a CMS loop, MDX/markdown, a fetch call>
— from `<exemplar path>`

## Reuse-first

<What in `candidates.componentDirs[0]` already looks reusable/composable, based on the component exemplars — before adding a new component, this is what to check first>
— from `<exemplar path(s)>`

## File layout

\`\`\`
<tree of the relevant directories: componentDirs[0], the routing directory, the asset root, and any styling-config location — real paths from this host, not a generic template>
\`\`\`

**Static-asset root:** `<path>` — this is what the asset-sync step binds to.
```

Every section cites the exemplar file it was learned from — a section with no citation is a section that was guessed, not read.

## Step 6 — Adapt tokens

**Skip this step and say so in the report** if `.twt-artifacts/design/design-system/tokens.css` doesn't exist. Otherwise:

1. **Read the host's styling config with the Read tool** — never evaluate it; a `tailwind.config.ts` is executable code, and running it is out of scope for a bundled script. Which file depends on the styling system Step 3 identified:
   - `tailwind`: the config file `detection.json.configs` recorded with `kind: 'tailwind'`. Extract **every scale you can read statically off the page**, not just spacing — `theme.extend.spacing`/`theme.spacing`, `borderRadius`, `fontSize`, `borderWidth`, `boxShadow`, `colors`, and any explicit width/height `size` scale. Each scale is a `<step key> -> px` mapping. **This matters:** `adapters.mjs` classifies each design token by its NAME (a `--radius-*` token is a radius, a `--font-size-*` token is a font size) and maps it onto the scale for *that* family only. A family you don't supply a scale for is reported `unmapped` — honest, and the builder falls back to the host's nearest existing idiom — but a scale you *could* have read and didn't is fidelity thrown away for nothing.
   - `css-vars` / `css-modules` / `theme-object` / `scss`: the styles exemplar recorded in `exemplars.md` (Step 4). Extract its existing `--custom-property: value;` (or `$scss-var: value;`, or theme-object key) declarations.
   - `none`: nothing to read — write `{}`.
   If nothing is confidently extractable (e.g. the config composes values through a `require()` this skill can't statically resolve), write `{}` (or whichever key you do have) and say so in the Step 8 report — a partial `host-style.json` is honest; a guessed one isn't.
2. **Write** `.twt-artifacts/inherited/host-style.json`. Its shape:

```json
{
  "scale": {
    "spacing":      { "4": 16, "6": 24 },
    "fontSize":     { "base": 16, "5xl": 48 },
    "borderRadius": { "md": 6, "lg": 16 },
    "borderWidth":  { "DEFAULT": 1, "2": 2 },
    "boxShadow":    { "md": 6 },
    "size":         { "8": 32 },
    "colors":       {}
  },
  "vars": { "--name": "value" }
}
```

   Every key is **optional** — omit any scale the host doesn't have (an omitted family is reported `unmapped`, which is the honest answer, not a failure). The scale key names are exactly the family names `adapters.mjs` classifies tokens into: `spacing`, `fontSize`, `borderRadius`, `borderWidth`, `boxShadow`, `colors`, `size`. Values are **numbers in px** (convert a `rem` scale at the host's own root font size and say so in the report). `vars` is the host's already-defined custom properties, used for collision detection.
3. One Bash call:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/inherit/adapters.mjs" --scan ".twt-artifacts/inherited/detection.json" --tokens ".twt-artifacts/design/design-system/tokens.css" --out ".twt-artifacts/inherited" --mode <host|exact> --host-style ".twt-artifacts/inherited/host-style.json"
```

Use `--mode exact` only when `--exact` was passed in `$ARGUMENTS`; otherwise `--mode host`.

**`--exact` is a power-user flag for direct invocation only.** No orchestrator (`/twt-develop`, `/twt-site-dev`, `/twt-site`) offers it in a target menu or forwards it, deliberately: `exact` mode adds named steps to the host's own config scales, which turns `tailwind.config` into a MODIFY the builder must get approved — a cost the user should opt into knowingly, by typing `/twt-inherit-define --exact`, rather than acquire from a menu. Default (`host`) mode snaps onto the scales the host already has and needs no config change at all.

- **Exit 3:** no tokens file — this shouldn't happen since you just checked for it above, but if the file was removed mid-run, report it and continue without a token map rather than failing the whole run.
- **Exit 2:** a usage error in this skill's own call (a missing `--scan`/`--tokens`/`--out`) — that's a bug in how this step constructed the command, not a host-project condition; fix the call and retry once.
- **Exit 0:** the CLI wrote `token-map.md` into `.twt-artifacts/inherited/` (and, for `tailwind`/`scss`/`theme-object` hosts, may also have written a mergeable extension file alongside it — `tailwind.config.extension.js`, `_tokens.scss`, or `theme.tokens.js` — note its path in the report if present). Read the stderr summary line (`system <x> (<confidence>) · N mapped, N snapped, N collision, N unmapped`) and **state the unmapped count in the report** — never let a lossy adaptation read as a clean one.

## Step 7 — Review gate

Present, in one place: the `## Detected` block from `conventions.md`, the exemplar paths from `exemplars.md`, and the token-map summary line from Step 6 (or "skipped — no tokens.css" if Step 6 was skipped).

- **Interactive:** ask via **AskUserQuestion** (single-select, header "Conventions"): **Accept** (description: "use this as the contract for everything `inherit` builds next") / **Let me edit conventions.md first** (description: "I'll open the file and adjust it myself, then re-run this skill to re-validate") / **Re-derive with different exemplars** (description: "go back to Step 4 and let me name the files instead"). On the edit option, stop here — don't re-run automatically; the next invocation's Step 1 refinement check picks up the user's edits. On re-derive, return to Step 4 and ask the user (plain text) which files to use instead of the ones auto-picked.
- **Collect mode** (`subagent-collect` in `$ARGUMENTS`): don't ask. Write `.twt-artifacts/inherited/decisions.md` instead:
  - Frontmatter: `generated`, `area: inherit`, `producer: twt-inherit-define`, `status: open`.
  - **H1 title** (immediately after the frontmatter, required — `check-decisions.mjs` fails the file without one): `# Decisions to confirm — inherited conventions`.
  - `## Open questions` — one entry per unresolved ambiguity from Step 3 (and the refinement-mode default from Step 1, if collect mode took it): `- <question> — options: [<a>, <b>, ...] — model-leaning: <x>`, with an **indented** continuation line `  - why it matters: <one line>`.
  - `## Model-decided assumptions (review)` — one entry per value this run picked without asking: `- <field> = <value> — basis: <reason> — reversible: <yes|no>`.
  - `## Proposed rules (confirm before binding)` — the Detected block's stack/styling-system/component-idiom/routing/asset-root rows, restated as rules the rest of the `inherit` pipeline would bind to if accepted.
  Set `status: open`. **After writing `decisions.md`, verify it** (Bash): `node "${CLAUDE_PLUGIN_ROOT}/tools/check-decisions.mjs" --file ".twt-artifacts/inherited/decisions.md"` — fix until it exits 0. Three consumers (the orchestrator's surface-up flow, `gen-report`, `wiki-harvest`) parse this exact format, and a drifted section title (e.g. dropping the `(review)`/`(confirm before binding)` suffix) is silently invisible to all three. Report the decisions block in your own output — the dispatching orchestrator surfaces it per §13; this skill never loops on the user itself.

**This gate is what makes adapting to a host safe.** Nothing downstream (the block creator, asset sync) is meant to run against `conventions.md` until the user — directly, or via the surfaced decisions in collect mode — has seen exactly what this skill read off their codebase and said yes.

## Step 8 — Report

Tell the user:
- Every artifact path written this run (`detection.json`, `conventions.md`, `exemplars.md`; `token-map.md` and `host-style.json` and any mergeable extension file, or "skipped — no tokens.css" if Step 6 didn't run).
- The detected stack, with its confidence (and the WordPress ruling, if it applied).
- The exemplars, by path, from `exemplars.md`.
- The token-map counts — mapped / snapped / collision / unmapped — if Step 6 ran.
- Whether this was a refinement or a from-scratch derivation (Step 1).
- Any `medium`-confidence signal that was asked about, and how it was resolved.
- What to run next: `/twt-inherit-block-creator`.
