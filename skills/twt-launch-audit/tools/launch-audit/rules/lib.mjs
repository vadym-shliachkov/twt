// tools/launch-audit/rules/lib.mjs — the plumbing every rule module shares.
//
// `at()` was defined identically in blocking.mjs and quality.mjs; `collapse()`
// existed only inside ANLY002 and had to be re-derived by hand the moment a
// second rule needed the same grouping (it did — see DISC001/DISC012).
import { finding } from '../../launch-audit.mjs';

// "site/about.html:12", or just "site/about.html" for a whole-file finding.
export const at = (f) => `${f.file}${f.line ? `:${f.line}` : ''}`;

// The raw scanner findings of one kind.
export const kindsOf = (facts, check, kind) =>
  ((facts.checks?.[check]?.findings) || []).filter((f) => f.kind === kind);

// Each scanner finding becomes one report finding, so the punch list names the
// exact file and line rather than "3 pages have a problem".
export const per = (facts, check, kind, make) => kindsOf(facts, check, kind).map((f) => finding(make(f)));

// Group scanner findings that describe ONE problem into one report finding.
//
// Several correct, common markup shapes produce more than one scanner finding
// for a single defect: the canonical GA4 snippet names its property id twice
// on one page, and belt-and-braces `<meta name="robots">` +
// `<meta name="googlebot">` is standard practice, not two mistakes. Emitting
// one report finding per scanner finding doubles (or quadruples) the report
// for the most ordinary installs — and, when the repeats sit on the same line,
// emits findings with identical ids.
//
// Returns an array of occurrence arrays, in first-seen order, so each caller
// still formats its own evidence.
export function collapse(raw, keyOf) {
  const groups = new Map();
  for (const f of raw) {
    const k = keyOf(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  return [...groups.values()];
}

// The lines a collapsed group covers, deduped and ordered — "line 8" /
// "lines 8, 12".
export function linesOf(occurrences) {
  const lines = [...new Set(occurrences.map((o) => o.line).filter(Boolean))].sort((a, b) => a - b);
  if (!lines.length) return null;
  return `line${lines.length === 1 ? '' : 's'} ${lines.join(', ')}`;
}

// Evidence for a collapsed group: the distinct details, plus where the repeats
// are. One evidence format for every collapsed rule, so the report never
// explains the same shape two different ways.
export function evidenceFor(occurrences) {
  const details = [...new Set(occurrences.map((o) => o.detail))].join('; ');
  if (occurrences.length < 2) return details;
  const lines = linesOf(occurrences);
  return lines ? `${details} (seen ${occurrences.length} times: ${lines})` : details;
}
