#!/usr/bin/env node
// standalone-report.mjs - what each skill must document to work when its unit
// is installed on its own.
//
// WHY THIS EXISTS
//
// A unit that installs is not the same as a unit that works. tools/build-units.mjs
// guarantees the first: every script present, every hook present, a manifest.
// It can say nothing about the second, because what breaks a lone install is
// not a missing FILE, it is a missing SKILL or a missing ARTIFACT:
//
//   dispatch  a soft dependency on a skill in another unit. Dispatched, it
//             lands in a subagent that has no such skill.
//   input     a `reads:` path whose only declared producer lives in another
//             unit. The skill opens, finds nothing, and in about twenty cases
//             today simply aborts.
//
// Both are satisfied the same way: a bullet under a `## Standalone` heading in
// the skill's own body. The skill text is the only thing that travels into a
// run - a fallback documented anywhere else may as well not exist.
//
// The check is deliberately loose. It drives a human to write a sentence; it
// does not grade the sentence. A lint that tried to would be argued with and
// then switched off.
//
// Usage:
//   node tools/standalone-report.mjs             every skill with an obligation
//   node tools/standalone-report.mjs --unit <n>  one unit
//   node tools/standalone-report.mjs --todo      only the unsatisfied ones
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { skillFiles } from "./lib/plugin-roots.mjs";

const field = (t, k) => (t.match(new RegExp(`^${k}:\\s*(\\S+)\\s*$`, "m")) || [])[1];

// A YAML block-sequence under `key:`, stopping at the next top-level key.
function listUnder(text, key) {
  const out = [];
  let on = false;
  for (const line of text.split(/\r?\n/)) {
    if (new RegExp(`^${key}:`).test(line)) { on = true; continue; }
    if (on && /^\s+-\s+/.test(line)) { out.push(line.replace(/^\s+-\s+/, "").trim()); continue; }
    if (on && /^\S/.test(line)) break;
  }
  return out;
}

function softDeps(text) {
  const out = [];
  let inDeps = false, on = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^dependencies:/.test(line)) { inDeps = true; continue; }
    if (inDeps && /^\s\ssoft:/.test(line)) { on = true; continue; }
    if (inDeps && /^\s\shard:/.test(line)) { on = false; continue; }
    if (on && /^\s+-\s+/.test(line)) { out.push(line.replace(/^\s+-\s+/, "").trim()); continue; }
    if (/^\S/.test(line) && !/^dependencies:/.test(line)) { inDeps = false; on = false; }
  }
  return out;
}

// The `## Standalone` section, or "" when absent.
function standaloneSection(text) {
  const m = text.match(/^##\s+Standalone\s*$/m);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return next === -1 ? rest : rest.slice(0, next);
}

export function obligations(repoRoot) {
  const skills = skillFiles(repoRoot).map((f) => {
    const text = readFileSync(f.path, "utf8");
    return {
      name: f.expectedName,
      unit: field(text, "unit"),
      soft: softDeps(text),
      reads: listUnder(text, "reads"),
      writes: listUnder(text, "writes"),
      section: standaloneSection(text),
      body: text.split(/^---\s*$/m).slice(2).join("---"),
    };
  });
  const byName = new Map(skills.map((s) => [s.name, s]));

  // Which skill declares it WRITES each path, so a read can be traced to a unit.
  const producers = new Map();
  for (const s of skills) {
    for (const w of s.writes) {
      if (!producers.has(w)) producers.set(w, []);
      producers.get(w).push(s);
    }
  }

  return skills.map((s) => {
    const dispatch = s.soft
      .map((d) => byName.get(d))
      .filter((d) => d && d.unit !== s.unit)
      .map((d) => ({ name: d.name, unit: d.unit }));

    const inputs = [];
    for (const r of s.reads) {
      const from = producers.get(r) || [];
      if (!from.length) continue;                        // no declared producer: not ours to trace
      if (from.some((p) => p.unit === s.unit)) continue; // satisfied inside the unit
      // Several skills may declare the same write - twt-eval-smoke seeds
      // positioning.md as a test fixture alongside the real producer. Naming
      // only the first one picked the fixture and pointed the reader at the
      // wrong unit, so name them all.
      const units = [...new Set(from.map((p) => p.unit))].sort();
      inputs.push({ path: r, unit: units.join(" or "), units });
    }

    // Satisfied means the section mentions the dependency by name, or the path
    // by basename. See the header: this drives a sentence, it does not grade one.
    const undocumented = [];
    for (const d of dispatch) if (!s.section.includes(d.name)) undocumented.push(d.name);
    for (const i of inputs) {
      const base = i.path.split("/").pop();
      if (!s.section.includes(base)) undocumented.push(i.path);
    }

    // A cross-unit input must never be a hard stop. "If absent, abort: run
    // /twt-positioning-define first" is right in the bundle and fatal alone,
    // where that skill does not exist to run. Paragraph-scoped, so an abort on
    // an unrelated condition does not trip it.
    const hardAborts = [];
    for (const para of s.body.split(/\n\s*\n/)) {
      if (!/\babort/i.test(para)) continue;
      for (const i of inputs) {
        const base = i.path.split("/").pop();
        if (para.includes(base)) hardAborts.push(i.path);
      }
    }

    return { ...s, dispatch, inputs, undocumented, hardAborts: [...new Set(hardAborts)] };
  });
}

const IS_MAIN = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("tools/standalone-report.mjs");
if (IS_MAIN) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const argv = process.argv.slice(2);
  const only = argv.includes("--unit") ? argv[argv.indexOf("--unit") + 1] : null;
  const todo = argv.includes("--todo");
  let listed = 0, gaps = 0;
  for (const o of obligations(ROOT)) {
    if (only && o.unit !== only) continue;
    if (!o.dispatch.length && !o.inputs.length) continue;
    if (todo && !o.undocumented.length && !o.hardAborts.length) continue;
    listed++;
    if (o.undocumented.length || o.hardAborts.length) gaps++;
    console.log(`\n${o.name}  (unit ${o.unit})`);
    for (const d of o.dispatch) console.log(`  dispatch  ${d.name}  -> unit ${d.unit}`);
    for (const i of o.inputs) console.log(`  input     ${i.path}  <- unit ${i.unit}`);
    if (o.undocumented.length) console.log(`  MISSING from ## Standalone: ${o.undocumented.join(", ")}`);
    if (o.hardAborts.length) console.log(`  HARD ABORT on a cross-unit input: ${o.hardAborts.join(", ")}`);
  }
  console.log(`\n${listed} skill(s) listed, ${gaps} with an unmet obligation.`);
}
