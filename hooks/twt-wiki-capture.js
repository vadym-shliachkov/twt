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
 * Pull the chosen answers out of the tool response. The response shape is not
 * guaranteed, so try the known shapes and give up gracefully - callers fall
 * back to recording the raw payload rather than dropping the decision.
 * Returns a { question: answer } map, possibly empty.
 */
function extractAnswers(data) {
  const candidates = [data && data.tool_response, data && data.tool_input];
  for (let c of candidates) {
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) { continue; } }
    if (c && typeof c === 'object' && c.answers && typeof c.answers === 'object') return c.answers;
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

  const answers = extractAnswers(data);
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  let out = '';
  for (const q of questions) {
    const question = oneLine(q && q.question);
    if (!question) continue;
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => oneLine(o && o.label)).filter(Boolean).join(' | ');
    const chosen = oneLine(answers[question]);

    out += `\n## ${stamp} · decision · AskUserQuestion\n`;
    out += `- **question:** ${question}\n`;
    if (options) out += `- **options:** ${options}\n`;
    if (chosen) out += `- **chosen:** ${chosen}\n`;
    else out += `- **raw:** ${oneLine(JSON.stringify(data.tool_response))}\n`;
  }

  if (!out) return;
  try { fs.appendFileSync(path.join(wikiDir, 'inbox.md'), out, 'utf8'); } catch (e) { /* never block */ }
}

try { main(); } catch (e) { /* never block a tool call */ }
process.exit(0);
