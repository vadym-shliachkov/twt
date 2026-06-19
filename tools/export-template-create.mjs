#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VALID_TYPES = new Set(["document", "presentation", "universal"]);

function parseArgs(argv) {
  const out = { force: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--name") out.name = argv[++i];
    else if (arg.startsWith("--name=")) out.name = arg.slice("--name=".length);
    else if (arg === "--type") out.type = argv[++i];
    else if (arg.startsWith("--type=")) out.type = arg.slice("--type=".length);
    else if (arg === "--style") out.style = argv[++i];
    else if (arg.startsWith("--style=")) out.style = arg.slice("--style=".length);
    else if (arg === "--description") out.description = argv[++i];
    else if (arg.startsWith("--description=")) out.description = arg.slice("--description=".length);
    else if (arg === "--brand") out.brandPath = argv[++i];
    else if (arg.startsWith("--brand=")) out.brandPath = arg.slice("--brand=".length);
    else if (arg === "--instructions") out.instructions = argv[++i];
    else if (arg.startsWith("--instructions=")) out.instructions = arg.slice("--instructions=".length);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node tools/export-template-create.mjs --name \"Executive Brief\" --type document --style \"minimal editorial\" [--brand path/to/brand-brief.md] [--instructions \"...\"] [--force]",
    "  node tools/export-template-create.mjs --name \"Sales Deck\" --type presentation --style \"premium sales\"",
  ].join("\n");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "export-template";
}

function wiseName({ name, type, style, brandPath }) {
  if (name && name.trim()) return name.trim();
  const brand = brandPath
    ? slugify(brandPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "")).replace(/-/g, " ")
    : "";
  const parts = [brand, style || "minimal editorial", type || "universal"].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function loadBrand(brandPath) {
  if (!brandPath) return { path: "", excerpt: "" };
  const resolved = resolve(brandPath);
  if (!existsSync(resolved)) throw new Error(`Brand source not found: ${resolved}`);
  const text = readFileSync(resolved, "utf8");
  return {
    path: resolved,
    excerpt: text.slice(0, 5000),
  };
}

function templateBody(meta, brand) {
  const scope = meta.type === "universal"
    ? "document and presentation exports"
    : `${meta.type} exports`;
  return `# ${meta.name}

Reusable export template for ${scope}.

## Identity

- Template name: ${meta.name}
- Template slug: ${meta.slug}
- Type: ${meta.type}
- Style direction: ${meta.style}
- Description: ${meta.description}

## Brand source

${brand.path ? `Source: ${brand.path}` : "No brand source provided."}

${brand.excerpt ? `### Brand excerpt\n\n${brand.excerpt}` : ""}

## User instructions

${meta.instructions || "No additional user instructions provided."}

## Typography

Choose fonts that match the style direction while staying portable. Prefer system-safe fonts unless a brand source explicitly names usable fonts.

## Color and spacing

Use the brand palette when provided. If the brand is absent or incomplete, use restrained neutral defaults and one clear accent. Keep spacing consistent and readable.

## Format-specific guidance

- Documents: preserve semantic heading hierarchy, comfortable margins, readable body text, restrained tables, and clear code blocks.
- Presentations: preserve slide hierarchy, avoid dense slides, keep titles large, and use aspect-aware layouts.

## Differentiation notes

This template should be distinguishable by its name, type, style direction, and brand source. Do not rename it to a vague label such as "template 1" or "default new".
`;
}

function createTemplate(args, cwd = process.cwd()) {
  if (!args.type || !VALID_TYPES.has(args.type)) {
    throw new Error(`Missing or invalid --type. Expected: document, presentation, or universal.\n${usage()}`);
  }
  const brand = loadBrand(args.brandPath);
  const name = wiseName(args);
  const slug = slugify(name);
  const dir = join(cwd, ".twt-artifacts", "export", "templates", slug);
  const templatePath = join(dir, "template.md");
  const metadataPath = join(dir, "template.json");
  const notesPath = join(dir, "preview-notes.md");

  if (existsSync(dir) && !args.force) {
    throw new Error(`Template already exists. Re-run with --force to overwrite: ${dir}`);
  }
  mkdirSync(dir, { recursive: true });

  const meta = {
    name,
    slug,
    type: args.type,
    style: args.style || "minimal editorial",
    description: args.description || `${name} export template`,
    brandSource: brand.path,
    instructions: args.instructions || "",
    templatePath,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(templatePath, templateBody(meta, brand), "utf8");
  writeFileSync(metadataPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  writeFileSync(notesPath, `# Preview notes - ${name}

Generated: ${meta.createdAt}
Template: ${templatePath}
Type: ${meta.type}
Style: ${meta.style}
Brand source: ${meta.brandSource || "none"}

## Naming rationale

The name combines recognizable context, style direction, and template scope so users can distinguish it from other export templates.

## Next use

Pass this template to an export command with:

\`\`\`powershell
--template "${templatePath}"
\`\`\`
`, "utf8");

  return { dir, templatePath, metadataPath, notesPath, meta };
}

function selfTest() {
  assert.equal(slugify("Xivic Editorial Brand Report!"), "xivic-editorial-brand-report");
  assert.equal(wiseName({ type: "document", style: "technical report" }), "technical report document");
  const created = createTemplate({
    name: "Test Template",
    type: "document",
    style: "minimal",
    description: "Self-test template",
    force: true,
  }, join(ROOT, ".twt-artifacts", "self-test"));
  assert(created.templatePath.endsWith(join("test-template", "template.md")));
  assert(existsSync(created.metadataPath));
  console.log("export-template-create self-test: OK");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
  } else if (args.help) {
    console.log(usage());
  } else {
    const result = createTemplate(args);
    console.log("Export template created");
    console.log(`Name: ${result.meta.name}`);
    console.log(`Type: ${result.meta.type}`);
    console.log(`Template: ${result.templatePath}`);
    console.log(`Metadata: ${result.metadataPath}`);
    console.log(`Notes: ${result.notesPath}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

