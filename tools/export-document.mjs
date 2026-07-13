#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mdToHtmlDoc } from "./export-html.mjs";
import { htmlToPdf } from "./pdf-render.mjs";
import { resolveThemeOrLegacy } from "./theme.mjs";
import { classifyDoc } from "./export-doctype.mjs";

const VALID_FORMATS = new Set(["pdf", "docx", "html"]);

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
    "  node tools/export-document.mjs --format html --input path/to/file.md [--theme <slug-or-path>] [--force]",
    "  node tools/export-document.mjs --format pdf --input path/to/file.md [--theme <slug-or-path>] [--force]",
    "  node tools/export-document.mjs --format docx --input path/to/file.md [--theme <slug-or-path>] [--force]",
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

// The pipeline reuses these basenames across many areas (eleven files are
// named validation-report.md); a slug from the basename alone would map them
// all to ONE export folder, silently overwriting each other. For these, the
// parent directory joins the slug: brand/validation-report.md → brand-validation-report.
const SHARED_BASENAMES = new Set([
  "validation-report", "decisions", "phase-review", "facts", "conventions",
  "index", "analysis-report", "optimized", "gaps",
]);

function outputPaths(inputPath, format, cwd = process.cwd()) {
  const parts = String(inputPath).split(/[\\/]/).filter(Boolean);
  let slug = slugify(parts.pop() || "document");
  if (SHARED_BASENAMES.has(slug) && parts.length) {
    const parent = slugify(parts.pop());
    if (parent) slug = `${parent}-${slug}`;
  }
  const dir = join(cwd, ".twt-artifacts", "export", format, slug);
  return {
    slug,
    dir,
    output: join(dir, `${slug}.${format}`),
    html: join(dir, `${slug}.html`),
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

// 'analysis-report' → 'Analysis report' — the human label under the H1 and in the
// PDF page footer.
function docTypeLabel(docType) {
  if (!docType || docType === 'generic') return undefined;
  const s = String(docType).replace(/^structural-/, '').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function runPandoc({ input, output, format, title, referenceDocx }) {
  const args = [input, "--standalone", "--metadata", `title=${title}`, "-o", output];
  if (format === "pdf") args.push("--variable", "geometry:margin=24mm", "--variable", "fontsize=11pt");
  if (format === "docx" && referenceDocx && existsSync(referenceDocx)) args.push("--reference-doc", referenceDocx);
  return spawnSync("pandoc", args, { encoding: "utf8" });
}

function renderNotes({ source, format, theme, doc, output, headingWarnings, adjustments, conversionNotes, sourceEdited, engine }) {
  return `# Render notes - ${format.toUpperCase()} - ${source.split(/[\\/]/).pop()}

Generated: ${new Date().toISOString().slice(0, 10)}
Source: ${source}
Requested format: ${format}
Theme: ${theme.slug} (${theme.source})
Doc type: ${doc.docType} → profile ${doc.profile}
${doc.evidence.map((e) => `Evidence: ${e}`).join("\n")}
Fonts: ${theme.meta?.fonts?.faces?.length ? "bundled (" + theme.meta.fonts.faces.length + " faces)" : "system stacks"}

## Outputs
- ${format.toUpperCase()}: ${output}

## Engine
- ${engine}

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

async function convert(args) {
  if (!args.format || !VALID_FORMATS.has(args.format)) {
    throw new Error(`Missing or invalid --format. Expected: pdf, docx, or html.\n${usage()}`);
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
  const doc = classifyDoc({ markdown, filePath: source });
  const audit = auditHeadings(markdown);
  const inputForPandoc = audit.adjustments.length ? paths.normalized : source;
  if (audit.adjustments.length) writeFileSync(paths.normalized, audit.normalizedMarkdown, "utf8");

  const conversionNotes = [];
  let success = false;
  let engine = "none";
  const title = audit.normalizedMarkdown.match(/^#\s+(.+)$/m)?.[1] || paths.slug;

  if (legacyTemplate) {
    conversionNotes.push(`Legacy --template ignored (prose templates never styled output): ${legacyTemplate}. Used theme '${theme.slug}'. Create a real theme with /twt-export-template-create.`);
  }

  const docMeta = { docLabel: docTypeLabel(doc.docType), date: new Date().toISOString().slice(0, 10) };

  if (args.format === "html") {
    if (!commandExists("pandoc")) { conversionNotes.push("Pandoc not found on PATH; HTML not produced."); }
    else {
      try {
        const r = mdToHtmlDoc({ markdownPath: inputForPandoc, title, theme, profile: doc.profile, docType: doc.docType, meta: docMeta });
        writeFileSync(paths.output, r.html, "utf8");
        engine = "html+theme"; success = statSync(paths.output).size > 0;
        conversionNotes.push(`Built themed HTML (theme=${theme.slug}, profile=${doc.profile}, transforms=${r.applied.join(", ") || "none"}).`);
        if (r.transformError) conversionNotes.push(`Transform fallback: ${r.transformError} (rendered generic HTML instead).`);
      } catch (e) { conversionNotes.push("HTML build failed: " + e.message); }
    }
  } else if (args.format === "pdf") {
    if (!commandExists("pandoc")) { conversionNotes.push("Pandoc not found on PATH; PDF not produced."); }
    else {
      try {
        const r = mdToHtmlDoc({ markdownPath: inputForPandoc, title, theme, profile: doc.profile, docType: doc.docType, meta: docMeta });
        writeFileSync(paths.html, r.html, "utf8"); // always saved for debugging
        conversionNotes.push(`Intermediate HTML saved: ${paths.html}`);
        if (r.transformError) conversionNotes.push(`Transform fallback: ${r.transformError} (rendered generic HTML instead).`);
        const footerLeft = docMeta.docLabel && !title.toLowerCase().includes(docMeta.docLabel.toLowerCase())
          ? `${docMeta.docLabel} — ${title}` : title;
        const pdfR = await htmlToPdf({ html: r.html, outPath: paths.output, footer: { left: footerLeft } });
        if (pdfR.ok) {
          engine = "chromium"; success = statSync(paths.output).size > 0;
          conversionNotes.push(`Rendered themed PDF via Chromium (theme=${theme.slug}, profile=${doc.profile}, transforms=${r.applied.join(", ") || "none"}).`);
        } else {
          const p = runPandoc({ input: inputForPandoc, output: paths.output, format: "pdf", title });
          success = p.status === 0 && existsSync(paths.output) && statSync(paths.output).size > 0;
          engine = "pandoc-latex";
          conversionNotes.push(`Playwright unavailable (${pdfR.reason}); fell back to pandoc LaTeX. Install the \`playwright\` npm package for themed PDF.`);
          if (!success) conversionNotes.push(`Pandoc failed: ${(p.stderr || "").trim().replace(/\r?\n/g, " ")}`);
        }
      } catch (e) { conversionNotes.push("PDF build failed: " + e.message); }
    }
  } else { // docx
    if (!commandExists("pandoc")) { conversionNotes.push("Pandoc not found on PATH; DOCX not produced."); }
    else {
      const referenceDocx = join(theme.dir, "reference", "reference.docx");
      const p = runPandoc({ input: inputForPandoc, output: paths.output, format: "docx", title, referenceDocx });
      success = p.status === 0 && existsSync(paths.output) && statSync(paths.output).size > 0;
      engine = existsSync(referenceDocx) ? "pandoc+reference.docx" : "pandoc-default";
      conversionNotes.push(existsSync(referenceDocx) ? "Converted with pandoc + theme reference.docx." : `Converted with pandoc (default reference; ${referenceDocx} missing).`);
      conversionNotes.push("DOCX gets theme typography/colors via reference doc; doc-type components are HTML/PDF-only.");
      if (!success) conversionNotes.push(`Pandoc failed: ${(p.stderr || "").trim().replace(/\r?\n/g, " ")}`);
    }
  }

  writeFileSync(paths.notes, renderNotes({
    source,
    format: args.format,
    theme,
    doc,
    output: success ? paths.output : "failed",
    headingWarnings: audit.warnings,
    adjustments: audit.adjustments,
    conversionNotes,
    sourceEdited: false,
    engine,
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
  assert.match(paths.html.replace(/\\/g, "/"), /\/\.twt-artifacts\/export\/pdf\/my-file\/my-file\.html$/);
  // shared basenames disambiguate by parent area — two validation reports must
  // never map to the same export folder
  const brandVr = outputPaths("C:/p/.twt-artifacts/pre-design/brand/validation-report.md", "pdf", "C:/p");
  const dsVr = outputPaths("C:/p/.twt-artifacts/design/design-system/validation-report.md", "pdf", "C:/p");
  assert.equal(brandVr.slug, "brand-validation-report");
  assert.equal(dsVr.slug, "design-system-validation-report");
  assert.notEqual(brandVr.dir, dsVr.dir);
  assert.equal(outputPaths("C:/p/.twt-artifacts/qa/gaps.md", "pdf", "C:/p").slug, "qa-gaps");
  // unique basenames keep their plain slug
  assert.equal(outputPaths("C:/p/.twt-artifacts/pre-design/brand/brand-brief.md", "pdf", "C:/p").slug, "brand-brief");
  console.log("export-document self-test: OK");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) selfTest();
  else if (args.help) console.log(usage());
  else {
    const result = await convert(args);
    console.log(`${args.format.toUpperCase()} export ${result.success ? "created" : "failed"}`);
    console.log(`Notes: ${result.paths.notes}`);
    if (result.success) console.log(`Output: ${result.paths.output}`);
    process.exit(result.success ? 0 : 2);
  }
} catch (error) { console.error(error.message); process.exit(1); }
