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
import { depSpecifiers } from "../split-readiness.mjs";

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
      if (!r.startsWith("..")) queue.push({ rel: r, declared: false });
    };
    for (const spec of imports) push(resolve(dirname(abs), spec));
    for (const parts of assets) push(resolve(dirname(abs), ...parts));
  }
  return { files: [...found].sort(), broken: [...broken].sort() };
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
