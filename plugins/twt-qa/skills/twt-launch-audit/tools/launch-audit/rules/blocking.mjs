// tools/launch-audit/rules/blocking.mjs — the facts that stop a launch.
//
// Every severity here is a judgement someone has to stand behind, so each rule
// carries the reason in a comment. A rule that cannot explain its own tier
// should not be a rule.
import { finding } from '../../launch-audit.mjs';
import { at, per, kindsOf, collapse, evidenceFor } from './lib.mjs';

export const blockingRules = [
  {
    id: 'DISC001',
    // Deindexes the whole site for weeks. The single most expensive launch
    // defect that is also trivially detectable.
    //
    // Collapsed per (file, kind), not per scanner finding: belt-and-braces
    // `<meta name="robots" content="noindex">` alongside
    // `<meta name="googlebot" content="noindex">` is standard practice and one
    // decision, not two defects — and when the two tags sit on the same line
    // the ungrouped version emitted findings with identical ids. The scanner
    // already exempts pages that are SUPPOSED to be excluded (404, error,
    // thank-you, search), so anything reaching here is a page the site wants
    // indexed and has told crawlers to skip.
    run: (facts) => collapse(kindsOf(facts, 'discoverability', 'noindex'), (f) => f.file)
      .map((occ) => finding({
        rule: 'DISC001', category: 'discoverability', severity: 'LAUNCH-BLOCKER',
        owner: 'developer', where: at(occ[0]), evidence: evidenceFor(occ),
      })),
  },
  {
    id: 'DISC002',
    run: (facts) => per(facts, 'discoverability', 'robots_disallow_all', (f) => ({
      rule: 'DISC002', category: 'discoverability', severity: 'LAUNCH-BLOCKER',
      owner: 'developer', where: at(f), evidence: f.detail,
    })),
  },
  {
    id: 'HYG001',
    // Unrecoverable once pushed: the key must be rotated, not deleted.
    run: (facts) => per(facts, 'hygiene', 'secret_file', (f) => ({
      rule: 'HYG001', category: 'hygiene', severity: 'LAUNCH-BLOCKER',
      owner: 'developer', where: at(f), evidence: f.detail,
    })),
  },
  {
    id: 'HYG002',
    run: (facts) => per(facts, 'hygiene', 'inline_secret', (f) => ({
      rule: 'HYG002', category: 'hygiene', severity: 'LAUNCH-BLOCKER',
      owner: 'developer', where: at(f), evidence: f.detail,
    })),
  },
  {
    id: 'HYG004',
    run: (facts) => per(facts, 'hygiene', 'wp_debug_on', (f) => ({
      rule: 'HYG004', category: 'hygiene', severity: 'LAUNCH-BLOCKER',
      owner: 'developer', where: at(f), evidence: f.detail,
    })),
  },
  {
    id: 'CONV001',
    // The quietest launch failure: the page looks finished and every lead is
    // discarded, with nothing in any log to notice.
    run: (facts) => [
      ...per(facts, 'conversion', 'dead_action', (f) => ({
        rule: 'CONV001', category: 'conversion', severity: 'LAUNCH-BLOCKER',
        owner: 'developer', where: at(f), evidence: f.detail,
      })),
      ...per(facts, 'conversion', 'nonprod_action', (f) => ({
        rule: 'CONV001', category: 'conversion', severity: 'LAUNCH-BLOCKER',
        owner: 'developer', where: at(f), evidence: f.detail,
      })),
    ],
  },
  {
    id: 'ANLY001',
    // Owner is client-decision, not developer: the fix is a policy call about
    // consent, and a developer cannot make it alone.
    run: (facts) => per(facts, 'analytics', 'tracker_before_consent', (f) => ({
      rule: 'ANLY001', category: 'analytics', severity: 'LAUNCH-BLOCKER',
      owner: 'client-decision', where: at(f), evidence: f.detail,
    })),
  },
  {
    id: 'CONT001',
    run: (facts) => per(facts, 'content', 'lorem', (f) => ({
      rule: 'CONT001', category: 'content', severity: 'LAUNCH-BLOCKER',
      owner: 'content-owner', where: at(f), evidence: `placeholder copy: ${f.detail}`,
    })),
  },
  {
    id: 'LEGL001',
    // Only the privacy page blocks. Terms and cookie pages are FIX-WEEK-ONE:
    // whether they are legally required depends on jurisdiction and business
    // model, which is an interview question, not a fact in the markup.
    run: (facts) => per(facts, 'legal', 'missing_privacy_page', (f) => ({
      rule: 'LEGL001', category: 'legal', severity: 'LAUNCH-BLOCKER',
      owner: 'client-decision', where: at(f), evidence: f.detail,
    })),
  },
  {
    id: 'LIVE001',
    run: (facts) => ((facts.live?.findings) || [])
      .filter((f) => f.kind === 'x_robots_noindex')
      .map((f) => finding({
        rule: 'LIVE001', category: 'discoverability', severity: 'LAUNCH-BLOCKER',
        owner: 'hosting-ops', where: at(f), evidence: f.detail,
      })),
  },
];
