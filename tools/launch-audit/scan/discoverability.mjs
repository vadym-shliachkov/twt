// tools/launch-audit/scan/discoverability.mjs — category 2.
//
// The stray-noindex check is the reason this module exists. A noindex that
// survives a staging→prod move deletes the site from search for weeks, is
// invisible to every existing twt audit, and is trivially detectable here.
//
// BOUNDARY: /twt-seo-define owns what the keywords, slugs and meta text SHOULD
// say. This module only measures whether the built output carries the tags.
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { metaByName, titleOf, pageKey, hrefKey } from './lib/html.mjs';

const TITLE_MAX = 60;
const DESC_MAX = 160;

// Pages that are SUPPOSED to be kept out of the index.
//
// A noindex on 404.html was the sole LAUNCH-BLOCKER — and therefore the sole
// cause of NO-GO — on a realistic, correctly built review fixture. Excluding
// an error page, a thank-you page, or an internal search-results page from
// search is the recommended configuration, not a defect; Google's own guidance
// says so, and ERRS001 in this same tool REQUIRES the 404 page to exist. A
// rule set that demands you ship a 404 and then blocks the launch for
// configuring it correctly is the definition of crying wolf.
//
// Exempted here at the scanner rather than re-tiered at the rules, and
// deliberately not emitted as a lower-severity finding either: the observation
// is preserved in `noindex_excluded` / `nofollow_excluded` (so facts.json
// still records what was seen, and Step 6's model pass can read it), but it
// never reaches the client-facing report, because printing the recommended
// configuration as an issue at ANY tier teaches the reader to skim the
// category — and that category contains the single most expensive launch
// defect this tool detects.
// Matched against the LAST SEGMENT OF THE PAGE KEY, not the raw basename: on a
// directory-per-page build (WordPress, Next.js, Astro, Hugo — i.e. most of
// them) every file is literally `index.html`, so a basename test sees
// `thank-you/index.html` as "index" and exempts nothing. Found by running the
// fixed scanner against an independently built 8-page site, where a correctly
// noindexed `thank-you/` page was still the sole LAUNCH-BLOCKER.
//
// ANCHORED AT BOTH ENDS, and this matters more than the exemption itself. The
// first cut anchored only the start, so the token was a prefix match: it
// exempted `search-engine-optimisation.html`, `404-error-handling.html`,
// `thanks-to-our-volunteers.html`, `error-codes-explained.html`,
// `errors-we-have-made.html` and `blog/searching-for-a-fitter.html` — real
// content pages, silently, at every tier. That is strictly worse than the
// false positive it replaced: a stray noindex on
// /services/search-engine-optimisation/ is exactly the defect this module
// exists to catch, and an unanchored exemption turns the tool's most expensive
// check off for the page an agency cares most about ranking.
//
// The optional `-page` / `-results` suffix covers the two real spellings
// (`error-page.html`, `search-results.html`) without opening the token back up
// to arbitrary continuations.
const EXCLUDED_PAGE = /^(?:404|error|errors|thank[-_]?you|thanks|search)(?:[-_](?:page|results?))?$/i;
const isExcluded = (key) => EXCLUDED_PAGE.test(key.split('/').pop());

export function run(ctx) {
  const counts = {
    pages: 0, missing_title: 0, long_title: 0, missing_description: 0, long_description: 0,
    missing_canonical: 0, missing_lang: 0, noindex_pages: 0, nofollow_pages: 0,
    noindex_excluded: 0, nofollow_excluded: 0, sitemap_excluded: 0,
    robots_txt: false, sitemap_xml: false, sitemap_orphans: 0,
  };
  const findings = [];

  // A theme-only or URL-only project has no built HTML to read. Every finding
  // below is a per-page or beside-the-build assertion, so with no pages there
  // is nothing this module can honestly measure — and "no robots.txt beside a
  // build that does not exist" is a fabricated finding, not a missing file.
  // See launch-scan.mjs's gate: the scan still runs (hygiene and the live
  // layer have real work), this module just no-ops.
  if (!ctx.base || ctx.html.length === 0) return { counts, findings };

  for (const f of ctx.html) {
    const src = ctx.read(f);
    const file = ctx.rel(f);
    counts.pages++;

    const title = titleOf(src);
    if (!title || !title.text) {
      counts.missing_title++;
      findings.push({ kind: 'missing_title', file, line: 1, detail: 'no non-empty <title>' });
    } else if (title.text.length > TITLE_MAX) {
      counts.long_title++;
      findings.push({ kind: 'long_title', file, line: ctx.lineOf(src, title.index), detail: `${title.text.length} chars (> ${TITLE_MAX})` });
    }

    const desc = metaByName(src, 'description');
    if (!desc || !desc.value.trim()) {
      counts.missing_description++;
      findings.push({ kind: 'missing_description', file, line: 1, detail: 'no meta description' });
    } else if (desc.value.length > DESC_MAX) {
      counts.long_description++;
      findings.push({ kind: 'long_description', file, line: ctx.lineOf(src, desc.index), detail: `${desc.value.length} chars (> ${DESC_MAX})` });
    }

    if (!/<link\s[^>]*rel\s*=\s*["']canonical["']/i.test(src)) {
      counts.missing_canonical++;
      findings.push({ kind: 'missing_canonical', file, line: 1, detail: 'no rel=canonical' });
    }
    if (!/<html\s[^>]*\blang\s*=\s*["'][a-z]/i.test(src)) {
      counts.missing_lang++;
      findings.push({ kind: 'missing_lang', file, line: 1, detail: 'no lang attribute on <html>' });
    }

    // Any crawler-directive meta counts — robots, googlebot, bingbot.
    // Per Google's robots-meta spec, content="none" is defined as equivalent
    // to "noindex, nofollow" — treat it as satisfying both branches.
    const excluded = isExcluded(pageKey(relative(ctx.base, f)));
    for (const name of ['robots', 'googlebot', 'bingbot']) {
      const m = metaByName(src, name);
      if (!m) continue;
      if (/\b(noindex|none)\b/i.test(m.value)) {
        if (excluded) counts.noindex_excluded++;
        else {
          counts.noindex_pages++;
          findings.push({ kind: 'noindex', file, line: ctx.lineOf(src, m.index), detail: `meta ${name}="${m.value}"` });
        }
      }
      if (/\b(nofollow|none)\b/i.test(m.value)) {
        if (excluded) counts.nofollow_excluded++;
        else {
          counts.nofollow_pages++;
          findings.push({ kind: 'nofollow', file, line: ctx.lineOf(src, m.index), detail: `meta ${name}="${m.value}"` });
        }
      }
    }
  }

  // robots.txt / sitemap.xml live beside the built pages, or at the project root.
  for (const [key, name] of [['robots_txt', 'robots.txt'], ['sitemap_xml', 'sitemap.xml']]) {
    const inBase = join(ctx.base, name);
    const inRoot = join(ctx.projectDir, name);
    const at = existsSync(inBase) ? inBase : existsSync(inRoot) ? inRoot : null;
    counts[key] = Boolean(at);
    if (!at) {
      findings.push({ kind: `missing_${key}`, file: ctx.rel(inBase), line: 0, detail: `${name} not found beside the build or at the project root` });
      continue;
    }
    const body = ctx.read(at);
    if (key === 'robots_txt') {
      const idx = body.search(/^\s*Disallow:\s*\/\s*$/im);
      if (idx > -1) {
        findings.push({ kind: 'robots_disallow_all', file: ctx.rel(at), line: ctx.lineOf(body, idx), detail: 'Disallow: / blocks the whole site' });
      }
    } else {
      // pageKey()/hrefKey() (scan/lib/html.mjs) normalize both a sitemap
      // <loc> and a built filename to the same bare key, so pretty /
      // extensionless sitemap URLs (https://acme.com/about/) match a built
      // about.html instead of reporting every page as an orphan.
      const listed = new Set(
        [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => hrefKey(m[1])).filter(Boolean),
      );
      for (const page of ctx.html) {
        const key = pageKey(relative(ctx.base, page));
        if (listed.has(key)) continue;
        // A 404, thank-you or search page is SUPPOSED to be absent from the
        // sitemap — listing it is the actual mistake. Same exemption, same
        // reason: never report the recommended configuration as a defect.
        if (isExcluded(key)) { counts.sitemap_excluded++; continue; }
        counts.sitemap_orphans++;
        findings.push({ kind: 'sitemap_orphan', file: ctx.rel(page), line: 0, detail: 'built page has no <loc> in sitemap.xml' });
      }
    }
  }
  return { counts, findings };
}
