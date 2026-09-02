// tools/launch-audit/rules/quality.mjs — real but survivable, and cosmetic.
import { finding } from '../../launch-audit.mjs';
import { at, kindsOf, collapse, evidenceFor } from './lib.mjs';

// One rule definition per (check, kind) pair, so adding a scanner signal means
// adding a row here rather than writing another near-identical closure.
const MAP = [
  // [rule, check, kind, category, severity, owner]
  ['HYG005', 'hygiene', 'nonprod_url', 'hygiene', 'FIX-WEEK-ONE', 'developer'],
  ['HYG003', 'hygiene', 'debug_statement', 'hygiene', 'NICE-TO-HAVE', 'developer'],
  ['HYG006', 'hygiene', 'source_map', 'hygiene', 'NICE-TO-HAVE', 'developer'],
  ['DISC003', 'discoverability', 'missing_title', 'discoverability', 'FIX-WEEK-ONE', 'content-owner'],
  ['DISC004', 'discoverability', 'missing_description', 'discoverability', 'FIX-WEEK-ONE', 'content-owner'],
  ['DISC005', 'discoverability', 'missing_canonical', 'discoverability', 'FIX-WEEK-ONE', 'developer'],
  ['DISC006', 'discoverability', 'missing_lang', 'discoverability', 'FIX-WEEK-ONE', 'developer'],
  ['DISC007', 'discoverability', 'missing_robots_txt', 'discoverability', 'FIX-WEEK-ONE', 'developer'],
  ['DISC008', 'discoverability', 'missing_sitemap_xml', 'discoverability', 'FIX-WEEK-ONE', 'developer'],
  ['DISC009', 'discoverability', 'sitemap_orphan', 'discoverability', 'FIX-WEEK-ONE', 'developer'],
  ['DISC010', 'discoverability', 'long_title', 'discoverability', 'NICE-TO-HAVE', 'content-owner'],
  ['DISC011', 'discoverability', 'long_description', 'discoverability', 'NICE-TO-HAVE', 'content-owner'],
  // DISC012 is NOT in this table — it needs the same (file, kind) collapse as
  // DISC001, for the same reason (robots + googlebot on one page is one
  // decision). See COLLAPSED below.
  ['SOCL001', 'social', 'missing_og_image', 'social', 'FIX-WEEK-ONE', 'designer'],
  ['SOCL002', 'social', 'og_image_missing_file', 'social', 'FIX-WEEK-ONE', 'designer'],
  ['SOCL003', 'social', 'missing_favicon', 'social', 'FIX-WEEK-ONE', 'designer'],
  ['SOCL004', 'social', 'missing_apple_touch_icon', 'social', 'NICE-TO-HAVE', 'designer'],
  ['SOCL005', 'social', 'missing_og_title', 'social', 'FIX-WEEK-ONE', 'content-owner'],
  ['SOCL006', 'social', 'missing_twitter_card', 'social', 'NICE-TO-HAVE', 'developer'],
  ['LEGL002', 'legal', 'missing_terms_page', 'legal', 'FIX-WEEK-ONE', 'client-decision'],
  ['LEGL003', 'legal', 'missing_cookie_page', 'legal', 'FIX-WEEK-ONE', 'client-decision'],
  ['LEGL004', 'legal', 'privacy_not_linked', 'legal', 'FIX-WEEK-ONE', 'developer'],
  ['LEGL005', 'legal', 'terms_not_linked', 'legal', 'NICE-TO-HAVE', 'developer'],
  ['LEGL006', 'legal', 'cookie_not_linked', 'legal', 'NICE-TO-HAVE', 'developer'],
  ['ANLY003', 'analytics', 'duplicate_tag', 'analytics', 'FIX-WEEK-ONE', 'developer'],
  ['CONT002', 'content', 'placeholder_marker', 'content', 'FIX-WEEK-ONE', 'content-owner'],
  ['CONT003', 'content', 'empty_heading', 'content', 'FIX-WEEK-ONE', 'content-owner'],
  ['CONT004', 'content', 'empty_slot', 'content', 'NICE-TO-HAVE', 'content-owner'],
  ['CONV002', 'conversion', 'no_submit', 'conversion', 'FIX-WEEK-ONE', 'developer'],
  ['CONV003', 'conversion', 'unlabeled_control', 'conversion', 'FIX-WEEK-ONE', 'developer'],
  ['CONV004', 'conversion', 'bad_mailto', 'conversion', 'FIX-WEEK-ONE', 'developer'],
  ['CONV005', 'conversion', 'bad_tel', 'conversion', 'FIX-WEEK-ONE', 'developer'],
  ['ERRS001', 'errors', 'missing_error_page', 'errors', 'FIX-WEEK-ONE', 'developer'],
  ['ERRS002', 'errors', 'unsafe_external', 'errors', 'FIX-WEEK-ONE', 'developer'],
  ['PERF001', 'performance', 'heavy_image', 'performance', 'FIX-WEEK-ONE', 'designer'],
  ['PERF002', 'performance', 'missing_lazy', 'performance', 'NICE-TO-HAVE', 'developer'],
  ['PERF003', 'performance', 'missing_dimensions', 'performance', 'NICE-TO-HAVE', 'developer'],
  ['PERF004', 'performance', 'remote_font', 'performance', 'NICE-TO-HAVE', 'developer'],
  ['PERF005', 'performance', 'unminified_css', 'performance', 'NICE-TO-HAVE', 'developer'],
];

// Scanner signals where more than one raw finding routinely describes ONE
// problem. Same table shape as MAP, plus the key each group collapses on.
const COLLAPSED = [
  // [rule, check, kind, category, severity, owner, keyOf]
  //
  // A page carrying `<meta name="robots" content="nofollow">` AND
  // `<meta name="googlebot" content="nofollow">` made one decision, not two.
  ['DISC012', 'discoverability', 'nofollow', 'discoverability', 'FIX-WEEK-ONE', 'developer', (f) => f.file],
  // ANLY002 — RE-TIERED from LAUNCH-BLOCKER/client-decision to
  // FIX-WEEK-ONE/developer. A placeholder analytics id costs launch-week
  // analytics: nothing on the site breaks, nothing is exposed, no lead is
  // lost. It sat one tier above CONV002 (a form with no submit button —
  // literally unusable), which is not a defensible ordering. The owner is the
  // developer because swapping in the real id is a developer edit once the
  // client supplies it; the "who owns the analytics account" question is
  // already the client's, and it is asked as Q-ANALYTICS-ID.
  //
  // Grouped by (file, detail): the scanner's ID regex matches every occurrence
  // of the placeholder text in the page source, and the canonical GA4/GTM
  // snippet legitimately repeats the SAME id twice on one page (loader
  // <script src=…id=…> then gtag('config', id); or the GTM IIFE argument then
  // the <noscript> fallback). `detail` is the id text plus a fixed message, so
  // repeats of one id on one page always collide into one group, while a
  // different id — or the same id on a different page — stays separate.
  ['ANLY002', 'analytics', 'placeholder_id', 'analytics', 'FIX-WEEK-ONE', 'developer', (f) => `${f.file}::${f.detail}`],
];

// Live-layer signals, keyed off facts.live.findings rather than facts.checks.
const LIVE_MAP = [
  ['LIVE002', 'unreachable', 'operational', 'LAUNCH-BLOCKER', 'hosting-ops'],
  ['LIVE003', 'soft_404', 'errors', 'FIX-WEEK-ONE', 'hosting-ops'],
  ['LIVE004', 'no_https', 'operational', 'LAUNCH-BLOCKER', 'hosting-ops'],
  ['LIVE005', 'no_hsts', 'operational', 'NICE-TO-HAVE', 'hosting-ops'],
  ['LIVE006', 'missing_robots_txt', 'discoverability', 'FIX-WEEK-ONE', 'hosting-ops'],
  ['LIVE007', 'missing_sitemap_xml', 'discoverability', 'FIX-WEEK-ONE', 'hosting-ops'],
  ['LIVE008', 'bad_root_status', 'operational', 'LAUNCH-BLOCKER', 'hosting-ops'],
];

export const qualityRules = [
  ...MAP.map(([rule, check, kind, category, severity, owner]) => ({
    id: rule,
    run: (facts) => ((facts.checks?.[check]?.findings) || [])
      .filter((f) => f.kind === kind)
      .map((f) => finding({ rule, category, severity, owner, where: at(f), evidence: f.detail })),
  })),
  ...COLLAPSED.map(([rule, check, kind, category, severity, owner, keyOf]) => ({
    id: rule,
    run: (facts) => collapse(kindsOf(facts, check, kind), keyOf).map((occ) =>
      finding({ rule, category, severity, owner, where: at(occ[0]), evidence: evidenceFor(occ) })),
  })),
  ...LIVE_MAP.map(([rule, kind, category, severity, owner]) => ({
    id: rule,
    run: (facts) => ((facts.live?.findings) || [])
      .filter((f) => f.kind === kind)
      .map((f) => finding({ rule, category, severity, owner, where: at(f), evidence: f.detail })),
  })),
];
