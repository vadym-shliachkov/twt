#!/usr/bin/env node
// move-skill-files.mjs - move a skill's exclusively-owned files into its own
// directory, and fix every reference that the move invalidates.
//
// Moving files by hand breaks three classes of reference, and missing any one of
// them leaves a build that fails somewhere far from the edit:
//
//   1. relative imports INSIDE a moved file that point at a file which did NOT
//      move (tools/launch-scan.mjs imports ./lib/sources.mjs, which is shared by
//      6 skills and stays put). The depth changes, so the specifier must change.
//   2. relative imports in a file that did NOT move pointing INTO the moved set.
//   3. ${CLAUDE_PLUGIN_ROOT}/... references in SKILL.md files, plus plain path
//      references in tests, CI and docs.
//
// Rather than hand-computing depths, every relative specifier is resolved to an
// absolute path against its OLD location and then re-expressed relative to its
// NEW one. That is correct regardless of how deep either end moves.
//
// Usage:
//   node tools/move-skill-files.mjs <skill> <src>... [--dry-run]
//
// <src> may be a file or a directory; a directory moves as a unit. Destination
// is skills/<skill>/tools/<basename>, preserving the shape under tools/.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from "node:fs";
import { join, dirname, relative, resolve, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BS = String.fromCharCode(92);
const slash = (p) => p.split(BS).join("/");
const abs = (rel) => join(ROOT, rel);

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const args = argv.filter((a) => a !== "--dry-run");
const skill = args[0];
const sources = args.slice(1);
if (!skill || !sources.length) {
  console.error("usage: move-skill-files.mjs <skill> <src>... [--dry-run]");
  process.exit(2);
}
if (!existsSync(abs(join("skills", skill)))) {
  console.error("no such skill directory: skills/" + skill);
  process.exit(2);
}

// ---- 1. build the move map (old repo-rel path -> new repo-rel path) ---------

function filesUnder(relPath) {
  const a = abs(relPath);
  if (!existsSync(a)) return [];
  if (!statSync(a).isDirectory()) return [relPath];
  const out = [];
  for (const e of readdirSync(a, { withFileTypes: true })) {
    out.push(...filesUnder(relPath + "/" + e.name));
  }
  return out;
}

const moveMap = new Map();
for (const s of sources) {
  const relSrc = slash(relative(ROOT, abs(s)));
  const destBase = "skills/" + skill + "/tools/" + basename(relSrc);
  for (const f of filesUnder(relSrc)) {
    const tail = f === relSrc ? "" : f.slice(relSrc.length);
    moveMap.set(f, destBase + tail);
  }
}
if (!moveMap.size) { console.error("nothing to move"); process.exit(2); }

const movedFrom = new Set(moveMap.keys());
const newPathOf = (oldRel) => moveMap.get(oldRel) || oldRel;

// ---- 2. rewrite relative imports -------------------------------------------

const SPEC_RE = /(from[ ]*|import[ ]*[(][ ]*|require[(][ ]*)(['"])(\.[^'"]+)(['"])/g;

function rewriteSpecifiers(text, oldFileRel, newFileRel) {
  return text.replace(SPEC_RE, (whole, head, q1, spec, q2) => {
    const targetOld = slash(relative(ROOT, resolve(dirname(abs(oldFileRel)), spec)));
    const targetNew = newPathOf(targetOld);
    let rel = slash(relative(dirname(abs(newFileRel)), abs(targetNew)));
    if (!rel.startsWith(".")) rel = "./" + rel;
    return head + q1 + rel + q2;
  });
}

const edits = [];

// (a) files that MOVE: re-resolve their own specifiers from the new location.
for (const [oldRel, newRel] of moveMap) {
  if (!/[.](mjs|js|cjs)$/.test(oldRel)) continue;
  const text = readFileSync(abs(oldRel), "utf8");
  const next = rewriteSpecifiers(text, oldRel, newRel);
  if (next !== text) edits.push({ file: oldRel, movesTo: newRel, text: next });
}

// (b) files that STAY but import into the moved set.
// Historical records are NOT rewritten. .superpowers/sdd and docs/superpowers
// are an account of what the repo looked like when that work was done; silently
// editing old task reports to match today's paths falsifies the record. The
// mover excludes itself too - its own comments cite the paths it moves.
const FROZEN = [".superpowers", "docs", "node_modules", ".git", "doc-hub", "CHANGELOG.md", ".twt-artifacts", "dist-codex", "tmp"];
const SELF = "tools/move-skill-files.mjs";

function allRepoFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (FROZEN.includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) allRepoFiles(p, out);
    else out.push(slash(relative(ROOT, p)));
  }
  return out;
}
const repoFiles = allRepoFiles(ROOT).filter((f) => f !== SELF);

for (const f of repoFiles) {
  if (movedFrom.has(f)) continue;
  if (!/[.](mjs|js|cjs)$/.test(f)) continue;
  const text = readFileSync(abs(f), "utf8");
  let touched = false;
  const next = text.replace(SPEC_RE, (whole, head, q1, spec, q2) => {
    const targetOld = slash(relative(ROOT, resolve(dirname(abs(f)), spec)));
    if (!movedFrom.has(targetOld)) return whole;
    touched = true;
    let rel = slash(relative(dirname(abs(f)), abs(newPathOf(targetOld))));
    if (!rel.startsWith(".")) rel = "./" + rel;
    return head + q1 + rel + q2;
  });
  if (touched) edits.push({ file: f, text: next });
}

// (c) plain path references anywhere (SKILL.md ${CLAUDE_PLUGIN_ROOT}/..., tests,
//     CI, docs). Longest-first so tools/launch-audit.mjs is not clobbered by a
//     tools/launch-audit prefix rewrite.
const pathPairs = [...moveMap.entries()].sort((a, b) => b[0].length - a[0].length);
const TEXT_EXT = /[.](md|yml|yaml|json|ps1|py|html|css)$/;
for (const f of repoFiles) {
  if (movedFrom.has(f)) continue;
  if (!TEXT_EXT.test(f) && !/[.](mjs|js|cjs)$/.test(f)) continue;
  let text = readFileSync(abs(f), "utf8");
  const before = text;
  for (const [oldRel, newRel] of pathPairs) {
    if (!text.includes(oldRel)) continue;
    text = text.split(oldRel).join(newRel);
  }
  if (text !== before) {
    const prior = edits.find((e) => e.file === f && !e.movesTo);
    if (prior) prior.text = prior.text.split(pathPairs[0][0]).join(pathPairs[0][1]);
    edits.push({ file: f, text });
  }
}

// ---- 2b. references this tool CANNOT rewrite -------------------------------

// Two classes of reference survived the first run of this tool and broke the
// build silently; only the test suite caught them. Both are invisible to a
// literal-substring rewrite, so they are REPORTED for a human instead of being
// guessed at:
//
//   anchors      tools/launch-audit/harvest.mjs computed
//                  const TOOLS = dirname(dirname(fileURLToPath(import.meta.url)))
//                which resolved to the repo tools/ only because of where the file
//                sat. After the move it pointed at the skill's own tools/, where
//                the shared child processes do not exist - and the harvest
//                degraded to status 'partial' rather than failing loudly.
//
//   constructed  tests built paths as `../tools/${n}` template literals. The old
//                path never appears as a literal, so nothing matched, and 52
//                tests died with MODULE_NOT_FOUND.
//
// Rewriting either automatically means guessing at intent, and a wrong guess
// here is worse than a manual edit. So: warn, loudly, and list them.
const warnings = [];

for (const [oldRel, newRel] of moveMap) {
  if (!/[.](mjs|js|cjs)$/.test(oldRel)) continue;
  const text = readFileSync(abs(oldRel), "utf8");
  if (text.includes("fileURLToPath(import.meta.url)") || text.includes("__dirname")) {
    warnings.push("ANCHOR   " + oldRel + " computes a path from its own location - verify it still resolves after the move to " + newRel);
  }
}

// The constructed-path case, precisely. A basename scan was the first attempt and
// was useless: 'report.mjs' and 'parse.mjs' appear in dozens of unrelated files,
// including the very file being scanned. The actual signal in the case that broke
// the build was a TEMPLATE LITERAL whose static prefix is the directory a file is
// moving out of:
//     const T = (n) => fileURLToPath(new URL(`../tools/${n}`, import.meta.url));
// So look for exactly that shape - a backtick literal whose text immediately
// before an interpolation ends with one of the old parent directories.
const oldParents = new Set([...moveMap.keys()].map((f) => f.split("/").slice(0, -1).join("/")));

for (const f of repoFiles) {
  if (movedFrom.has(f)) continue;
  if (!/[.](mjs|js|cjs)$/.test(f)) continue;
  let text = "";
  try { text = readFileSync(abs(f), "utf8"); } catch { continue; }
  for (const lit of text.match(/`[^`]*`/g) || []) {
    const before = lit.split("${")[0];
    if (before === lit) continue;
    for (const parent of oldParents) {
      if (!parent) continue;
      const tail = parent.split("/").pop();
      if (before.endsWith(tail + "/")) {
        warnings.push("CONSTRUCTED  " + f + "  " + lit.trim() + "  - builds a path into '" + parent + "', which is moving; repoint it by hand");
      }
    }
  }
}

// ---- 3. apply ---------------------------------------------------------------

console.log("moving " + moveMap.size + " file(s) into skills/" + skill + "/tools/");
for (const [o, n] of pathPairs) console.log("  " + o + "  ->  " + n);
console.log("");
const editedFiles = [...new Set(edits.map((e) => e.file))];
console.log("reference edits in " + editedFiles.length + " file(s):");
for (const f of editedFiles) console.log("  " + f);

if (warnings.length) {
  console.log("");
  console.log("MANUAL REVIEW REQUIRED (" + warnings.length + ") - this tool cannot rewrite these:");
  for (const w of [...new Set(warnings)]) console.log("  " + w);
}

if (DRY) { console.log(""); console.log("(dry run - nothing written)"); process.exit(0); }

// Write in-place edits for files that stay.
for (const e of edits) if (!e.movesTo) writeFileSync(abs(e.file), e.text);
// Move, applying the rewritten body where there is one.
const movedText = new Map(edits.filter((e) => e.movesTo).map((e) => [e.file, e.text]));
for (const [oldRel, newRel] of moveMap) {
  mkdirSync(dirname(abs(newRel)), { recursive: true });
  renameSync(abs(oldRel), abs(newRel));
  if (movedText.has(oldRel)) writeFileSync(abs(newRel), movedText.get(oldRel));
}
console.log("");
console.log("done.");
