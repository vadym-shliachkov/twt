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
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginRoots, skillFiles } from "./lib/plugin-roots.mjs";
import { syncFiles, MANIFEST } from "./lib/vendor.mjs";
import { closure, depSpecifiers } from "./split-readiness.mjs";

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

// Resolve everything a plugin needs, walking each file AT THE LOCATION IT
// ACTUALLY LIVES. This is subtler than it looks and the first version got it
// wrong: it only followed the closure of refs the plugin was MISSING, so an
// OWNED file that reached outside the plugin was invisible. The export split
// exposed it immediately - tools/theme.mjs moved into the plugin (owned), and
// it reaches templates/themes through join(HERE, '..', 'templates', 'themes').
// The walker never opened it, reported "0 files to vendor", and would have
// shipped a plugin whose every export died on a missing theme directory.
//
// So: for each plugin-relative path, look in the plugin first, then the
// monolith. A file found only in the monolith is one to vendor. Either way its
// own dependencies are then resolved against the root it was FOUND in, which is
// what makes theme.mjs's computed path land on templates/themes plugin-relative.
// `vendored` is the set recorded by a previous run. It exists because
// derivation alone is NOT stable across runs: once a file has been copied in it
// exists inside the plugin, so a re-derivation classifies it as "owned" and
// drops it from the checked set. That is not cosmetic - it meant an EDITED
// vendored file sailed past --check reporting OK, which is precisely the drift
// this tool was built to catch. Recording the set and treating those paths as
// monolith-sourced makes derivation idempotent and keeps every copy checked.
function resolveNeeds(pluginRoot, startRels) {
  const seen = new Set();
  const vendor = new Set();
  const owned = new Set();
  const broken = new Set();
  // Declared refs and discovered ones are not the same kind of thing. A
  // ${CLAUDE_PLUGIN_ROOT}/... ref in a SKILL.md that resolves nowhere is broken
  // and must be reported. A DISCOVERED computed path that resolves nowhere is
  // usually an output location, not a dependency - export-source-create.mjs has
  // join(ROOT, ".twt-artifacts", "self-test"), a directory it writes at runtime.
  // Calling that "broken" made the first run report a phantom failure. Skip
  // them, which is what split-readiness's walker already does via its existsSync
  // filter.
  const queue = startRels.map((r) => ({ rel: r, declared: true }));

  while (queue.length) {
    const { rel, declared } = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);

    const inPlugin = join(pluginRoot, rel);
    const inMono = join(ROOT, rel);
    let src, base;
    // Classification is positional and stateless, which matters more than it
    // looks. The obvious rule - "exists in the plugin, therefore owned" - is
    // what broke: once a file had been copied in it looked owned, dropped out
    // of the checked set, and an EDITED vendored file passed --check reporting
    // OK. That is exactly the drift this tool exists to catch.
    //
    // The discriminator is whether the SAME relative path also exists in the
    // monolith. A plugin's own files moved OUT of the monolith, so they exist in
    // one place only; a vendored copy exists in both. No recorded state, nothing
    // to bootstrap, and it self-heals if a manifest is ever lost.
    const hasPlugin = existsSync(inPlugin);
    const hasMono = existsSync(inMono);
    if (hasMono) { src = inMono; base = ROOT; vendor.add(rel); }
    else if (hasPlugin) { src = inPlugin; base = pluginRoot; owned.add(rel); }
    else { if (declared) broken.add(rel); continue; }

    // A directory travels as a unit; no need to walk into it.
    if (statSync(src).isDirectory()) continue;
    if (!/[.](mjs|js|cjs)$/.test(src)) continue;

    let text = "";
    try { text = readFileSync(src, "utf8"); } catch { continue; }
    const { imports, assets } = depSpecifiers(text);
    const push = (target) => {
      const r = slash(relative(base, target));
      if (!r.startsWith("..")) queue.push({ rel: r, declared: false });
    };
    for (const spec of imports) push(resolve(dirname(src), spec));
    for (const parts of assets) push(resolve(dirname(src), ...parts));
  }
  return { vendor: [...vendor], owned: [...owned], broken: [...broken] };
}

// Exported so the derivation can be tested against the real repo rather than a
// fixture: given a plugin root and its skills' refs, what must be vendored.
export function vendorPlanFor(pluginRoot, startRels) {
  const { vendor, owned, broken } = resolveNeeds(pluginRoot, startRels);
  const expanded = new Set();
  for (const rel of vendor) {
    const a = join(ROOT, rel);
    if (existsSync(a) && statSync(a).isDirectory()) for (const f of filesUnder(rel)) expanded.add(f);
    else expanded.add(rel);
  }
  return { vendor: [...expanded].sort(), owned: owned.sort(), broken: broken.sort() };
}

function skillRefs(pluginName) {
  const refs = new Set();
  for (const f of skillFiles(ROOT)) {
    if (f.plugin !== pluginName) continue;
    const text = readFileSync(f.path, "utf8");
    for (const m of text.matchAll(REF_RE)) {
      const rel = m[1].replace(/[.,;:]+$/, "");
      if (/[<>*${}]/.test(rel)) continue;
      refs.add(rel);
    }
  }
  return [...refs];
}

// Both now live in tools/lib/vendor.mjs, which the unit build also uses.
// Re-exported so existing importers keep working until this file retires.
export { MANIFEST, syncFiles };

// The recorded set from the last sync. Directories are expanded to files at
// vendor time, so this is always a flat file list.
function recordedVendored(pluginRoot) {
  const p = join(pluginRoot, MANIFEST);
  if (!existsSync(p)) return new Set();
  try { return new Set(JSON.parse(readFileSync(p, "utf8")).vendored || []); } catch { return new Set(); }
}

function planFor(plugin) {
  const plan = vendorPlanFor(plugin.root, skillRefs(plugin.name));
  // Recorded but no longer reached: the copy lingers as an unexplained file.
  plan.stale = [...recordedVendored(plugin.root)].filter((r) => !plan.vendor.includes(r)).sort();
  return plan;
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
  const { owned, vendor, broken, stale } = planFor(plugin);
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

  if (stale && stale.length) {
    console.log("  stale (recorded but no longer reached - safe to delete):");
    for (const f of stale) console.log("      " + f);
  }

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
    // Machine-readable companion. VENDORED.md is for humans; --check reads THIS,
    // because a re-derivation cannot see an already-vendored file (it looks
    // owned) and would silently stop checking it.
    writeFileSync(
      join(plugin.root, MANIFEST),
      JSON.stringify({ vendored: vendor, source: "marketplace monolith", tool: "tools/sync-kernel.mjs" }, null, 2) + String.fromCharCode(10),
    );
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
