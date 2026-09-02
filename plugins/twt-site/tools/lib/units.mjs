// The unit registry: what a skill cannot know about the plugin it ships in.
//
// WHAT IS AND IS NOT HERE
//
// Membership is NOT here. Which unit a skill belongs to is declared by that
// skill's own `unit:` frontmatter, so the two cannot drift apart - a central
// list of unit -> skills is exactly the thing that forgets a skill the day it
// is added. What a skill genuinely cannot carry is the per-PLUGIN metadata:
// the description and keywords its manifest needs, the version the bump hook
// advances, and whether the unit is finished enough to offer for install.
//
// THE `ready` FLAG
//
// A unit that is built and verified but not yet listed. Building it is what
// keeps its reference closure honest while its skills are still being taught to
// run without the rest of the pipeline; listing it would promise something that
// does not yet work. Flipping it to true also promotes the standalone-contract
// lints from warnings to errors, so it is the single definition of done.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadUnits(repoRoot) {
  const path = join(repoRoot, ".claude-plugin", "units.json");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`cannot read ${path}: ${e.message}`);
  }
  if (!parsed.units || typeof parsed.units !== "object") {
    throw new Error(`${path} has no "units" object`);
  }
  return parsed;
}

// Gate G6. Returns human-readable errors; empty means valid.
//
// Both directions matter. A `unit:` naming nothing would silently drop a skill
// out of every plugin, and a registered unit nothing names would publish an
// empty one - neither shows up as a failure anywhere else.
export function validateRegistry(reg, skills) {
  const errors = [];
  const known = new Set(Object.keys(reg.units));
  const bundle = reg.bundle && reg.bundle.name;

  if (bundle && known.has(bundle)) {
    errors.push(`unit "${bundle}" collides with the bundle plugin name; rename the unit`);
  }

  const members = new Map([...known].map((u) => [u, []]));
  for (const s of skills) {
    if (!s.unit) {
      errors.push(`skill "${s.name}" declares no unit:`);
      continue;
    }
    if (!known.has(s.unit)) {
      errors.push(`skill "${s.name}" declares unit "${s.unit}", which is not in units.json`);
      continue;
    }
    members.get(s.unit).push(s.name);
  }
  for (const [unit, names] of members) {
    if (!names.length) {
      errors.push(`unit "${unit}" is registered but has no members (no skill declares unit: ${unit})`);
    }
  }
  return errors;
}
