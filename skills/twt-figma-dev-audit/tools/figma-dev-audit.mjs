#!/usr/bin/env node
// figma-dev-audit.mjs - deterministic rule engine for /twt-figma-dev-audit.
//
// Layer 2 of four: facts.json (from tools/figma-dev-audit/scan.js) in,
// findings.json out. Everything emitted here is Confidence: High, because it
// was measured rather than inferred. The skill body adds the Medium-confidence
// findings and the impact/action prose afterwards.
//
// Usage:
//   node tools/figma-dev-audit.mjs <facts.json> --out <dir> [--platform web|wordpress] [--url <figma-url>]
//   node tools/figma-dev-audit.mjs --self-test
//
// Exit 2 on a missing or unreadable facts file.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { RULES } from './figma-dev-audit/rules/index.mjs';

export const SEVERITIES = ['Blocker', 'High', 'Medium', 'Low'];
export const CONFIDENCES = ['High', 'Medium'];
export const OWNERS = ['Designer', 'Client', 'Developer', 'Content team', 'Product owner'];

export const CATEGORIES = [
  'Fonts',
  'Responsive coverage',
  'Auto Layout & sizing',
  'Components & code mapping',
  'States',
  'Forms',
  'Assets & exports',
  'Effects & implementation cost',
  'Interaction, flows & animation',
  'Content flexibility & a11y risk',
  'Handoff hygiene',
  'Platform/CMS risk',
];

// The single implementation of the vocabulary contract, called from BOTH
// ends of the pipeline. finding() guards what the rules construct, and
// figma-dev-report.mjs guards what it is handed - because Layer 3 (the model
// pass) writes findings.json directly and never goes through finding(). Two
// copies of these checks would drift, and the one that drifted would be the
// one guarding the layer a human wrote.
export function validateFinding(p) {
  const at = p?.id || p?.rule || '(unidentified finding)';
  if (!SEVERITIES.includes(p?.severity)) {
    throw new Error(`${at}: bad severity "${p?.severity}" (expected one of ${SEVERITIES.join(', ')})`);
  }
  // Confidence: Low is never a finding - it belongs in decisions[]. Enforced
  // here so no rule or model pass can smuggle a guess in as a detected fact.
  if (!CONFIDENCES.includes(p.confidence)) {
    throw new Error(`${at}: bad confidence "${p.confidence}" (expected High or Medium; Low must become a decision)`);
  }
  if (!OWNERS.includes(p.owner)) {
    throw new Error(`${at}: bad owner "${p.owner}" (expected one of ${OWNERS.join(', ')})`);
  }
  if (!CATEGORIES.includes(p.category)) {
    throw new Error(`${at}: bad category "${p.category}"`);
  }
  return p;
}

export function finding(p) {
  validateFinding(p);
  return {
    id: `${p.rule}-${(p.nodeIds || [])[0] || 'file'}`,
    rule: p.rule,
    title: p.title,
    category: p.category,
    severity: p.severity,
    confidence: p.confidence,
    nodeIds: p.nodeIds || [],
    location: p.location || { page: '', frame: '', layers: [] },
    link: p.link || '',
    detected: p.detected,
    impact: null,
    action: null,
    owner: p.owner,
    blocking: p.severity === 'Blocker',
    source: 'rule',
  };
}

// The normal way a user supplies a Figma URL is to copy it from the browser,
// which means it already carries "?node-id=0-1&t=...". Appending a second "?"
// makes the browser read the whole tail as one parameter value, so EVERY
// finding deep-links to the same wrong node. Strip query and hash first.
//
// Every colon must go, not just the first: an instance descendant's id looks
// like "I423:12;9:8" and Figma's URL form is "I423-12;9-8". AL001, A11Y001,
// CM004 and HY002 all commonly fire inside instances.
export const linkFor = (url, id) => (url ? `${String(url).split(/[?#]/)[0]}?node-id=${String(id).replace(/:/g, '-')}` : '');

// A finding with no node (FN002 counts fonts across the whole file) gets the
// file link, not a dangling "...?node-id=".
export const fileLink = (url) => (url ? String(url).split(/[?#]/)[0] : '');

export function evaluate(facts, opts = {}) {
  const url = opts.url || facts.file?.url || '';
  const ctx = {
    platform: opts.platform || 'web',
    url,
    byId: new Map((facts.nodes || []).map((n) => [n.id, n])),
  };

  const findings = [];
  const decisions = [];
  for (const rule of RULES) {
    const out = rule.run(facts, ctx) || [];
    for (const f of out) {
      const first = ctx.byId.get(f.nodeIds?.[0]);
      f.link = f.link || (f.nodeIds?.[0] ? linkFor(url, f.nodeIds[0]) : fileLink(url));
      if (first && !f.location.page) {
        f.location = {
          page: first.page,
          frame: first.frame,
          layers: f.nodeIds.map((id) => ctx.byId.get(id)?.name).filter(Boolean),
        };
      }
      findings.push(f);
    }
    for (const d of rule.decisions?.(facts, ctx) || []) decisions.push(d);
  }

  const order = (f) => SEVERITIES.indexOf(f.severity);
  findings.sort((a, b) => order(a) - order(b) || a.category.localeCompare(b.category));

  return {
    meta: {
      file: facts.file?.name || '',
      url,
      platform: ctx.platform,
      // facts.file.scope is what the scan actually walked; the flag is what
      // the caller asked for. Falling back to the facts means a report can
      // never present a scoped scan as a whole-file one just because Step 3
      // forgot to repeat the flag.
      scope: opts.scope || facts.file?.scope || null,
      scannedAt: new Date().toISOString(),
      dsAuditReport: opts.dsAuditReport || null,
      // The file's size, not the sample's. The scan returns only nodes a rule
      // could fire on; reporting facts.nodes.length here would tell a reader
      // an 84,704-node file has 3,000 nodes in it.
      nodeCount: facts.totals?.nodes ?? (facts.nodes || []).length,
      frameCount: (facts.frames || []).length,
      // How this report was produced. Written here and nowhere else: a
      // findings.json that reaches the renderer without it did not come from
      // this engine, and the renderer says so rather than presenting model
      // judgment in the shape of a measured scan.
      method: 'rule-engine',
      sampleCount: (facts.nodes || []).length,
      truncated: facts.limits?.truncated === true,
      // Only the reasons that actually sampled - a rule that returned
      // everything it matched has nothing to disclose.
      sampling: Object.fromEntries(Object.entries(facts.limits?.sampled || {})
        .filter(([, s]) => s.matched > s.kept)),
    },
    findings,
    decisions,
  };
}

function runSelfTest() {
  assert.throws(() => finding({ rule: 'X', title: 't', category: CATEGORIES[0],
    severity: 'Nope', confidence: 'High', owner: 'Designer', detected: 'd' }), /severity/);
  assert.throws(() => finding({ rule: 'X', title: 't', category: CATEGORIES[0],
    severity: 'High', confidence: 'Low', owner: 'Designer', detected: 'd' }), /confidence/);
  const empty = evaluate({ file: { name: 'x' }, frames: [], nodes: [] }, { platform: 'web' });
  assert.equal(empty.findings.length, 0);
  assert.equal(empty.meta.platform, 'web');
  console.log('figma-dev-audit self-test: OK');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return runSelfTest();

  const flag = (name, dflt = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const factsPath = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);
  const outDir = flag('out');
  if (!factsPath || !outDir) {
    console.error('usage: node tools/figma-dev-audit.mjs <facts.json> --out <dir> [--platform web|wordpress] [--url <figma-url>]');
    process.exit(2);
  }

  let facts;
  try {
    facts = JSON.parse(readFileSync(factsPath, 'utf8'));
  } catch (e) {
    console.error(`cannot read facts file ${factsPath}: ${e.message}`);
    process.exit(2);
  }

  const result = evaluate(facts, {
    platform: flag('platform', 'web'),
    url: flag('url'),
    scope: flag('scope'),
    dsAuditReport: flag('ds-audit'),
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'findings.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(`findings: ${result.findings.length} | decisions: ${result.decisions.length} -> ${join(outDir, 'findings.json')}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('figma-dev-audit.mjs')) {
  main();
}
