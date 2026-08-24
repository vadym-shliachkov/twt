#!/usr/bin/env node
// sync-kernel.mjs - vendor the shared kernel into each split-out plugin.
//
// THE CONSTRAINT THIS REMOVES
//
// split-readiness reports a cluster BLOCKED when a file it needs is also needed
// by a non-member, because "a file can live in exactly one plugin". That is true
// of files a human checks in. It stops being true the moment a build step owns
// the copies. tools/lib/sources.mjs is reachable from 6 skills; house-style.mjs
// from 6; templates/themes from 4. Those are not design mistakes to be untangled,
// they are genuinely shared code - the fix is to let more than one plugin have
// them, with exactly one place to edit.
//
// CANONICAL SOURCE
//
// The monolith (marketplace source "./") IS the canonical copy. It vendors
// nothing - its tools/ is both the source of truth and its own runtime location.
// Only split-out plugins under ./plugins/<name>/ receive copies.
//
// WHAT GETS VENDORED IS DERIVED, NOT LISTED
//
// A hand-maintained manifest is the thing that drifts, so there is not one. For
// each split plugin the required set is computed: every ${CLAUDE_PLUGIN_ROOT}/...
// reference its skills make, plus the transitive closure of those files
// (following imports AND computed data paths - the same walker split-readiness
// uses, because templates/themes is reached by a join() call that no import
// edge would reveal). Anything in that set the plugin does not already own is
// copied from the monolith.
//
// DRIFT
//
// Copies are byte-identical, so --check is an exact comparison. CI runs it. Edit
// the monolith copy and re-run; never edit a vendored file - each plugin gets a
// tools/VENDORED.md saying so and naming the source.
//
// Usage:
//   node tools/sync-kernel.mjs            copy, write manifests
//   node tools/sync-kernel.mjs --check    verify in sync; exit 1 on drift
//   node tools/sync-kernel.mjs --plan     print what would be vendored
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginRoots, skillFiles } from "./lib/plugin-roots.mjs";
import { closure } from "./split-readiness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BS = String.fromCharCode(92);
const slash = (p) => p.split(BS).join("/");

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const PLAN = argv.includes("--plan");

// ---- what each split plugin needs -------------------------------------------

const REF_RE = /[$][{]CLAUDE_PLUGIN_ROOT[}][/]([^\s"'`)\]]+)/g;

function filesUnder(relPath) {
  const a = join(ROOT, relPath);
  if (!existsSync(a)) return [];
  if (!statSync(a).isDirectory()) return [relPath];
  const out = [];
  for (const e of readdirSync(a, { withFileTypes: true })) out.push(...filesUnder(relPath + "/" + e.name));
  return out;
}

// Exported so the derivation can be tested against the real repo rather than a
// fixture. Given skill names, returns every monolith-relative file a plugin
// containing exactly those skills would have to carry - refs plus transitive
// closure. The vendor set is this minus whatever the plugin already ships.
export function requiredForSkills(names) {
  const want = new Set(names);
  const refs = new Set();
  for (const f of skillFiles(ROOT)) {
    if (!want.has(f.expectedName)) continue;
    const text = readFileSync(f.path, "utf8");
    for (const m of text.matchAll(REF_RE)) {
      const rel = m[1].replace(/[.,;:]+$/, "");
      if (/[<>*${}]/.test(rel)) continue;
      refs.add(slash(relative(ROOT, join(f.pluginRoot, rel))));
    }
  }
  const out = new Set();
  for (const rel of closure([...refs].filter((r) => existsSync(join(ROOT, r))))) {
    for (const f of filesUnder(rel)) out.add(f);
  }
  return [...out].sort();
}

function planFor(plugin) {
  // Raw ${CLAUDE_PLUGIN_ROOT}/<rel> references made by this plugin's skills.
  const refs = new Set();
  for (const f of skillFiles(ROOT)) {
    if (f.plugin !== plugin.name) continue;
    const text = readFileSync(f.path, "utf8");
    for (const m of text.matchAll(REF_RE)) {
      const rel = m[1].replace(/[.,;:]+$/, "");
      if (/[<>*${}]/.test(rel)) continue;   // runtime placeholder - unresolvable
      refs.add(rel);
    }
  }

  // Anything the plugin already ships is settled.
  const owned = [...refs].filter((r) => existsSync(join(plugin.root, r)));
  const missing = [...refs].filter((r) => !existsSync(join(plugin.root, r)));

  // Everything else must come from the monolith, transitively. closure() is
  // anchored at the repo root, which IS the monolith root, so these resolve.
  const needed = new Set();
  for (const rel of closure(missing.filter((r) => existsSync(join(ROOT, r))))) {
    for (const f of filesUnder(rel)) needed.add(f);
  }

  const broken = missing.filter((r) => !existsSync(join(ROOT, r)));
  return { owned, vendor: [...needed].sort(), broken };
}

// Exported and root-parameterised so the copy/verify half can be tested against
// real temp directories rather than mocked. Byte comparison, not mtime or size:
// a same-length edit is exactly the drift that must not slip through.
export function syncFiles(rels, fromRoot, toRoot, { check = false } = {}) {
  const missing = [], drifted = [], copied = [];
  for (const rel of rels) {
    const from = join(fromRoot, rel);
    const to = join(toRoot, rel);
    if (check) {
      if (!existsSync(to)) { missing.push(rel); continue; }
      if (!readFileSync(from).equals(readFileSync(to))) drifted.push(rel);
    } else {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      copied.push(rel);
    }
  }
  return { missing, drifted, copied };
}

// ---- run --------------------------------------------------------------------

// Guarded: this file is also imported as a library (requiredForSkills), and an
// import must not run the CLI or touch the disk.
const IS_MAIN = process.argv[1] && slash(process.argv[1]).endsWith("tools/sync-kernel.mjs");

if (IS_MAIN) main();

function main() {
const plugins = pluginRoots(ROOT).filter((p) => slash(relative(ROOT, p.root)) !== "");
let drift = 0, copied = 0, brokenTotal = 0;

for (const plugin of plugins) {
  const { owned, vendor, broken } = planFor(plugin);
  console.log("");
  console.log("=== " + plugin.name + "  (" + slash(relative(ROOT, plugin.root)) + ") ===");
  console.log("  owns:    " + owned.length + " referenced file(s)");
  console.log("  vendors: " + vendor.length + " file(s) from the monolith");
  for (const v of vendor) console.log("      " + v);

  if (broken.length) {
    brokenTotal += broken.length;
    console.error("  BROKEN references (in neither the plugin nor the monolith):");
    for (const b of broken) console.error("      " + b);
  }

  if (PLAN) continue;

  const r = syncFiles(vendor, ROOT, plugin.root, { check: CHECK });
  for (const p of r.missing) console.error("  MISSING vendored copy: " + p);
  for (const p of r.drifted) console.error("  DRIFTED: " + p);
  drift += r.missing.length + r.drifted.length;
  copied += r.copied.length;

  // The manifest is what a human reads before editing a vendored file.
  if (vendor.length && !CHECK) {
    const man = [
      "# Vendored files - DO NOT EDIT HERE",
      "",
      "These are byte-identical copies of shared code from the marketplace monolith.",
      "They exist because this plugin installs on its own, and a plugin cannot reach",
      "into another plugin's files at runtime.",
      "",
      "Edit the canonical copy at the repo root, then run:",
      "",
      "    node tools/sync-kernel.mjs",
      "",
      "CI runs `node tools/sync-kernel.mjs --check`, so an edit made here instead of",
      "at the source fails the build rather than silently diverging.",
      "",
      "| vendored file | canonical source |",
      "|---|---|",
      ...vendor.map((v) => "| `" + v + "` | `" + v + "` |"),
      "",
    ].join(String.fromCharCode(10));
    const manPath = join(plugin.root, "VENDORED.md");
    mkdirSync(dirname(manPath), { recursive: true });
    writeFileSync(manPath, man);
  }
}

console.log("");
if (brokenTotal) {
  console.error(brokenTotal + " broken reference(s) - a skill names a file that exists nowhere.");
  process.exit(1);
}
if (CHECK) {
  if (drift) {
    console.error(drift + " vendored file(s) out of sync - run: node tools/sync-kernel.mjs");
    process.exit(1);
  }
  console.log("sync-kernel: OK - every vendored copy matches its source.");
} else if (!PLAN) {
  console.log("sync-kernel: " + copied + " file(s) vendored.");
}
}
