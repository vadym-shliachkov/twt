# Vendored files - DO NOT EDIT HERE

These are byte-identical copies of shared code from the marketplace monolith.
They exist because this plugin installs on its own, and a plugin cannot reach
into another plugin's files at runtime.

Edit the canonical copy at the repo root, then run:

    node tools/sync-kernel.mjs

CI runs `node tools/sync-kernel.mjs --check`, so an edit made here instead of
at the source fails the build rather than silently diverging.

| vendored file | canonical source |
|---|---|
| `templates/themes/doc-hub-light/css/components.css` | `templates/themes/doc-hub-light/css/components.css` |
| `templates/themes/doc-hub-light/css/doc.css` | `templates/themes/doc-hub-light/css/doc.css` |
| `templates/themes/doc-hub-light/css/doctypes/brand-brief.css` | `templates/themes/doc-hub-light/css/doctypes/brand-brief.css` |
| `templates/themes/doc-hub-light/css/doctypes/components.css` | `templates/themes/doc-hub-light/css/doctypes/components.css` |
| `templates/themes/doc-hub-light/css/doctypes/qa-report.css` | `templates/themes/doc-hub-light/css/doctypes/qa-report.css` |
| `templates/themes/doc-hub-light/css/doctypes/sitemap.css` | `templates/themes/doc-hub-light/css/doctypes/sitemap.css` |
| `templates/themes/doc-hub-light/css/doctypes/tokens.css` | `templates/themes/doc-hub-light/css/doctypes/tokens.css` |
| `templates/themes/doc-hub-light/css/profiles/brief.css` | `templates/themes/doc-hub-light/css/profiles/brief.css` |
| `templates/themes/doc-hub-light/css/profiles/generic.css` | `templates/themes/doc-hub-light/css/profiles/generic.css` |
| `templates/themes/doc-hub-light/css/profiles/report.css` | `templates/themes/doc-hub-light/css/profiles/report.css` |
| `templates/themes/doc-hub-light/css/profiles/spec.css` | `templates/themes/doc-hub-light/css/profiles/spec.css` |
| `templates/themes/doc-hub-light/css/slide.css` | `templates/themes/doc-hub-light/css/slide.css` |
| `templates/themes/doc-hub-light/css/tokens.css` | `templates/themes/doc-hub-light/css/tokens.css` |
| `templates/themes/doc-hub-light/fonts/LICENSE.md` | `templates/themes/doc-hub-light/fonts/LICENSE.md` |
| `templates/themes/doc-hub-light/fonts/ibm-plex-mono-400.woff2` | `templates/themes/doc-hub-light/fonts/ibm-plex-mono-400.woff2` |
| `templates/themes/doc-hub-light/fonts/ibm-plex-mono-500.woff2` | `templates/themes/doc-hub-light/fonts/ibm-plex-mono-500.woff2` |
| `templates/themes/doc-hub-light/fonts/inter-variable.woff2` | `templates/themes/doc-hub-light/fonts/inter-variable.woff2` |
| `templates/themes/doc-hub-light/fonts/montserrat-variable.woff2` | `templates/themes/doc-hub-light/fonts/montserrat-variable.woff2` |
| `templates/themes/doc-hub-light/reference/reference.docx` | `templates/themes/doc-hub-light/reference/reference.docx` |
| `templates/themes/doc-hub-light/reference/reference.pptx` | `templates/themes/doc-hub-light/reference/reference.pptx` |
| `templates/themes/doc-hub-light/theme.json` | `templates/themes/doc-hub-light/theme.json` |
