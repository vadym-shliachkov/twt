#!/usr/bin/env node
// block-map.mjs — /twt-block-map entry point.
//
// STDOUT CONTRACT: counts, paths, warnings. At most ~40 lines. This script
// must never print an artifact it wrote — that is exactly the failure mode
// measured in tools/ds-audit.mjs: it writes audit.json to disk and then
// dumps the identical content to stdout, 206-502 KB (~60k-130k tokens) per
// invocation, for data already sitting on disk. There is no --json dump
// mode here, on purpose.
'use strict';
import { resolve } from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fromDir, fromUrl, fromFigmaExport } from './block-map/acquire.mjs';
import { parseHtml } from './block-map/parse.mjs';
import { walkWithPlaywright } from './block-map/playwright-walk.mjs';
import { extractBlocks } from './block-map/extract.mjs';
import { cluster, applyDecisions } from './block-map/identity.mjs';
import { emitAll } from './block-map/emit.mjs';
import { renderReport } from './block-map/report.mjs';

const USAGE = 'usage: block-map.mjs <url|dir|figma-export.json> [--out <dir>] [--max <n>] [--depth <n>] [--static] [--decisions <path>]';

// --- argument parsing --------------------------------------------------------
//
// The brief's reference sketch located the source with:
//   argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out' ...)
// `argv.indexOf(a)` resolves to the FIRST index of a repeated string value,
// not the index of the candidate `a` currently being tested by `.find` — so
// a repeated flag, or a flag VALUE that happens to equal an earlier token,
// mis-locates the "what came before me" check. Two concrete failures that
// bug produces: (1) `--out foo --out bar` — the second `--out`'s positional
// lookup for `bar` checks `argv[argv.indexOf('bar') - 1]`, which is fine
// here, but the general pattern breaks the moment any token repeats
// elsewhere in argv; (2) a source path that happens to equal a flag's own
// value elsewhere in argv silently gets skipped as "belongs to a flag"
// even though it doesn't.
//
// Fix: walk argv exactly once, left to right. A recognized flag consumes
// itself and (if it takes a value) the very next token, unconditionally —
// classification depends only on THIS token's position in the walk, never
// on where an identical string reappears elsewhere in argv. The first
// leftover token is the source.
const FLAGS_WITH_VALUE = new Set(['--out', '--max', '--depth', '--decisions']);
const BOOLEAN_FLAGS = new Set(['--static']);

function parseArgs(argv) {
  const opts = { out: null, max: null, depth: null, static: false, decisions: null };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOLEAN_FLAGS.has(a)) { opts.static = true; continue; }
    if (FLAGS_WITH_VALUE.has(a)) {
      if (i + 1 >= argv.length) return { error: `missing value for ${a}` };
      opts[a.slice(2)] = argv[++i];
      continue;
    }
    if (a.startsWith('--')) {
      // Decision: an unrecognized flag is a USAGE ERROR (exit 2), not a
      // silent no-op. This CLI runs unattended from a skill's Bash call —
      // a typo'd flag (`--depht`) silently falling back to a default and
      // producing a plausible-looking but wrong map is a worse failure
      // than refusing to run. Ignoring unknown flags would also make it
      // impossible to ever add a new flag name without risking a caller's
      // stale typo being "supported" by accident.
      return { error: `unknown flag: ${a}` };
    }
    positionals.push(a);
  }
  if (positionals.length === 0) return { error: 'missing <source>' };
  if (positionals.length > 1) return { error: `unexpected extra argument(s): ${positionals.slice(1).join(' ')}` };
  return { source: positionals[0], opts };
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.error) {
  console.error(`block-map: ${parsed.error}`);
  console.error(USAGE);
  process.exit(2);
}
const { source, opts } = parsed;

const OUT = resolve(opts.out || '.twt-artifacts/block-map');
const MAX = Number(opts.max ?? 20);
const DEPTH = Number(opts.depth ?? 4);
if (!Number.isFinite(MAX) || !Number.isFinite(DEPTH)) {
  console.error(`block-map: --max and --depth must be numbers`);
  console.error(USAGE);
  process.exit(2);
}
const STATIC = opts.static;
const DECISIONS = opts.decisions;

(async () => {
  // --- acquire -----------------------------------------------------------
  let pages, sourceKind;
  if (/^https?:\/\//i.test(source)) {
    sourceKind = 'url';
    pages = await fromUrl(source, { max: MAX });
  } else if (/\.json$/i.test(source)) {
    sourceKind = 'figma';
    if (!existsSync(source)) {
      console.error(`block-map: source not found: ${source}`);
      process.exitCode = 1;
      return;
    }
    pages = await fromFigmaExport(source);
  } else if (existsSync(source) && statSync(source).isDirectory()) {
    sourceKind = 'dir';
    pages = await fromDir(source);
  } else if (existsSync(source)) {
    console.error(`block-map: source is neither a directory nor a .json export: ${source}`);
    process.exitCode = 1;
    return;
  } else {
    console.error(`block-map: source not found: ${source}`);
    process.exitCode = 1;
    return;
  }

  // --- parse + extract -----------------------------------------------------
  //
  // Figma-export pages carry `figma://Name` synthetic urls (acquire.mjs) —
  // there is no real page for a browser to navigate to, so the Playwright
  // engine is never attempted for that source kind regardless of --static.
  let engine = 'static';
  const instances = [];
  const flat = (bs) => bs.flatMap((b) => [b, ...flat(b.children)]);
  for (const p of pages) {
    let tree = null;
    if (!STATIC && sourceKind !== 'figma') {
      const walkUrl = sourceKind === 'url' ? p.url : pathToFileURL(p.url).href;
      tree = await walkWithPlaywright(walkUrl);
      if (tree) engine = 'playwright';
    }
    if (!tree) tree = parseHtml(p.html);
    for (const block of flat(extractBlocks(tree, { depth: DEPTH })))
      instances.push({ block, page: p.url, selector: block.selector });
  }

  // --- identity -------------------------------------------------------------
  let clustered = cluster(instances);
  let decisionsRead = 0;
  if (DECISIONS) {
    let rulings;
    try {
      rulings = JSON.parse(readFileSync(resolve(DECISIONS), 'utf8'));
    } catch (e) {
      console.error(`block-map: --decisions file is not valid JSON: ${DECISIONS} (${e.message})`);
      process.exitCode = 1;
      return;
    }
    if (!Array.isArray(rulings)) {
      console.error(`block-map: --decisions file must contain a JSON array: ${DECISIONS}`);
      process.exitCode = 1;
      return;
    }
    decisionsRead = rulings.filter((r) => r && r.verdict === 'same').length;
    clustered = applyDecisions(clustered, rulings);
  }

  // --- emit -------------------------------------------------------------
  const result = { pages, engine, ...clustered };
  const paths = emitAll(result, OUT);
  const rep = renderReport(OUT);

  // --- stdout — bounded, see file header ----------------------------------
  const js = pages.filter((p) => p.jsRendered).map((p) => p.url);
  console.log(`block-map: ${pages.length} pages, ${result.blocks.length} blocks, ${instances.length} instances (engine: ${engine})`);
  console.log(`  aliases merged: ${result.blocks.reduce((s, b) => s + Math.max(0, b.aliases.length - 1), 0)}`);
  console.log(`  gray band: ${result.grayBand.length} pairs to adjudicate` + (result.unadjudicated ? `, ${result.unadjudicated} auto-split (over cap)` : ''));
  if (DECISIONS) {
    console.log(`  decisions: applied ${decisionsRead} "same" ruling(s) from ${DECISIONS}`);
  }
  if (js.length && engine === 'static') {
    console.log(`  WARNING js-rendered pages read statically — map incomplete for: ${js.slice(0, 10).join(', ')}`);
  } else if (js.length) {
    console.log(`  note: pages flagged js-rendered even under the playwright engine — check for a per-page render failure: ${js.slice(0, 10).join(', ')}`);
  }
  console.log(`  wrote: ${paths.blockMapPath}`);
  console.log(`  wrote: ${paths.summaryPath}  <- read this one`);
  console.log(`  wrote: ${paths.grayBandPath}`);
  console.log(`  wrote: ${rep.homepage} (+${rep.blockPages.length} block pages)`);
})().catch((e) => {
  console.error('block-map: ' + e.message);
  process.exitCode = 1;
});
