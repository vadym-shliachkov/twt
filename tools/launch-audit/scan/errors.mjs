// tools/launch-audit/scan/errors.mjs — category 7.
//
// BOUNDARY: dead and placeholder links belong to /twt-qa-links and are cited
// from its report by the harvest layer — never re-counted here. This module
// owns only what that audit does not look at: the error page and the safety
// attributes on links that leave the site.
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { listFiles } from '../../lib/sources.mjs';

export function run(ctx) {
  const counts = { error_page: false, external_links: 0, unsafe_external: 0 };
  const findings = [];

  // The theme branch is the ONLY branch a theme-only project can satisfy, and
  // until launch-scan.mjs stopped bailing on a missing build root it could
  // never run at all — an Elementor project never reached this module. Order
  // the checks so none of them depends on a build root existing.
  const named = ctx.html.some((f) => /^(404|error)\.html?$/i.test(basename(f)));
  const themed = ctx.theme
    ? listFiles(ctx.theme, '.php').some((f) => /^404\.php$/i.test(basename(f)))
    : false;
  const atBase = Boolean(ctx.base) && existsSync(join(ctx.base, '404.html'));
  counts.error_page = named || themed || atBase;
  if (!counts.error_page) {
    findings.push({ kind: 'missing_error_page', file: ctx.rel(ctx.base) || ctx.rel(ctx.theme) || '.', line: 0, detail: 'no 404.html beside the build and no 404.php in the theme' });
  }

  // `external_links` counts only target="_blank" links — those are the ones
  // rel="noopener" applies to. It is scoped to the safety check this module
  // owns, not a census of every outbound <a href> in the build.
  for (const f of ctx.html) {
    const src = ctx.read(f);
    const file = ctx.rel(f);
    for (const m of src.matchAll(/<a\b[^>]*\shref\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi)) {
      const tag = m[0];
      if (!/\starget\s*=\s*["']_blank["']/i.test(tag)) continue;
      counts.external_links++;
      if (/\srel\s*=\s*["'][^"']*\bnoopener\b/i.test(tag)) continue;
      counts.unsafe_external++;
      findings.push({ kind: 'unsafe_external', file, line: ctx.lineOf(src, m.index), detail: 'target=_blank without rel=noopener' });
    }
  }
  return { counts, findings };
}
