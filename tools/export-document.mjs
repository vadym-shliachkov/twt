#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = join(ROOT, "templates", "document-export-style.md");
const VALID_FORMATS = new Set(["pdf", "docx"]);

function parseArgs(argv) {
  const out = { force: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--format") out.format = argv[++i];
    else if (arg.startsWith("--format=")) out.format = arg.slice("--format=".length);
    else if (arg === "--input") out.input = argv[++i];
    else if (arg.startsWith("--input=")) out.input = arg.slice("--input=".length);
    else if (arg === "--template") out.template = argv[++i];
    else if (arg.startsWith("--template=")) out.template = arg.slice("--template=".length);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (!out.input) out.input = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node tools/export-document.mjs --format pdf --input path/to/file.md [--template path/to/template.md] [--force]",
    "  node tools/export-document.mjs --format docx --input path/to/file.md [--template path/to/template.md] [--force]",
  ].join("\n");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "document";
}

function outputPaths(inputPath, format, cwd = process.cwd()) {
  const slug = slugify(inputPath.split(/[\\/]/).pop() || "document");
  const dir = join(cwd, ".twt-artifacts", "export", format, slug);
  return {
    slug,
    dir,
    output: join(dir, `${slug}.${format}`),
    notes: join(dir, "render-notes.md"),
    normalized: join(dir, `${slug}.normalized.md`),
  };
}

function auditHeadings(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headings = [];
  let inFence = false;
  let fenceMarker = "";

  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^\s*(```+|~~~+)/);
    if (fence && !inFence) {
      inFence = true;
      fenceMarker = fence[1][0];
      continue;
    }
    if (inFence && lines[i].trim().startsWith(fenceMarker.repeat(3))) {
      inFence = false;
      fenceMarker = "";
      continue;
    }
    if (inFence) continue;
    const heading = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) headings.push({ line: i + 1, level: heading[1].length, text: heading[2], raw: lines[i] });
  }

  const warnings = [];
  const topLevel = headings.filter((h) => h.level === 1);
  if (topLevel.length === 0) warnings.push("No H1 title found.");
  if (topLevel.length > 1) warnings.push(`Multiple H1 titles found (${topLevel.length}).`);

  let previous = 0;
  const adjustments = [];
  const normalizedLines = [...lines];
  for (const heading of headings) {
    if (previous > 0 && heading.level > previous + 1) {
      const nextLevel = previous + 1;
      warnings.push(`Line ${heading.line}: ${"#".repeat(heading.level)} skips from H${previous} to H${heading.level}; normalized export copy uses H${nextLevel}.`);
      normalizedLines[heading.line - 1] = `${"#".repeat(nextLevel)} ${heading.text}`;
      adjustments.push({ line: heading.line, from: heading.level, to: nextLevel, text: heading.text });
      previous = nextLevel;
      continue;
    }
    previous = heading.level;
  }

  return {
    warnings,
    adjustments,
    normalizedMarkdown: adjustments.length ? normalizedLines.join("\n") : markdown,
  };
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function runPandoc({ input, output, format, title }) {
  const args = [
    input,
    "--standalone",
    "--metadata",
    `title=${title}`,
    "-o",
    output,
  ];
  if (format === "pdf") {
    args.push("--variable", "geometry:margin=24mm", "--variable", "fontsize=11pt");
  }
  return spawnSync("pandoc", args, { encoding: "utf8" });
}

function renderNotes({ source, format, templatePath, output, headingWarnings, adjustments, conversionNotes, sourceEdited }) {
  return `# Render notes - ${format.toUpperCase()} - ${source.split(/[\\/]/).pop()}

Generated: ${new Date().toISOString().slice(0, 10)}
Source: ${source}
Requested format: ${format}
Template: ${templatePath}

## Outputs
- ${format.toUpperCase()}: ${output}

## Heading nesting
${headingWarnings.length ? headingWarnings.map((w) => `- ${w}`).join("\n") : "- none"}

## Temporary export-copy adjustments
${adjustments.length ? adjustments.map((a) => `- Line ${a.line}: H${a.from} -> H${a.to} (${a.text})`).join("\n") : "- none"}

## Conversion notes
${conversionNotes.length ? conversionNotes.map((n) => `- ${n}`).join("\n") : "- none"}

## Source edits
${sourceEdited ? "Source was edited." : "No source edits were made."}
`;
}

function convert(args) {
  if (!args.format || !VALID_FORMATS.has(args.format)) {
    throw new Error(`Missing or invalid --format. Expected: pdf or docx.\n${usage()}`);
  }
  if (!args.input) throw new Error(`Missing --input.\n${usage()}`);
  const templatePath = args.template ? resolve(args.template) : TEMPLATE_PATH;
  if (!existsSync(templatePath)) throw new Error(`Document export template missing: ${templatePath}`);

  const source = resolve(args.input);
  if (!existsSync(source)) throw new Error(`Input file not found: ${source}`);
  const ext = extname(source).toLowerCase();
  if (![".md", ".markdown"].includes(ext)) {
    throw new Error(`Input must be a Markdown file (.md or .markdown): ${source}`);
  }

  const paths = outputPaths(source, args.format);
  mkdirSync(paths.dir, { recursive: true });
  if (existsSync(paths.output) && !args.force) {
    throw new Error(`Output exists. Re-run with --force to overwrite: ${paths.output}`);
  }

  readFileSync(templatePath, "utf8");
  const markdown = readFileSync(source, "utf8");
  const audit = auditHeadings(markdown);
  const inputForPandoc = audit.adjustments.length ? paths.normalized : source;
  if (audit.adjustments.length) writeFileSync(paths.normalized, audit.normalizedMarkdown, "utf8");

  const conversionNotes = [];
  let success = false;
  if (!commandExists("pandoc")) {
    conversionNotes.push("Pandoc was not found on PATH; requested output was not produced.");
  } else {
    const title = audit.normalizedMarkdown.match(/^#\s+(.+)$/m)?.[1] || paths.slug;
    const result = runPandoc({ input: inputForPandoc, output: paths.output, format: args.format, title });
    if (result.status === 0 && existsSync(paths.output) && statSync(paths.output).size > 0) {
      conversionNotes.push("Converted with pandoc.");
      success = true;
    } else {
      conversionNotes.push(`Pandoc failed with exit code ${result.status ?? "unknown"}.`);
      const stderr = (result.stderr || result.error?.message || "").trim();
      if (stderr) conversionNotes.push(stderr.replace(/\r?\n/g, " "));
    }
  }

  writeFileSync(paths.notes, renderNotes({
    source,
    format: args.format,
    templatePath,
    output: success ? paths.output : "failed",
    headingWarnings: audit.warnings,
    adjustments: audit.adjustments,
    conversionNotes,
    sourceEdited: false,
  }), "utf8");

  return { success, paths, warnings: audit.warnings, conversionNotes };
}

function selfTest() {
  assert.equal(slugify("Brand Brief_Final.md"), "brand-brief-final");
  assert.equal(parseArgs(["--format", "pdf", "--input", "a.md", "--template", "custom.md"]).template, "custom.md");
  const audited = auditHeadings([
    "# Title",
    "```",
    "#### Ignored code heading",
    "```",
    "## Section",
    "#### Skipped",
  ].join("\n"));
  assert.equal(audited.adjustments.length, 1);
  assert.equal(audited.adjustments[0].from, 4);
  assert.equal(audited.adjustments[0].to, 3);
  assert.match(audited.normalizedMarkdown, /^### Skipped$/m);
  const paths = outputPaths("C:/tmp/My File.md", "pdf", "C:/work/project");
  assert.match(paths.output.replace(/\\/g, "/"), /\/\.twt-artifacts\/export\/pdf\/my-file\/my-file\.pdf$/);
  console.log("export-document self-test: OK");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
  } else if (args.help) {
    console.log(usage());
  } else {
    const result = convert(args);
    console.log(`${args.format.toUpperCase()} export ${result.success ? "created" : "failed"}`);
    console.log(`Notes: ${result.paths.notes}`);
    if (result.success) console.log(`Output: ${result.paths.output}`);
    process.exit(result.success ? 0 : 2);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
