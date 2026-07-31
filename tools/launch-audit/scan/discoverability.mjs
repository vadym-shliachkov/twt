// tools/launch-audit/scan/discoverability.mjs — category 2.
//
// The stray-noindex check is the reason this module exists. A noindex that
// survives a staging→prod move deletes the site from search for weeks, is
// invisible to every existing twt audit, and is trivially detectable here.
//
// BOUNDARY: /twt-seo-define owns what the keywords, slugs and meta text SHOULD
// say. This module only measures whether the built output carries the tags.
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const TITLE_MAX = 60;
const DESC_MAX = 160;

function metaByName(src, name) {
  const re = new RegExp(`<meta\\s[^>]*name\\s*=\\s*["']${name}["'][^>]*>`, 'i');
  const tag = re.exec(src);
  if (!tag) return null;
  const c = /content\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
  return { value: c ? c[1] : '', index: tag.index };
}

export function run(ctx) {
  const counts = {
    pages: 0, missing_title: 0, long_title: 0, missing_description: 0, long_description: 0,
    missing_canonical: 0, missing_lang: 0, noindex_pages: 0, nofollow_pages: 0,
    robots_txt: false, sitemap_xml: false, sitemap_orphans: 0,
  };
  const findings = [];

  for (const f of ctx.html) {
    const src = ctx.read(f);
    const file = ctx.rel(f);
    counts.pages++;

    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
    const titleText = title ? title[1].trim() : '';
    if (!titleText) {
      counts.missing_title++;
      findings.push({ kind: 'missing_title', file, line: 1, detail: 'no non-empty <title>' });
    } else if (titleText.length > TITLE_MAX) {
      counts.long_title++;
      findings.push({ kind: 'long_title', file, line: ctx.lineOf(src, title.index), detail: `${titleText.length} chars (> ${TITLE_MAX})` });
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
    for (const name of ['robots', 'googlebot', 'bingbot']) {
      const m = metaByName(src, name);
      if (!m) continue;
      if (/\bnoindex\b/i.test(m.value)) {
        counts.noindex_pages++;
        findings.push({ kind: 'noindex', file, line: ctx.lineOf(src, m.index), detail: `meta ${name}="${m.value}"` });
      }
      if (/\bnofollow\b/i.test(m.value)) {
        counts.nofollow_pages++;
        findings.push({ kind: 'nofollow', file, line: ctx.lineOf(src, m.index), detail: `meta ${name}="${m.value}"` });
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
      const listed = new Set(
        [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
          .map((m) => basename(m[1].replace(/\/$/, '')) || 'index.html'),
      );
      for (const page of ctx.html) {
        if (listed.has(basename(page))) continue;
        counts.sitemap_orphans++;
        findings.push({ kind: 'sitemap_orphan', file: ctx.rel(page), line: 0, detail: 'built page has no <loc> in sitemap.xml' });
      }
    }
  }
  return { counts, findings };
}
