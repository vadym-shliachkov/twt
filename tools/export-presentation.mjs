#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mdToSlidesHtml, splitSlides } from "./export-html.mjs";
import { htmlToPdf } from "./pdf-render.mjs";
import { resolveThemeOrLegacy } from "./theme.mjs";

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
    else if (arg === "--theme") out.theme = argv[++i];
    else if (arg.startsWith("--theme=")) out.theme = arg.slice("--theme=".length);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (!out.input) out.input = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node tools/export-presentation.mjs --format pptx --input path/to/deck.md [--aspect 16:9|4:3] [--theme <slug-or-path>] [--force]",
    "  node tools/export-presentation.mjs --format pdf --input path/to/deck.md [--aspect 16:9|4:3] [--theme <slug-or-path>] [--force]",
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
    html: join(dir, `${slug}.html`),
    notes: join(dir, "render-notes.md"),
    normalized: join(dir, `${slug}.slides.md`),
  };
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

function pandocArgs({ input, output, format, aspect, title, referencePptx }) {
  const args = [input, "--standalone", "--slide-level=1", "--metadata", `title=${title}`, "-o", output];
  if (format === "pdf") {
    args.splice(1, 0, "-t", "beamer");
    args.push("--variable", `aspectratio:${aspect === "4:3" ? "43" : "169"}`);
  }
  if (format === "pptx" && aspect === "4:3") {
    // Pandoc PPTX sizing depends on its reference deck. Keep an explicit note
    // rather than pretending a CLI flag can force 4:3 in every environment.
  }
  if (format === "pptx" && referencePptx && existsSync(referencePptx)) args.push("--reference-doc", referencePptx);
  return args;
}

function runPandoc(options) {
  return spawnSync("pandoc", pandocArgs(options), { encoding: "utf8" });
}

function renderNotes({ source, format, aspect, theme, slideCount, output, warnings, conversionNotes, sourceEdited, engine }) {
  return `# Render notes - Presentation ${format.toUpperCase()} - ${source.split(/[\\/]/).pop()}

Generated: ${new Date().toISOString().slice(0, 10)}
Source: ${source}
Requested format: ${format}
Aspect ratio: ${aspect}
Theme: ${theme.slug} (${theme.source})
Fonts: ${theme.meta?.fonts?.faces?.length ? "bundled (" + theme.meta.fonts.faces.length + " faces)" : "system stacks"}

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
  const themeRef = args.theme ?? args.template;
  const { theme, legacyTemplate } = resolveThemeOrLegacy(themeRef);

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

  const markdown = readFileSync(source, "utf8");
  const analysis = analyzeSlides(markdown);
  writeFileSync(paths.normalized, analysis.normalizedMarkdown, "utf8");
  const inputForPandoc = paths.normalized;

  const conversionNotes = [];
  let success = false;
  let engine = "none";
  const title = analysis.normalizedMarkdown.match(/^#\s+(.+)$/m)?.[1] || paths.slug;
  const referencePptx = join(theme.dir, "reference", "reference.pptx");

  if (legacyTemplate) {
    conversionNotes.push(`Legacy --template ignored (prose templates never styled output): ${legacyTemplate}. Used theme '${theme.slug}'. Create a real theme with /twt-export-template-create.`);
  }

  if (!commandExists("pandoc")) {
    conversionNotes.push("Pandoc was not found on PATH; requested output was not produced.");
  } else if (args.format === "pdf") {
    try {
      const { html } = mdToSlidesHtml({ markdownPath: inputForPandoc, aspect: args.aspect, title, theme });
      writeFileSync(paths.html, html, "utf8");
      conversionNotes.push(`Intermediate HTML saved: ${paths.html}`);
      const [w, h] = args.aspect === "4:3" ? ["1024px", "768px"] : ["1280px", "720px"];
      const r = await htmlToPdf({ html, outPath: paths.output, width: w, height: h });
      if (r.ok) {
        engine = "chromium";
        success = existsSync(paths.output) && statSync(paths.output).size > 0;
        conversionNotes.push(`Rendered themed slides via Chromium (theme=${theme.slug}).`);
      } else {
        const p = runPandoc({ input: inputForPandoc, output: paths.output, format: "pdf", aspect: args.aspect, title, referencePptx });
        success = p.status === 0 && existsSync(paths.output) && statSync(paths.output).size > 0;
        engine = "pandoc-beamer";
        conversionNotes.push(`Playwright unavailable (${r.reason}); fell back to beamer. Install \`playwright\` for themed slides.`);
        if (!success) conversionNotes.push(`Pandoc failed: ${(p.stderr || p.error?.message || "").trim().replace(/\r?\n/g, " ")}`);
      }
    } catch (e) {
      conversionNotes.push("Slide PDF build failed: " + e.message);
    }
  } else { // pptx
    if (args.aspect === "4:3" && !existsSync(referencePptx)) {
      conversionNotes.push("PPTX 4:3 output requires a matching Pandoc reference deck; this script records the requested aspect but cannot guarantee slide size without one.");
    }
    const p = runPandoc({ input: inputForPandoc, output: paths.output, format: args.format, aspect: args.aspect, title, referencePptx });
    engine = existsSync(referencePptx) ? "pandoc+reference.pptx" : "pandoc-default";
    if (p.status === 0 && existsSync(paths.output) && statSync(paths.output).size > 0) {
      conversionNotes.push(existsSync(referencePptx) ? "Converted with pandoc + theme reference.pptx." : "Converted with pandoc.");
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
    theme,
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
  assert.match(paths.html.replace(/\\/g, "/"), /\/\.twt-artifacts\/export\/presentation\/my-deck\/my-deck\.html$/);
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
