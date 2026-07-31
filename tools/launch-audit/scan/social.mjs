// tools/launch-audit/scan/social.mjs — category 3.
//
// A missing og:image is not cosmetic: every share of the site renders as a bare
// grey card, and it is the launch defect a client notices first.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function metaByProp(src, name) {
  const re = new RegExp(`<meta\\s[^>]*(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, 'i');
  const tag = re.exec(src);
  if (!tag) return null;
  const c = /content\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
  return { value: c ? c[1] : '', index: tag.index };
}

export function run(ctx) {
  const counts = {
    favicon: false, apple_touch_icon: false,
    missing_og_title: 0, missing_og_image: 0, og_image_missing_file: 0, missing_twitter_card: 0,
  };
  const findings = [];

  for (const f of ctx.html) {
    const src = ctx.read(f);
    const file = ctx.rel(f);
    if (/<link\s[^>]*rel\s*=\s*["'][^"']*\bicon\b[^"']*["']/i.test(src)) counts.favicon = true;
    if (/<link\s[^>]*rel\s*=\s*["']apple-touch-icon["']/i.test(src)) counts.apple_touch_icon = true;

    if (!metaByProp(src, 'og:title')) {
      counts.missing_og_title++;
      findings.push({ kind: 'missing_og_title', file, line: 1, detail: 'no og:title' });
    }
    if (!metaByProp(src, 'twitter:card')) {
      counts.missing_twitter_card++;
      findings.push({ kind: 'missing_twitter_card', file, line: 1, detail: 'no twitter:card' });
    }
    const img = metaByProp(src, 'og:image');
    if (!img || !img.value.trim()) {
      counts.missing_og_image++;
      findings.push({ kind: 'missing_og_image', file, line: 1, detail: 'no og:image' });
    } else if (!/^https?:\/\//i.test(img.value)) {
      // Only a local path is checkable on disk. A CDN URL is verified by the
      // live layer when a URL is supplied, and left alone otherwise. Strip a
      // cache-busting query string / fragment before resolving — the path
      // this actually maps to on disk excludes them.
      const localPath = img.value.replace(/^\//, '').split(/[?#]/)[0];
      if (!existsSync(join(ctx.base, localPath))) {
        counts.og_image_missing_file++;
        findings.push({ kind: 'og_image_missing_file', file, line: ctx.lineOf(src, img.index), detail: `og:image ${img.value} resolves to no file` });
      }
    }
  }
  if (!counts.favicon) findings.push({ kind: 'missing_favicon', file: ctx.rel(ctx.base), line: 0, detail: 'no rel=icon link on any page' });
  if (!counts.apple_touch_icon) findings.push({ kind: 'missing_apple_touch_icon', file: ctx.rel(ctx.base), line: 0, detail: 'no apple-touch-icon link on any page' });
  return { counts, findings };
}
