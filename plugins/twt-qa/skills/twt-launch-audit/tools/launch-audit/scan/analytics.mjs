// tools/launch-audit/scan/analytics.mjs — category 5.
//
// tracker_before_consent is the finding this module exists for: a tracker that
// runs before the user can decline is a live compliance liability, not a todo.
// Detection is deliberately conservative — a tracker counts as "before consent"
// only when no consent marker appears earlier in the same document.
//
// The consent-marker vocabulary is SHARED with legal.mjs (scan/lib/
// patterns.mjs). This module's private copy accepted a BARE `gdpr`, so the
// literal word "GDPR" appearing anywhere before a tracker — a footer link, a
// policy heading, a paragraph of body copy — suppressed ANLY001 outright: a
// false negative on this module's headline blocker. The shared constant
// requires a qualifier on both `gdpr` and `consent`.
import { CONSENT_BANNER } from './lib/patterns.mjs';

// Placeholder IDs the scaffolders and tutorials leave behind. A real GA4 id has
// a mixed alphanumeric suffix, so an all-X, all-0, or literal-placeholder tail
// is unambiguous. Legacy UA- ids are included deliberately: Universal Analytics
// no longer collects data, so a UA- tag on a launching site collects nothing.
// YOUR-GA-ID / YOUR-GTM-ID are included because they are the literal placeholder
// Google's own gtag documentation ships in commented-out config examples — a
// scaffolder that forgets to replace it ships a site that collects nothing.
const PLACEHOLDER = /^(G-X+|G-0+|GTM-X+|GTM-0+|UA-0+-\d+|UA-X+-X+|YOUR-?(GA|GTM)-?ID)$/i;
const TRACKER = /(googletagmanager\.com\/(?:gtag\/js|gtm\.js)|google-analytics\.com\/analytics\.js|plausible\.io\/js|matomo\.js|static\.hotjar\.com|cdn\.segment\.com\/analytics\.js|connect\.facebook\.net[^"']*fbevents\.js|clarity\.ms)/gi;
// Prefix alternation includes YOUR- so the placeholder literals above (whose
// id text never starts with G-/GTM-/UA-/AW-) actually get captured by this
// regex in the first place — without it PLACEHOLDER's YOUR- branch is dead
// code that never fires against real markup.
const ID = /\b((?:G|GTM|UA|AW|YOUR)-[A-Z0-9]+(?:-[A-Z0-9]+)?)\b/gi;
// Duplicate-tag detection is deliberately narrower than "this id appears twice
// anywhere in the page". Google's own canonical GA4 snippet repeats the id
// once in the loader <script src> and once in a gtag('config', id) call; its
// canonical GTM snippet repeats the id once in an inline IIFE argument and
// once in a <noscript><iframe> fallback. Both are a single, correct install —
// counting every text occurrence of the id flagged both as duplicates, which
// meant this check fired on the two most common analytics installations on
// the internet and stayed quiet only on unusual ones. A tag is only counted
// as duplicated when the SAME id loads from 2+ distinct <script src=...id=...>
// tags, which is what an actually-pasted-twice snippet looks like.
// Trade-off accepted: this misses a duplicated GTM IIFE paste whose id only
// ever appears as a JS constructor argument (never inside a literal src=) —
// that pattern is rare, and far better than false-flagging every correct
// GA4/GTM install.
const LOADER_ID = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*[?&]id=([A-Z0-9-]+)[^"']*["'][^>]*>/gi;

export function run(ctx) {
  const counts = { trackers: 0, placeholder_ids: 0, duplicate_tags: 0, tracker_before_consent: 0 };
  const findings = [];

  for (const f of ctx.html) {
    const src = ctx.read(f);
    const file = ctx.rel(f);
    const consent = CONSENT_BANNER.exec(src);
    const consentAt = consent ? consent.index : -1;

    for (const m of src.matchAll(TRACKER)) {
      counts.trackers++;
      if (consentAt !== -1 && m.index >= consentAt) continue;
      counts.tracker_before_consent++;
      findings.push({
        kind: 'tracker_before_consent', file, line: ctx.lineOf(src, m.index),
        detail: consentAt === -1
          ? `${m[0]} loads and there is no consent gate on the page`
          : `${m[0]} loads before the consent gate at line ${ctx.lineOf(src, consentAt)}`,
      });
    }
    for (const m of src.matchAll(ID)) {
      const id = m[1].toUpperCase();
      const line = ctx.lineOf(src, m.index);
      if (PLACEHOLDER.test(id)) {
        counts.placeholder_ids++;
        findings.push({ kind: 'placeholder_id', file, line, detail: `${id} is a placeholder, not a real property` });
      }
    }
    const seenLoaderIds = new Set();
    for (const m of src.matchAll(LOADER_ID)) {
      const id = m[1].toUpperCase();
      const line = ctx.lineOf(src, m.index);
      if (seenLoaderIds.has(id)) {
        counts.duplicate_tags++;
        findings.push({ kind: 'duplicate_tag', file, line, detail: `${id} loads from more than one <script src> tag on this page` });
      }
      seenLoaderIds.add(id);
    }
  }
  return { counts, findings };
}
