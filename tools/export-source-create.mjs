#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VALID_TYPES = new Set(["document", "presentation"]);

function parseArgs(argv) {
  const out = { force: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--type") out.type = argv[++i];
    else if (arg.startsWith("--type=")) out.type = arg.slice("--type=".length);
    else if (arg === "--title") out.title = argv[++i];
    else if (arg.startsWith("--title=")) out.title = arg.slice("--title=".length);
    else if (arg === "--instructions") out.instructions = argv[++i];
    else if (arg.startsWith("--instructions=")) out.instructions = arg.slice("--instructions=".length);
    else if (arg === "--instructions-file") out.instructionsFile = argv[++i];
    else if (arg.startsWith("--instructions-file=")) out.instructionsFile = arg.slice("--instructions-file=".length);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node tools/export-source-create.mjs --type document --title \"Brand Report\" --instructions \"...\" [--force]",
    "  node tools/export-source-create.mjs --type presentation --title \"Pitch Deck\" --instructions-file notes.txt",
  ].join("\n");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "export-source";
}

function loadInstructions(args) {
  if (args.instructionsFile) {
    if (!existsSync(args.instructionsFile)) throw new Error(`Instructions file not found: ${args.instructionsFile}`);
    return readFileSync(args.instructionsFile, "utf8").trim();
  }
  return (args.instructions || "").trim();
}

function bulletLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function documentMarkdown(title, instructions) {
  return `# ${title}

## Export instructions

${instructions || "No detailed instructions were provided."}

## Draft content

Replace this section with final document content before exporting if the instructions above are not meant to appear in the final artifact.
`;
}

function presentationMarkdown(title, instructions) {
  const bullets = bulletLines(instructions);
  const bulletBlock = bullets.length
    ? bullets.map((line) => `- ${line}`).join("\n")
    : "- Add the first key point\n- Add the second key point\n- Add the third key point";

  return `# ${title}

${instructions || "Add the presentation purpose and audience here."}

---

# Key points

${bulletBlock}

---

# Next steps

- Confirm final content
- Export with the selected template
`;
}

function createSource(args, cwd = process.cwd()) {
  if (!args.type || !VALID_TYPES.has(args.type)) {
    throw new Error(`Missing or invalid --type. Expected: document or presentation.\n${usage()}`);
  }
  const title = (args.title || "").trim();
  if (!title) throw new Error(`Missing --title.\n${usage()}`);

  const instructions = loadInstructions(args);
  const slug = slugify(title);
  const dir = join(cwd, ".twt-artifacts", "export", "sources");
  const sourcePath = join(dir, `${slug}.md`);
  const notesPath = join(dir, `${slug}.notes.md`);

  if (existsSync(sourcePath) && !args.force) {
    throw new Error(`Source already exists. Re-run with --force to overwrite: ${sourcePath}`);
  }
  mkdirSync(dir, { recursive: true });

  const markdown = args.type === "presentation"
    ? presentationMarkdown(title, instructions)
    : documentMarkdown(title, instructions);

  writeFileSync(sourcePath, markdown, "utf8");
  writeFileSync(notesPath, `# Source creation notes - ${title}

Generated: ${new Date().toISOString()}
Type: ${args.type}
Source: ${sourcePath}

## Important

This helper creates a Markdown source from user instructions so export commands have a concrete file to process. Review or refine the generated source before export when the instructions are not meant to appear verbatim in the final artifact.
`, "utf8");

  return { sourcePath, notesPath, type: args.type, title, slug };
}

function selfTest() {
  assert.equal(slugify("Executive Brief 2026!"), "executive-brief-2026");
  assert.deepEqual(bulletLines("- Alpha\n* Beta\n\nGamma"), ["Alpha", "Beta", "Gamma"]);
  const created = createSource({
    type: "presentation",
    title: "Self Test Deck",
    instructions: "One\nTwo",
    force: true,
  }, join(ROOT, ".twt-artifacts", "self-test"));
  assert(created.sourcePath.endsWith(join("sources", "self-test-deck.md")));
  assert(existsSync(created.notesPath));
  console.log("export-source-create self-test: OK");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
  } else if (args.help) {
    console.log(usage());
  } else {
    const result = createSource(args);
    console.log("Export source created");
    console.log(`Type: ${result.type}`);
    console.log(`Source: ${result.sourcePath}`);
    console.log(`Notes: ${result.notesPath}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
