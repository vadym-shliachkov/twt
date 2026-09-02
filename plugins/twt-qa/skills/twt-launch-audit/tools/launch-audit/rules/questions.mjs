// tools/launch-audit/rules/questions.mjs — the interview catalogue.
//
// Layer C. `blocking: true` means an unanswered question becomes an UNVERIFIED
// finding, which is what keeps a silent run from reaching a clean GO. That
// materialization is done by interview.mjs, at RULE time — see the comment
// there for why it does not live in the command file's interview step.
//
// Split out of index.mjs so interview.mjs can import the catalogue without
// importing (and cycling through) the rule aggregate.
// A question with a `live` variant is asked in its cutover form before launch
// and in the variant form once the URL under audit is already serving traffic.
// Same id, same owner, same blocking status — only the wording changes, so the
// one-rule-per-blocking-question invariant is untouched. Without this the audit
// asked "who presses the button?" about a site that had been public for weeks,
// which reads as an audit that did not look at what it was auditing.
export function resolveQuestions(facts, questions = QUESTIONS) {
  const live = facts?.live?.status === 'ok' && facts?.live?.checks?.reachable === true;
  return questions.map(({ live: variant, ...q }) => (live && variant ? { ...q, ...variant } : q));
}

export const QUESTIONS = [
  { id: 'Q-CONTENT-SIGNOFF', category: 'content', owner: 'content-owner', blocking: true,
    question: 'Has the client signed off on the final copy for every page?',
    why: 'Publishing copy the client has not approved is the most common cause of a same-day rollback.' },
  { id: 'Q-LEGAL-SUPPLIED', category: 'legal', owner: 'client-decision', blocking: true,
    question: 'Which legal documents did the client supply and approve (privacy, terms, cookie)?',
    why: 'A privacy policy written by anyone but the client is legal exposure they did not agree to carry.' },
  { id: 'Q-CONSENT-REQUIRED', category: 'legal', owner: 'client-decision', blocking: false,
    question: 'Does the launch jurisdiction require a cookie-consent gate?',
    why: 'Consent obligation depends on where visitors are, which is not knowable from the markup.' },
  { id: 'Q-ANALYTICS-ID', category: 'analytics', owner: 'client-decision', blocking: true,
    question: 'Is the analytics property ID in the build the real production one, and who owns that account?',
    why: 'Data sent to the wrong property cannot be recovered, and an agency-owned account strands the client.' },
  { id: 'Q-FORM-DESTINATION', category: 'conversion', owner: 'client-decision', blocking: true,
    question: 'Where do form submissions go, who receives the notification, and has one been sent end to end?',
    why: 'A form can post successfully and still deliver to nobody; only a real submission proves the path.' },
  { id: 'Q-BACKUP-ROLLBACK', category: 'operational', owner: 'hosting-ops', blocking: true,
    question: 'Is there a backup of the current production state and a tested rollback path?',
    why: 'Without a rollback, every launch defect becomes an emergency fix under time pressure.' },
  { id: 'Q-DNS-SSL', category: 'operational', owner: 'hosting-ops', blocking: true,
    question: 'Are DNS and SSL ready for the production domain, and what is the TTL during cutover?',
    why: 'A long TTL turns a five-minute fix into a day-long partial outage.',
    live: { question: 'Is the certificate renewal automated, and does every hostname the site answers on (apex, www, any alias) serve valid TLS?',
      why: 'On a site already serving traffic the cutover is done; the remaining failure is a certificate nobody is watching expire.' } },
  { id: 'Q-ENV-PARITY', category: 'operational', owner: 'hosting-ops', blocking: false,
    question: 'Does the production environment match staging (PHP/Node version, extensions, caching)?',
    why: 'Environment drift produces defects that cannot be reproduced anywhere the team can debug.' },
  { id: 'Q-LAUNCH-WINDOW', category: 'operational', owner: 'client-decision', blocking: true,
    question: 'Who presses the button, when, and who is available for the hour after?',
    why: 'An unattended launch is how a broken form goes unnoticed for a weekend.',
    live: { question: 'Who watches the site for the hour after each of these fixes ships, and how would they notice a form that stopped delivering?',
      why: 'There is no cutover left to staff — the risk has moved to remediation landing on live traffic with nobody watching.' } },
  { id: 'Q-MONITORING', category: 'operational', owner: 'hosting-ops', blocking: false,
    question: 'Is uptime and error monitoring configured, and who receives the alerts?',
    why: 'Without monitoring, the client discovers the outage before the team does.' },
  { id: 'Q-REDESIGN-REDIRECTS', category: 'discoverability', owner: 'developer', blocking: false,
    question: 'Is this replacing a live site, and is the old-URL redirect map implemented?',
    why: 'A redesign without redirects discards the accumulated ranking of every old URL.' },
];
