#!/usr/bin/env node
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PLUGIN_NAME = "twt-marketplace";
const DEFAULT_OUT = join(ROOT, "dist-codex", PLUGIN_NAME);

const COPIED_DIRS = ["tools", "templates", "references", "hooks"];

function usage() {
  return `usage:
  node tools/export-to-codex.mjs [--out <dir>]
  node tools/export-to-codex.mjs --install user

Options:
  --out <dir>       Write a previewable Codex plugin copy. Defaults to dist-codex/twt-marketplace.
  --install user    Install generated skills into ~/.agents/skills and support files into ~/.codex/twt-marketplace.
  --help            Show this help.
`;
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, install: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--out") {
      const value = argv[++i];
      if (!value) throw new Error("--out requires a directory");
      args.out = resolve(value);
    } else if (arg === "--install") {
      const value = argv[++i];
      if (value !== "user") throw new Error("--install currently supports only: user");
      args.install = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function cleanSlashPath(path) {
  return path.split(sep).join("/");
}

async function assertGeneratedTargetCanBeReplaced(outDir) {
  if (!(await pathExists(outDir))) return;

  const manifestPath = join(outDir, ".codex-plugin", "plugin.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `refusing to replace ${outDir}: it does not look like a generated ${PLUGIN_NAME} plugin`,
    );
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.name !== PLUGIN_NAME) {
    throw new Error(
      `refusing to replace ${outDir}: plugin name is ${JSON.stringify(manifest.name)}`,
    );
  }

  await rm(outDir, { recursive: true, force: true });
}

async function listMarkdownFiles(dir) {
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(dir, entry.name));
}

async function listSkillDirs(dir) {
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name, "SKILL.md"))
    .filter((path) => existsSync(path));
}

function insertCodexNote(text, name, options = {}) {
  const runtimeRoot = options.runtimeRoot || "<codex-plugin-root>";
  const reloadLine = options.directUserInstall
    ? " Reload Codex or start a new session after install so the user skills list is refreshed."
    : "";
  const note = [
    "",
    "> **Codex adaptation note.** This file was generated from the TWT Claude Code marketplace. Invoke it as `$" + name + "` or select it from `/skills`. Treat the text after the skill invocation as the argument string. Resolve `" + runtimeRoot + "` as the installed TWT support folder that contains `skills/`, `tools/`, `templates/`, `references/`, and `hooks/`. Legacy Claude Code permission setup is a no-op in Codex; rely on the active Codex approvals and sandbox." + reloadLine,
    "",
  ].join("\n");

  const h1 = new RegExp(`^# \\$${escapeRegExp(name)}\\s*$`, "m");
  if (h1.test(text)) return text.replace(h1, `# $${name}${note}`);
  return `${note}${text}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function adaptSkillText(raw, name, options = {}) {
  const runtimeRoot = options.runtimeRoot || "<codex-plugin-root>";
  let text = raw.replace(/^\uFEFF/, "");

  text = text.replace(new RegExp(`^# /${escapeRegExp(name)}\\s*$`, "m"), `# $${name}`);
  text = text.replace(/\/twt-([a-z0-9-]+)/g, "$twt-$1");
  text = text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, runtimeRoot);
  text = text.replace(/\$CLAUDE_PLUGIN_ROOT/g, runtimeRoot);
  text = text.replace(/\$CLAUDE_PROJECT_DIR/g, "<current-project-root>");
  text = text.replace(/\$ARGUMENTS/g, "the invocation arguments");
  text = text.replace(/AskUserQuestion tool/g, "Codex user-input flow");
  text = text.replace(/AskUserQuestion/g, "Codex user-input flow");
  text = text.replace(/Agent tool/g, "Codex sibling-skill or subagent dispatch");
  text = text.replace(/Claude Code/g, "Codex");
  text = text.replace(/\.claude\/settings\.json/g, "Codex session permissions");
  text = text.replace(new RegExp("`" + escapeRegExp(runtimeRoot), "g"), "`" + runtimeRoot);

  return insertCodexNote(text, name, options);
}

async function writeManifest(outDir) {
  const manifestDir = join(outDir, ".codex-plugin");
  await mkdir(manifestDir, { recursive: true });
  const manifest = {
    name: PLUGIN_NAME,
    version: readVersionFromReadmeFallback(),
    description: "TWT marketplace workflows exported for Codex.",
    skills: "./skills/",
  };
  await writeFile(
    join(manifestDir, "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function readVersionFromReadmeFallback() {
  return "1.0.0";
}

async function copySupportDirs(outDir) {
  for (const dir of COPIED_DIRS) {
    const src = join(ROOT, dir);
    if (!existsSync(src)) continue;
    await cp(src, join(outDir, dir), {
      recursive: true,
      force: true,
      filter: (source) => {
        const base = basename(source);
        if (base === ".DS_Store") return false;
        if (dir === "tools" && /^export-to-codex(?:\.test)?\.mjs$/.test(base)) return false;
        if (dir === "hooks" && base === "hooks.json") return false;
        return true;
      },
    });
  }
  await adaptCopiedHooks(outDir);
}

async function adaptCopiedHooks(outDir) {
  const hooksDir = join(outDir, "hooks");
  if (!existsSync(hooksDir)) return;

  const files = await readdir(hooksDir, { withFileTypes: true });
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const file = join(hooksDir, entry.name);
    let text = await readFile(file, "utf8");
    text = text.replace(/\$CLAUDE_PROJECT_DIR/g, "the current Codex working directory");
    text = text.replace(/Claude Code/g, "Codex");
    text = text.replace(/process\.env\.CLAUDE_PROJECT_DIR \|\| process\.cwd\(\)/g, "process.cwd()");
    await writeFile(file, text, "utf8");
  }
}

async function exportExistingSkills(outDir, options = {}) {
  const skillFiles = await listSkillDirs(join(ROOT, "skills"));
  for (const sourceFile of skillFiles) {
    const name = sourceFile.split(sep).at(-2);
    const raw = await readFile(sourceFile, "utf8");
    const outFile = join(outDir, "skills", name, "SKILL.md");
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, adaptSkillText(raw, name, options), "utf8");
  }
  return skillFiles.length;
}

async function exportCommandsAsSkills(outDir, options = {}) {
  const commandFiles = await listMarkdownFiles(join(ROOT, "commands"));
  let count = 0;
  for (const sourceFile of commandFiles) {
    const fileName = sourceFile.split(sep).at(-1);
    if (fileName === "README.md") continue;
    const name = fileName.replace(/\.md$/, "");
    const raw = await readFile(sourceFile, "utf8");
    const outFile = join(outDir, "skills", name, "SKILL.md");
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, adaptSkillText(raw, name, options), "utf8");
    count++;
  }
  return count;
}

async function exportCodexPlugin(outDir, options = {}) {
  await assertGeneratedTargetCanBeReplaced(outDir);
  await mkdir(outDir, { recursive: true });
  await writeManifest(outDir);
  await copySupportDirs(outDir);
  const copiedSkills = await exportExistingSkills(outDir, options);
  const convertedCommands = await exportCommandsAsSkills(outDir, options);
  return { outDir, copiedSkills, convertedCommands };
}

async function installUser() {
  const codexHome = resolve(process.env.TWT_CODEX_HOME || join(homedir(), ".codex"));
  const agentsHome = resolve(process.env.TWT_AGENTS_HOME || join(homedir(), ".agents"));
  const supportRoot = join(codexHome, PLUGIN_NAME);
  const userSkillsRoot = join(agentsHome, "skills");
  const runtimeRoot = cleanSlashPath(supportRoot);

  const summary = await exportCodexPlugin(supportRoot, {
    runtimeRoot,
    directUserInstall: true,
  });
  const installedSkills = await installGeneratedSkills(join(supportRoot, "skills"), userSkillsRoot);
  return { ...summary, supportRoot, userSkillsRoot, installedSkills };
}

async function installGeneratedSkills(generatedSkillsRoot, userSkillsRoot) {
  await mkdir(userSkillsRoot, { recursive: true });
  const entries = await readdir(generatedSkillsRoot, { withFileTypes: true });
  let installed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("twt-")) continue;
    const sourceDir = join(generatedSkillsRoot, entry.name);
    const targetDir = join(userSkillsRoot, entry.name);
    await assertUserSkillCanBeReplaced(targetDir);
    await rm(targetDir, { recursive: true, force: true });
    await cp(sourceDir, targetDir, { recursive: true, force: true });
    installed++;
  }
  return installed;
}

async function assertUserSkillCanBeReplaced(targetDir) {
  if (!(await pathExists(targetDir))) return;
  const skillPath = join(targetDir, "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error(`refusing to replace ${targetDir}: existing folder is not a Codex skill`);
  }
  const text = await readFile(skillPath, "utf8");
  if (!text.includes("generated from the TWT Claude Code marketplace")) {
    throw new Error(`refusing to replace ${targetDir}: existing skill was not generated by this exporter`);
  }
}

function printSummary(summary) {
  console.log(`Codex plugin exported: ${summary.outDir}`);
  console.log(`Existing skills copied: ${summary.copiedSkills}`);
  console.log(`Commands converted to skills: ${summary.convertedCommands}`);
  if (summary.userSkillsRoot) {
    console.log(`User skills installed: ${summary.installedSkills}`);
    console.log(`User skills root: ${summary.userSkillsRoot}`);
    console.log(`Support files root: ${summary.supportRoot}`);
    console.log("Reload Codex or start a new session, then use /skills or invoke $twt-* directly.");
  } else {
    console.log("Preview build only. Use --install user to install into ~/.agents/skills.");
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(usage());
      return;
    }

    const summary = args.install === "user"
      ? await installUser()
      : await exportCodexPlugin(resolve(args.out));
    printSummary(summary);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    process.exit(2);
  }
}

await main();
