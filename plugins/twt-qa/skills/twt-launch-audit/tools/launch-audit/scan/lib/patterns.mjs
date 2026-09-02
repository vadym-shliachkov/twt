// tools/launch-audit/scan/lib/patterns.mjs
// Vocabularies that two scan modules would otherwise each define, differently.
//
// Both constants below existed twice on this branch, and in both cases the
// NARROWER copy was the one guarding the higher-severity finding — so the
// tool's most consequential checks ran on its weakest definitions:
//
//   * "non-production URL": conversion.mjs's copy was anchored and omitted
//     0.0.0.0, so a form posting to http://0.0.0.0:8080/post — the exact
//     "quietest launch failure" CONV001's own comment describes — was missed
//     by the LAUNCH-BLOCKER and picked up only by hygiene's FIX-WEEK-ONE.
//   * "consent banner": analytics.mjs saw <div id="consentmanager"> and
//     legal.mjs did not; worse, analytics' bare `gdpr` alternative meant the
//     literal word "GDPR" anywhere before a tracker suppressed ANLY001, a
//     false negative on that module's headline blocker.
//
// One definition, two importers. Each module still decides how to APPLY it —
// anchored vs. anywhere-in-the-file is a real difference; the host list is not.
//
// The host list is the UNION of what the two copies used to match, with one
// deliberate narrowing and one deliberate widening:
//   * `.local` requires a label boundary, so cdn.localisation.example — a real
//     hostname, matched by the old copy — is no longer a "non-production URL".
//   * `localhost` accepts subdomain labels, so http://app.localhost:3000/dash
//     matches. Wildcard *.localhost is how Vite, Traefik and pnpm dev servers
//     address per-app dev origins, and the first cut of the boundary fix took
//     it out along with the false positive. `localhost` itself carries the
//     same label boundary, so localhostess.example is not a match either.

// Hosts that cannot exist in production. Kept deliberately narrow: every entry
// here is either a loopback address or a name whose label set says "not prod".
const NONPROD_HOST = String.raw`(?:(?:[a-z0-9-]+\.)*localhost(?![a-z0-9-])|127\.0\.0\.1|0\.0\.0\.0|[a-z0-9-]*\.?(?:staging|stage|dev|test|preview)\.[a-z0-9.-]+|[a-z0-9-]+\.local(?![a-z0-9-]))`;

// Anywhere in a file — hygiene sweeps every shipped file for these.
export const NONPROD_URL_ANYWHERE = new RegExp(`https?://${NONPROD_HOST}(?::\\d+)?`, 'gi');

// At the start of the string — a form `action` IS the URL, so a match must
// cover the whole destination rather than appear somewhere inside it.
export const NONPROD_URL_AT_START = new RegExp(`^https?://${NONPROD_HOST}(?::\\d+)?`, 'i');

// A consent gate, by the markup real CMPs actually ship. `gdpr` and `consent`
// require a qualifier: the bare words appear in body copy, footer links, and
// policy headings on sites with no consent gate at all, and treating those as
// a gate silently turns off the tracker-before-consent blocker.
export const CONSENT_BANNER = /(?:cookie[-_ ]?(?:consent|banner|notice|bar|popup|prefs|preferences)|gdpr[-_ ]?(?:consent|banner|notice|bar|popup|modal|dialog|gate)|consent[-_ ]?(?:manager|banner|gate|mode)|cookieconsent|cookiebot|cookieyes|onetrust|klaro|osano|termly|usercentrics|iubenda|didomi|axeptio|complianz|borlabs|trustarc|quantcast)/i;
