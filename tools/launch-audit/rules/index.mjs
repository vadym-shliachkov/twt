// tools/launch-audit/rules/index.mjs — every rule, plus the interview catalogue.
import { blockingRules } from './blocking.mjs';
import { qualityRules } from './quality.mjs';
import { harvestedRules } from './harvested.mjs';
import { interviewRules } from './interview.mjs';

export { QUESTIONS } from './questions.mjs';
export { isAnswered } from './interview.mjs';

// interviewRules last: they are the only rules that fire on the ABSENCE of an
// input rather than the presence of one, and the sort in launch-audit.mjs
// re-orders everything anyway.
export const RULES = [...blockingRules, ...qualityRules, ...harvestedRules, ...interviewRules];
