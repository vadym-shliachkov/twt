#!/usr/bin/env node
// launch-scan.mjs — Layer 1 of /twt-launch-audit: deterministic evidence.
//
//   node launch-scan.mjs <projectDir> [--url <https://...>]
//
// Writes .twt-artifacts/launch/facts.json and prints a summary + fenced json.
// Exit 0 whenever it ran (evidence, never pass/fail); exit 2 on bad usage.
//
// `layers` is the contract the renderer's failure discipline reads: a module
// that throws is recorded as failed rather than silently omitted, because a
// missing check must never look like a passing one.
'use strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { locate, locateTheme, rel as relTo } from './lib/sources.mjs';
import { harvest } from './launch-audit/harvest.mjs';
import * as content from './launch-audit/scan/content.mjs';
import * as discoverability from './launch-audit/scan/discoverability.mjs';
import * as social from './launch-audit/scan/social.mjs';
import * as legal from './launch-audit/scan/legal.mjs';
import * as analytics from './launch-audit/scan/analytics.mjs';
import * as conversion from './launch-audit/scan/conversion.mjs';
import * as errors from './launch-audit/scan/errors.mjs';
import * as performance from './launch-audit/scan/performance.mjs';
import * as hygiene from './launch-audit/scan/hygiene.mjs';

const MODULES = { content, discoverability, social, legal, analytics, conversion, errors, performance, hygiene };

const projectDir = process.argv[2];
if (!projectDir || projectDir.startsWith('--')) {
  console.error('usage: launch-scan.mjs <projectDir> [--url <https://...>]');
  process.exit(2);
}
const urlIdx = process.argv.indexOf('--url');
const url = urlIdx > -1 ? process.argv[urlIdx + 1] || null : null;

const { html, css, base, kind } = locate(projectDir);
if (!base || html.length === 0) {
  console.log('launch-scan: no built HTML found (looked in site/ and .twt-artifacts/design/mockup/). Build the site or pass a live URL.');
  process.exit(0);
}

const ctx = {
  projectDir, html, css, base, kind, theme: locateTheme(projectDir),
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } },
  lineOf: (text, idx) => { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') n++; return n; },
  rel: (p) => relTo(projectDir, p),
};

const checks = {};
const failed = [];
for (const [name, mod] of Object.entries(MODULES)) {
  try {
    checks[name] = mod.run(ctx);
  } catch (e) {
    failed.push(`${name}: ${e.message}`);
    checks[name] = { counts: {}, findings: [], error: e.message };
  }
}

// Layer B (harvest) is independent of Layer A (scan): harvest() wraps every
// probe internally (harvest.mjs's own `probe()`), so it should only ever
// throw here on a genuine bug in the module itself — not on a missing or
// unreadable artifact, which it already reports as status:"ok"/"partial"
// without throwing. Track that crash separately from `failed` (the scan
// modules' own failure list) so a harvest problem can never flip
// layers.scan to "partial" — only layers.scan gates the report filename.
let harvested = null;
let harvestCrash = null;
try {
  harvested = harvest(ctx);
} catch (e) {
  harvestCrash = e.message;
}

const facts = {
  tool: 'launch-scan',
  version: 1,
  generated: new Date().toISOString(),
  project: projectDir,
  mode: url ? 'local+live' : 'local',
  url,
  sources: { kind, base: ctx.rel(base), html: html.map(ctx.rel), css: css.map(ctx.rel), theme: ctx.theme ? ctx.rel(ctx.theme) : null },
  layers: {
    scan: failed.length ? 'partial' : 'ok',
    harvest: harvested ? harvested.status : 'failed',
    live: 'skipped',
  },
  checks,
  harvest: harvested,
  live: null,
};

const outDir = join(projectDir, '.twt-artifacts', 'launch');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'facts.json'), JSON.stringify(facts, null, 2), 'utf8');

const tally = Object.entries(checks)
  .map(([k, v]) => `${k}=${v.findings.length}`).join('  ');
console.log(`launch-scan: ${tally}  (${html.length} page${html.length === 1 ? '' : 's'} from ${facts.sources.base})`);
if (failed.length) console.log(`layers.scan=partial — ${failed.join('; ')}`);
if (harvestCrash) console.log(`layers.harvest=failed — ${harvestCrash}`);
else if (harvested && harvested.notes.length) console.log(`layers.harvest=${harvested.status} — ${harvested.notes.join('; ')}`);
console.log('```json');
console.log(JSON.stringify(facts, null, 2));
console.log('```');
process.exit(0);
