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
//   family    members whose FAMILY is only partly inside the cluster. This is
//             the fatal one, and the only one no edge kind can express: an
//             orchestrator and its define/validate are joined by SOFT edges,
//             correctly, because under orchestration they degrade. Ship the
//             orchestrator without them and it has nothing to dispatch.
//   inbound   skills outside the cluster that depend on a member
//   outbound  members depending on non-members. A HARD edge either way is an
//             install-order bug; a soft one degrades and is a judgement call.
//   contested bundled files the cluster needs that non-members also need.
//             These used to be the killers, on the reasoning that a file can
//             live in exactly one plugin. tools/build-units.mjs removed that
//             constraint by vendoring shared files into each unit from one
//             canonical source, with CI comparing the copies byte-for-byte, so
//             contention is now a COST (files duplicated), not a blocker.
//
//   node tools/split-readiness.mjs <skill-name>...     one ad-hoc cluster
//   node tools/split-readiness.mjs --preset <unit>     one registered unit
//   node tools/split-readiness.mjs --all-presets       every registered unit
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { skillFiles } from "./lib/plugin-roots.mjs";
import { loadUnits } from "./lib/units.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Candidate clusters are no longer hand-kept here. They ARE the registered
// units, resolved from .claude-plugin/units.json plus each skill's `unit:`
// field - a maintained list is the thing that goes stale the moment a unit
// changes shape, which is exactly what this tool exists to detect.

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
  const scalar = (k) => (fm.match(new RegExp(`^${k}:\\s*(\\S+)\\s*$`, "m")) || [])[1] || "";
  skills.set(f.expectedName, {
    ...f,
    // A family ships whole (CONVENTIONS 19); the unit says which plugin it
    // ships in. Both are read here so analyze() can enforce the family rule
    // that no edge kind can express.
    family: scalar("family"),
    unit: scalar("unit"),
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
  // `import\s+` catches the bare side-effect form, `import "./x.mjs"`, which the
  // other three branches all miss: it has no `from`, no paren, no require. No
  // file in the repo uses it today, which is exactly why it would be missed
  // silently the day one does - and a missed edge means a vendored plugin
  // shipping without a file it needs.
  const imports = [...src.matchAll(/(?:from\s*|import\s*\(\s*|require\(\s*|import\s+)['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  const assets = [];
  for (const m of src.matchAll(/(?:join|resolve)\(\s*(HERE|ROOT|__dirname|[A-Z][A-Z0-9_]*)\s*,\s*((?:['"][^'"]+['"]\s*,\s*)*['"][^'"]+['"])\s*\)/g)) {
    const parts = [...m[2].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    if (!parts.length || parts.some((x) => /[<>*${}]/.test(x))) continue;
    parts.anchor = m[1];
    assets.push(parts);
  }
  return { imports, assets };
}

// What the anchor VARIABLE of a computed path means, by name.
//
// The walker cannot know what a variable holds, so it reads the name. This is
// not cosmetic: resolving every computed path against BOTH the file's directory
// and the repo root pulled the repo's own README.md, SKILLS.md, architecture.md
// and AGENTS.md into three units on the first real build, because expressions
// like join(WIKI, 'AGENTS.md') and join(OUT, 'README.md') happen to name files
// that exist at the root.
//
//   "file"  the file's own directory  - HERE, __dirname
//   "repo"  the repository root       - ROOT, REPO, *_ROOT
//   null    a runtime OUTPUT location - ART, OUT, WIKI, REPORTS, DS, ...
//           These are directories a tool WRITES into, never source it depends
//           on, so they are not dependencies at all.
export function anchorKind(name) {
  if (name === "HERE" || name === "__dirname") return "file";
  if (name === "ROOT" || name === "REPO" || /_ROOT$/.test(name)) return "repo";
  return null;
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

  // A family is the unit of independence: an orchestrator installed without its
  // own define has nothing to dispatch, and a define without its validator has
  // no critic. Those edges are all declared SOFT - correctly, because under
  // orchestration they degrade - so the EDGE KIND can never carry this rule.
  // Before the family tag existed this tool reported twt-brand alone as
  // splittable, which is how an orchestrator with nothing to orchestrate would
  // have shipped. The family tag is the only thing that catches it.
  const familySplits = [];
  const byFamily = new Map();
  for (const [name, s] of skills) {
    if (!s.family) continue;
    if (!byFamily.has(s.family)) byFamily.set(s.family, []);
    byFamily.get(s.family).push(name);
  }
  for (const [family, names] of byFamily) {
    const inside = names.filter((n) => inCluster.has(n));
    if (inside.length && inside.length !== names.length) {
      familySplits.push({ family, missing: names.filter((n) => !inCluster.has(n)).sort() });
    }
  }

  // Order is the judgement. A cut family is a broken install; a hard edge is an
  // install-order bug; a contested file is only a duplication cost.
  const verdict = missing.length ? "UNKNOWN (unresolved skill names)"
    : familySplits.length
      ? `BLOCKED (family split: ${familySplits.map((f) => `${f.family} needs ${f.missing.join(", ")}`).join("; ")})`
    : hardEdges.length ? "BLOCKED (hard dependency across the boundary)"
    : contested.length ? `VENDORABLE (${contested.length} contested file(s) - run build-units)`
    : inbound.length + outbound.length ? "SPLITTABLE (soft edges only)"
    : "CLEAN";

  return { missing, inbound, outbound, contested, familySplits, verdict };
}

// The registered units, and their membership. Presets ARE the units now: a
// hand-kept candidate list goes stale the moment a unit changes shape, which is
// the very drift this tool exists to detect.
export function registeredUnits() {
  return Object.keys(loadUnits(ROOT).units).sort();
}

export function presetMembers(unit) {
  const reg = loadUnits(ROOT);
  if (!reg.units[unit]) {
    throw new Error(`unknown unit "${unit}"; known: ${Object.keys(reg.units).sort().join(", ")}`);
  }
  return [...skills].filter(([, s]) => s.unit === unit).map(([n]) => n).sort();
}

function report(label, members) {
  const { missing, inbound, outbound, contested, familySplits, verdict } = analyze(members);
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
  if (familySplits.length) {
    console.log(`  family splits: ${familySplits.length} (a family ships whole)`);
    for (const f of familySplits) console.log(`    ${f.family} needs ${f.missing.join(", ")}`);
  }
  if (!contested.length) console.log("  contested files: none");
  else {
    console.log(`  contested files: ${contested.length} — shared; build-units vendors them into each`);
    for (const f of contested) console.log(`    ${f}`);
  }
  return verdict;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("split-readiness.mjs");
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (argv.includes("--all-presets")) {
    for (const unit of registeredUnits()) report(`unit:${unit}`, presetMembers(unit));
  } else if (argv[0] === "--preset") {
    try {
      report(`unit:${argv[1]}`, presetMembers(argv[1]));
    } catch (e) {
      console.error(e.message);
      process.exit(2);
    }
  } else if (argv.length) {
    report("ad-hoc cluster", argv);
  } else {
    console.error("usage: split-readiness.mjs <skill-name>... | --preset <name> | --all-presets");
    process.exit(2);
  }
}
