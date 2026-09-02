#!/usr/bin/env node
// scaffold-html-site.mjs — deterministic file scaffold behind
// /twt-html-site-creator. The static-site boilerplate (partials, CSS, index,
// conventions reference) is a fixed template with three substitutions; the
// tokens.css mirror/scaffold decision is a file-existence check.
//
//   node scaffold-html-site.mjs --name "<ProjectName>" --slug <slug>
//                               [--root site] [--tokens <path>] [--force]
//
// Never overwrites an existing file unless --force. Prints a JSON summary:
// { root, slug, tokens_source: "mirrored"|"scaffold", created: [], skipped: [],
//   conventions_path }. Exit 0 on success; exit 2 on bad usage.
'use strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const argv = process.argv.slice(2);
function flag(name, dflt) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const name = flag("--name");
const slug = flag("--slug");
const FORCE = argv.includes("--force");
if (!name || !slug) {
  console.error('Usage: scaffold-html-site.mjs --name "<ProjectName>" --slug <slug> [--root site] [--tokens <path>] [--force]');
  process.exit(2);
}
if (!/^[a-z0-9-]+$/.test(slug)) { console.error(`invalid slug '${slug}' — lowercase alphanumeric + hyphens only`); process.exit(2); }

const S = slug, N = name;
const root = flag("--root", "site").replace(/[\\/]+$/, "");
const tokensSpine = flag("--tokens", join(".twt-artifacts", "design", "design-system", "tokens.css"));

// ---- tokens: mirror the design-system spine, or write a marked scaffold ---------

let tokensContent, tokensSource;
if (existsSync(tokensSpine)) {
  tokensContent = readFileSync(tokensSpine, "utf8");
  tokensSource = "mirrored";
} else {
  tokensContent = `/* SCAFFOLD — replace by mirroring the design-system tokens.css after design handoff */
:root {
  --color-text:        #1a1a1a;
  --color-surface:     #ffffff;
  --color-primary:     #0D1B2A;
  --font-family-base:  system-ui, sans-serif;
  --space-4:           1rem;
  --container-max:     1200px;
}
`;
  tokensSource = "scaffold";
}

// ---- file templates ---------------------------------------------------------------

const nav = `<nav class="site-nav" aria-label="Primary">
  <a href="index.html">Home</a>
</nav>`;

const header = `<header class="site-header">
  <div class="container">
    <a class="site-logo" href="index.html">${N}</a>
    <!-- BEGIN partials/nav.html -->
    ${nav.split("\n").join("\n    ")}
    <!-- END partials/nav.html -->
  </div>
</header>`;

const footer = `<footer class="site-footer">
  <div class="container">
    <p>&copy; ${N}</p>
  </div>
</footer>`;

const files = {};
files["partials/nav.html"] = nav + "\n";
files["partials/header.html"] = header + "\n";
files["partials/footer.html"] = footer + "\n";
files["assets/css/tokens.css"] = tokensContent;

files["assets/css/general.css"] = `/**
 * General — ${N}
 * Site-wide layout utilities. Token-only — never write hex/px/font literals here.
 */
.${S}-page { margin: 0; font-family: var(--font-family-base); color: var(--color-text); background: var(--color-surface); }
.${S}-page .container { max-inline-size: var(--container-max, 1200px); margin-inline: auto; padding-inline: var(--space-4); }
.${S}-page .site-header .container,
.${S}-page .site-footer .container { display: flex; align-items: center; justify-content: space-between; }
.${S}-page .site-nav a { margin-inline-start: var(--space-4); }

@media (max-width: 960px) { .${S}-page .container { padding-inline: var(--space-4); } }
@media (max-width: 720px) { .${S}-page .site-header .container { flex-direction: column; align-items: flex-start; } }
@media (max-width: 600px) { .${S}-page .site-nav a { margin-inline-start: 0; display: inline-block; } }
@media (max-width: 480px) { .${S}-page .site-nav { display: flex; flex-direction: column; } }
`;

files["assets/css/sections.css"] = `/**
 * Sections — ${N}
 * Per-section/component styles, appended by /twt-html-block-creator.
 * Each section's block is separated by a comment line. Token-only.
 */
`;

files["index.html"] = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${N}</title>
  <link rel="stylesheet" href="assets/css/tokens.css">
  <link rel="stylesheet" href="assets/css/general.css">
  <link rel="stylesheet" href="assets/css/sections.css">
</head>
<body class="${S}-page">
  <!-- BEGIN partials/header.html -->
  ${header.split("\n").join("\n  ")}
  <!-- END partials/header.html -->

  <main>
    <!-- page sections go here -->
  </main>

  <!-- BEGIN partials/footer.html -->
  ${footer.split("\n").join("\n  ")}
  <!-- END partials/footer.html -->
</body>
</html>
`;

files["assets/js/.gitkeep"] = "";
files["assets/img/.gitkeep"] = "";

// ---- conventions reference -----------------------------------------------------

const conventions = `---
name: html-block-creator
description: Reference for the ${N} static site conventions — partials-inlining rule, scoping, tokens-mirror workflow, responsive tiers. Load whenever working in ${root}/.
---

Project name: ${N}
Project slug: ${S}
Output root: ${root}

## Partials (single source of truth)

Chrome lives once in \`${root}/partials/\` (\`header.html\`, \`footer.html\`, \`nav.html\`). Pages do NOT hand-author chrome — the builder **inlines** the partial between marker comments:

\`\`\`
<!-- BEGIN partials/header.html --> ... inlined copy ... <!-- END partials/header.html -->
\`\`\`

\`nav.html\` is inlined into \`header.html\` between its own \`BEGIN/END partials/nav.html\` markers; \`header.html\` (with nav already inlined) is inlined into each page. When a partial changes, the builder **re-inlines** it into every page that contains its markers, so no page drifts. Never edit chrome directly inside a page — edit the partial and re-inline.

## Scoping

- Body carries \`class="${S}-page"\`. All site CSS is scoped under \`.${S}-page ...\`.
- Never write unscoped global selectors.

## Tokens (mirrored — never re-authored)

- \`${root}/assets/css/tokens.css\` is a **mirror** of \`.twt-artifacts/design/design-system/tokens.css\`. Re-copy it when the spine changes; never edit token values in place.
- \`general.css\` and \`sections.css\` reference tokens via \`var(--...)\` only. **No hex/px/font literals.** If a needed token is missing, add it to the design-system spine (\`/twt-design-system-define\`) and re-mirror — do not inline a literal.

## Responsive tiers

| Range | Use |
|---|---|
| > 960px | Desktop |
| ≤ 960px | Tablet |
| ≤ 720px | Mobile (stacked) |
| ≤ 600px | Narrow |
| ≤ 480px | Small mobile |

Every page is responsive across desktop/tablet/mobile.

## Content

Pages use **real content** (from Phase-1/2 artifacts or the provided design). Lorem/placeholder where real content exists is a build blocker.

## Reuse-first

Before adding a section, reuse an existing section, extend if close, create new only when nothing fits. State the decision in the run report.

## File layout

\`\`\`
${root}/
  index.html
  <page-slug>.html
  partials/   header.html · footer.html · nav.html
  assets/css/ tokens.css (mirror) · general.css · sections.css
  assets/js/  (only when a section needs behavior)
  assets/img/ (real assets)
\`\`\`
`;

// ---- write -----------------------------------------------------------------------

const created = [], skipped = [];
function put(path, content) {
  if (existsSync(path) && !FORCE) { skipped.push(path); return; }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  created.push(path);
}

for (const [rel, content] of Object.entries(files)) put(join(root, rel), content);
const conventionsPath = join(".twt-artifacts", "html-site", "conventions.md");
put(conventionsPath, conventions);

console.log(JSON.stringify({
  root, slug: S, tokens_source: tokensSource,
  created, skipped,
  conventions_path: conventionsPath,
}, null, 2));
