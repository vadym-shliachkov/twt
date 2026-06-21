#!/usr/bin/env node
/**
 * twt-run-trace — always-on dispatch tracer for /twt-site and /twt-site-dev.
 *
 * (Formerly the opt-in `--log` debug tracer. It is now armed automatically by the
 * site orchestrators at the start of a run and summarized at the end — no flag.)
 *
 * Three modes:
 *   1. --arm "<label>"     create the sentinel + reset the event log.
 *   2. (stdin JSON)        PreToolUse / PostToolUse handler (Task + Skill + AskUserQuestion).
 *   3. --summarize         render the full dispatch trace + wall-time cost table
 *                          into .twt-artifacts/site-log.md, then disarm.
 *
 * It is INERT unless armed: every hook invocation first checks for the sentinel
 * at <project>/.twt-artifacts/.twt-debug/active.json and exits 0 silently if it
 * is absent. So any non-site session is completely unaffected — the orchestrators
 * arm it only for their own runs; nothing else writes .twt-artifacts.
 *
 * COVERAGE: captures EVERY skill/subagent the run touches — twt phase wrappers
 * (dispatched via the Task/Agent tool) AND any other Skill-tool call (other
 * plugins, superpowers, system skills) — each with its WHY (tool input) and
 * wall-time. There is intentionally NO token column: Claude Code does not expose
 * per-subagent token usage to hooks, and subagent tool calls do not appear in the
 * parent transcript. Wall-time is the honest cost proxy; treat shares as relative.
 *
 * Never throws out of the top level — any failure exits 0 so it can never break a
 * run (same safety posture as twt-scope-guard).
 *
 * Output (human): folded into <project>/.twt-artifacts/site-log.md at --summarize.
 * Output (machine): <project>/.twt-artifacts/.twt-debug/events.jsonl (run scratch).
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
// The trace is folded into the single user-facing run log (site-log.md for
// /twt-site; site-dev-log.md for /twt-site-dev — chosen via the --arm label).
function logMd() {
  const label = (readJson(SENTINEL, {}) || {}).label || 'site';
  const file = /site-dev/.test(label) ? 'site-dev-log.md' : 'site-log.md';
  return path.join(ROOT, '.twt-artifacts', file);
}

// ---- tiny helpers --------------------------------------------------------

function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; } }
function writeJson(p, o) { try { fs.writeFileSync(p, JSON.stringify(o)); } catch {} }
function appendMd(file, s) { try { fs.appendFileSync(file, s); } catch {} }
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
  if (n === 'twt-site' || n === 'twt-site-dev') return 'orchestrator';
  if (/^twt-(content|brand|spec|positioning|ia|curation|pre-design)/.test(n)) return 'pre-design';
  if (/^twt-(design$|design-system|component|layout|mockup|design)/.test(n)) return 'design';
  if (/^twt-(develop|html|elementor|content-approval)/.test(n)) return 'development';
  if (/^twt-qa/.test(n)) return 'qa';
  if (/^twt-/.test(n)) return 'other-twt';
  return 'external'; // superpowers / figma / system / other plugins
};

// Pull the dispatched skill name + a one-line "why" out of a Task prompt.
function parseDispatch(input) {
  const prompt = (input && (input.prompt || input.description)) || '';
  const text = String(prompt);
  const skillM = text.match(/\/?twt-[a-z0-9-]+/);
  const skill = skillM ? skillM[0].replace(/^\//, '') : (input && input.subagent_type ? input.subagent_type : 'task');
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

// Pull skill name + why out of a Skill-tool call.
function parseSkill(input) {
  const skill = (input && (input.skill || input.name)) || 'skill';
  let why = (input && (input.args || input.arguments || '')) || '';
  why = String(why).replace(/\s+/g, ' ').trim();
  if (why.length > 160) why = why.slice(0, 157) + '…';
  return { skill: String(skill), why };
}

// ---- modes ---------------------------------------------------------------

function arm(label) {
  try { fs.mkdirSync(DBG_DIR, { recursive: true }); } catch {}
  const runId = Date.now().toString(36);
  writeJson(SENTINEL, { runId, started: nowIso(), label: label || 'site' });
  writeJson(STATE, { open: 0, stack: [] });
  try { fs.writeFileSync(EVENTS, ''); } catch {}
  process.stdout.write('twt-run-trace: armed (run ' + runId + ')\n');
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

  if (ev === 'PreToolUse' && (tool === 'Task' || tool === 'Agent')) {
    const { skill, why } = parseDispatch(input);
    const depth = state.open + 1;
    state.stack.push({ skill, t0: Date.now() });
    state.open += 1;
    writeJson(STATE, state);
    appendEvent({ ev: 'dispatch', kind: 'task', skill, why, depth, t0: Date.now(), ts: hms() });
  } else if (ev === 'PostToolUse' && (tool === 'Task' || tool === 'Agent')) {
    const { skill } = parseDispatch(input);
    let elapsed = null;
    for (let i = state.stack.length - 1; i >= 0; i--) {
      if (state.stack[i].skill === skill) { elapsed = Date.now() - state.stack[i].t0; state.stack.splice(i, 1); break; }
    }
    state.open = Math.max(0, state.open - 1);
    writeJson(STATE, state);
    appendEvent({ ev: 'done', kind: 'task', skill, elapsed, ts: hms() });
  } else if (ev === 'PreToolUse' && tool === 'Skill') {
    const { skill, why } = parseSkill(input);
    appendEvent({ ev: 'dispatch', kind: 'skill', skill, why, depth: state.open + 1, t0: Date.now(), ts: hms() });
  } else if (ev === 'PostToolUse' && tool === 'Skill') {
    const { skill } = parseSkill(input);
    appendEvent({ ev: 'done', kind: 'skill', skill, elapsed: null, ts: hms() });
  } else if (ev === 'PreToolUse' && tool === 'AskUserQuestion') {
    const qs = (input && input.questions) || [];
    appendEvent({ ev: 'ask', questions: qs.map((q) => ({ header: q.header || '', question: (q.question || '').slice(0, 110) })), ts: hms() });
  } else if (ev === 'PostToolUse' && tool === 'AskUserQuestion') {
    let answers = '';
    try {
      const r = typeof resp === 'string' ? JSON.parse(resp) : resp;
      const a = (r && (r.answers || r)) || {};
      answers = Object.entries(a).map(([k, v]) => `${k} → ${v}`).join(' · ');
    } catch { answers = typeof resp === 'string' ? resp.slice(0, 200) : ''; }
    appendEvent({ ev: 'answer', answers, ts: hms() });
  }
}

function summarize() {
  if (!armed()) { process.stdout.write('twt-run-trace: not armed — nothing to summarize\n'); return; }
  const LOG = logMd();
  const events = [];
  try {
    for (const l of fs.readFileSync(EVENTS, 'utf8').split('\n')) {
      if (l.trim()) { try { events.push(JSON.parse(l)); } catch {} }
    }
  } catch {}

  // ---- render the chronological dispatch trace (every skill, any source) ----
  let trace = '';
  let depth = 0;
  for (const e of events) {
    if (e.ev === 'dispatch') {
      const indent = '  '.repeat(Math.max(0, depth));
      const tag = e.kind === 'skill' ? 'skill' : 'task';
      trace += `${indent}- \`▶ ${e.ts || ''}\` **${e.skill}** _(${tag})_ — ${e.why || '(no context)'}\n`;
      if (e.kind === 'task') depth += 1;
    } else if (e.ev === 'done') {
      if (e.kind === 'task') depth = Math.max(0, depth - 1);
      const indent = '  '.repeat(Math.max(0, depth));
      if (e.elapsed != null) trace += `${indent}  \`✔ ${e.ts || ''}\` ${e.skill} (${fmtDur(e.elapsed)})\n`;
    } else if (e.ev === 'ask') {
      const indent = '  '.repeat(Math.max(0, depth));
      const heads = (e.questions || []).map((q) => q.header || q.question).join(' · ');
      trace += `${indent}- \`❓ ${e.ts || ''}\` ${heads}\n`;
    } else if (e.ev === 'answer') {
      const indent = '  '.repeat(Math.max(0, depth));
      if (e.answers) trace += `${indent}  \`✅\` ${e.answers}\n`;
    }
  }

  // ---- cost tables (wall-time proxy) ----
  const per = new Map(); // skill -> {ms, calls}
  for (const e of events) {
    if (e.ev === 'dispatch') {
      const r = per.get(e.skill) || { ms: 0, calls: 0 }; r.calls += 1; per.set(e.skill, r);
    } else if (e.ev === 'done' && e.elapsed != null) {
      const r = per.get(e.skill) || { ms: 0, calls: 0 }; r.ms += e.elapsed; per.set(e.skill, r);
    }
  }
  const total = [...per.values()].reduce((a, b) => a + b.ms, 0) || 1;
  const pct = (ms) => ((ms / total) * 100).toFixed(1).padStart(5) + '%';
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
  const dispatches = events.filter((e) => e.ev === 'dispatch').length;

  appendMd(LOG,
    `\n### Dispatch trace — every skill called (auto-captured)\n\n` +
    `_Hook-captured chronological trace of every Task/Agent dispatch and Skill call ` +
    `(twt + any other plugin / superpowers / system skill), each with its WHY and wall-time._\n\n` +
    (trace || '_(no dispatches captured)_\n') +
    `\n#### Cost (wall-time proxy — NOT token counts)\n\n` +
    `_Per-skill token usage is not exposed to hooks; wall-time per dispatch is the relative proxy. ` +
    `Total tracked: ${fmtDur(total)} across ${dispatches} dispatches._\n\n` +
    `**By phase:**\n\n| phase | calls | time | share |\n|---|---:|---:|---:|\n${phaseRows}\n\n` +
    `**By skill:**\n\n| skill | calls | time | share |\n|---|---:|---:|---:|\n${leafRows}\n`
  );

  // disarm: keep events.jsonl for reference, remove the sentinel.
  try { fs.unlinkSync(SENTINEL); } catch {}
  process.stdout.write('twt-run-trace: trace + cost folded into ' + path.basename(LOG) + '; disarmed.\n');
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
