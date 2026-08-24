#!/usr/bin/env node
// split-readiness.mjs — can this set of skills become its own plugin?
//
// Splitting a cluster out of the monolith fails for reasons a grep cannot see.
// Three real examples, each found by hand before this existed:
//   - the export cluster looked clean until tools/theme.mjs turned out to pull
//     templates/themes/doc-hub-light, which tools/house-style.mjs also reads at
//     runtime for four monolith report tools;
//   - twt-figma-dev-audit looked standalone until six other commands turned out
//     to invoke ${CLAUDE_PLUGIN_ROOT}/skills/twt-figma-dev-audit/tools/figma-dev-audit.mjs directly;
//   - the content cluster carried 16 inbound dependency edges.
// The common thread: what blocks a split is usually not the skills, it is the
// FILES underneath them, reachable only through the transitive import graph.
//
// So this reports, for a candidate cluster:
//   inbound   — skills outside the cluster that depend on a member
//   outbound  — members depending on non-members
//               (hard is fatal either way: a hard dep across a plugin boundary
//               is an install-order bug. soft is a judgement call — it degrades.)
//   contested — bundled files the cluster needs that non-members also need.
//               These are the killers: a file can live in exactly one plugin.
//
//   node tools/split-readiness.mjs <skill-name>...     one ad-hoc cluster
//   node tools/split-readiness.mjs --preset <name>     a named candidate below
//   node tools/split-readiness.mjs --all-presets
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { skillFiles } from "./lib/plugin-roots.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Candidate clusters from the packaging discussion, kept here so the numbers
// behind a "we did not split this" decision stay reproducible.
const PRESETS = {
  export: ["twt-export", "twt-export-docx", "twt-export-pdf", "twt-export-presentation", "twt-export-template-create"],
  audit: ["twt-block-map", "twt-design-system-audit", "twt-figma-dev-audit", "twt-launch-audit"],
  content: ["twt-content-fetch", "twt-content-fetch-doc", "twt-content-fetch-figma", "twt-content-fetch-pdf",
            "twt-content-fetch-site", "twt-text-analysis", "twt-content-optimize",
            "twt-content-approval-checklist", "twt-content-approval-implement", "twt-content-validate"],
  "figma-dev-audit": ["twt-figma-dev-audit"],
  "write-as-me": ["twt-write-as-me", "twt-write-as-me-analysis"],
};

// ---- skill graph ------------------------------------------------------------

const files = skillFiles(ROOT);
const skills = new Map();
for (const f of files) {
  const text = readFileSync(f.path, "utf8");
  const fm = text.split(/^---\s*$/m)[1] || "";
  const depBlock = (fm.match(/dependencies:[\s\S]*?(?=\n[a-z_]+:)/) || [""])[0];
  const hardBlock = (depBlock.match(/hard:([\s\S]*?)(?=\n\s*soft:|$)/) || ["", ""])[1];
  const softBlock = (depBlock.match(/soft:([\s\S]*)/) || ["", ""])[1];
  const names = (s) => [...s.matchAll(/-\s+([a-z][a-z0-9-]+)/g)].map((m) => m[1]);
  skills.set(f.expectedName, {
    ...f,
    hard: names(hardBlock),
    soft: names(softBlock),
    // Every bundled file the skill names, normalised to a repo-relative path.
    // ${CLAUDE_PLUGIN_ROOT} resolves to the OWNING plugin's root, so a skill
    // already living in ./plugins/<name> must not have its refs resolved against
    // the repo root. Placeholders and globs are skipped — they cannot be
    // resolved statically, the same rule gen-docs applies.
    refs: [...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"'`)\]]+)/g)]
      .map((m) => m[1].replace(/[.,;:]+$/, ""))
      .filter((r) => !/[<>*$]/.test(r))
      .map((r) => relative(ROOT, join(f.pluginRoot, r)).replace(/\\/g, "/")),
  });
}

// ---- transitive file closure ------------------------------------------------

// A skill naming tools/export-document.mjs also depends on everything that file
// imports, and so on down. Without following this, a shared library one hop away
// stays invisible — which is exactly how the export cluster looked clean.
const IMPORT_RE = /(?:from\s*|import\s*\(\s*|require\(\s*)['"](\.[^'"]+)['"]/g;

// Import edges alone are not enough, and assuming they were is what made the
// export cluster look clean. tools/theme.mjs reaches templates/themes through
//   join(HERE, '..', 'templates', 'themes')
// — a computed DATA path, not an import — and tools/house-style.mjs reaches the
// same directory the same way for four monolith report tools. Nothing in the
// import graph connects them, yet the directory can only live in one plugin.
// So: also resolve join()/resolve() calls whose arguments are a dir anchor
// followed by string literals.
const ASSET_RE = /(?:join|resolve)\(\s*(?:HERE|ROOT|__dirname|[A-Z][A-Z0-9_]*)\s*,\s*((?:['"][^'"]+['"]\s*,\s*)*['"][^'"]+['"])\s*\)/g;

function assetPaths(abs, src) {
  const out = [];
  for (const m of src.matchAll(ASSET_RE)) {
    const parts = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((p) => p[1]);
    if (!parts.length) continue;
    // Skip anything with a runtime placeholder - it cannot be resolved statically.
    if (parts.some((p) => /[<>*${}]/.test(p))) continue;
    const target = resolve(dirname(abs), ...parts);
    const rel = relative(ROOT, target).replace(/\\/g, "/");
    if (!rel.startsWith("..") && existsSync(target)) out.push(rel);
  }
  return out;
}

// The dependency-spotting knowledge, shared rather than copied. sync-kernel
// needs the same two edge types but resolves them against a DIFFERENT anchor
// (a plugin root, not the repo root), so it takes the specifiers and does its
// own resolution. Exporting the compiled /g regexes instead would share their
// lastIndex state across callers - a real bug, not a style preference.
export function depSpecifiers(src) {
  const imports = [...src.matchAll(/(?:from\s*|import\s*\(\s*|require\(\s*)['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  const assets = [];
  for (const m of src.matchAll(/(?:join|resolve)\(\s*(?:HERE|ROOT|__dirname|[A-Z][A-Z0-9_]*)\s*,\s*((?:['"][^'"]+['"]\s*,\s*)*['"][^'"]+['"])\s*\)/g)) {
    const parts = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    if (!parts.length || parts.some((x) => /[<>*${}]/.test(x))) continue;
    assets.push(parts);
  }
  return { imports, assets };
}

function closure(startRefs) {
  const seen = new Set();
  const queue = [...startRefs];
  while (queue.length) {
    const ref = queue.shift();
    if (seen.has(ref)) continue;
    seen.add(ref);
    const abs = join(ROOT, ref);
    if (!existsSync(abs)) continue;
    let st;
    try { st = statSync(abs); } catch { continue; }
    // A directory reference pulls the directory as a unit; no need to walk into
    // it, since moving a directory moves everything under it anyway.
    if (st.isDirectory() || !/\.(mjs|js|cjs)$/.test(abs)) continue;
    let src = "";
    try { src = readFileSync(abs, "utf8"); } catch { continue; }
    for (const m of src.matchAll(IMPORT_RE)) {
      const target = resolve(dirname(abs), m[1]);
      const rel = relative(ROOT, target).replace(/\\/g, "/");
      if (!rel.startsWith("..")) queue.push(rel);
    }
    for (const rel of assetPaths(abs, src)) queue.push(rel);
  }
  return seen;
}

// The skill graph and the closure walker are the expensive, correctness-critical
// part of this file (see the two blind spots pinned in tests/split-readiness).
// tools/skill-ownership.mjs needs both to work out which bundled files a single
// skill exclusively owns, so they are exported rather than reimplemented there
// — a second copy of this walk would drift, and a drifted copy reports CLEAN.
export { skills, closure };

// Contention is directory containment, not string equality, and this is the
// rule that decides it. Exported and unit-tested directly: it used to be proven
// only through the export cluster's real data, and when export became its own
// plugin that data stopped exercising the nested case at all. A pure rule
// deserves a pure test that repo layout cannot quietly defeat.
export function pathsOverlap(a, b) {
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
}

// ---- report -----------------------------------------------------------------

export function analyze(members) {
  const inCluster = new Set(members);
  const missing = members.filter((m) => !skills.has(m));
  const inbound = [];
  const outbound = [];
  for (const [name, s] of skills) {
    const mine = inCluster.has(name);
    for (const kind of ["hard", "soft"]) {
      for (const dep of s[kind]) {
        if (!skills.has(dep)) continue; // external (figma-mcp, WebFetch, ...)
        if (!mine && inCluster.has(dep)) inbound.push({ kind, from: name, to: dep });
        if (mine && !inCluster.has(dep)) outbound.push({ kind, from: name, to: dep });
      }
    }
  }

  // Files the cluster needs, against files everyone else needs.
  const mineRefs = [];
  const theirRefs = [];
  for (const [name, s] of skills) (inCluster.has(name) ? mineRefs : theirRefs).push(...s.refs);
  const mineClosure = closure(mineRefs);
  const theirClosure = closure(theirRefs);

  // Contention is directory containment, not string equality. tools/theme.mjs
  // reaches "templates/themes" while tools/house-style.mjs reaches
  // "templates/themes/doc-hub-light/css" — different strings, one directory,
  // and it can still only live in one plugin. Compare both ways.
  const overlaps = pathsOverlap;
  const theirs = [...theirClosure];
  const contested = [...mineClosure]
    .filter((f) => theirs.some((t) => overlaps(f, t)))
    .sort();

  // Contested files used to be the fatal verdict, on the reasoning that a file
  // can live in exactly one plugin. tools/sync-kernel.mjs removed that
  // constraint: shared files are vendored into each plugin that needs them from
  // one canonical source, with CI comparing the copies byte-for-byte. So a
  // contested file is now a COST (files to duplicate), not a blocker.
  //
  // A hard dependency edge is the one thing vendoring cannot fix, and is
  // therefore now the only fatal verdict. Vendoring a FILE is fine; "vendoring"
  // a skill would mean shipping two copies of it, which is the duplicate trap
  // CONVENTIONS forbids. Hard edges are checked first for that reason.
  const hardEdges = [...inbound, ...outbound].filter((e) => e.kind === "hard");
  const verdict = missing.length ? "UNKNOWN (unresolved skill names)"
    : hardEdges.length ? "BLOCKED (hard dependency across the boundary)"
    : contested.length ? `VENDORABLE (${contested.length} contested file(s) - run sync-kernel)`
    : inbound.length + outbound.length ? "SPLITTABLE (soft edges only)"
    : "CLEAN";

  return { missing, inbound, outbound, contested, verdict };
}

function report(label, members) {
  const { missing, inbound, outbound, contested, verdict } = analyze(members);
  console.log(`\n=== ${label} — ${members.length} skill(s) ===`);
  console.log(`verdict: ${verdict}`);
  if (missing.length) console.log(`  unknown skills: ${missing.join(", ")}`);
  const edges = (list, dir) => {
    if (!list.length) return console.log(`  ${dir}: none`);
    console.log(`  ${dir}: ${list.length}`);
    for (const e of list.slice(0, 12)) console.log(`    [${e.kind}] ${e.from} -> ${e.to}`);
    if (list.length > 12) console.log(`    ... and ${list.length - 12} more`);
  };
  edges(inbound, "inbound  (outsiders depending on this cluster)");
  edges(outbound, "outbound (cluster depending on outsiders)");
  if (!contested.length) console.log("  contested files: none");
  else {
    console.log(`  contested files: ${contested.length} — shared; sync-kernel vendors them into both`);
    for (const f of contested) console.log(`    ${f}`);
  }
  return verdict;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("split-readiness.mjs");
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (argv.includes("--all-presets")) {
    for (const [name, members] of Object.entries(PRESETS)) report(`preset:${name}`, members);
  } else if (argv[0] === "--preset") {
    const name = argv[1];
    if (!PRESETS[name]) {
      console.error(`unknown preset '${name}'. known: ${Object.keys(PRESETS).join(", ")}`);
      process.exit(2);
    }
    report(`preset:${name}`, PRESETS[name]);
  } else if (argv.length) {
    report("ad-hoc cluster", argv);
  } else {
    console.error("usage: split-readiness.mjs <skill-name>... | --preset <name> | --all-presets");
    process.exit(2);
  }
}
