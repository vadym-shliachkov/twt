// tools/launch-audit/scan/analytics.mjs — category 5.
//
// tracker_before_consent is the finding this module exists for: a tracker that
// runs before the user can decline is a live compliance liability, not a todo.
// Detection is deliberately conservative — a tracker counts as "before consent"
// only when no consent marker appears earlier in the same document.

// Placeholder IDs the scaffolders and tutorials leave behind. A real GA4 id has
// a mixed alphanumeric suffix, so an all-X, all-0, or literal-placeholder tail
// is unambiguous. Legacy UA- ids are included deliberately: Universal Analytics
// no longer collects data, so a UA- tag on a launching site collects nothing.
const PLACEHOLDER = /^(G-X+|G-0+|GTM-X+|GTM-0+|UA-0+-\d+|UA-X+-X+|YOUR-?(GA|GTM)-?ID)$/i;
const TRACKER = /(googletagmanager\.com\/(?:gtag\/js|gtm\.js)|google-analytics\.com\/analytics\.js|plausible\.io\/js|matomo\.js|static\.hotjar\.com|cdn\.segment\.com\/analytics\.js|connect\.facebook\.net[^"']*fbevents\.js|clarity\.ms)/gi;
const ID = /\b((?:G|GTM|UA|AW)-[A-Z0-9]+(?:-[A-Z0-9]+)?)\b/gi;
const CONSENT = /(cookie[-_ ]?(consent|banner|notice)|gdpr|cookieconsent|onetrust|klaro|cookiebot|osano|termly|consentmanager)/i;

export function run(ctx) {
  const counts = { trackers: 0, placeholder_ids: 0, duplicate_tags: 0, tracker_before_consent: 0 };
  const findings = [];

  for (const f of ctx.html) {
    const src = ctx.read(f);
    const file = ctx.rel(f);
    const consent = CONSENT.exec(src);
    const consentAt = consent ? consent.index : -1;
    const seen = new Set();

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
      if (seen.has(id)) {
        counts.duplicate_tags++;
        findings.push({ kind: 'duplicate_tag', file, line, detail: `${id} appears more than once on this page` });
      }
      seen.add(id);
    }
  }
  return { counts, findings };
}
