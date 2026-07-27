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

export function finding(p) {
  if (!SEVERITIES.includes(p.severity)) {
    throw new Error(`bad severity "${p.severity}" (expected one of ${SEVERITIES.join(', ')})`);
  }
  // Confidence: Low is never a finding - it belongs in decisions[]. Enforced
  // here so no rule or model pass can smuggle a guess in as a detected fact.
  if (!CONFIDENCES.includes(p.confidence)) {
    throw new Error(`bad confidence "${p.confidence}" (expected High or Medium; Low must become a decision)`);
  }
  if (!OWNERS.includes(p.owner)) {
    throw new Error(`bad owner "${p.owner}" (expected one of ${OWNERS.join(', ')})`);
  }
  if (!CATEGORIES.includes(p.category)) {
    throw new Error(`bad category "${p.category}"`);
  }
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

const linkFor = (url, id) => (url ? `${url}?node-id=${String(id).replace(':', '-')}` : '');

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
      f.link = f.link || linkFor(url, f.nodeIds?.[0] || '');
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
      scope: opts.scope || null,
      scannedAt: new Date().toISOString(),
      dsAuditReport: opts.dsAuditReport || null,
      nodeCount: (facts.nodes || []).length,
      frameCount: (facts.frames || []).length,
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
