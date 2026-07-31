// tools/launch-audit/rules/blocking.mjs — the facts that stop a launch.
//
// Every severity here is a judgement someone has to stand behind, so each rule
// carries the reason in a comment. A rule that cannot explain its own tier
// should not be a rule.
import { finding } from '../../launch-audit.mjs';

// Each scanner finding becomes one report finding, so the punch list names the
// exact file and line rather than "3 pages have a problem".
const per = (facts, check, kind, make) =>
  ((facts.checks?.[check]?.findings) || [])
    .filter((f) => f.kind === kind)
    .map((f) => finding(make(f)));

const at = (f) => `${f.file}${f.line ? `:${f.line}` : ''}`;

export const blockingRules = [
  {
    id: 'DISC001',
    // Deindexes the whole site for weeks. The single most expensive launch
    // defect that is also trivially detectable.
    run: (facts) => per(facts, 'discoverability', 'noindex', (f) => ({
      rule: 'DISC001', category: 'discoverability', severity: 'LAUNCH-BLOCKER',
      owner: 'developer', where: at(f), evidence: f.detail,
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
    id: 'ANLY002',
    // A placeholder id means launch week — the week the client cares about
    // most — collects nothing, and the data cannot be backfilled.
    //
    // NOT per(): the scanner's ID regex matches every occurrence of the
    // placeholder text in the page source, and the canonical GA4/GTM snippet
    // legitimately repeats the SAME id twice on one page (once in the loader
    // <script src=…id=…>, once in the gtag('config', id) call, or once in the
    // GTM IIFE argument and once in the <noscript> fallback). Two scanner
    // findings for one id on one page are the SAME misconfiguration — mapping
    // both straight through would double the report for the single most
    // common analytics install shape and is exactly the noise this design
    // exists to avoid. Group by (file, detail) — detail is just the id text
    // plus a fixed message, so repeats of the same id on the same page always
    // collide into one group, while a different id, or the same id on a
    // different page, is a genuinely separate problem and stays separate.
    run: (facts) => {
      const raw = (facts.checks?.analytics?.findings || []).filter((f) => f.kind === 'placeholder_id');
      const groups = new Map();
      for (const f of raw) {
        const key = `${f.file}::${f.detail}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(f);
      }
      return [...groups.values()].map((occurrences) => {
        const lines = [...new Set(occurrences.map((o) => o.line).filter(Boolean))].sort((a, b) => a - b);
        const first = occurrences[0];
        const evidence = occurrences.length > 1
          ? `${first.detail} (seen ${occurrences.length} times: line${lines.length === 1 ? '' : 's'} ${lines.join(', ')})`
          : first.detail;
        return finding({
          rule: 'ANLY002', category: 'analytics', severity: 'LAUNCH-BLOCKER',
          owner: 'client-decision', where: at(first), evidence,
        });
      });
    },
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
