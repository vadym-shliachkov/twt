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
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { locate, locateTheme, rel as relTo } from './lib/sources.mjs';
import { pageKey, hrefKey, deployPrefix } from './launch-audit/scan/lib/html.mjs';
import { harvest } from './launch-audit/harvest.mjs';
import { checkLive } from './launch-audit/live.mjs';
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
const theme = locateTheme(projectDir);

// The command file's Step 1 admits three kinds of auditable project: a built
// site/mockup, a hello-elementor-* child theme, or a live URL. Bailing on
// `!base` accepted only the first, so an Elementor or URL-only project passed
// Step 1's gate and then got no facts.json at all — exit 0, no findings, and a
// message reading "pass a live URL" printed at a run that HAD passed a live
// URL. A committed .env holding a live Stripe key and WP_DEBUG=true in a
// theme's functions.php both went undetected. Gate on "there is nothing any
// layer could read", not on "there is no local HTML": hygiene reads the
// project root and the theme, errors reads the theme's 404.php, and the eight
// LIVE_MAP rules read the URL — none of them needs a build root.
if (html.length === 0 && !theme && !url) {
  console.log('launch-scan: nothing to audit — no built HTML (site/ or .twt-artifacts/design/mockup/), no hello-elementor-* theme, and no --url. Build the site or pass a live URL.');
  process.exit(0);
}

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// A site can be served under a PATH PREFIX — https://acme.com/outfitters/ —
// and then every URL it writes about itself (internal links, sitemap <loc>s,
// root-relative asset refs) carries a segment that does not exist on disk,
// where the build root IS that prefix. Three separate checks compare a URL
// against a file (sitemap orphans, legal-page reachability, og:image/image
// weight on disk), and making the page keys path-aware broke all three at
// once: a correct 5-page site produced 5 false orphans, 3 false "not linked"s
// and 7 false "og:image resolves to no file"s.
//
// Infer the prefix ONCE, here, from the site's own evidence, and hand it to
// every consumer on ctx — three inferences would be three chances to drift,
// which is the exact failure this branch has now paid for four times.
// deployPrefix() only accepts a prefix that lines MORE pages up than leaving
// it alone, so a genuinely unlisted or genuinely unlinked page is still
// reported and a site served at the root is never "corrected".
function inferDeploy() {
  if (!base || html.length === 0) return '';
  const keys = new Set(html.map((f) => pageKey(relative(base, f))));
  const cands = [];
  for (const f of html) {
    const src = read(f);
    const from = relative(base, f);
    for (const m of src.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
      const k = hrefKey(m[1], from);
      if (k) cands.push(k);
    }
  }
  for (const at of [join(base, 'sitemap.xml'), join(projectDir, 'sitemap.xml')]) {
    if (!existsSync(at)) continue;
    for (const m of read(at).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const k = hrefKey(m[1]);
      if (k) cands.push(k);
    }
    break;
  }
  return deployPrefix(cands, keys);
}

const ctx = {
  projectDir, html, css, base, kind, theme,
  deploy: inferDeploy(),
  read,
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

// Layer C (live) only runs when the user supplied a URL, and only reports
// what a response can actually prove — see live.mjs. checkLive() already
// never throws (an unreachable host is a failed result, not a crash), but
// this wraps the call anyway so a genuine bug in the module degrades the live
// layer instead of taking the whole scan down, same independence rule as the
// harvest layer above: a failed live layer must never flip layers.scan.
let live = null;
if (url) {
  try {
    live = await checkLive(url);
  } catch (e) {
    live = { status: 'failed', url, checks: {}, findings: [{ kind: 'unreachable', file: url, line: 0, detail: e.message }] };
  }
}

const facts = {
  tool: 'launch-scan',
  version: 1,
  generated: new Date().toISOString(),
  project: projectDir,
  mode: url ? 'local+live' : 'local',
  url,
  // `deploy` is recorded because it is INFERRED: a wrong inference would move
  // three checks at once, and a fact nobody can see is a fact nobody can
  // challenge. null means "served at the root", the un-inferred default.
  sources: { kind, base: ctx.rel(base), html: html.map(ctx.rel), css: css.map(ctx.rel), theme: ctx.theme ? ctx.rel(ctx.theme) : null, deploy: ctx.deploy || null },
  layers: {
    scan: failed.length ? 'partial' : 'ok',
    harvest: harvested ? harvested.status : 'failed',
    live: live ? live.status : 'skipped',
  },
  checks,
  harvest: harvested,
  live,
};

const outDir = join(projectDir, '.twt-artifacts', 'launch');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'facts.json'), JSON.stringify(facts, null, 2), 'utf8');

const tally = Object.entries(checks)
  .map(([k, v]) => `${k}=${v.findings.length}`).join('  ');
// Name what was actually read. A theme-only or URL-only run has no build root,
// and printing "0 pages from null" hides which layers had anything to work on.
const from = [
  base ? `${html.length} page${html.length === 1 ? '' : 's'} from ${facts.sources.base}` : null,
  theme ? `theme ${facts.sources.theme}` : null,
  url ? `live ${url}` : null,
].filter(Boolean).join(', ') || 'nothing';
console.log(`launch-scan: ${tally}  (${from})`);
if (failed.length) console.log(`layers.scan=partial — ${failed.join('; ')}`);
if (harvestCrash) console.log(`layers.harvest=failed — ${harvestCrash}`);
else if (harvested && harvested.notes.length) console.log(`layers.harvest=${harvested.status} — ${harvested.notes.join('; ')}`);
console.log('```json');
console.log(JSON.stringify(facts, null, 2));
console.log('```');
process.exit(0);
