#!/usr/bin/env node
/**
 * twt-debug-log — opt-in debug tracer for /twt-site --log.
 *
 * Three modes:
 *   1. --arm "<label>"     create the sentinel + open a fresh debug log section.
 *   2. (stdin JSON)        PreToolUse / PostToolUse handler (Task + AskUserQuestion).
 *   3. --summarize         append the wall-time cost table, then disarm.
 *
 * It is INERT unless armed: every hook invocation first checks for the sentinel
 * at <project>/.twt-artifacts/.twt-debug/active.json and exits 0 silently if it
 * is absent. So normal sessions (no --log) are completely unaffected.
 *
 * Cost is a WALL-TIME PROXY for token spend, not a token count — Claude Code
 * does not expose per-subagent token usage to hooks, and subagent tool calls do
 * not appear in the parent transcript. Elapsed time per dispatch is the best
 * signal a hook can capture; treat the percentages as relative, not exact.
 *
 * Never throws out of the top level — any failure exits 0 so it can never break
 * a run (same safety posture as twt-scope-guard).
 *
 * Output (human): <project>/.twt-artifacts/site-debug.md
 * Output (machine, for --summarize): <project>/.twt-artifacts/.twt-debug/events.jsonl
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ---- paths ---------------------------------------------------------------

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
const ROOT = projectDir();
const DBG_DIR = path.join(ROOT, '.twt-artifacts', '.twt-debug');
const SENTINEL = path.join(DBG_DIR, 'active.json');
const EVENTS = path.join(DBG_DIR, 'events.jsonl');
const STATE = path.join(DBG_DIR, 'state.json');
const LOG_MD = path.join(ROOT, '.twt-artifacts', 'site-debug.md');

// ---- tiny helpers --------------------------------------------------------

function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; } }
function writeJson(p, o) { try { fs.writeFileSync(p, JSON.stringify(o)); } catch {} }
function appendMd(s) { try { fs.appendFileSync(LOG_MD, s); } catch {} }
function appendEvent(o) { try { fs.appendFileSync(EVENTS, JSON.stringify(o) + '\n'); } catch {} }
function armed() { return fs.existsSync(SENTINEL); }
function nowIso() { return new Date().toISOString(); }
function hms() { return new Date().toISOString().slice(11, 19); }
function fmtDur(ms) {
  if (ms == null || isNaN(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60); return m + 'm' + String(s % 60).padStart(2, '0') + 's';
}

// Map every worker skill to the phase that owns it, for the rolled-up table.
const PHASE_OF = (name) => {
  const n = String(name).replace(/^\//, '');
  if (n === 'twt-site') return 'orchestrator';
  if (/^twt-(content|brand|spec|positioning|ia|curation|pre-design)/.test(n)) return 'pre-design';
  if (/^twt-(design$|design-system|component|layout|mockup|design)/.test(n)) return 'design';
  if (/^twt-(develop|html|elementor|content-approval|site-dev)/.test(n)) return 'development';
  if (/^twt-qa/.test(n)) return 'qa';
  return 'other';
};

// Pull the dispatched skill name + a one-line "why" out of a Task prompt.
function parseDispatch(input) {
  const prompt = (input && (input.prompt || input.description)) || '';
  const text = String(prompt);
  const skillM = text.match(/\/twt-[a-z0-9-]+/);
  const skill = skillM ? skillM[0] : (input && input.subagent_type ? input.subagent_type : 'task');
  // explicit "WHY: ..." marker wins; else first non-empty, non-boilerplate line.
  let why = '';
  const whyM = text.match(/WHY:\s*(.+)/i);
  if (whyM) why = whyM[1].trim();
  else {
    const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^subagent-collect/i.test(l));
    why = line || '';
  }
  if (why.length > 160) why = why.slice(0, 157) + '…';
  return { skill, why };
}

// ---- modes ---------------------------------------------------------------

function arm(label) {
  try { fs.mkdirSync(DBG_DIR, { recursive: true }); } catch {}
  const runId = Date.now().toString(36);
  writeJson(SENTINEL, { runId, started: nowIso(), label: label || 'site' });
  writeJson(STATE, { open: 0, stack: [] });
  try { fs.writeFileSync(EVENTS, ''); } catch {}
  appendMd(
    `\n\n## Debug run ${nowIso()} — \`${label || 'site'}\`\n\n` +
    `> Hook-driven trace. \`▶\` dispatch · \`✔\` done · boxed = user choice. ` +
    `Cost is a **wall-time proxy** for token spend (see summary).\n\n` +
    `### Trace\n\n`
  );
  process.stdout.write('twt-debug-log: armed (run ' + runId + ')\n');
}

function handleHook() {
  if (!armed()) return; // inert
  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; }
  const ev = payload.hook_event_name || payload.hookEventName;
  const tool = payload.tool_name || payload.toolName;
  const input = payload.tool_input || payload.toolInput || {};
  const resp = payload.tool_response || payload.toolResponse;
  const state = readJson(STATE, { open: 0, stack: [] });

  if (ev === 'PreToolUse' && tool === 'Task') {
    const { skill, why } = parseDispatch(input);
    const depth = state.open + 1;
    const indent = '  '.repeat(state.open);
    appendMd(`${indent}\`▶ ${hms()}\` ·D${depth}· **${skill}**\n${indent}    ↳ ${why || '(no context parsed)'}\n`);
    state.stack.push({ skill, t0: Date.now() });
    state.open += 1;
    writeJson(STATE, state);
    appendEvent({ ev: 'dispatch', skill, why, depth, t0: Date.now() });
  } else if (ev === 'PostToolUse' && tool === 'Task') {
    const { skill } = parseDispatch(input);
    let elapsed = null;
    for (let i = state.stack.length - 1; i >= 0; i--) {
      if (state.stack[i].skill === skill) { elapsed = Date.now() - state.stack[i].t0; state.stack.splice(i, 1); break; }
    }
    state.open = Math.max(0, state.open - 1);
    const indent = '  '.repeat(state.open);
    appendMd(`${indent}\`✔ ${hms()}\` **${skill}**  (${fmtDur(elapsed)})\n`);
    writeJson(STATE, state);
    appendEvent({ ev: 'done', skill, elapsed });
  } else if (ev === 'PreToolUse' && tool === 'AskUserQuestion') {
    const qs = (input && input.questions) || [];
    let block = `\n\`\`\`text\n┌─ USER ─────────────────────────────────\n`;
    for (const q of qs) {
      const hdr = q.header ? `[${q.header}] ` : '';
      block += `│ ❓ ${hdr}${(q.question || '').slice(0, 90)}\n`;
    }
    block += `└─────────────────────────────────────────\n\`\`\`\n`;
    appendMd(block);
    appendEvent({ ev: 'ask', questions: qs.map((q) => q.header || q.question || '') });
  } else if (ev === 'PostToolUse' && tool === 'AskUserQuestion') {
    // tool_response carries the user's selection(s).
    let answers = '';
    try {
      const r = typeof resp === 'string' ? JSON.parse(resp) : resp;
      const a = (r && (r.answers || r)) || {};
      answers = Object.entries(a).map(([k, v]) => `${k} → ${v}`).join(' · ');
    } catch { answers = typeof resp === 'string' ? resp.slice(0, 200) : ''; }
    appendMd(`\`\`\`text\n  ✅ ${answers || '(answer recorded)'}\n\`\`\`\n`);
    appendEvent({ ev: 'answer', answers });
  }
}

function summarize() {
  if (!armed()) { process.stdout.write('twt-debug-log: not armed — nothing to summarize\n'); return; }
  const events = [];
  try {
    for (const l of fs.readFileSync(EVENTS, 'utf8').split('\n')) {
      if (l.trim()) { try { events.push(JSON.parse(l)); } catch {} }
    }
  } catch {}

  const per = new Map(); // skill -> {ms, calls}
  for (const e of events) {
    if (e.ev === 'dispatch') {
      const r = per.get(e.skill) || { ms: 0, calls: 0 };
      r.calls += 1; per.set(e.skill, r);
    } else if (e.ev === 'done' && e.elapsed != null) {
      const r = per.get(e.skill) || { ms: 0, calls: 0 };
      r.ms += e.elapsed; per.set(e.skill, r);
    }
  }
  const total = [...per.values()].reduce((a, b) => a + b.ms, 0) || 1;
  const pct = (ms) => ((ms / total) * 100).toFixed(1).padStart(5) + '%';

  // phase rollup
  const phase = new Map();
  for (const [skill, r] of per) {
    const p = PHASE_OF(skill);
    const pr = phase.get(p) || { ms: 0, calls: 0 };
    pr.ms += r.ms; pr.calls += r.calls; phase.set(p, pr);
  }

  const leafRows = [...per.entries()].sort((a, b) => b[1].ms - a[1].ms)
    .map(([s, r]) => `| ${s} | ${r.calls} | ${fmtDur(r.ms)} | ${pct(r.ms)} |`).join('\n');
  const phaseRows = [...phase.entries()].sort((a, b) => b[1].ms - a[1].ms)
    .map(([p, r]) => `| ${p} | ${r.calls} | ${fmtDur(r.ms)} | ${pct(r.ms)} |`).join('\n');

  appendMd(
    `\n### Cost summary (wall-time proxy)\n\n` +
    `_Not token counts — hooks can't see subagent tokens. Wall-time per dispatch, ` +
    `as a relative proxy. Total tracked: ${fmtDur(total)} across ${events.filter((e) => e.ev === 'dispatch').length} dispatches._\n\n` +
    `**By phase (rolled up):**\n\n| phase | calls | time | share |\n|---|---:|---:|---:|\n${phaseRows}\n\n` +
    `**By skill (leaf):**\n\n| skill | calls | time | share |\n|---|---:|---:|---:|\n${leafRows}\n`
  );

  // disarm: keep the log + events for reference, remove the sentinel.
  try { fs.unlinkSync(SENTINEL); } catch {}
  process.stdout.write('twt-debug-log: summarized + disarmed. See .twt-artifacts/site-debug.md\n');
}

// ---- dispatch ------------------------------------------------------------

try {
  const arg = process.argv[2];
  if (arg === '--arm') arm(process.argv.slice(3).join(' '));
  else if (arg === '--summarize') summarize();
  else handleHook();
} catch {
  // never break a run
}
process.exit(0);
