#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mdToSlidesHtml } from "./export-html.mjs";
import { htmlToPdf } from "./pdf-render.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = join(ROOT, "templates", "presentation-export-style.md");
const REFERENCE_PPTX = join(ROOT, "templates", "reference.pptx");
const VALID_FORMATS = new Set(["pptx", "pdf"]);
const VALID_ASPECTS = new Set(["16:9", "4:3"]);

function parseArgs(argv) {
  const out = { aspect: "16:9", force: false, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--format") out.format = argv[++i];
    else if (arg.startsWith("--format=")) out.format = arg.slice("--format=".length);
    else if (arg === "--aspect") out.aspect = argv[++i];
    else if (arg.startsWith("--aspect=")) out.aspect = arg.slice("--aspect=".length);
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
    "  node tools/export-presentation.mjs --format pptx --input path/to/deck.md [--aspect 16:9|4:3] [--template path/to/template.md] [--force]",
    "  node tools/export-presentation.mjs --format pdf --input path/to/deck.md [--aspect 16:9|4:3] [--template path/to/template.md] [--force]",
  ].join("\n");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "presentation";
}

function outputPaths(inputPath, format, cwd = process.cwd()) {
  const slug = slugify(inputPath.split(/[\\/]/).pop() || "presentation");
  const dir = join(cwd, ".twt-artifacts", "export", "presentation", slug);
  return {
    slug,
    dir,
    output: join(dir, `${slug}.${format}`),
    notes: join(dir, "render-notes.md"),
    normalized: join(dir, `${slug}.slides.md`),
  };
}

function splitSlides(markdown) {
  const lines = markdown.split(/\r?\n/);
  const slides = [];
  let current = [];
  let inFence = false;
  let fenceMarker = "";

  for (const line of lines) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence && !inFence) {
      inFence = true;
      fenceMarker = fence[1][0];
      current.push(line);
      continue;
    }
    if (inFence && line.trim().startsWith(fenceMarker.repeat(3))) {
      inFence = false;
      fenceMarker = "";
      current.push(line);
      continue;
    }
    if (!inFence && /^-{3,}\s*$/.test(line)) {
      if (current.join("\n").trim()) slides.push(current.join("\n").trim());
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.join("\n").trim()) slides.push(current.join("\n").trim());
  return slides;
}

function analyzeSlides(markdown) {
  const slides = splitSlides(markdown);
  const warnings = [];
  const normalizedSlides = [];

  slides.forEach((slide, index) => {
    const lines = slide.split(/\r?\n/);
    const titleLine = lines.find((line) => /^#{1,6}\s+/.test(line));
    if (!titleLine) warnings.push(`Slide ${index + 1}: no heading title found.`);
    const headings = lines
      .map((line, lineIndex) => ({ line, lineIndex }))
      .filter(({ line }) => /^#{1,6}\s+/.test(line))
      .map(({ line, lineIndex }) => ({ level: line.match(/^#+/)[0].length, lineIndex, text: line.replace(/^#+\s+/, "") }));
    if (headings[0] && headings[0].level > 1) {
      warnings.push(`Slide ${index + 1}: first heading starts at H${headings[0].level}; normalized export copy uses H1.`);
      lines[headings[0].lineIndex] = `# ${headings[0].text}`;
    }

    const bullets = lines.filter((line) => /^\s*[-*+]\s+/.test(line)).length;
    if (bullets > 7) warnings.push(`Slide ${index + 1}: ${bullets} bullets; consider splitting for presentation readability.`);

    const wordCount = slide
      .replace(/```[\s\S]*?```/g, "")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .split(/\s+/)
      .filter(Boolean).length;
    if (wordCount > 120) warnings.push(`Slide ${index + 1}: ${wordCount} words; consider reducing density.`);

    normalizedSlides.push(lines.join("\n"));
  });

  return {
    slideCount: slides.length,
    warnings,
    normalizedMarkdown: normalizedSlides.join("\n\n---\n\n"),
  };
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function pandocArgs({ input, output, format, aspect, title }) {
  const args = [input, "--standalone", "--slide-level=1", "--metadata", `title=${title}`, "-o", output];
  if (format === "pdf") {
    args.splice(1, 0, "-t", "beamer");
    args.push("--variable", `aspectratio:${aspect === "4:3" ? "43" : "169"}`);
  }
  if (format === "pptx" && aspect === "4:3") {
    // Pandoc PPTX sizing depends on its reference deck. Keep an explicit note
    // rather than pretending a CLI flag can force 4:3 in every environment.
  }
  if (format === "pptx" && existsSync(REFERENCE_PPTX)) args.push("--reference-doc", REFERENCE_PPTX);
  return args;
}

function runPandoc(options) {
  return spawnSync("pandoc", pandocArgs(options), { encoding: "utf8" });
}

function renderNotes({ source, format, aspect, templatePath, slideCount, output, warnings, conversionNotes, sourceEdited, engine }) {
  return `# Render notes - Presentation ${format.toUpperCase()} - ${source.split(/[\\/]/).pop()}

Generated: ${new Date().toISOString().slice(0, 10)}
Source: ${source}
Requested format: ${format}
Aspect ratio: ${aspect}
Template: ${templatePath}

## Outputs
- ${format.toUpperCase()}: ${output}

## Engine
- ${engine}

## Slides
- Count: ${slideCount}

## Structure and density warnings
${warnings.length ? warnings.map((w) => `- ${w}`).join("\n") : "- none"}

## Conversion notes
${conversionNotes.length ? conversionNotes.map((n) => `- ${n}`).join("\n") : "- none"}

## Source edits
${sourceEdited ? "Source was edited." : "No source edits were made."}
`;
}

async function convert(args) {
  if (!args.format || !VALID_FORMATS.has(args.format)) {
    throw new Error(`Missing or invalid --format. Expected: pptx or pdf.\n${usage()}`);
  }
  if (!VALID_ASPECTS.has(args.aspect)) {
    throw new Error(`Missing or invalid --aspect. Expected: 16:9 or 4:3.\n${usage()}`);
  }
  if (!args.input) throw new Error(`Missing --input.\n${usage()}`);
  const templatePath = args.template ? resolve(args.template) : TEMPLATE_PATH;
  if (!existsSync(templatePath)) throw new Error(`Presentation export template missing: ${templatePath}`);

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
  const analysis = analyzeSlides(markdown);
  writeFileSync(paths.normalized, analysis.normalizedMarkdown, "utf8");
  const inputForPandoc = paths.normalized;

  const conversionNotes = [];
  let success = false;
  let engine = "none";
  const title = analysis.normalizedMarkdown.match(/^#\s+(.+)$/m)?.[1] || paths.slug;

  if (!commandExists("pandoc")) {
    conversionNotes.push("Pandoc was not found on PATH; requested output was not produced.");
  } else if (args.format === "pdf") {
    const html = mdToSlidesHtml({ markdownPath: inputForPandoc, aspect: args.aspect, title });
    const [w, h] = args.aspect === "4:3" ? ["1024px", "768px"] : ["1280px", "720px"];
    const r = await htmlToPdf({ html, outPath: paths.output, width: w, height: h });
    if (r.ok) {
      engine = "chromium";
      success = existsSync(paths.output) && statSync(paths.output).size > 0;
      conversionNotes.push("Rendered doc-hub-light slides via Chromium.");
    } else {
      const p = runPandoc({ input: inputForPandoc, output: paths.output, format: "pdf", aspect: args.aspect, title });
      success = p.status === 0 && existsSync(paths.output) && statSync(paths.output).size > 0;
      engine = "pandoc-beamer";
      conversionNotes.push(`Playwright unavailable (${r.reason}); fell back to beamer. Install \`playwright\` for doc-hub-light slides.`);
      if (!success) conversionNotes.push(`Pandoc failed: ${(p.stderr || p.error?.message || "").trim().replace(/\r?\n/g, " ")}`);
    }
  } else { // pptx
    if (args.aspect === "4:3" && !existsSync(REFERENCE_PPTX)) {
      conversionNotes.push("PPTX 4:3 output requires a matching Pandoc reference deck; this script records the requested aspect but cannot guarantee slide size without one.");
    }
    const p = runPandoc({ input: inputForPandoc, output: paths.output, format: args.format, aspect: args.aspect, title });
    engine = existsSync(REFERENCE_PPTX) ? "pandoc+reference.pptx" : "pandoc-default";
    if (p.status === 0 && existsSync(paths.output) && statSync(paths.output).size > 0) {
      conversionNotes.push(existsSync(REFERENCE_PPTX) ? "Converted with pandoc + doc-hub-light reference.pptx." : "Converted with pandoc.");
      success = true;
    } else {
      conversionNotes.push(`Pandoc failed with exit code ${p.status ?? "unknown"}.`);
      const stderr = (p.stderr || p.error?.message || "").trim();
      if (stderr) conversionNotes.push(stderr.replace(/\r?\n/g, " "));
    }
  }

  writeFileSync(paths.notes, renderNotes({
    source,
    format: args.format,
    aspect: args.aspect,
    templatePath,
    slideCount: analysis.slideCount,
    output: success ? paths.output : "failed",
    warnings: analysis.warnings,
    conversionNotes,
    sourceEdited: false,
    engine,
  }), "utf8");

  return { success, paths, slideCount: analysis.slideCount, warnings: analysis.warnings, conversionNotes };
}

function selfTest() {
  assert.equal(slugify("Q3 Strategy Deck.md"), "q3-strategy-deck");
  assert.equal(parseArgs(["--format", "pptx", "--input", "deck.md", "--template", "custom.md"]).template, "custom.md");
  const slides = splitSlides(["# Cover", "", "---", "", "# Slide 2", "- A"].join("\n"));
  assert.equal(slides.length, 2);
  const analysis = analyzeSlides(["## Wrong level", "- one", "---", "# Dense", Array(8).fill("- point").join("\n")].join("\n"));
  assert.equal(analysis.slideCount, 2);
  assert.match(analysis.normalizedMarkdown, /^# Wrong level/m);
  assert(analysis.warnings.some((warning) => warning.includes("8 bullets")));
  assert.equal(parseArgs(["--format", "pdf", "--input", "deck.md"]).aspect, "16:9");
  const paths = outputPaths("C:/tmp/My Deck.md", "pptx", "C:/work/project");
  assert.match(paths.output.replace(/\\/g, "/"), /\/\.twt-artifacts\/export\/presentation\/my-deck\/my-deck\.pptx$/);
  console.log("export-presentation self-test: OK");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
  } else if (args.help) {
    console.log(usage());
  } else {
    const result = await convert(args);
    console.log(`${args.format.toUpperCase()} presentation export ${result.success ? "created" : "failed"}`);
    console.log(`Slides: ${result.slideCount}`);
    console.log(`Notes: ${result.paths.notes}`);
    if (result.success) console.log(`Output: ${result.paths.output}`);
    process.exit(result.success ? 0 : 2);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
