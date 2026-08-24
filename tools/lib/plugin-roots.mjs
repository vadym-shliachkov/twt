// Plugin-root discovery, shared by the author-time tooling (gen-docs, check-io,
// the CI enumerator, the bump hook).
//
// The repo hosts MORE THAN ONE plugin. `.claude-plugin/marketplace.json` is the
// registry: each entry in `plugins[]` names a plugin and a `source` directory
// relative to the repo root. The monolith is `source: "./"` (its skills live in
// <root>/skills); a split-out plugin is `source: "./plugins/<name>"` and owns
// its own skills/, tools/, and .claude-plugin/plugin.json.
//
// There is ONE skill layout: skills/<name>/SKILL.md. The old flat commands/*.md
// tier is gone — a skill is a DIRECTORY so it can own the scripts, references
// and assets it needs, which a flat file could never do. Whether a skill is a
// user-facing entry point or dispatch-only is now declared by its `surface:`
// frontmatter field (command | internal), not by which folder it sits in.
// commands/ is still SCANNED so a stray leftover is discovered and reported by
// gen-docs rather than silently dropping out of the docs and the lint.
//
// This matters beyond enumeration: `${CLAUDE_PLUGIN_ROOT}` resolves to the
// OWNING plugin's directory at runtime, so a reference in a split-out skill must
// be verified against that plugin's root, never the repo root. Nesting is safe
// because plugin discovery only ever looks at <root>/skills — a plugin under
// ./plugins/ is invisible to the monolith's scan.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

export function pluginRoots(repoRoot) {
  const manifest = join(repoRoot, ".claude-plugin", "marketplace.json");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (e) {
    throw new Error(`cannot read ${manifest}: ${e.message}`);
  }
  const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : [];
  if (!plugins.length) throw new Error(`${manifest} lists no plugins`);
  return plugins.map((p) => ({
    name: p.name,
    source: p.source || "./",
    root: resolve(repoRoot, p.source || "./"),
    // The monolith's manifest is the repo-root one; a split plugin carries its own.
    manifest: join(resolve(repoRoot, p.source || "./"), ".claude-plugin", "plugin.json"),
  }));
}

// Every skill file across every plugin, as
// { path, expectedName, source: "skills"|"commands", plugin, pluginRoot }.
// `source: "commands"` is the DEPRECATED tier and should never appear; it is
// still enumerated so gen-docs can fail loudly on a leftover instead of the
// file quietly vanishing from SKILLS.md, check-io and the lint sweep.
export function skillFiles(repoRoot) {
  const out = [];
  for (const plugin of pluginRoots(repoRoot)) {
    const commandsDir = join(plugin.root, "commands");
    if (existsSync(commandsDir)) {
      for (const f of readdirSync(commandsDir)) {
        if (!f.endsWith(".md") || f === "README.md") continue;
        out.push({
          path: join(commandsDir, f),
          expectedName: basename(f, ".md"),
          source: "commands",
          plugin: plugin.name,
          pluginRoot: plugin.root,
        });
      }
    }
    const skillsDir = join(plugin.root, "skills");
    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillFile = join(skillsDir, entry.name, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        out.push({
          path: skillFile,
          expectedName: entry.name,
          source: "skills",
          plugin: plugin.name,
          pluginRoot: plugin.root,
        });
      }
    }
  }
  return out;
}

// The plugin that owns an absolute file path — longest matching root wins, so a
// nested ./plugins/<name> beats the monolith's "./". Returns undefined if the
// path is outside every plugin.
export function owningPlugin(repoRoot, filePath) {
  const abs = resolve(filePath);
  return pluginRoots(repoRoot)
    .filter((p) => abs === p.root || abs.startsWith(p.root + "/") || abs.startsWith(p.root + "\\"))
    .sort((a, b) => b.root.length - a.root.length)[0];
}
