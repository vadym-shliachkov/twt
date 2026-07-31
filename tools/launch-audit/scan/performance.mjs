// tools/launch-audit/scan/performance.mjs — category 8.
//
// Byte weight and markup signals ONLY. Intrinsic image dimensions would need an
// image decoder, and this repo ships one runtime dependency; `missing_dimensions`
// therefore means the <img> tag has no width/height attributes — the
// layout-shift signal that actually matters, and readable from markup.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HEAVY_BYTES = 300 * 1024;
const REMOTE_FONT = /<link\b[^>]*href\s*=\s*["'](https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fast\.fonts\.net)[^"']*)["']/gi;
const kb = (n) => `${Math.round(n / 1024)}KB`;

const localSize = (ctx, src) => {
  if (!src || /^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return null;
  const p = join(ctx.base, src.split(/[?#]/)[0].replace(/^\//, ''));
  return existsSync(p) ? statSync(p).size : null;
};

export function run(ctx) {
  const counts = {
    images: 0, heavy_images: 0, missing_lazy: 0, missing_dimensions: 0,
    heaviest_page_bytes: 0, unminified_css: 0, remote_fonts: 0,
  };
  const findings = [];

  for (const f of ctx.html) {
    const src = ctx.read(f);
    const file = ctx.rel(f);
    let pageBytes = Buffer.byteLength(src, 'utf8');

    for (const m of src.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const line = ctx.lineOf(src, m.index);
      counts.images++;
      const srcAttr = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag);
      const size = localSize(ctx, srcAttr ? srcAttr[1] : null);
      if (size !== null) {
        pageBytes += size;
        if (size > HEAVY_BYTES) {
          counts.heavy_images++;
          findings.push({ kind: 'heavy_image', file, line, detail: `${srcAttr[1]} is ${kb(size)} (> ${kb(HEAVY_BYTES)})` });
        }
      }
      if (!/\sloading\s*=\s*["']lazy["']/i.test(tag)) {
        counts.missing_lazy++;
        findings.push({ kind: 'missing_lazy', file, line, detail: 'img has no loading="lazy"' });
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
      const size = localSize(ctx, m[1]);
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
