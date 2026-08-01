// tools/launch-audit/scan/legal.mjs — category 4.
//
// Detects PRESENCE and REACHABILITY only. Whether a jurisdiction requires a
// given document, and whether the client's lawyer approved the text, are
// interview questions — this module never infers legal obligation from markup.
import { basename, relative } from 'node:path';
import { titleOf, pageKey, hrefKey } from './lib/html.mjs';
import { CONSENT_BANNER } from './lib/patterns.mjs';

const KINDS = {
  privacy: { file: /privacy|datenschutz|privacidad/i, title: /privacy|data protection|datenschutz/i },
  terms: { file: /terms|tos|conditions|agb/i, title: /terms|conditions|service agreement/i },
  cookie: { file: /cookie/i, title: /cookie/i },
};

export function run(ctx) {
  const counts = {
    privacy_page: false, terms_page: false, cookie_page: false,
    privacy_linked: false, terms_linked: false, cookie_linked: false,
    cookie_banner: false,
  };
  const findings = [];

  // No built HTML (a theme-only or URL-only project) — see discoverability.mjs.
  // This guard matters more here than anywhere else in the scan: without it a
  // theme-only project reports missing_privacy_page, which is LEGL001, which
  // is a LAUNCH-BLOCKER, from a module that read zero pages.
  if (!ctx.base || ctx.html.length === 0) return { counts, findings };

  const pages = ctx.html.map((f) => {
    const src = ctx.read(f);
    const t = titleOf(src);
    // `rel` is the path relative to the BUILD ROOT — what a URL would address.
    // `key` normalizes it (privacy.html and privacy/index.html are one page);
    // `name` keeps the raw basename purely for the filename patterns below.
    const rel = relative(ctx.base, f).replace(/\\/g, '/');
    return { file: ctx.rel(f), name: basename(f), rel, key: pageKey(rel), src, title: t ? t.text : '' };
  });
  const hrefs = pages.flatMap((p) =>
    [...p.src.matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
      .map((m) => ({ from: p.key, to: hrefKey(m[1], p.rel) }))
      .filter((h) => h.to !== null));

  for (const [kind, pat] of Object.entries(KINDS)) {
    // Match on the whole relative path, not just the basename: on a
    // directory-per-page build every file is `index.html`, and `privacy/` is
    // the only thing that says which page this is.
    const hit = pages.find((p) => pat.file.test(p.rel) || pat.title.test(p.title));
    counts[`${kind}_page`] = Boolean(hit);
    if (!hit) {
      findings.push({ kind: `missing_${kind}_page`, file: ctx.rel(ctx.base), line: 0, detail: `no ${kind} page found by filename or <title>` });
      continue;
    }
    // Linked from somewhere OTHER than itself — a page that only links to
    // itself is unreachable in practice, which is the same as not existing.
    //
    // Compared on normalized page KEYS, not raw basenames. The previous
    // basename('/privacy/') === 'privacy.html' comparison could never be true,
    // so every site whose footer links pretty URLs — which is every site built
    // on WordPress, Next.js, Astro, Hugo, or any directory-per-page static
    // build — was told its privacy, terms, and cookie pages were unreachable.
    // This is the same bug class already fixed for sitemap orphans; the fix
    // now lives in one place (scan/lib/html.mjs) so it cannot be fixed here
    // and left standing there again.
    const linked = hrefs.some((h) => h.from !== hit.key && h.to === hit.key);
    counts[`${kind}_linked`] = linked;
    if (!linked) {
      // Name the page by its path relative to the project, not its bare
      // basename: on a directory-per-page build every page is `index.html`,
      // and "index.html exists but no other page links to it" tells the
      // client nothing about WHICH page.
      findings.push({ kind: `${kind}_not_linked`, file: hit.file, line: 0, detail: `${hit.file} exists but no other page links to it` });
    }
  }

  counts.cookie_banner = pages.some((p) => CONSENT_BANNER.test(p.src));
  return { counts, findings };
}
