#!/usr/bin/env node
/**
 * twt-wiki-capture - PostToolUse capture hook for AskUserQuestion.
 *
 * Appends every human decision to .project-wiki/inbox.md, append-only.
 * Appending cannot corrupt: the curator (twt-wiki-define) is the only thing
 * that ever writes a curated page.
 *
 * INERT BY DEFAULT: if .project-wiki/ does not exist, this writes nothing and
 * exits 0. The wiki is opt-in per project; running /twt-wiki once arms capture.
 *
 * This hook fires on every AskUserQuestion in every project. It must never
 * throw and must always exit 0 - a crashing hook degrades every tool call.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}

/** Escape a value so it cannot break the one-field-per-line inbox format. */
function oneLine(v) {
  return String(v == null ? '' : v).replace(/\r?\n/g, ' ').trim();
}

/**
 * Operational plumbing questions - the setup gate and the wiki skills' own
 * routing prompts. Their answers are never project knowledge, only run
 * mechanics, and capturing them puts a dismiss-every-time burden on the
 * curator. Matched against the question's `header` chip, which these owners
 * control; every header below is used ONLY by twt-setup's Step 0 gate or by
 * the wiki commands themselves (verified across the repo before listing).
 */
const SKIP_HEADERS = new Set(['setup', 'wiki', 'sync', 'save', 'ingest or focus']);

/**
 * Pull the chosen answers out of the tool response. The response shape is not
 * guaranteed, so try the known shapes and give up gracefully - callers fall
 * back to recording the raw payload rather than dropping the decision.
 * Returns a { question: answer } map, possibly empty.
 */
function extractAnswers(data, questions) {
  const candidates = [data && data.tool_response, data && data.tool_input];
  for (let c of candidates) {
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) { continue; } }
    if (!c || typeof c !== 'object') continue;
    if (c.answers && typeof c.answers === 'object') return c.answers;
    // Tolerate a bare { question: answer } map with no `answers` wrapper - the
    // sibling twt-debug-log hook hedges the same way (`r.answers || r`). Only
    // accept it when it actually keys one of THIS call's questions, so an
    // unrelated response object can never be mistaken for an answer map.
    if (questions.some((q) => q && typeof c[q] === 'string')) return c;
  }
  return {};
}

/**
 * Pull the per-question annotations map ({ question: { notes, preview } })
 * out of the payload, same hedged shapes as extractAnswers. Notes are the
 * user explaining their own choice in free text - the single highest-value
 * thing this hook can capture - so look for them everywhere they might be.
 */
function extractAnnotations(data) {
  const candidates = [data && data.tool_response, data && data.tool_input];
  for (let c of candidates) {
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) { continue; } }
    if (!c || typeof c !== 'object') continue;
    if (c.annotations && typeof c.annotations === 'object') return c.annotations;
  }
  return {};
}

function main() {
  let data;
  try { data = JSON.parse(readStdin() || '{}'); } catch (e) { return; }
  if (!data || data.tool_name !== 'AskUserQuestion') return;

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const wikiDir = path.join(root, '.project-wiki');
  if (!fs.existsSync(wikiDir)) return; // inert: no wiki, no capture

  const questions = (data.tool_input && Array.isArray(data.tool_input.questions))
    ? data.tool_input.questions : [];
  if (!questions.length) return;

  const answers = extractAnswers(data, questions.map((q) => q && q.question));
  const annotations = extractAnnotations(data);
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  let out = '';
  for (const q of questions) {
    const question = oneLine(q && q.question);
    if (!question) continue;
    const header = oneLine(q && q.header);
    if (header && SKIP_HEADERS.has(header.toLowerCase())) continue; // run mechanics, not project knowledge
    const opts = Array.isArray(q.options) ? q.options : [];
    const options = opts.map((o) => oneLine(o && o.label)).filter(Boolean).join(' | ');
    const chosen = oneLine(answers[question]);
    // The chosen option's description spells out what the label meant at the
    // moment of choice - the closest thing to a rationale the tool offers.
    const chosenOpt = chosen && opts.find((o) => o && oneLine(o.label) === chosen);
    const detail = chosenOpt ? oneLine(chosenOpt.description) : '';
    const note = annotations[question] && oneLine(annotations[question].notes);

    out += `\n## ${stamp} · decision · AskUserQuestion\n`;
    if (header) out += `- **header:** ${header}\n`;
    out += `- **question:** ${question}\n`;
    if (options) out += `- **options:** ${options}\n`;
    // No parseable answer: never drop the decision - record the payload verbatim
    // so a human can still recover what was chosen. JSON.stringify(undefined)
    // yields the value `undefined`, not a string, so guard the absent case.
    if (chosen) out += `- **chosen:** ${chosen}\n`;
    else {
      const raw = oneLine(JSON.stringify(data.tool_response)) || '(no tool_response in payload)';
      out += `- **raw:** ${raw}\n`;
    }
    if (detail) out += `- **detail:** ${detail}\n`;
    if (note) out += `- **notes:** ${note}\n`;
  }

  if (!out) return;
  try { fs.appendFileSync(path.join(wikiDir, 'inbox.md'), out, 'utf8'); } catch (e) { /* never block */ }
}

try { main(); } catch (e) { /* never block a tool call */ }
process.exit(0);
