// vendor.mjs - what a generated plugin must carry, and how the copies are made.
//
// THE PROBLEM
//
// A unit ships its member skill directories plus every bundled file those
// skills reach. "Reach" is not just import edges, and that distinction has
// already cost one broken plugin: tools/theme.mjs finds templates/themes
// through join(HERE, '..', 'templates', 'themes'), which no import statement
// reveals. The first walker that followed imports only reported "0 files to
// vendor" for a plugin whose every export would have died on a missing theme
// directory.
//
// DECLARED VS DISCOVERED
//
// A DECLARED ref - one a SKILL.md actually writes as ${CLAUDE_PLUGIN_ROOT}/... -
// that resolves nowhere is broken, and shipping it would produce a plugin whose
// script is simply absent. A DISCOVERED computed path that resolves nowhere is
// usually an OUTPUT location: export-source-create.mjs has
// join(ROOT, ".twt-artifacts", "self-test"), a directory it writes at runtime.
// Treating those as broken produced a phantom failure on the first real run, so
// only declared refs are reported.
//
// Everything here is parameterised on repoRoot, so the build can be tested
// against a fixture instead of the live repo.
import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { depSpecifiers, anchorKind } from "../split-readiness.mjs";

const BS = String.fromCharCode(92);
const slash = (p) => p.split(BS).join("/");

// Every file under a repo-relative path. A file yields itself; a directory
// yields its whole subtree, because a directory reference travels as a unit and
// a manifest entry naming a directory gives the byte check nothing to compare.
function filesUnder(repoRoot, relPath) {
  const abs = join(repoRoot, relPath);
  if (!existsSync(abs)) return [];
  let st;
  try { st = statSync(abs); } catch { return []; }
  if (!st.isDirectory()) return [relPath];
  const out = [];
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    out.push(...filesUnder(repoRoot, relPath + "/" + e.name));
  }
  return out;
}

// The transitive set of repo-relative files reachable from `startRels`.
// Returns { files, broken } - both sorted, both flat file lists.
export function closureFrom(repoRoot, startRels) {
  const seen = new Set();
  const found = new Set();
  const broken = new Set();
  const queue = startRels.map((rel) => ({ rel, declared: true }));

  while (queue.length) {
    const { rel, declared } = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);

    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) {
      if (declared) broken.add(rel);
      continue;
    }
    for (const f of filesUnder(repoRoot, rel)) found.add(f);

    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) continue;              // travels whole; no need to walk in
    if (!/[.](mjs|js|cjs)$/.test(abs)) continue; // only scripts carry dependencies

    let src = "";
    try { src = readFileSync(abs, "utf8"); } catch { continue; }
    const { imports, assets } = depSpecifiers(src);
    const push = (target) => {
      const r = slash(relative(repoRoot, target));
      // A specifier escaping the repo is a node_modules import or a typo;
      // either way it is not ours to vendor.
      if (r.startsWith("..")) return;
      if (!isVendorable(r)) return;
      queue.push({ rel: r, declared: false });
    };
    for (const spec of imports) push(resolve(dirname(abs), spec));
    // A computed path is anchored on a variable whose value this walker cannot
    // know, so it reads the variable's NAME (see anchorKind). Resolving only
    // against the file's directory silently missed every ROOT-anchored path -
    // the wiki unit would have shipped without the templates it writes from.
    // Resolving against both anchors instead over-collected, pulling the repo's
    // own README and AGENTS.md into three units. The name is the discriminator.
    for (const parts of assets) {
      const kind = anchorKind(parts.anchor);
      let target = null;
      if (kind === "file") target = resolve(dirname(abs), ...parts);
      else if (kind === "repo") target = resolve(repoRoot, ...parts);
      // kind === null: a runtime output directory, not a dependency.
      if (target && isPlausibleAsset(slash(relative(repoRoot, target)))) push(target);
    }
  }
  return { files: [...found].sort(), broken: [...broken].sort() };
}

// Paths that are never a dependency, however a computed path reaches them.
//
// The empty string is the REPO ROOT itself, and that is not a hypothetical:
// tools/wiki-init.mjs opens with `const ROOT = join(HERE, '..')` purely to
// build a real path on the next line. Treating that as a dependency made the
// first real build vendor the entire repo into the wiki unit - node_modules,
// docs, and plugins/ itself, so each build then carried the previous build's
// output and the tree grew every run.
export function isVendorable(rel) {
  if (rel === "" || rel === ".") return false;      // the repo root
  const top = rel.split("/")[0];
  if (top === "plugins") return false;              // generated output, never a source
  if (top === "node_modules") return false;         // dependencies, not ours to copy
  if (top === ".git") return false;
  // The artifact namespace is runtime OUTPUT. export-source-create.mjs writes
  // .twt-artifacts/self-test/ during its self-test, and once that had run the
  // export unit began carrying a generated deck as if it were source - making
  // --check fail every time the self-test reran.
  if (top === ".twt-artifacts" || top === ".project-wiki") return false;
  return true;
}

// Is a DISCOVERED computed path plausibly a bundled dependency at all?
//
// Only depth matters, and one segment is the giveaway. Every genuine bundled
// dependency names something specific - templates/themes, templates/wiki,
// tools/lib/sources.mjs. A bare top-level path is something else entirely:
//
//   join(REPO, 'tools')   in launch-audit/harvest.mjs is a directory it SCANS
//                         at run time. Following it vendored all 78 files of
//                         tools/ into the qa unit - the wiki tools, the export
//                         tools, the build itself.
//   join(ROOT, 'SKILLS.md') in gen-docs.mjs is a file it WRITES, and following
//                         it put the repo's own SKILLS.md, README.md and
//                         architecture.md inside the site unit.
//
// Neither is a dependency, and no static walker can tell a read from a write.
// Requiring two segments costs nothing real and removes both classes.
//
// This applies ONLY to discovered paths. A DECLARED ${CLAUDE_PLUGIN_ROOT}/x ref
// is a deliberate statement by a skill author and is always followed.
function isPlausibleAsset(rel) {
  return rel.includes("/");
}

export const MANIFEST = ".vendored.json";

// Byte comparison, not mtime or size: a same-length edit is exactly the drift
// that must not slip through.
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
