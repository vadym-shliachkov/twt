// tools/launch-audit/scan/legal.mjs — category 4.
//
// Detects PRESENCE and REACHABILITY only. Whether a jurisdiction requires a
// given document, and whether the client's lawyer approved the text, are
// interview questions — this module never infers legal obligation from markup.
import { basename } from 'node:path';

const KINDS = {
  privacy: { file: /privacy|datenschutz|privacidad/i, title: /privacy|data protection|datenschutz/i },
  terms: { file: /terms|tos|conditions|agb/i, title: /terms|conditions|service agreement/i },
  cookie: { file: /cookie/i, title: /cookie/i },
};
const BANNER = /(cookie[-_ ]?(consent|banner|notice)|gdpr[-_ ]?(consent|banner)|cookieconsent|onetrust|klaro|cookiebot|osano|termly)/i;

export function run(ctx) {
  const counts = {
    privacy_page: false, terms_page: false, cookie_page: false,
    privacy_linked: false, terms_linked: false, cookie_linked: false,
    cookie_banner: false,
  };
  const findings = [];

  const pages = ctx.html.map((f) => {
    const src = ctx.read(f);
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
    return { file: ctx.rel(f), name: basename(f), src, title: t ? t[1].trim() : '' };
  });
  const hrefs = pages.flatMap((p) =>
    [...p.src.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => ({ from: p.name, href: m[1] })));

  for (const [kind, pat] of Object.entries(KINDS)) {
    const hit = pages.find((p) => pat.file.test(p.name) || pat.title.test(p.title));
    counts[`${kind}_page`] = Boolean(hit);
    if (!hit) {
      findings.push({ kind: `missing_${kind}_page`, file: ctx.rel(ctx.base), line: 0, detail: `no ${kind} page found by filename or <title>` });
      continue;
    }
    // Linked from somewhere OTHER than itself — a page that only links to itself
    // is unreachable in practice, which is the same as not existing.
    const linked = hrefs.some((h) => h.from !== hit.name && basename(h.href.split(/[?#]/)[0]) === hit.name);
    counts[`${kind}_linked`] = linked;
    if (!linked) {
      findings.push({ kind: `${kind}_not_linked`, file: hit.file, line: 0, detail: `${hit.name} exists but no other page links to it` });
    }
  }

  counts.cookie_banner = pages.some((p) => BANNER.test(p.src));
  return { counts, findings };
}
