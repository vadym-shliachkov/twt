// tools/launch-audit/rules/interview.mjs — the questions no file can answer,
// materialized as findings at RULE time.
//
// THE INVERSION. The command file's success criterion is "every unanswered
// blocking interview question appears as an UNVERIFIED finding, so the verdict
// can never be a clean GO on silence". The instructions that created those
// findings used to live INSIDE the interview step — the step the command file
// skips by design under `--skip-interview` and under subagent dispatch (where
// AskUserQuestion does not exist). `QUESTIONS` was serialized into
// `findings.json.interview[]` and read by nothing. So the unattended path ran
// every mechanical check, found nothing, and returned a clean GO having
// verified no backup, no rollback, no DNS, no form destination, and no content
// sign-off. A safety property that holds only on the path a human is watching
// is not a safety property.
//
// So: the findings are created HERE, where every path runs them, and the
// interview REMOVES them by answering. That is also the honest direction —
// "nobody has answered this" is a deterministic fact about the project's
// files (the catalogue and answers.json), not a judgement. Judgement stays
// with the model: it still decides what an answer MEANS (Step 5 turns a
// worrying answer into a real finding, and a clearing answer into none) and
// still writes every finding's impact and action (Step 6).
import { finding } from '../../launch-audit.mjs';
import { QUESTIONS } from './questions.mjs';

// An answer counts when it has non-empty text. `answers.json` is written by the
// model in Step 5 as `{ "<question id>": { "answer": "...", "asked": "..." } }`
// and loaded by launch-audit.mjs's CLI onto `facts.answers`; a bare string is
// accepted too, so a hand-written file is not silently ignored.
export function isAnswered(answers, id) {
  const a = answers?.[id];
  const text = typeof a === 'string' ? a : a?.answer;
  return typeof text === 'string' && text.trim().length > 0;
}

// Only `blocking: true` questions become findings. A non-blocking question is
// worth asking and not worth stalling a launch over, so leaving it unanswered
// must not add an UNVERIFIED to the count that drives the verdict.
export const interviewRules = QUESTIONS.filter((q) => q.blocking).map((q) => ({
  id: `INTV-${q.id}`,
  run: (facts) => (isAnswered(facts.answers, q.id) ? [] : [finding({
    rule: 'INTV001', category: q.category, severity: 'UNVERIFIED', owner: q.owner,
    where: `interview: ${q.id}`,
    evidence: `not answered — ${q.question}`,
  })]),
}));
