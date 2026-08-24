#!/usr/bin/env node
// skill-ownership.mjs - which bundled files does ONE skill exclusively own?
//
// Step 2 of the packaging work: a skill is a directory now, so the files only it
// uses belong inside it (skills/<name>/...) instead of in the shared tools/ blob.
// This decides which those are.
//
// Three tiers, because the first cut of this tool conflated the last two and
// called the whole tools/launch-audit/ subtree unmovable when in fact only three
// of its files are shared with another skill:
//
//   clean    exclusive to this skill, nothing anywhere else names it. Move it.
//   rewire   exclusive to this skill, but tests / CI / docs name it by path.
//            Still movable - those are references to UPDATE, not blockers. The
//            only cost is that the move and the reference edits land together.
//   shared   another SKILL can reach it. This is the real blocker, and the only
//            one: a file can live in exactly one plugin. These are the step-3
//            kernel.
//
// Reachability is deliberately broader than the skill graph, because the skill
// graph is not the only consumer. tools/gen-docs.mjs is named by exactly one
// skill (twt-marketplace-docs) and looks exclusive by that measure - but CI runs
// it, tests import it, and the doc-hub build shells out to it. Those land it in
// `rewire`, not `clean`.
//
// Usage:
//   node tools/skill-ownership.mjs              summary
//   node tools/skill-ownership.mjs --plan       per-skill file lists
//   node tools/skill-ownership.mjs --shared     the shared kernel (step-3 input)
//   node tools/skill-ownership.mjs <skill>      one skill, with the reason per file
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { skills, closure } from "./split-readiness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEP = String.fromCharCode(92);
const slash = (p) => p.split(SEP).join("/");

// ---- per-skill transitive closures -----------------------------------------

const closures = new Map();
for (const [name, s] of skills) closures.set(name, closure(s.refs));

const reachedBy = new Map();
for (const [name, set] of closures) {
  for (const f of set) {
    if (!reachedBy.has(f)) reachedBy.set(f, new Set());
    reachedBy.get(f).add(name);
  }
}

// ---- non-skill consumers ----------------------------------------------------

const skillReachable = new Set(reachedBy.keys());
const SCAN_DIRS = ["tests", ".github", "doc-hub", "hooks", ".claude", "templates", "references"];
const SCAN_FILES = ["package.json", "CLAUDE.md", "CONVENTIONS.md", "README.md", "AGENTS.md"];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const consumerFiles = [];
for (const d of SCAN_DIRS) consumerFiles.push(...walk(join(ROOT, d)));
for (const f of SCAN_FILES) { const p = join(ROOT, f); if (existsSync(p)) consumerFiles.push(p); }
// tools/ scripts no skill reaches are author-time utilities - consumers, not candidates.
for (const p of walk(join(ROOT, "tools"))) {
  if (!skillReachable.has(slash(relative(ROOT, p)))) consumerFiles.push(p);
}

// Literal substring, not a parsed reference: a shell line in ci.yml, a JSON
// script entry and a prose mention all count. Over-reporting costs one file left
// in tools/; under-reporting breaks the build.
const namedByConsumer = new Map();
const consumerText = consumerFiles.map((p) => {
  let t = ""; try { t = readFileSync(p, "utf8"); } catch {}
  return { rel: slash(relative(ROOT, p)), t };
});
for (const cand of skillReachable) {
  for (const { rel, t } of consumerText) {
    if (!t.includes(cand)) continue;
    if (!namedByConsumer.has(cand)) namedByConsumer.set(cand, new Set());
    namedByConsumer.get(cand).add(rel);
  }
}

// ---- verdict ----------------------------------------------------------------

const inSomeSkillDir = (f) => /skills[/][^/]+[/]/.test(f);

function ownership(name) {
  const clean = [], rewire = [], shared = [];
  for (const f of closures.get(name) || []) {
    if (inSomeSkillDir(f)) continue;
    const others = [...(reachedBy.get(f) || [])].filter((n) => n !== name);
    const refs = [...(namedByConsumer.get(f) || [])];
    if (others.length) shared.push({ f, others });
    else if (refs.length) rewire.push({ f, refs });
    else clean.push(f);
  }
  const byF = (a, b) => String(a.f ?? a).localeCompare(String(b.f ?? b));
  return { clean: clean.sort(byF), rewire: rewire.sort(byF), shared: shared.sort(byF),
           movable: clean.length + rewire.length };
}

const brief = (arr, n) => arr.slice(0, n).join(", ") + (arr.length > n ? ", +" + (arr.length - n) + " more" : "");

// ---- report -----------------------------------------------------------------

const argv = process.argv.slice(2);
const names = [...skills.keys()].sort();

if (argv[0] && !argv[0].startsWith("--")) {
  const n = argv[0];
  if (!skills.has(n)) { console.error("unknown skill: " + n); process.exit(2); }
  const o = ownership(n);
  console.log("");
  console.log("=== " + n + " ===");
  console.log("");
  console.log("move as-is (" + o.clean.length + "):");
  for (const f of o.clean) console.log("  " + f);
  console.log("");
  console.log("move + update references (" + o.rewire.length + "):");
  for (const r of o.rewire) { console.log("  " + r.f); console.log("      refs: " + brief(r.refs, 4)); }
  console.log("");
  console.log("STAYS SHARED - another skill reaches it (" + o.shared.length + "):");
  for (const b of o.shared) { console.log("  " + b.f); console.log("      also: " + brief(b.others, 3)); }
} else if (argv[0] === "--shared") {
  const shared = [...reachedBy.entries()]
    .filter(([f, s]) => !inSomeSkillDir(f) && s.size > 1)
    .sort((a, b) => b[1].size - a[1].size);
  console.log("");
  console.log("Files reachable from more than one skill (" + shared.length + ") - the step-3 kernel:");
  console.log("");
  for (const [f, s] of shared) console.log("  " + String(s.size).padStart(2) + " skills  " + f);
} else {
  let tc = 0, tr = 0, ts = 0;
  const rows = [];
  for (const n of names) {
    const o = ownership(n);
    tc += o.clean.length; tr += o.rewire.length; ts += o.shared.length;
    if (o.movable) rows.push([n, o]);
  }
  console.log("");
  console.log("Skills that exclusively own at least one bundled file (" + rows.length + " of " + names.length + "):");
  console.log("");
  for (const [n, o] of rows.sort((a, b) => b[1].movable - a[1].movable)) {
    console.log("  " + n + "  -  " + o.movable + " movable (" + o.clean.length + " as-is, " + o.rewire.length + " need ref updates), " + o.shared.length + " shared");
    if (argv[0] === "--plan") {
      for (const f of o.clean) console.log("      " + f);
      for (const r of o.rewire) console.log("      " + r.f + "   [refs: " + r.refs.length + "]");
    }
  }
  console.log("");
  console.log("totals: " + (tc + tr) + " movable (" + tc + " as-is, " + tr + " need ref updates), " + ts + " genuinely shared");
}
