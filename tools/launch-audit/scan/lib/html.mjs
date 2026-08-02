// tools/launch-audit/scan/lib/html.mjs
// The HTML primitives more than one scan module needs.
//
// Six modules were each carrying their own copy of "find this meta tag",
// "find the <title>", and "turn this href into a path on disk". Three of the
// review findings on this branch were the SAME bug fixed in one copy and left
// standing in the others (the pretty-URL normalizer landed in discoverability
// and never reached legal). One definition per primitive makes that class of
// drift impossible rather than merely unlikely.
import { join } from 'node:path';

// <meta name="…"> — the crawler-directive / description form.
export const metaByName = (src, name) => metaTag(src, 'name', name);

// <meta property="…"> OR <meta name="…"> — the OpenGraph/Twitter form. Both
// spellings are in the wild for og:*/twitter:*, and a scanner that accepts
// only one of them reports a correctly tagged page as untagged.
export const metaByProp = (src, name) => metaTag(src, '(?:property|name)', name);

function metaTag(src, attr, name) {
  const re = new RegExp(`<meta\\s[^>]*${attr}\\s*=\\s*["']${name}["'][^>]*>`, 'i');
  const tag = re.exec(src);
  if (!tag) return null;
  const c = /content\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
  return { value: c ? c[1] : '', index: tag.index };
}

// { text, index } for the first <title>, or null. `index` is the offset of the
// opening tag so callers can turn it into a line number.
export function titleOf(src) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
  return m ? { text: m[1].trim(), index: m.index } : null;
}

// The path part of a reference that addresses something inside this site, or
// null when it does not address one at all (remote URL, protocol-relative
// //cdn, data: URI, bare #fragment, mailto:, tel:, javascript:). The query
// string and fragment are dropped — neither the file on disk nor the page key
// carries them — but the LEADING SLASH IS KEPT, because it is the whole
// difference between "resolve against the build root" and "resolve against the
// referring document's directory". Losing it here is what made localPath()
// non-document-relative for three review rounds.
export function localRef(ref) {
  if (typeof ref !== 'string') return null;
  const r = ref.trim();
  if (!r || r.startsWith('#')) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(r)) return null;
  if (/^(?:data|mailto|tel|javascript):/i.test(r)) return null;
  return r.split(/[?#]/)[0] || null;
}

// Resolve a site-internal path the way a browser would: `/…` against the site
// root, anything else against the referring document's directory, collapsing
// `.` and `..`. `fromRel` is the referring page's path relative to the build
// root; pass it whenever the reference was read out of a page. `..` can never
// climb above the root — a build cannot reference its own parent.
function resolve(path, fromRel = '') {
  const dir = String(fromRel).replace(/\\/g, '/').replace(/[^/]*$/, '');
  const full = path.startsWith('/') ? path.slice(1) : dir + path;
  const out = [];
  for (const seg of full.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return { path: out.join('/'), trailingSlash: full.endsWith('/') };
}

// A reference resolved to a path on disk, DOCUMENT-RELATIVE: `fromRel` is the
// referring page's path relative to the build root, so an og:image of
// `../assets/og.png` on `guides/index.html` resolves to `assets/og.png` — the
// file that actually exists — instead of `../assets/og.png` off the build
// root, which exists nowhere and was reported as a missing file. The same bug
// silently resolved NOTHING for every subdirectory page in performance.mjs's
// image-weight check, disabling `heavy_image` there entirely.
//
// null when the reference is not local, or when there is no build root to
// resolve it against (a theme-only or URL-only project — see launch-scan.mjs).
export function localPath(base, ref, fromRel = '') {
  const p = localRef(ref);
  if (!base || !p) return null;
  const { path } = resolve(p, fromRel);
  return path ? join(base, path) : null;
}

// Normalize a built page — given its path RELATIVE TO THE BUILD ROOT — to the
// URL path a visitor would type. `privacy.html` and `privacy/index.html` are
// the same page to a server and must be the same key here; `about.html` and
// `blog/about.html` are different pages and must not collide.
//
//   privacy.html          → privacy
//   privacy/index.html    → privacy
//   blog/about.html       → blog/about
//   index.html            → index   (the site root)
//
// Case folding is deliberate: a footer linking `/Privacy/` to `privacy.html`
// is a working link on every case-insensitive host, and reporting it as
// unlinked is a false positive on correct work.
export function pageKey(relPath) {
  let p = String(relPath).replace(/\\/g, '/').toLowerCase();
  p = p.replace(/\.html?$/, '');
  p = p.replace(/(?:^|\/)index$/, '');   // dir/index and a bare index → the dir
  p = p.replace(/^\/+|\/+$/g, '');
  return p || 'index';
}

// Normalize an href, or a sitemap <loc>, to the same key pageKey() produces.
// Handles absolute URLs, pretty/extensionless directory URLs (`/privacy/`),
// root-relative paths, and document-relative paths (resolved against
// `fromRel`, the referring page's path relative to the build root — pass it
// whenever the href came out of a page). Returns null for anything that does
// not address a page of this site (a bare fragment, mailto:, tel:,
// javascript:).
export function hrefKey(raw, fromRel = '') {
  if (typeof raw !== 'string') return null;
  let r = raw.trim();
  if (!r || r.startsWith('#')) return null;
  if (/^(?:data|mailto|tel|javascript):/i.test(r)) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(r)) {
    r = r.replace(/^[a-z][a-z0-9+.-]*:/i, '').replace(/^\/\/[^/]*/, '') || '/';
  }
  r = r.split(/[?#]/)[0];
  if (!r) return null;
  const { path, trailingSlash } = resolve(r, fromRel);
  // A trailing slash means "the directory's index page" — say so explicitly so
  // pageKey() collapses it the same way it collapses a real dir/index.html.
  return pageKey(path + (trailingSlash ? '/index' : ''));
}

