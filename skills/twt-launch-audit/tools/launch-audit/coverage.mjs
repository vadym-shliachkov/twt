// tools/launch-audit/coverage.mjs — which categories the scan actually had
// input for.
//
// The readiness matrix used to derive its state from the finding count alone,
// so "no findings" and "nothing to look at" rendered identically as CLEAR. On a
// run where the locator found no built pages (`sources.html: []`), five
// categories reported CLEAR having read nothing — and one of them, Social &
// brand assets, sat in the same document as a cited 404 on the site's favicon.
//
// Absence of evidence is the one thing an audit must never print as evidence of
// absence. This module answers only "did this category have anything to read?",
// never "is it fine" — findings answer that.
import { CATEGORIES } from '../launch-audit.mjs';

export function coverageFor(facts) {
  const pages = facts?.sources?.html?.length || 0;
  const theme = Boolean(facts?.sources?.theme);
  const live = facts?.live?.status === 'ok';
  const h = facts?.harvest || {};
  // Every harvested source that was actually found, in the order the harvest
  // reports them. `validations` is a list, the rest are present/absent probes.
  const harvest = ['qa', 'gaps', 'seo_map', 'assets_manifest', 'approval']
    .filter((k) => h[k]?.present).length + (h.validations?.length || 0);
  const answered = Object.keys(facts?.answers || {}).length > 0;

  const assessed = {
    // Read out of the page markup, and only out of the page markup.
    content: pages > 0,
    social: pages > 0,
    legal: pages > 0,
    analytics: pages > 0,
    conversion: pages > 0,
    performance: pages > 0,
    // The live layer probes robots.txt/sitemap.xml and an unknown URL, so it
    // covers these two on its own even with nothing built locally.
    discoverability: pages > 0 || live,
    errors: pages > 0 || theme || live,
    // Reads the project root itself, which every local run has.
    hygiene: facts?.mode !== 'live',
    // Nothing to carry forward is not the same as nothing wrong: it means no
    // upstream report existed to read.
    carried: harvest > 0,
    operational: live || answered,
  };
  for (const c of CATEGORIES) if (!(c in assessed)) assessed[c] = false;
  return { assessed, inputs: { pages, theme, live, harvest } };
}
