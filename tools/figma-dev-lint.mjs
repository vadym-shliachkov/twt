#!/usr/bin/env node
// figma-dev-lint.mjs - the gate between the model pass and the renderer.
//
// Layer 3 of /twt-figma-dev-audit writes findings.json BY HAND. Everything the
// schema requires was, until this file existed, enforced by prose in the skill
// asking the model to remember ten fields, rebuild a deep link with every
// colon replaced, keep `blocking` in step with `severity`, and re-sort the
// array before writing. Prose does not survive a 24-finding run - the first
// real one shipped 16 findings at a confidence the same document forbade.
//
// So this does two jobs, in this order:
//
//   --fix   DERIVE the six fields nobody should be typing: id, link, location,
//           blocking, source, and the sort order. The model is then only
//           responsible for judgment - title, category, severity, confidence,
//           nodeIds, detected, impact, action, owner.
//   lint    CHECK what is left, including the four things validateFinding()
//           does not: a missing impact or action (which the report silently
//           prints as "not yet assessed"), a location missing its keys, a shot
//           path that resolves to no file on disk, and a decision with no owner.
//
// Usage:
//   node tools/figma-dev-lint.mjs <out-dir> [--fix]
//   node tools/figma-dev-lint.mjs --self-test
//
// Exit 0 clean (warnings allowed), 1 on any error, 2 on usage or IO failure.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import {
  CATEGORIES, SEVERITIES, CONFIDENCES, OWNERS, validateFinding, linkFor, fileLink,
} from './figma-dev-audit.mjs';

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

// The scan matches ONE case-insensitive substring against page and top-level
// frame names, and both renderers print `scope` as "only pages and frames
// matching this were scanned". A comma-separated list of four frames matches
// nothing; a sentence of method notes turns that coverage statement into a
// false one. The skill says "never put a method note in --scope" twice, in
// bold, and a real run did it anyway - prose does not hold a field down.
const SCOPE_MAX = 80;
// Shape before length: "it lists several names" tells the author what to do,
// "it is 87 characters" only tells them to trim, and trimming a four-frame
// list to 80 characters leaves it just as unmatchable.
const scopeProblem = (s) => {
  if (/\n/.test(s)) return 'it spans multiple lines';
  if (/,\s/.test(s)) return 'it lists several names — the scan matches one substring, so a list matches nothing';
  if (/\.\s+\S/.test(s)) return 'it contains prose — method notes belong in meta.method, not in the coverage statement';
  if (s.length > SCOPE_MAX) return `it is ${s.length} characters (max ${SCOPE_MAX})`;
  return null;
};

// Font licensing is not in the Figma file. FN001 returns [] for exactly this
// reason ("the single rule that keeps the report honest") - but that invariant
// lived only in a comment inside a rule file, which the model-only path never
// executes and no reader of the skill ever sees. Enforced here instead.
const LICENSING = /licen[cs]|licencing|licensing/i;

// Owned by /twt-design-system-audit. Two reports contradicting each other in
// front of one client is the failure this boundary exists to prevent.
const DS_TOPIC = /\btokens?\b|design token|spacing scale|radius scale|colour palette|color palette|duplicate components?/i;

// Every link this finding is allowed to carry: one of its own nodes, or the
// bare file link for a file-level finding that cites none.
const acceptableLinks = (url, f) => ((f.nodeIds || []).length
  ? f.nodeIds.map((id) => linkFor(url, id))
  : [fileLink(url)]);

// ---------------------------------------------------------------------------
// Normalise

// The same formula finding() uses, plus a suffix when two findings share a
// first node - two entries under one id would collide on the report's anchors
// and one of the two links would land on the wrong finding.
function assignIds(findings) {
  const seen = new Set();
  let changed = 0;
  for (const f of findings) {
    if (!isText(f.rule)) { f.rule = 'MODEL'; changed += 1; }
    let id = isText(f.id) ? f.id : `${f.rule}-${(f.nodeIds || [])[0] || 'file'}`;
    if (seen.has(id)) {
      let n = 2;
      while (seen.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    if (f.id !== id) { f.id = id; changed += 1; }
    seen.add(id);
  }
  return changed;
}

export function normalise(data, facts = null) {
  const url = data.meta?.url || '';
  const byId = new Map((facts?.nodes || []).map((n) => [n.id, n]));
  const counts = { id: 0, link: 0, location: 0, blocking: 0, source: 0, sorted: 0 };

  for (const f of data.findings || []) {
    if (!isText(f.rule)) { f.rule = 'MODEL'; counts.id += 1; }
    if (!isText(f.source)) { f.source = f.rule === 'MODEL' ? 'model' : 'rule'; counts.source += 1; }

    // The invariant is that a finding links to a node it actually cites -
    // not that it links to the FIRST one. A model listing the containing
    // section first and linking to the specific control is making a better
    // choice for the reader than nodeIds[0] would, and rewriting it would
    // retarget a correct link. Anything outside the cited set is rebuilt: a
    // link to an uncited node, or one with an un-replaced colon in an
    // instance id like "I423:12;9:8", is wrong in a way nobody notices until
    // a reader clicks it and lands somewhere else.
    if (url && !acceptableLinks(url, f).includes(f.link)) {
      f.link = f.nodeIds?.[0] ? linkFor(url, f.nodeIds[0]) : fileLink(url);
      counts.link += 1;
    }

    const loc = f.location && typeof f.location === 'object' ? f.location : {};
    const first = byId.get(f.nodeIds?.[0]);
    // Only fill what is empty. Under reduction the scan returns a sample, so a
    // model finding can legitimately cite a node that is not in facts.json -
    // its hand-written location is then the only one there is.
    if (!isText(loc.page) && first) {
      f.location = {
        page: first.page,
        frame: first.frame,
        layers: (f.nodeIds || []).map((id) => byId.get(id)?.name).filter(Boolean),
      };
      counts.location += 1;
    } else if (!f.location || !('page' in loc) || !('frame' in loc) || !Array.isArray(loc.layers)) {
      f.location = { page: loc.page ?? '', frame: loc.frame ?? '', layers: loc.layers ?? [] };
      counts.location += 1;
    }

    // Two fields carrying one fact. Severity is the authority; a non-Blocker
    // may still opt in, which is why this is not a plain assignment.
    const want = f.severity === 'Blocker' ? true : f.blocking === true;
    if (f.blocking !== want) { f.blocking = want; counts.blocking += 1; }

    if (f.impact === undefined) f.impact = null;
    if (f.action === undefined) f.action = null;
  }

  // The renderer's per-category cap is a priority queue, so an unsorted High
  // buried after five Mediums is the one that gets withheld.
  const order = (f) => {
    const i = SEVERITIES.indexOf(f.severity);
    return i < 0 ? SEVERITIES.length : i;
  };
  const before = data.findings || [];
  const sorted = [...before]
    .sort((a, b) => order(a) - order(b) || String(a.category).localeCompare(String(b.category)));
  if (sorted.some((f, i) => f !== before[i])) counts.sorted = 1;
  data.findings = sorted;

  // Ids are assigned after the sort, so a re-run produces the same ids in the
  // same order. They are the report's anchors, and an anchor that moves
  // between runs breaks every link anyone has already shared.
  counts.id += assignIds(data.findings);

  data.decisions = data.decisions || [];
  for (const [i, d] of data.decisions.entries()) {
    if (!isText(d.id)) d.id = `DECISION-${i + 1}`;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Lint

export function lint(data, { facts = null, outDir = null } = {}) {
  const problems = [];
  const err = (where, msg) => problems.push({ level: 'error', where, msg });
  const warn = (where, msg) => problems.push({ level: 'warning', where, msg });
  const url = data.meta?.url || '';
  const byId = new Map((facts?.nodes || []).map((n) => [n.id, n]));

  if (!isText(url)) err('meta', 'meta.url is missing — every deep link in the report depends on it');
  const modelOnly = data.meta?.method !== 'rule-engine';
  if (modelOnly) {
    warn('meta', `method is "${data.meta?.method ?? 'absent'}" — the report renders as `
      + 'readiness-report-provisional.md, titled "Provisional developer readiness". Correct if the engine did run.');
  }

  const scope = data.meta?.scope;
  if (isText(scope)) {
    const why = scopeProblem(scope.trim());
    if (why) {
      err('meta', `meta.scope is not a scan scope: ${why}. It must be the single page or frame `
        + 'substring the scan was given (or null for a whole-file run) — the report prints it as '
        + '"only pages and frames matching this were scanned", so anything else makes that statement false.');
    }
  }

  // A number nobody can check is not evidence. On a run with no facts.json on
  // disk there is nothing to check ANY number against, so High confidence has
  // no basis - the digit heuristic below only tests that a digit was typed.
  // Step 2b's counts-only facts.json is the way to keep High legitimately.
  if (modelOnly && !facts && (data.findings || []).some((f) => f.confidence === 'High')) {
    err('meta', 'High-confidence findings on a run with no facts.json — nothing in this report can be '
      + 'reproduced or checked. Write the counts-only facts.json from the metadata probe (Step 2b), '
      + 'or drop those findings to Medium.');
  }

  const perCategory = {};
  for (const f of data.findings || []) {
    const at = f.id || f.title || '(unidentified finding)';

    // The vocabulary contract, from its single implementation.
    try { validateFinding(f); } catch (e) { err(at, e.message.replace(`${at}: `, '')); }

    if (!isText(f.title)) err(at, 'title is empty');
    if (!isText(f.detected)) err(at, 'detected is empty — a finding with no evidence is a guess');
    if (!isText(f.impact)) err(at, 'impact is empty — Step 4a leaves it null and the report prints "not yet assessed"');
    if (!isText(f.action)) err(at, 'action is empty — Step 4a leaves it null and the report prints "not yet assessed"');
    if (!Array.isArray(f.nodeIds)) err(at, 'nodeIds is not an array');
    else if (f.nodeIds.some((n) => !isText(n))) err(at, 'nodeIds contains a non-string entry');

    const loc = f.location;
    if (!loc || typeof loc !== 'object' || !('page' in loc) || !('frame' in loc) || !Array.isArray(loc.layers)) {
      err(at, 'location must be an object with page, frame and layers (use empty values for a file-level finding)');
    }

    if (f.severity === 'Blocker' && f.blocking !== true) {
      err(at, 'severity is Blocker but blocking is not true — the Summary would count a Blocker while '
        + '"Blocking issues" said None');
    }

    if (url && !acceptableLinks(url, f).includes(f.link)) {
      err(at, `link points at a node this finding does not cite ("${f.link}") — it must target one of `
        + `${(f.nodeIds || []).join(', ') || 'the file itself'}. Run with --fix.`);
    }

    // A cited node that the scan never returned. Not an error: the scan
    // returns only rule-relevant nodes, so a model finding about a frame full
    // of vectors legitimately points outside the sample.
    if (facts && f.nodeIds?.[0] && !byId.get(f.nodeIds[0])) {
      warn(at, `node ${f.nodeIds[0]} is not in facts.json — location and layer names could not be verified`);
    }

    if (f.shot !== undefined && f.shot !== null) {
      if (typeof f.shot !== 'string' || !f.shot.startsWith('shots/') || f.shot.includes('..')) {
        err(at, `shot "${f.shot}" is not a relative path inside shots/ — the renderer drops it silently`);
      } else if (outDir && !existsSync(join(outDir, f.shot))) {
        err(at, `shot "${f.shot}" resolves to no file — the screenshot was captured under a different name`);
      }
    }

    if (f.source === 'model' && f.confidence === 'High' && !/\d/.test(String(f.detected))) {
      warn(at, 'confidence High on a model finding whose evidence cites no measured number — '
        + 'confidence follows the evidence, not the authorship');
    }

    // Topic boundaries, checked on what the reader sees rather than on the
    // category alone: a licensing claim is just as wrong dressed as Handoff
    // hygiene, and a token finding is out of scope wherever it is filed.
    const claim = `${f.title} ${f.detected}`;
    if (LICENSING.test(claim)) {
      err(at, 'this finding makes a font-licensing claim. Licensing is not recorded in the Figma file, '
        + 'so it can only ever be a guess — FN001 returns no finding for it by design. Move it to '
        + 'decisions[] as a question for the Client.');
    }
    if (DS_TOPIC.test(claim)) {
      warn(at, 'this reads as a design-system finding (tokens, scales, palette, duplicate components) — '
        + 'that is /twt-design-system-audit\'s territory, and two reports disagreeing in front of one '
        + 'client is what the boundary exists to prevent');
    }

    if (CATEGORIES.includes(f.category)) {
      perCategory[f.category] = (perCategory[f.category] || 0) + 1;
    }
  }

  for (const [cat, n] of Object.entries(perCategory)) {
    if (n > 5) warn(cat, `${n} findings — the report shows 5 and states the rest as withheld`);
  }

  for (const [i, d] of (data.decisions || []).entries()) {
    const at = d.id || `decision ${i + 1}`;
    if (!isText(d.question)) err(at, 'question is empty');
    if (!isText(d.why)) err(at, 'why is empty — it must say why the file cannot answer it');
    if (!OWNERS.includes(d.owner)) err(at, `bad owner "${d.owner}" (expected one of ${OWNERS.join(', ')})`);
  }

  return problems;
}

// ---------------------------------------------------------------------------

function runSelfTest() {
  const bad = {
    meta: { url: 'https://figma.com/design/K/T?node-id=0-1&t=x', method: 'rule-engine' },
    findings: [{
      rule: 'MODEL', title: 't', category: CATEGORIES[0], severity: 'Blocker',
      confidence: CONFIDENCES[0], nodeIds: ['I423:12;9:8'], detected: 'the frame is 390x1647',
      impact: 'i', action: 'a', owner: OWNERS[0],
    }],
    decisions: [],
  };
  normalise(bad);
  const f = bad.findings[0];
  assert.equal(f.link, 'https://figma.com/design/K/T?node-id=I423-12;9-8');
  assert.equal(f.blocking, true);
  assert.equal(f.source, 'model');
  assert.equal(f.id, 'MODEL-I423:12;9:8');
  assert.deepEqual(lint(bad), []);

  const errorsOf = (d, opts) => lint(d, opts).filter((p) => p.level === 'error').map((p) => p.msg);
  const clone = () => JSON.parse(JSON.stringify(bad));

  // The scope a real run wrote: four frame names plus a sentence of method
  // notes, rendered as "only pages and frames matching this were scanned".
  const scoped = clone();
  scoped.meta.scope = 'D_Landing Page_V5 (198:3), M_Landing Page (159:3). File-wide counts cover all 23 items.';
  assert.match(errorsOf(scoped).join('\n'), /meta\.scope is not a scan scope: it lists several names/);
  const okScope = clone();
  okScope.meta.scope = 'Pricing';
  assert.deepEqual(errorsOf(okScope), []);

  // High confidence with no facts.json on disk: nothing to check the number against.
  const noFacts = clone();
  noFacts.meta.method = 'model-only';
  assert.match(errorsOf(noFacts, { facts: null }).join('\n'), /nothing in this report can be reproduced/);
  assert.deepEqual(errorsOf(noFacts, { facts: { nodes: [] } }), []);

  // Licensing is never a finding - FN001 returns [] for this reason.
  const licence = clone();
  licence.findings[0].title = 'Two typefaces with no web licence decided';
  assert.match(errorsOf(licence).join('\n'), /font-licensing claim/);

  console.log('figma-dev-lint self-test: OK');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return runSelfTest();

  const fix = argv.includes('--fix');
  const outDir = argv.find((a) => !a.startsWith('--'));
  if (!outDir) {
    console.error('usage: node tools/figma-dev-lint.mjs <out-dir> [--fix]');
    process.exit(2);
  }

  const findingsPath = join(outDir, 'findings.json');
  let data;
  try {
    data = JSON.parse(readFileSync(findingsPath, 'utf8'));
  } catch (e) {
    console.error(`cannot read ${findingsPath}: ${e.message}`);
    process.exit(2);
  }

  // facts.json is optional on purpose: a model-only run has none, and this
  // gate is exactly the run that needs checking most.
  let facts = null;
  const factsPath = join(outDir, 'facts.json');
  if (existsSync(factsPath)) {
    try { facts = JSON.parse(readFileSync(factsPath, 'utf8')); } catch { facts = null; }
  }

  if (fix) {
    const c = normalise(data, facts);
    writeFileSync(findingsPath, JSON.stringify(data, null, 2), 'utf8');
    const done = Object.entries(c).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(' ');
    console.log(`--fix: ${done || 'nothing to derive'}`);
  }

  const problems = lint(data, { facts, outDir });
  for (const p of problems) console.log(`${p.level.toUpperCase().padEnd(7)} ${p.where}: ${p.msg}`);

  const errors = problems.filter((p) => p.level === 'error').length;
  const warnings = problems.length - errors;
  console.log(`${data.findings?.length ?? 0} findings, ${data.decisions?.length ?? 0} decisions — `
    + `${errors} error(s), ${warnings} warning(s)`);
  if (errors) process.exit(1);
}

if (process.argv[1]?.endsWith('figma-dev-lint.mjs')) main();
