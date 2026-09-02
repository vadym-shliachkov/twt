#!/usr/bin/env node
// build-units.mjs - generate one installable plugin per unit.
//
// WHY THIS EXISTS
//
// A user should be able to install one twt family and have it work, without the
// rest of the pipeline. Claude Code's install unit is a plugin, so "one family"
// has to BE a plugin: every script it calls present, every hook present, its own
// manifest. Hand-placing those plugins is what this replaces - two of them
// existed, and each was a second place to edit, which is the drift that
// vendoring was invented to stop.
//
// So membership is DATA (a `unit:` field per skill) and the plugin tree is
// OUTPUT. Changing the partition is a frontmatter edit plus a rebuild, never a
// file move.
//
// WHAT IS DERIVED, NOT LISTED
//
// A hand-maintained file list is the thing that drifts, so there is not one.
// Each unit carries its member skill directories plus the transitive closure of
// every ${CLAUDE_PLUGIN_ROOT}/... reference those skills make - following
// imports AND computed data paths, because templates/themes is reached by a
// join() call that no import edge reveals.
//
// ALL OR NOTHING
//
// A failing gate writes nothing. A half-built tree that someone commits is
// worse than no tree, because --check would then report it as current.
//
// Usage:
//   node tools/build-units.mjs            build every unit, write marketplace.json
//   node tools/build-units.mjs --check    verify committed output is current; exit 1 on drift
//   node tools/build-units.mjs --plan     print what each unit would carry; write nothing
//   node tools/build-units.mjs --unit <n> build one unit (development convenience)
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { skillFiles } from "./lib/plugin-roots.mjs";
import { loadUnits, validateRegistry } from "./lib/units.mjs";
import { closureFrom, syncFiles, MANIFEST, isVendorable } from "./lib/vendor.mjs";

const BS = String.fromCharCode(92);
const slash = (p) => p.split(BS).join("/");
const REF_RE = /[$][{]CLAUDE_PLUGIN_ROOT[}][/]([^\s"'`)\]]+)/g;
const GENERATED = ".twt-generated";
const json = (o) => JSON.stringify(o, null, 2) + "\n";

// ---- frontmatter ------------------------------------------------------------

// Deliberately minimal: only the fields the build gates on. gen-docs owns the
// full parse, and a second full parser here would be a second thing to keep in
// step with the format.
function parseSkill(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
  if (end === -1) return null;

  const fm = { hard: [], soft: [] };
  let ctx = null, inDeps = false;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && ctx) { fm[ctx].push(item[1].trim()); continue; }
    let m = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (m) {
      const key = m[1], val = m[2];
      inDeps = key === "dependencies";
      ctx = null;
      if (["name", "surface", "category", "family", "role", "unit", "trigger", "version"].includes(key)) {
        fm[key] = val.trim();
      }
      continue;
    }
    m = line.match(/^\s\s(hard|soft):\s*(.*)$/);
    if (m && inDeps) { ctx = m[1]; continue; }
  }
  return fm;
}

function loadSkills(repoRoot) {
  return skillFiles(repoRoot).map((f) => {
    const text = readFileSync(f.path, "utf8");
    const fm = parseSkill(text) || { hard: [], soft: [] };
    const refs = [];
    for (const m of text.matchAll(REF_RE)) {
      const rel = m[1].replace(/[.,;:]+$/, "");
      if (/[<>*${}]/.test(rel)) continue; // a placeholder in prose, not a path
      refs.push(slash(rel));
    }
    return { ...fm, name: fm.name || f.expectedName, path: f.path, refs };
  });
}

// ---- gates ------------------------------------------------------------------

function runGates(reg, skills) {
  const errors = [];
  const byName = new Map(skills.map((s) => [s.name, s]));

  // G6 first: every later gate reads `unit`, so a bad registry poisons them all.
  errors.push(...validateRegistry(reg, skills));

  // G1 - a family never splits across units. An orchestrator installed without
  // its own define has nothing to dispatch.
  const families = new Map();
  for (const s of skills) {
    if (!s.family) { errors.push(`skill "${s.name}" declares no family:`); continue; }
    if (!families.has(s.family)) families.set(s.family, []);
    families.get(s.family).push(s);
  }
  for (const [family, members] of families) {
    const units = [...new Set(members.map((m) => m.unit).filter(Boolean))].sort();
    if (units.length > 1) {
      errors.push(
        `family "${family}" is split across units ${units.join(" and ")} ` +
        `(${members.map((m) => `${m.name}->${m.unit}`).join(", ")}); a family ships whole`,
      );
    }
  }

  // G1b - an orchestrator's own sub-skills must declare its family. Without
  // this, a define could be tagged into a family other than the one that
  // dispatches it, and G1 would then happily let the two ship apart.
  const SUBROLES = new Set(["fetch", "define", "validate", "measure", "audit"]);
  for (const s of skills) {
    if (s.role !== "orchestrator") continue;
    for (const dep of s.soft) {
      const t = byName.get(dep);
      if (!t || !SUBROLES.has(t.role)) continue; // tool / pipeline deps are exempt
      if (t.family !== s.family) {
        errors.push(
          `orchestrator "${s.name}" (family ${s.family}) dispatches "${dep}", ` +
          `which declares family "${t.family}"; a sub-skill belongs to the family that dispatches it`,
        );
      }
    }
  }

  // G2 - a hard dep across units is an install-order bug, and vendoring cannot
  // fix it, because duplicating a SKILL is the trap this whole design avoids.
  for (const s of skills) {
    for (const dep of s.hard) {
      const t = byName.get(dep);
      if (!t) continue; // external: figma-mcp, WebFetch, ...
      if (t.unit !== s.unit) {
        errors.push(
          `"${s.name}" (unit ${s.unit}) declares a HARD dependency on "${dep}" (unit ${t.unit}); ` +
          `cross-unit dependencies must be soft`,
        );
      }
    }
  }

  // G3 - a unit nobody can invoke is not installable.
  for (const unit of Object.keys(reg.units)) {
    const members = skills.filter((s) => s.unit === unit);
    if (!members.length) continue; // already reported by G6
    if (!members.some((m) => m.surface === "command" || m.trigger === "model")) {
      errors.push(`unit "${unit}" has no entry point (no surface: command and no trigger: model skill)`);
    }
  }

  // G4 - a file two skills need belongs in tools/, not inside one of them.
  // Otherwise the owning skill's directory has to travel into a unit that does
  // not contain that skill, which is the duplicate-skill trap by another route.
  for (const s of skills) {
    for (const ref of s.refs) {
      const m = ref.match(/^skills[/]([^/]+)[/]/);
      if (m && m[1] !== s.name) {
        errors.push(
          `"${s.name}" references "${ref}", which lives inside skill "${m[1]}"; ` +
          `move the shared file to tools/`,
        );
      }
    }
  }
  return errors;
}

// ---- emit -------------------------------------------------------------------

function everyFileUnder(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...everyFileUnder(p, base));
    else out.push(slash(relative(base, p)));
  }
  return out;
}

function planUnit(repoRoot, members) {
  // Every ref is a closure START, including refs into a member's OWN skill
  // directory. That matters more than it looks: skills/twt-launch-audit/tools/
  // launch-scan.mjs imports ../../../tools/lib/sources.mjs, and if skill-local
  // files were merely copied and never WALKED, that shared lib would never be
  // vendored - shipping a plugin that installs and dies on its first run.
  //
  // The whole-directory copy then makes those same files redundant in the
  // vendored list, so they are subtracted AFTER the walk, not before it.
  const memberDirs = members.map((m) => `skills/${m.name}`);
  const inMember = (r) => memberDirs.some((d) => r === d || r.startsWith(d + "/"));

  const starts = members.flatMap((m) => m.refs);
  const { files, broken } = closureFrom(repoRoot, [...new Set(starts)].sort());
  const vendored = files.filter((f) => !inMember(f));

  const skillFilesOut = [];
  for (const m of members) {
    for (const f of everyFileUnder(join(repoRoot, "skills", m.name))) {
      skillFilesOut.push(`skills/${m.name}/${f}`);
    }
  }
  const hooks = everyFileUnder(join(repoRoot, "hooks")).map((f) => `hooks/${f}`);
  return {
    vendored: vendored.sort(),
    broken,
    all: [...new Set([...skillFilesOut, ...vendored, ...hooks])].sort(),
  };
}

function manifestFor(reg, unit, rootManifest) {
  const u = reg.units[unit];
  return {
    name: unit,
    version: u.version,
    description: u.description,
    author: rootManifest.author,
    homepage: rootManifest.homepage,
    repository: rootManifest.repository,
    license: rootManifest.license,
    keywords: u.keywords || [],
  };
}

function vendoredNote(unit, vendored) {
  const rows = vendored.map((f) => `| \`${f}\` | \`${f}\` |`).join("\n");
  return `# Generated - DO NOT EDIT ANYTHING IN THIS DIRECTORY

\`plugins/${unit}/\` is build output. It is regenerated in full by:

    node tools/build-units.mjs

Edit the canonical copy in the repo root's authored tree (\`skills/\`, \`tools/\`,
\`templates/\`, \`hooks/\`), then rebuild. CI runs \`--check\`, so an edit made here
instead of at the source fails the build rather than diverging silently.

| vendored file | canonical source |
|---|---|
${rows}
`;
}

function marketplaceFor(reg, rootManifest) {
  const ready = Object.entries(reg.units).filter(([, u]) => u.ready).map(([n]) => n).sort();
  return {
    name: reg.marketplace.name,
    owner: rootManifest.author,
    metadata: {
      description: reg.marketplace.description,
      version: reg.marketplace.version,
    },
    plugins: [
      { name: reg.bundle.name, source: "./", description: reg.bundle.description },
      ...ready.map((n) => ({ name: n, source: `./plugins/${n}`, description: reg.units[n].description })),
    ],
  };
}

// ---- the build --------------------------------------------------------------

export function buildUnits(repoRoot, { check = false, plan = false, only = null } = {}) {
  const reg = loadUnits(repoRoot);
  const skills = loadSkills(repoRoot);
  const errors = runGates(reg, skills);
  const drift = [], written = [], built = [];
  if (errors.length) return { errors, drift, written, units: built };

  const rootManifest = JSON.parse(readFileSync(join(repoRoot, ".claude-plugin", "plugin.json"), "utf8"));
  const unitNames = Object.keys(reg.units).sort().filter((u) => !only || u === only);
  const plans = new Map();

  for (const unit of unitNames) {
    const members = skills.filter((s) => s.unit === unit).sort((a, b) => a.name.localeCompare(b.name));
    const p = planUnit(repoRoot, members);
    // G5, checked BEFORE anything is written: a declared reference that
    // resolves nowhere would ship a plugin whose script is simply absent.
    // Name the skill, not just the path - the path alone does not say who to fix.
    for (const b of p.broken) {
      const owner = members.find((m) => m.refs.includes(b));
      errors.push(`"${owner ? owner.name : unit}" references "${b}", which does not exist`);
    }
    plans.set(unit, { plan: p, members });
  }
  if (errors.length) return { errors, drift, written, units: built };

  if (plan) {
    for (const [unit, { plan: p, members }] of plans) {
      console.log(`\n=== ${unit} - ${members.length} skill(s), ${p.vendored.length} vendored file(s) ===`);
      for (const f of p.all) console.log(`  ${f}`);
    }
    return { errors, drift, written, units: unitNames };
  }

  for (const [unit, { plan: p }] of plans) {
    const dest = join(repoRoot, "plugins", unit);
    const extras = [
      [".claude-plugin/plugin.json", json(manifestFor(reg, unit, rootManifest))],
      [MANIFEST, json({
        vendored: p.vendored,
        hashes: Object.fromEntries(
          p.vendored.map((f) => [f, createHash("sha256").update(readFileSync(join(repoRoot, f))).digest("hex")]),
        ),
      })],
      ["VENDORED.md", vendoredNote(unit, p.vendored)],
      [GENERATED, ""],
    ];

    if (check) {
      const r = syncFiles(p.all, repoRoot, dest, { check: true });
      for (const f of r.missing) drift.push(`${unit}: missing ${f}`);
      for (const f of r.drifted) drift.push(`${unit}: edited ${f}`);
      for (const [rel, body] of extras) {
        const at = join(dest, rel);
        if (!existsSync(at)) drift.push(`${unit}: missing ${rel}`);
        else if (readFileSync(at, "utf8") !== body) drift.push(`${unit}: edited ${rel}`);
      }
      const expected = new Set([...p.all, ...extras.map(([r2]) => r2)]);
      // Ignore anything the build would never vendor anyway. A test run can
      // leave .twt-artifacts/ inside a unit, and those are gitignored - calling
      // them drift would fail CI for a file nobody committed.
      for (const f of everyFileUnder(dest)) {
        if (expected.has(f) || !isVendorable(f)) continue;
        drift.push(`${unit}: stale ${f}`);
      }
      continue;
    }

    // Rebuild from empty. The generated tree is a pure function of the authored
    // tree and the registry, so a file left over from an earlier partition must
    // not survive into the new one.
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    syncFiles(p.all, repoRoot, dest);
    for (const [rel, body] of extras) {
      const at = join(dest, rel);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, body);
    }
    written.push(...p.all.map((f) => `${unit}/${f}`));
    built.push(unit);
  }

  // A directory under plugins/ that is not a registered unit is a leftover from
  // an earlier partition. Only sweep on a FULL build; --unit builds just one.
  if (!check && !only) {
    const pluginsDir = join(repoRoot, "plugins");
    if (existsSync(pluginsDir)) {
      for (const e of readdirSync(pluginsDir, { withFileTypes: true })) {
        if (e.isDirectory() && !reg.units[e.name]) {
          rmSync(join(pluginsDir, e.name), { recursive: true, force: true });
        }
      }
    }
  }

  const mp = json(marketplaceFor(reg, rootManifest));
  const mpPath = join(repoRoot, ".claude-plugin", "marketplace.json");
  if (check) {
    if (!existsSync(mpPath) || readFileSync(mpPath, "utf8") !== mp) drift.push("marketplace.json is out of date");
  } else {
    writeFileSync(mpPath, mp);
    written.push(".claude-plugin/marketplace.json");
  }

  return { errors, drift, written, units: built };
}

// ---- CLI --------------------------------------------------------------------

// Guarded: this file is also imported as a library by its tests, and an import
// must not run the CLI or touch the disk.
const IS_MAIN = process.argv[1] && slash(process.argv[1]).endsWith("tools/build-units.mjs");
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const only = argv.includes("--unit") ? argv[argv.indexOf("--unit") + 1] : null;
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const res = buildUnits(ROOT, {
    check: argv.includes("--check"),
    plan: argv.includes("--plan"),
    only,
  });
  for (const e of res.errors) console.error(`ERROR  ${e}`);
  for (const d of res.drift) console.error(`DRIFT  ${d}`);
  if (res.errors.length) {
    console.error(`\n${res.errors.length} error(s); nothing written.`);
    process.exit(1);
  }
  if (res.drift.length) {
    console.error(`\n${res.drift.length} file(s) out of date. Run: node tools/build-units.mjs`);
    process.exit(1);
  }
  if (argv.includes("--check")) console.log("Generated plugins are in sync.");
  else if (!argv.includes("--plan")) console.log(`Built ${res.units.length} unit(s): ${res.units.join(", ")}`);
}
