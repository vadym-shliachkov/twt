// tools/launch-audit/scan/performance.mjs — category 8.
//
// Byte weight and markup signals ONLY. Intrinsic image dimensions would need an
// image decoder, and this repo ships one runtime dependency; `missing_dimensions`
// therefore means the <img> tag has no width/height attributes — the
// layout-shift signal that actually matters, and readable from markup.
import { existsSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { localPath } from './lib/html.mjs';

const HEAVY_BYTES = 300 * 1024;
const REMOTE_FONT = /<link\b[^>]*href\s*=\s*["'](https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fast\.fonts\.net)[^"']*)["']/gi;
const kb = (n) => `${Math.round(n / 1024)}KB`;

// Without `fromRel` every relative src on a subdirectory page resolved to a
// path that does not exist, localSize() returned null, and `heavy_image` — the
// check this module exists for — was silently dead on every page below the
// root.
//
// `fromRel` is the referring page's path relative to the build root.
const localSize = (ctx, src, fromRel) => {
  const p = localPath(ctx.base, src, fromRel);
  return p && existsSync(p) ? statSync(p).size : null;
};

export function run(ctx) {
  const counts = {
    images: 0, heavy_images: 0, missing_lazy: 0, deliberate_eager: 0, missing_dimensions: 0,
    heaviest_page_bytes: 0, unminified_css: 0, remote_fonts: 0,
  };
  const findings = [];

  for (const f of ctx.html) {
    const src = ctx.read(f);
    const file = ctx.rel(f);
    // Every local reference on this page resolves against THIS page's
    // directory, not the build root — see localSize().
    const fromRel = ctx.base ? relative(ctx.base, f) : '';
    let pageBytes = Buffer.byteLength(src, 'utf8');

    let imgIndex = 0;
    for (const m of src.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const line = ctx.lineOf(src, m.index);
      counts.images++;
      const nth = imgIndex++;
      const srcAttr = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag);
      const size = localSize(ctx, srcAttr ? srcAttr[1] : null, fromRel);
      if (size !== null) {
        pageBytes += size;
        if (size > HEAVY_BYTES) {
          counts.heavy_images++;
          findings.push({ kind: 'heavy_image', file, line, detail: `${srcAttr[1]} is ${kb(size)} (> ${kb(HEAVY_BYTES)})` });
        }
      }
      // Lazy-loading is NOT universally correct, and recommending it where it
      // is wrong is worse than saying nothing. Deferring the LCP image
      // measurably slows the page — it is a documented anti-pattern, and the
      // three markers below are exactly how an author declares "this one is
      // above the fold, load it now":
      //   * fetchpriority="high" — the explicit LCP hint
      //   * loading="eager"      — the explicit opt-out
      //   * the first <img> in the document — the hero/logo in practice
      // On a well-built review fixture this check produced eight of ten
      // NICE-TO-HAVEs, every one of them advice that would make the site
      // slower. Counted as `deliberate_eager` so the observation survives.
      const eager = /\sfetchpriority\s*=\s*["']high["']/i.test(tag)
        || /\sloading\s*=\s*["']eager["']/i.test(tag)
        || nth === 0;
      if (!/\sloading\s*=\s*["']lazy["']/i.test(tag)) {
        if (eager) counts.deliberate_eager++;
        else {
          counts.missing_lazy++;
          findings.push({ kind: 'missing_lazy', file, line, detail: 'img has no loading="lazy"' });
        }
      }
      if (!/\swidth\s*=/i.test(tag) || !/\sheight\s*=/i.test(tag)) {
        counts.missing_dimensions++;
        findings.push({ kind: 'missing_dimensions', file, line, detail: 'img has no width/height attributes (layout shift)' });
      }
    }

    for (const m of src.matchAll(REMOTE_FONT)) {
      counts.remote_fonts++;
      findings.push({ kind: 'remote_font', file, line: ctx.lineOf(src, m.index), detail: m[1] });
    }
    for (const m of src.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["']/gi)) {
      const size = localSize(ctx, m[1], fromRel);
      if (size !== null) pageBytes += size;
    }
    counts.heaviest_page_bytes = Math.max(counts.heaviest_page_bytes, pageBytes);
  }

  // Unminified = a stylesheet averaging under 200 chars per line and not named
  // .min.css. A crude proxy, but it separates hand-written from built CSS.
  for (const f of ctx.css) {
    if (/\.min\.css$/i.test(f)) continue;
    const body = ctx.read(f);
    const lines = body.split('\n').length;
    if (body.length < 2048 || body.length / lines > 200) continue;
    counts.unminified_css++;
    findings.push({ kind: 'unminified_css', file: ctx.rel(f), line: 0, detail: `${kb(body.length)} across ${lines} lines, not minified` });
  }
  return { counts, findings };
}
