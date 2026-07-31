// tools/launch-audit/rules/index.mjs — every rule, plus the interview catalogue.
import { blockingRules } from './blocking.mjs';
import { qualityRules } from './quality.mjs';
import { harvestedRules } from './harvested.mjs';

export const RULES = [...blockingRules, ...qualityRules, ...harvestedRules];

// Layer C. `blocking: true` means an unanswered question becomes an UNVERIFIED
// finding, which is what keeps a silent run from reaching a clean GO.
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
    why: 'A long TTL turns a five-minute fix into a day-long partial outage.' },
  { id: 'Q-ENV-PARITY', category: 'operational', owner: 'hosting-ops', blocking: false,
    question: 'Does the production environment match staging (PHP/Node version, extensions, caching)?',
    why: 'Environment drift produces defects that cannot be reproduced anywhere the team can debug.' },
  { id: 'Q-LAUNCH-WINDOW', category: 'operational', owner: 'client-decision', blocking: true,
    question: 'Who presses the button, when, and who is available for the hour after?',
    why: 'An unattended launch is how a broken form goes unnoticed for a weekend.' },
  { id: 'Q-MONITORING', category: 'operational', owner: 'hosting-ops', blocking: false,
    question: 'Is uptime and error monitoring configured, and who receives the alerts?',
    why: 'Without monitoring, the client discovers the outage before the team does.' },
  { id: 'Q-REDESIGN-REDIRECTS', category: 'discoverability', owner: 'developer', blocking: false,
    question: 'Is this replacing a live site, and is the old-URL redirect map implemented?',
    why: 'A redesign without redirects discards the accumulated ranking of every old URL.' },
];
