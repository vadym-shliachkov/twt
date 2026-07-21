import fs from "node:fs";
import path from "node:path";
import { TOKEN_USAGE_GUIDE, tokenUsageFor } from "./token-usage.mjs";

const root = process.cwd();
const outDir = path.join(root, "doc-hub");
const source = fs.readFileSync(path.join(root, "SKILLS.md"), "utf8").replace(/\r\n?/g, "\n");

const blocks = [
  {
    id: "general",
    name: "General",
    kicker: "Utilities",
    href: "blocks/general.html",
    status: "Ready",
    description:
      "Cross-cutting helpers for setup, full-pipeline orchestration, exports, docs, status checks, and search.",
    skills: [
      "twt-site",
      "twt-site-dev",
      "twt-setup",
      "twt-status",
      "twt-marketplace-docs",
      "twt-search-site",
      "twt-export",
      "twt-export-docx",
      "twt-export-pdf",
      "twt-export-presentation",
      "twt-export-template-create",
      "twt-content-optimize",
    ],
  },
  {
    id: "pre-design",
    name: "Pre-design",
    kicker: "Phase 1",
    href: "blocks/pre-design.html",
    status: "Ready",
    description:
      "Shape the raw project signal into a practical brief: intake, content, brand, positioning, IA, and curation.",
    skills: [
      "twt-project-intake",
      "twt-pre-design",
      "twt-spec",
      "twt-spec-define",
      "twt-brand",
      "twt-brand-fetch",
      "twt-brand-define",
      "twt-positioning",
      "twt-positioning-define",
      "twt-ia-define",
      "twt-content-fetch",
      "twt-content-fetch-site",
      "twt-content-fetch-pdf",
      "twt-content-fetch-doc",
      "twt-content-fetch-figma",
      "twt-curation-define",
      "twt-text-analysis",
    ],
  },
  {
    id: "design",
    name: "Design",
    kicker: "Phase 2",
    href: "blocks/design.html",
    status: "Ready",
    description:
      "Turn the brief into a design spine: tokens, component behavior, layouts, mockups, and design-system checks.",
    skills: [
      "twt-design",
      "twt-design-system",
      "twt-design-system-define",
      "twt-design-system-audit",
      "twt-block-preview",
      "twt-component-define",
      "twt-layout-define",
      "twt-mockup-define",
      "twt-content-approval-checklist",
      "twt-design-system-validate",
      "twt-component-validate",
      "twt-layout-validate",
      "twt-mockup-validate",
    ],
  },
  {
    id: "develop",
    name: "Develop",
    kicker: "Phase 3",
    href: "blocks/develop.html",
    status: "Maintenance",
    description:
      "Promote approved design into build targets: static HTML, Elementor widgets, themes, and implementation passes.",
    skills: [
      "twt-develop",
      "twt-html-site-creator",
      "twt-html-block-creator",
      "twt-elementor-theme-creator",
      "twt-elementor-block-creator",
      "twt-content-approval-implement",
    ],
  },
  {
    id: "qa",
    name: "QA",
    kicker: "Phase 4",
    href: "blocks/qa.html",
    status: "Maintenance",
    description:
      "Audit the built work for accessibility, content fidelity, links, responsive risks, and design-token hygiene.",
    skills: [
      "twt-qa",
      "twt-qa-a11y",
      "twt-qa-content",
      "twt-qa-design",
      "twt-qa-elementor",
      "twt-qa-links",
      "twt-content-validate",
    ],
  },
];

const MAINTENANCE_NOTICE = "Under maintenance. These skills are being reviewed and may change. Verify their output before using it in production.";

const blockBySkill = new Map();
for (const block of blocks) {
  for (const skill of block.skills) blockBySkill.set(skill, block);
}

// Doc-hub-only short descriptions for skill cards. Curated, client-facing
// one-liners — they intentionally do NOT touch each skill's canonical
// `**Purpose:**` line (which still drives the detail pages and SKILLS.md).
// Keyed by skill slug; a missing entry falls back to the trimmed purpose.
const shortDescriptions = {
  "twt-brand": "Build and sanity-check your brand brief in one pass — fetch from a source if given, then define and validate.",
  "twt-brand-fetch": "Pull existing brand signals from a brand book, Figma, screenshots, or a live site into raw notes.",
  "twt-component-define": "Document every UI component — anatomy, variants, states, tokens — and render a full interactive gallery.",
  "twt-component-validate": "Review the component library for token-only styling, reuse quality, state coverage, and accessibility.",
  "twt-content-approval-checklist": "Generate a per-page approval workbook so every headline, link, asset, and SEO field is signed off before build.",
  "twt-content-approval-implement": "Push approved workbook content into the built site — only the rows marked ready to implement.",
  "twt-content-fetch": "One entry point for content ingest — detects each source you provide and routes it to the right fetcher.",
  "twt-content-fetch-doc": "Convert a Word or Google Doc into clean, uniform Markdown for the rest of the pipeline.",
  "twt-content-fetch-figma": "Extract the visible text from a Figma design — headings, copy, labels, nav — as clean Markdown.",
  "twt-content-fetch-pdf": "Convert a PDF's readable text into clean Markdown for brand, IA, and curation work.",
  "twt-content-fetch-site": "Capture a website's pages as clean Markdown for audits, migrations, or reuse downstream.",
  "twt-content-optimize": "Score your copy, rewrite it for clarity and brevity, then show the before/after improvement.",
  "twt-content-validate": "Score any text against a UX-writing rubric with evidence for every rating — review only, no rewrites.",
  "twt-curation-define": "Turn fetched content into a keep/skip/elevate plan plus a per-page outline of what fills each section.",
  "twt-curation-validate": "Review the curation plan for coverage gaps, voice mismatches, and invented content.",
  "twt-design": "Run the full design phase — system, components, layouts, mockups — into one handoff-ready brief.",
  "twt-design-system": "Define or analyze your design system and validate it in a single pass — the shared spine for every phase.",
  "twt-block-preview": "Screenshot any HTML page or element with a CSS selector — full page, a clipped region, or a batch of audit blocks in one go.",
  "twt-design-system-audit": "Score a real design system's quality and flag every page and block that drifts from it.",
  "twt-develop": "Promote the approved design into production code — a foundation page first, then the rest in parallel.",
  "twt-elementor-block-creator": "Build an Elementor widget or page template that follows your theme's conventions, reusing what exists.",
  "twt-elementor-theme-creator": "Scaffold a Hello Elementor child theme and its conventions file — run once per WordPress project.",
  "twt-export": "Create polished exports — PDF, DOCX, or slides — from a single guided command.",
  "twt-export-docx": "Convert Markdown into a polished, on-brand DOCX document.",
  "twt-export-pdf": "Convert Markdown into a polished, on-brand PDF document.",
  "twt-export-presentation": "Convert a Markdown deck into polished PPTX or PDF slides.",
  "twt-export-template-create": "Create a reusable export template from a brand brief, your own style notes, or both.",
  "twt-html-block-creator": "Build a static HTML page or section into your site, reusing partials and styling with tokens only.",
  "twt-html-site-creator": "Scaffold a dependency-free static HTML/CSS site with shared partials and mirrored design tokens.",
  "twt-ia-define": "Define the site structure — a sitemap with page purposes and CTAs, plus the functional scope.",
  "twt-ia-validate": "Review the sitemap and scope for gaps, navigation issues, and positioning misalignment.",
  "twt-layout-define": "Spec each page's layout — section order, components, content mapping, and responsive behavior.",
  "twt-layout-validate": "Review page layouts for section hierarchy, component fit, content coverage, and responsive intent.",
  "twt-marketplace-docs": "Regenerate SKILLS.md, architecture.md, and the README table from every skill's frontmatter.",
  "twt-mockup-define": "Render each layout into a responsive, real-content HTML/CSS mockup with a review index.",
  "twt-mockup-validate": "Review mockups for real content, token fidelity, responsiveness, and accessibility.",
  "twt-positioning": "Define your positioning — audience, value props, priorities — and validate it in one pass.",
  "twt-pre-design": "Run the full pre-design phase — content, brand, positioning, IA, curation — into one handoff brief.",
  "twt-project-intake": "Turn messy project notes and links into a clean site-instruction brief the pipeline can read.",
  "twt-qa": "Run the right QA audits on local files or a live site, then report a pass/fail verdict and punch-list.",
  "twt-qa-a11y": "Audit pages for accessibility — alt text, heading order, landmarks, labels, and contrast.",
  "twt-qa-content": "Audit pages for content and IA fidelity — every page present, real content, no placeholders.",
  "twt-qa-design": "Audit source files for design fidelity — token-only CSS and section structure matching the system.",
  "twt-qa-elementor": "Audit an Elementor child theme for code hygiene — token-only CSS, widget registration, WPML, PHP.",
  "twt-qa-links": "Audit links for integrity and check declared responsive tiers, flagging dead and placeholder links.",
  "twt-search-site": "Find every occurrence of a string across a site, with the exact page URLs and surrounding context.",
  "twt-setup": "Merge a curated permission allowlist into your project so routine pipeline calls stop prompting.",
  "twt-site": "Run the entire pipeline — pre-design to QA — as one guided command with approval pauses between phases.",
  "twt-site-dev": "The express path — from a Figma link, build the design system and jump straight to development.",
  "twt-spec": "Interview into a north-star specification and validate it in one pass.",
  "twt-status": "Detect stale artifacts — flag any output older than the inputs it came from and what to re-run.",
  "twt-text-analysis": "Audit copy by block type and suggest only rewrites that pass the safe-improvement gate.",
};

function cardCopy(skill) {
  return shortDescriptions[skill.slug] ?? shortText(skill.purpose, 185);
}

// Doc-hub-only longer descriptions for the skill detail pages. Plain-language,
// user-oriented 2-3 sentence explanations — they replace the jargon-heavy
// canonical `**Purpose:**` text on the page hero/Purpose panel without touching
// the skill source. A missing entry falls back to the raw purpose.
const longDescriptions = {
  "twt-brand": "Gets your whole brand onto one page — the voice, tone, look, and promises that make it feel like you. Start from something you already have (a brand book, Figma file, or live site) or build it together from scratch; either way it double-checks the result for gaps before design begins.",
  "twt-brand-fetch": "Gathers the brand clues already sitting in a source you hand it — a brand book PDF, a Figma file, screenshots, or a live site — and saves them as raw notes. Those notes give the brand-define step a running start instead of a blank page.",
  "twt-component-define": "Writes down every building block your site uses — buttons, cards, forms, and the bigger pieces they snap together into — with all their variants, states, and tokens. Then it builds a live gallery so you can see every component and variation in one place before a line of the site is built.",
  "twt-component-validate": "Gives your component library an honest once-over: are styles coming from tokens, are pieces reused instead of copy-pasted, is every state covered, and is it accessible? It writes the findings to a report for you to act on — it never changes anything itself.",
  "twt-content-approval-checklist": "Builds a simple spreadsheet of everything that needs a real, approved value before launch — every page, shared element, asset, link, and SEO field. It's perfect when the content isn't final yet (think Figma mockups full of placeholder text), so nothing slips through unreviewed.",
  "twt-content-approval-implement": "Takes your filled-in approval spreadsheet and places the approved content exactly where it belongs on the built site. It only touches the rows you've marked ready, so anything still in progress stays off the live pages.",
  "twt-content-fetch": "One easy front door for pulling in content you already have. Give it any mix of websites, PDFs, documents, or Figma files and it works out what each one is, sends it to the right reader, and hands you clean, consistent Markdown.",
  "twt-content-fetch-doc": "Turns a Word or Google Doc into tidy Markdown that looks just like every other source you've pulled in. Because the shape is consistent, your brand, IA, and curation steps can use it right away — no cleanup needed.",
  "twt-content-fetch-figma": "Lifts all the visible words out of a Figma design — headings, body copy, button labels, navigation, the little bits of microcopy — and saves them as clean Markdown. Now a design file can feed the pipeline just like a fetched website or PDF would.",
  "twt-content-fetch-pdf": "Pulls the readable text out of a PDF and saves it as clean Markdown, ready for brand, IA, and curation work. Handy when your raw material lives in reports, brochures, or exported docs.",
  "twt-content-fetch-site": "Saves a website's pages as clean, reusable Markdown — great for copy migrations, content audits, or feeding other steps. It only reads, giving you a snapshot of what's published right now.",
  "twt-content-optimize": "Makes a piece of writing better for you: it scores the original, rewrites it to be clearer and tighter, then shows the before-and-after with the reason behind each change. Let it rewrite everything at once, or walk through the suggestions one by one.",
  "twt-content-validate": "Grades any text against a UX-writing checklist and backs up every score with real quotes from the copy, so you can see exactly what's landing and what isn't. It only reviews and explains — the actual rewriting is a separate step.",
  "twt-curation-define": "Goes through the content you've collected and decides what to keep, skip, or spotlight — then maps each keeper onto a page. You end up with a clear inventory plus a per-page outline of what fills every section.",
  "twt-curation-validate": "Reads your content plan like a sharp editor would: any gaps in coverage, any tone that's off-brand, anything made up or unsupported? It scores the plan and suggests fixes in a report.",
  "twt-design": "Runs your whole design phase — design system, components, page layouts, and mockups — and ties it all into one brief that's ready to hand to development. It's the quickest way to get from a pre-design brief to a design you can actually build.",
  "twt-design-system": "Sets up the foundation every page stands on — colors, type, spacing, and components — either from scratch or by studying designs you already have, then checks it for consistency. This is the shared reference that design, development, and QA all point back to.",
  "twt-block-preview": "Takes a playwright screenshot of any HTML file or live URL — either the whole page or a single element you name with a CSS selector. It also runs in batch mode to capture every flagged block in a design-system audit, producing the thumbnails shown in the visual report. When playwright isn't installed it falls through to self-contained HTML previews that render faithfully without a browser.",
  "twt-design-system-audit": "Tells you how strong a real design system is and how closely a design actually sticks to it. Point it at a Figma file or live site and it scores the system, then names the exact page and block wherever the design drifts — and if no system exists, it works out the one that should have.",
  "twt-develop": "Turns your approved design into real, production-ready code. It builds one foundation page first to lock in reusable patterns, then powers through the rest in parallel — keeping your content-approval list moving alongside.",
  "twt-elementor-block-creator": "Builds an Elementor widget or full-page template that matches your theme's existing conventions. It reuses what you already have wherever it can, and only makes something new when nothing fits.",
  "twt-elementor-theme-creator": "Sets up a Hello Elementor child theme and writes the conventions file the other Elementor tools rely on. Run it once when a WordPress project kicks off so everything shares the same footing.",
  "twt-export": "Makes polished, on-brand documents and decks straight from your Markdown — PDF, Word, or slides — all from one guided command. It asks what you want, sets up a template if you need one, then runs the right export.",
  "twt-export-docx": "Turns a Markdown document into a polished, on-brand Word file. A reliable script handles the conversion, so the formatting comes out the same every time.",
  "twt-export-pdf": "Turns a Markdown document into a polished, on-brand PDF. A reliable script does the conversion, so the result looks identical on every run.",
  "twt-export-presentation": "Turns a Markdown deck into polished slides — PowerPoint or PDF — using a presentation template. A quick way to spin up a clean, on-brand deck without leaving your writing.",
  "twt-export-template-create": "Builds a reusable export template that your future PDF, Word, and slide exports can pick from. Base it on a brand brief, your own style notes, or both — and everything you export later can match it.",
  "twt-html-block-creator": "Adds a static HTML page or a single section to your site, reusing shared partials and styling with tokens only. It can promote a finished mockup or build fresh from Figma, screenshots, or notes.",
  "twt-html-site-creator": "Sets up a clean, dependency-free HTML/CSS site once per project, with shared header/footer partials and design tokens mirrored from your design system. Run it first so every page you build starts from the same base.",
  "twt-ia-define": "Maps your site's structure — every page, what it's for, and its main call to action — plus the features and integrations each page needs. It's the blueprint the rest of the design follows.",
  "twt-ia-validate": "Looks over your sitemap and scope like an information architect: missing pages, confusing navigation, fuzzy page purposes, anything drifting from your positioning. It scores the structure and recommends fixes.",
  "twt-layout-define": "Lays out every page — the order of sections, the components each one uses, the real content that fills it, and how it reflows on desktop, tablet, and mobile. It's the bridge between your site structure and the visual mockups.",
  "twt-layout-validate": "Reviews your page layouts for solid hierarchy, the right component in each slot, complete content mapping, and clear responsive intent. It writes the findings to a report — it doesn't change anything for you.",
  "twt-marketplace-docs": "Rebuilds the marketplace's reference docs — the skills index, architecture map, and README table — straight from each skill's definition. Run it after you change any skill so the docs never drift out of sync.",
  "twt-mockup-define": "Renders each page layout into a real, responsive HTML/CSS mockup filled with your actual content, plus an index to flip through them all. It's the high-fidelity preview of how the finished site will look.",
  "twt-mockup-validate": "Checks your mockups for what really matters before build: real content (not placeholder), faithful use of tokens, responsiveness, and a baseline of accessibility. The results go into a report.",
  "twt-positioning": "Sharpens how your brand shows up — who it's for, the value it offers, and what to lead with — then reviews it for clarity in one pass. It turns a fuzzy idea into a focused message the whole site can rally around.",
  "twt-pre-design": "Runs your entire pre-design phase — pulling in content, then defining brand, positioning, structure, and a content plan — and rolls it all into one brief ready for design. It's the fastest path from messy project notes to a solid foundation.",
  "twt-project-intake": "Takes scattered notes, links, file paths, and constraints and turns them into one clean brief the pipeline can actually read. Every later phase gets a reliable, editable starting point instead of guessing from the mess.",
  "twt-qa": "Runs the right quality checks for your project — on local files or a live site — and rolls them up into a pass/fail report plus a plain-language list of what's left to fix. It's the final gate before you call the site done.",
  "twt-qa-a11y": "Checks your pages for accessibility basics: image alt text, heading order, landmarks, form labels, and color contrast against WCAG AA. It reports what it finds without touching anything.",
  "twt-qa-content": "Makes sure your content is complete and on-plan — every page present, every section following its outline, and no leftover placeholder or empty gaps. Works on local files, or on the live site if you give it a URL.",
  "twt-qa-design": "Checks your source files for design fidelity: styling that comes only from tokens (no stray colors or sizes), every token actually defined, and each page's structure including the components its layout calls for. It only reports — it doesn't edit.",
  "twt-qa-elementor": "Checks an Elementor child theme for clean, maintainable code — token-only styling, properly registered widgets, translation coverage, and valid PHP. It reviews the code, not the live content, which lives in WordPress.",
  "twt-qa-links": "Makes sure every link and anchor actually resolves, navigation stays consistent, and your declared responsive breakpoints hold up. It flags dead and placeholder links so they land on your fix list.",
  "twt-search-site": "Finds every spot a phrase shows up across a website and reports the exact page URLs, each with a little surrounding text for context. A handy standalone tool for tracking down copy wherever it's hiding.",
  "twt-setup": "Gets your project ready once so the pipeline runs smoothly: it merges a curated permission allowlist into your settings so routine, safe actions stop interrupting you. Anything genuinely risky or new still asks first.",
  "twt-site": "Runs the whole twt pipeline — pre-design through QA — as one guided command. Pick the phases and build target up front, then approve, redo, or stop at each pause along the way; or kick off auto mode and let it run hands-free.",
  "twt-site-dev": "The express lane to a built site: starting from a Figma link, it sets up your design system, builds the content-approval workbook, scaffolds your target, and dives straight into building pages — skipping the full pre-design and design phases. Auto mode runs the whole thing without questions.",
  "twt-spec": "Interviews you to capture a north-star spec — the one document that says what you're building and why — then reviews it for clarity in a single pass. It's the anchor everything else points back to.",
  "twt-status": "Tells you what's gone stale. Edit something early in the pipeline and everything downstream is quietly out of date — this compares timestamps, flags what's affected, and lists the smallest set of steps to re-run. It only reports; it never changes a thing.",
  "twt-text-analysis": "Splits your text into logical blocks, scores each one with metrics that fit that block type, and separates real problems from optional polish. It only suggests a rewrite when Claude can show the change fixes a detected weakness without inventing facts, weakening voice, or changing meaning.",
  "twt-audience": "Defines who the site is really for — named personas seeded from your positioning, each with the journey stages they move through — then reviews the result in the same pass. IA, curation, layouts, and text analysis all read these personas, so pages speak to real people instead of a generic visitor.",
  "twt-seo": "Plans the site's search presence page by page — target keywords, slugs, meta titles and descriptions, schema, and (for redesigns) the redirect map — then reviews the plan in the same pass. Development gets concrete values to build in, instead of SEO being left as an afterthought.",
  "twt-direction-define": "Before any design tokens are locked in, renders your brand as two or three genuinely different visual directions — small self-contained style tiles built from your real copy — so you choose the site's look by seeing it, not by reading settings. The winning direction becomes the reference every later design step inherits.",
  "twt-eval-smoke": "A behavioral smoke test for the marketplace itself: it seeds a fixture project, runs real skills against it, and mechanically checks that they leave behind what they promise. It's a marketplace-development tool — you won't need it on a normal website project.",
  "twt-wiki": "Sets up and maintains the project wiki — the durable memory that outlives generated artifacts: why decisions were made, what was ruled out, what the client actually said, and ideas not yet scoped. Run it to initialize the wiki, feed it new material, or tidy what's already there.",
  "twt-wiki-fetch": "Brings outside material into the wiki's evidence layer — a file, URL, pasted note, or transcript — and records where it came from so every later claim can cite it. It can also sweep your existing artifacts for decisions worth keeping.",
  "twt-wiki-query": "Asks the project a question and answers it from the wiki with citations — including the questions no generated file can answer, like why the CTA is orange or what was ruled out and why.",
};

function detailCopy(skill) {
  return longDescriptions[skill.slug] ?? skill.purpose;
}

// ---------------------------------------------------------------------------
// Per-file plain-language explanations for the "What it reads" / "Result it
// provides" panels. Keyed by the file path exactly as it appears in SKILLS.md
// (inline `# comments` and trailing `(notes)` are stripped before matching).
// Files whose meaning is the same wherever they appear are matched by basename
// in `artifactByBasename`; anything unmatched falls back to a type-based line.
// ---------------------------------------------------------------------------
const artifactDescriptions = {
  // Pipeline-level briefs
  ".twt-artifacts/": "Your project's twt workspace — the shared folder every phase reads from and writes to.",
  ".twt-artifacts/site-instruction.md": "The single normalized brief that drives the whole pipeline: goals, pages, constraints, and source links.",
  "site-instruction.md": "The single normalized brief that drives the whole pipeline: goals, pages, constraints, and source links.",
  ".twt-artifacts/intake/intake-report.md": "A summary of how your raw notes were turned into the brief, with every assumption flagged.",
  ".twt-artifacts/pre-design/pre-design-brief.md": "The Phase-1 handoff brief — brand, positioning, structure, and content plan rolled into one design-ready document.",
  ".twt-artifacts/design/design-brief.md": "The Phase-2 handoff brief — design system, components, layouts, and mockups tied together for development.",
  ".twt-artifacts/design/design-read.md": "The agreed visual direction and design 'dials' that steer the whole design phase.",

  // Brand / positioning / spec
  ".twt-artifacts/pre-design/brand/brand-brief.md": "Your canonical brand brief: voice, tone, personality, and the visual cues the whole project follows.",
  ".twt-artifacts/pre-design/brand/_fetched-brand.md": "Raw brand notes pulled from a source (brand book, Figma, site), used as the starting point for the brief.",
  ".twt-artifacts/pre-design/positioning/positioning.md": "Your positioning: who the site is for, the value it offers, and what to promote first.",
  ".twt-artifacts/pre-design/spec/specification.md": "The north-star spec describing what you're building and why.",

  // Information architecture
  ".twt-artifacts/pre-design/ia/sitemap.md": "The site map — every page, its purpose, and its primary call to action.",
  ".twt-artifacts/pre-design/ia/functional-scope.md": "The features, integrations, and functionality each page needs.",

  // Curation
  ".twt-artifacts/pre-design/curation/": "The curation workspace — what to keep from your content and how it maps onto pages.",
  ".twt-artifacts/pre-design/curation/inventory.md": "A keep / skip / elevate decision for every piece of source content.",
  ".twt-artifacts/pre-design/curation/outlines/": "Per-page outlines showing which content fills each section.",
  ".twt-artifacts/pre-design/curation/outlines/<page-slug>.md": "The section-by-section content outline for a single page.",

  // Content fetch
  ".twt-artifacts/pre-design/content/fetched/": "The folder of content pulled in from your sources, all as clean Markdown.",
  ".twt-artifacts/pre-design/content/fetched/_manifest.md": "An index of everything that was fetched and where each piece came from.",
  ".twt-artifacts/pre-design/content/fetched/doc/<filename>/index.md": "The cleaned Markdown text extracted from a PDF or Word/Google Doc.",
  ".twt-artifacts/pre-design/content/fetched/figma/<file-key>/_index.md": "An index of the Figma frames whose text was pulled.",
  ".twt-artifacts/pre-design/content/fetched/figma/<file-key>/<frame-slug>/index.md": "The visible text from a single Figma frame, as Markdown.",
  ".twt-artifacts/pre-design/content/fetched/site/<domain>/_sitemap.md": "A map of the pages discovered while crawling the site.",
  ".twt-artifacts/pre-design/content/fetched/site/<domain>/index.md": "The cleaned Markdown for the site's main fetched page.",
  ".twt-artifacts/pre-design/content/fetched/site/<domain>/<path>/index.md": "The cleaned Markdown for one fetched page of the site.",

  // Content optimize / validate / analysis
  ".twt-artifacts/content/content-config.md": "Settings for content work — which subjects to process and how.",
  ".twt-artifacts/content/subject/<subject-slug>.md": "A captured copy of the text being analyzed or optimized.",
  ".twt-artifacts/content/optimized/<subject-slug>.md": "The rewritten, improved version of a piece of text.",
  ".twt-artifacts/content/optimization-report.md": "A before/after summary of the copy improvements and the reasoning behind each one.",
  ".twt-artifacts/pre-design/content/text-analysis/": "Per-subject text-quality analysis output.",
  ".twt-artifacts/pre-design/content/text-analysis/<page-slug>/analysis-report.md": "A block-by-block text-quality score with suggested rewrites.",
  ".twt-artifacts/pre-design/content/text-analysis/<subject-slug>/analysis-report.md": "A block-by-block text-quality score with suggested rewrites.",
  ".twt-artifacts/pre-design/content/text-analysis/<page-slug>/optimized.md": "A suggested stronger rewrite produced during text analysis.",
  ".twt-artifacts/pre-design/content/text-analysis/<subject-slug>/optimized.md": "A suggested stronger rewrite produced during text analysis.",
  ".twt-artifacts/content/validation/<subject-slug>/validation-report.md": "A scored UX-writing critique of the text, with evidence per criterion.",
  ".twt-artifacts/content/validation/<subject-slug>/validation-report-before.md": "The text-quality critique captured before optimization.",
  ".twt-artifacts/content/validation/<subject-slug>/validation-report-after.md": "The text-quality critique captured after optimization, to show the gain.",

  // Content approval
  ".twt-artifacts/content-approval/content-approval-checklist.xlsx": "A per-page workbook where every headline, link, asset, and SEO field is reviewed and signed off before build.",
  ".twt-artifacts/content-approval/content-approval-checklist-report.md": "A summary of the generated workbook — pages, rows, and what still needs a value.",
  ".twt-artifacts/content-approval/content-approval-implementation-report.md": "A record of which approved rows were applied to the built site.",

  // Design system
  ".twt-artifacts/design/design-system/": "The synthesized canonical design system, created when none was provided.",
  ".twt-artifacts/design/design-system/tokens.md": "The human-readable token reference — colors, type, spacing, and more.",
  ".twt-artifacts/design/design-system/tokens.css": "The design tokens as CSS custom properties, ready for the build to consume.",
  ".twt-artifacts/design/design-system/components.md": "The shared component definitions that design, development, and QA all reference.",

  // Components
  ".twt-artifacts/design/component/components.md": "Detailed specs for every UI component — anatomy, variants, states, and tokens.",
  ".twt-artifacts/design/component/gallery.html": "An interactive gallery rendering each component with all its variants and states.",

  // Layout
  ".twt-artifacts/design/layout/layouts/": "Per-page layout specs — section order, components, content, and breakpoints.",
  ".twt-artifacts/design/layout/*.md": "A per-page layout spec.",

  // Mockup
  ".twt-artifacts/design/mockup/index.html": "A review index linking to every rendered page mockup.",
  ".twt-artifacts/design/mockup/pages/": "The rendered HTML mockup for each page.",
  ".twt-artifacts/design/mockup/*.html": "A rendered HTML page mockup.",
  ".twt-artifacts/design/mockup/styles.css": "The shared stylesheet powering the mockups, built from design tokens.",
  ".twt-artifacts/design/assets/manifest.md": "An inventory of the images and assets the design references.",

  // Design-system audit
  ".twt-artifacts/design/design-system-audit/audit.json": "The full machine-readable audit results.",
  ".twt-artifacts/design/design-system-audit/audit-report.html": "The visual audit report — system-quality scores plus every page and block that drifts.",
  ".twt-artifacts/design/design-system-audit/audit-report.md": "The Markdown version of the audit report.",
  ".twt-artifacts/design/design-system-audit/blocks.json": "Detected page blocks and how consistently they're used across pages.",
  ".twt-artifacts/design/design-system-audit/canonical-blocks.md": "The reference set of blocks the design should reuse consistently.",
  ".twt-artifacts/design/design-system-audit/quality.json": "The raw design-system quality scores.",
  ".twt-artifacts/design/design-system-audit/quality-report.md": "A readable scorecard of the design system's quality.",
  ".twt-artifacts/design/design-system-audit/visuals.json": "Metadata linking each finding to its captured screenshot.",
  ".twt-artifacts/design/design-system-audit/pages/": "Per-page audit detail.",
  ".twt-artifacts/design/design-system-audit/previews/": "Generated preview images used in the audit report.",
  ".twt-artifacts/design/design-system-audit/shots/": "Screenshots captured from the design or site during the audit.",

  // Export
  ".twt-artifacts/export/sources/<source-slug>.md": "The Markdown source prepared for export.",
  ".twt-artifacts/export/sources/<source-slug>.notes.md": "Notes captured about an export source.",
  ".twt-artifacts/export/docx/<source-slug>/<source-slug>.docx": "The finished, on-brand Word document.",
  ".twt-artifacts/export/pdf/<source-slug>/<source-slug>.pdf": "The finished, on-brand PDF document.",
  ".twt-artifacts/export/presentation/<source-slug>/<source-slug>.pptx": "The finished slide deck in PowerPoint format.",
  ".twt-artifacts/export/presentation/<source-slug>/<source-slug>.pdf": "The finished slide deck as a PDF.",
  ".twt-artifacts/export/templates/*/template.json": "The machine-readable export template definition.",
  ".twt-artifacts/export/templates/*/template.md": "The human-readable description of an export template.",
  ".twt-artifacts/export/templates/<template-slug>/template.json": "The machine-readable export template definition.",
  ".twt-artifacts/export/templates/<template-slug>/template.md": "The human-readable description of an export template.",
  ".twt-artifacts/export/templates/<template-slug>/preview-notes.md": "Notes about a template preview.",

  // QA
  ".twt-artifacts/qa/qa-report.md": "The rolled-up QA verdict — pass/fail across every audit that ran.",
  ".twt-artifacts/qa/gaps.md": "A plain-language punch-list of everything left to fix.",
  ".twt-artifacts/qa/a11y-report.md": "The accessibility audit findings.",
  ".twt-artifacts/qa/content-report.md": "The content & IA fidelity audit findings.",
  ".twt-artifacts/qa/design-report.md": "The design & token fidelity audit findings.",
  ".twt-artifacts/qa/elementor-report.md": "The Elementor code-hygiene audit findings.",
  ".twt-artifacts/qa/links-report.md": "The link-integrity and responsive-tier audit findings.",

  // Reports, logs, search
  ".twt-artifacts/reports/": "Copies of the headline report from each phase, gathered in one place.",
  ".twt-artifacts/reports/index.html": "A dashboard linking to every phase's headline report.",
  ".twt-artifacts/site-log.md": "A running log of each /twt-site run — questions, answers, and the skill chosen per step.",
  ".twt-artifacts/site-dev-log.md": "A running log of each /twt-site-dev run — questions, answers, and the skill chosen per step.",
  ".twt-artifacts/search/<domain>/search-report-<query-slug>.md": "The search results — every page that matched, with surrounding context.",

  // Build targets — static HTML site
  "site/": "The built static website.",
  "site/index.html": "The site's home page.",
  "site/<page-slug>.html": "A built page of the site.",
  "site/partials/": "Shared HTML partials reused across every page.",
  "site/partials/header.html": "The shared site header, reused across every page.",
  "site/partials/footer.html": "The shared site footer, reused across every page.",
  "site/partials/nav.html": "The shared navigation, reused across every page.",
  "site/assets/css/": "The site's stylesheets.",
  "site/assets/css/tokens.css": "The design tokens mirrored into the site as CSS variables.",
  "site/assets/css/general.css": "Site-wide base styles, built from tokens.",
  "site/assets/css/sections.css": "Reusable section styles, built from tokens.",
  "site/assets/img/": "The site's image assets.",
  "site/assets/js/<section-slug>.js": "The JavaScript for a specific section.",
  ".twt-artifacts/html-site/conventions.md": "The build conventions every HTML page in this project follows.",

  // Build targets — Elementor child theme
  ".twt-artifacts/elementor-theme/conventions.md": "The build conventions every Elementor widget and template in this project follows.",
  "wp-content/themes/": "Your WordPress themes folder.",
  "wp-content/themes/hello-elementor-*/": "An existing Hello Elementor child theme to build on.",
  "<THEME>/": "The WordPress child theme being built or extended.",
  "<THEME>/assets/css/design-system.css": "The design tokens compiled into the theme's stylesheet.",
  "<THEME>/assets/css/widgets.css": "The CSS for the theme's custom widgets, built from tokens.",
  "<THEME>/assets/js/<widget>.js": "The JavaScript for a custom Elementor widget.",
  "<THEME>/inc/elementor/class-<slug>-elementor.php": "The PHP class that registers the theme's Elementor integration.",
  "<THEME>/inc/elementor/widgets/": "The PHP classes for the theme's custom widgets.",
  "<THEME>/inc/elementor/widgets/class-<slug>-<widget>.php": "The PHP class for a single custom Elementor widget.",
  "<THEME>/import/<page-slug>/import.json": "An Elementor template you can import to recreate a page.",
  "<THEME>/import/<page-slug>/assets/": "The assets that accompany an importable page template.",
  "<THEME>/wpml-config.xml": "The WPML config that makes the theme's custom fields translatable.",
  "wp-content/themes/hello-elementor-<slug>/style.css": "The child theme's stylesheet header that registers it with WordPress.",
  "wp-content/themes/hello-elementor-<slug>/functions.php": "The child theme's entry point — enqueues styles and wires up widgets.",
  "wp-content/themes/hello-elementor-<slug>/inc/elementor/class-skeleton-widget-base.php": "A reusable base class that every custom widget extends.",
  "wp-content/themes/hello-elementor-<slug>/inc/elementor/class-<slug>-elementor.php": "The PHP class that registers the theme's Elementor integration.",
  "wp-content/themes/hello-elementor-<slug>/assets/css/design-system.css": "The design tokens compiled into the theme's stylesheet.",
  "wp-content/themes/hello-elementor-<slug>/assets/css/general.css": "Site-wide base styles for the theme, built from tokens.",
  "wp-content/themes/hello-elementor-<slug>/wpml-config.xml": "The WPML config that makes the theme's custom fields translatable.",

  // Marketplace docs / setup
  "SKILLS.md": "The auto-generated command reference for the marketplace.",
  "architecture.md": "The auto-generated map of how the skills fit together.",
  "README.md": "The repo README — only the auto-managed skills table inside it is updated.",
  ".claude/settings.json": "Your project settings — the curated permission allowlist is merged in without removing anything you already have.",
  "commands/*.md": "Every skill's command definition, read to regenerate the docs.",
  "skills/*/SKILL.md": "Every sub-skill's definition, read to regenerate the docs.",
  "references/external-design-skills.md": "Notes on the external design skills this skill leans on.",
  "templates/document-export-style.md": "The shared style template for exported documents.",
  "templates/presentation-export-style.md": "The shared style template for exported slides.",
  "tools/export-document.mjs": "The script that renders Markdown into DOCX/PDF documents.",
  "tools/export-presentation.mjs": "The script that renders Markdown into slide decks.",
  "tools/export-source-create.mjs": "The helper that prepares a Markdown source for export.",
  "tools/export-template-create.mjs": "The helper that builds a reusable export template.",

  // Read-only theme files (audit targets)
  "<THEME>/assets/css/design-system.css ": "The theme's compiled design-token stylesheet, read for the audit.",

  // Things you pass on the command line, not files
  "$ARGUMENTS": "Whatever you type after the command name.",
  "<brand source>": "The brand source you point it at — a brand book, Figma file, screenshots, or a live site.",
  "<doc-path-or-url>": "The Word or Google Doc you give it, as a file path or URL.",
  "<markdown-path>": "The Markdown file you give it.",
  "<pdf-path>": "The PDF you give it.",
  "<provided sources>": "Whatever sources you provide — sites, PDFs, docs, or Figma files.",
  "<url>": "The website URL you give it.",
  "<figma-url>": "The Figma file you give it, read through the Figma connection.",
  "Figma URL or Figma design context supplied via $ARGUMENTS": "A Figma URL or design context you pass on the command line.",
  "the subject text": "The text you want analyzed — a file, pasted text, or an existing content artifact.",
  "the subject file in place": "Your original text file, updated in place — only with your explicit consent.",
};

// Files whose meaning is the same wherever they live, matched by basename.
const artifactByBasename = {
  "validation-report.md": "A read-only critique of this artifact, listing blockers, warnings, and suggestions.",
  "decisions.md": "A log of the key decisions and trade-offs made while producing this artifact.",
  "phase-review.md": "A consolidated review of this phase's outputs.",
  "render-notes.md": "Notes from the export run — settings used and anything worth flagging.",
  "_meta.md": "Notes about the fetched source — where it came from and any extraction caveats.",
  "index.md": "The cleaned Markdown text extracted from this source.",
  ".gitkeep": "An empty placeholder that keeps an otherwise-empty folder in version control.",
};

// Normalize a Reads/Writes entry to a lookup key: drop inline `# comments` and
// a single trailing `(note)` so phrasing variants collapse to one description.
function artifactKey(raw = "") {
  return cleanText(raw)
    .replace(/\s*#.*$/, "")
    .replace(/\s*\([^()]*\)\s*$/, "")
    .trim();
}

function genericArtifactDesc(key) {
  if (key.endsWith("/")) return "A folder of related files.";
  if (key.startsWith("$") || key.startsWith("<") || /\s/.test(key)) {
    return "A value you provide when you run the command.";
  }
  const ext = key.includes(".") ? key.split(".").pop().toLowerCase() : "";
  return (
    {
      md: "A Markdown document.",
      css: "A stylesheet.",
      html: "An HTML page.",
      json: "A JSON data file.",
      php: "A PHP source file.",
      js: "A JavaScript file.",
      xlsx: "A spreadsheet workbook.",
      xml: "An XML configuration file.",
      pdf: "A PDF document.",
      docx: "A Word document.",
      pptx: "A PowerPoint deck.",
    }[ext] ?? "A generated file."
  );
}

// Returns { path, desc } for a Reads/Writes entry, or null for "(none)".
function describeArtifact(raw) {
  const key = artifactKey(raw);
  if (!key || key === "(none)" || key === "--") return null;
  if (artifactDescriptions[key]) return { path: key, desc: artifactDescriptions[key] };
  const base = key.replace(/\/$/, "").split("/").pop();
  if (artifactByBasename[base]) return { path: key, desc: artifactByBasename[base] };
  return { path: key, desc: genericArtifactDesc(key) };
}

function fileListBlock(title, items) {
  const seen = new Set();
  const rows = [];
  for (const item of items) {
    const entry = describeArtifact(item);
    if (!entry || seen.has(entry.path)) continue;
    seen.add(entry.path);
    rows.push(
      `<li><code>${escapeHtml(entry.path)}</code><span class="file-desc">${formatInline(entry.desc)}</span></li>`
    );
  }
  if (!rows.length) {
    const empty =
      title === "Result it provides"
        ? "No files of its own — it orchestrates other skills or reports back to you."
        : "Nothing — it starts from what you give it, or asks you directly.";
    return `<section class="detail-panel reveal">
    <h2>${escapeHtml(title)}</h2>
    <p>${empty}</p>
  </section>`;
  }
  return `<section class="detail-panel reveal">
    <h2>${escapeHtml(title)}</h2>
    <ul class="file-list">${rows.join("")}</ul>
  </section>`;
}

// ---------------------------------------------------------------------------
// Orchestrators: the skills they run, in order, and why each one runs.
// Only skills that genuinely dispatch a sequence appear here. `to` may list
// several slugs when a step picks one of them (e.g. HTML vs Elementor target).
// ---------------------------------------------------------------------------
const callSequences = {
  "twt-site": [
    { to: ["twt-pre-design"], why: "Lays the foundation: gathers content and defines brand, positioning, structure, and a content plan before any design starts." },
    { to: ["twt-design"], why: "Turns that brief into a design system, components, layouts, and mockups ready to build." },
    { to: ["twt-text-analysis"], why: "Runs a text-quality pass on the new copy so weak writing is caught before it's built." },
    { to: ["twt-content-approval-checklist"], why: "Builds the approval workbook so every page's real content is signed off before development." },
    { to: ["twt-develop"], why: "Promotes the approved design into real code for your chosen build target." },
    { to: ["twt-qa"], why: "Audits the finished build for accessibility, content, links, and design fidelity." },
    { to: ["twt-site-dev"], why: "Used instead of the full pre-design + design path when you start from a finished design or Figma link." },
  ],
  "twt-site-dev": [
    { to: ["twt-design-system-define"], why: "Builds or mirrors the design system from your Figma link so everything downstream shares one source of truth." },
    { to: ["twt-content-approval-checklist"], why: "Creates the approval workbook so placeholder copy gets replaced with signed-off content." },
    { to: ["twt-html-site-creator", "twt-elementor-theme-creator"], why: "Scaffolds your chosen build target once before any pages are built." },
    { to: ["twt-html-block-creator", "twt-elementor-block-creator"], why: "Builds each page or widget into the scaffold." },
  ],
  "twt-pre-design": [
    { to: ["twt-content-fetch"], why: "Pulls in any existing copy first, so every later step works from real material instead of guesses." },
    { to: ["twt-brand"], why: "Defines the brand voice and visual cues the rest of the site leans on." },
    { to: ["twt-spec"], why: "Captures the north-star spec when the project needs an explicit one." },
    { to: ["twt-positioning"], why: "Sharpens who the site is for and what to promote." },
    { to: ["twt-ia-define", "twt-ia-validate"], why: "Lays out the sitemap and scope, then checks it for gaps." },
    { to: ["twt-curation-define", "twt-curation-validate"], why: "Decides what content to keep and maps it onto pages, then reviews the plan." },
  ],
  "twt-design": [
    { to: ["twt-design-system"], why: "Establishes tokens and components — the shared spine every page is built on." },
    { to: ["twt-component-define", "twt-component-validate"], why: "Specs each UI component, then checks it for reuse, state coverage, and accessibility." },
    { to: ["twt-layout-define", "twt-layout-validate"], why: "Specs each page's layout, then reviews hierarchy and responsive intent." },
    { to: ["twt-mockup-define", "twt-mockup-validate"], why: "Renders real-content mockups, then checks them for fidelity and accessibility." },
  ],
  "twt-brand": [
    { to: ["twt-brand-fetch"], why: "Pulls existing brand signal from a source you provide — only when one is given." },
    { to: ["twt-brand-define"], why: "Shapes that signal (or a fresh conversation) into the canonical brand brief." },
    { to: ["twt-brand-validate"], why: "Reviews the brief for gaps before design begins." },
  ],
  "twt-positioning": [
    { to: ["twt-positioning-define"], why: "Builds or refines the positioning statement with you." },
    { to: ["twt-positioning-validate"], why: "Checks it for clarity and alignment with the brand." },
  ],
  "twt-design-system": [
    { to: ["twt-design-system-define"], why: "Builds or analyzes the tokens, components, and preview." },
    { to: ["twt-design-system-validate"], why: "Runs a read-only critique, including a WCAG contrast gate." },
  ],
  "twt-spec": [
    { to: ["twt-spec-define"], why: "Interviews you into the north-star specification." },
    { to: ["twt-spec-validate"], why: "Reviews the spec for clarity and completeness." },
  ],
  "twt-qa": [
    { to: ["twt-qa-content"], why: "Checks every page exists and matches the content plan." },
    { to: ["twt-qa-design"], why: "Checks styling is token-only and structure matches the design system." },
    { to: ["twt-qa-a11y"], why: "Checks accessibility basics — alt text, headings, labels, contrast." },
    { to: ["twt-qa-links"], why: "Checks links resolve and responsive tiers hold up." },
    { to: ["twt-qa-elementor"], why: "Checks Elementor theme code hygiene — only for WordPress builds." },
  ],
  "twt-develop": [
    { to: ["twt-html-site-creator", "twt-elementor-theme-creator"], why: "Scaffolds your chosen build target once." },
    { to: ["twt-html-block-creator", "twt-elementor-block-creator"], why: "Builds a foundation page first to set the patterns, then the rest in parallel." },
    { to: ["twt-content-approval-checklist"], why: "Keeps the content-approval list running alongside the build." },
  ],
  "twt-export": [
    { to: ["twt-export-template-create"], why: "Sets up a reusable template first when you don't already have one." },
    { to: ["twt-export-pdf", "twt-export-docx", "twt-export-presentation"], why: "Runs the export you chose — PDF, Word, or slides." },
  ],
  "twt-content-fetch": [
    { to: ["twt-content-fetch-site"], why: "Handles any website sources." },
    { to: ["twt-content-fetch-pdf"], why: "Handles any PDF sources." },
    { to: ["twt-content-fetch-doc"], why: "Handles any Word or Google Doc sources." },
    { to: ["twt-content-fetch-figma"], why: "Handles any Figma sources." },
  ],
  "twt-content-optimize": [
    { to: ["twt-content-validate"], why: "Scores the original copy first, so the improvement is measured rather than guessed." },
  ],
  "twt-content-approval-checklist": [
    { to: ["twt-text-analysis"], why: "Scores existing copy so only validated rewrites become recommended content." },
  ],
  "twt-content-approval-implement": [
    { to: ["twt-html-block-creator", "twt-elementor-block-creator"], why: "Applies approved rows by rebuilding the affected blocks in your build target." },
  ],
  "twt-design-system-audit": [
    { to: ["twt-content-fetch-figma"], why: "Pulls the design's text and structure from Figma." },
    { to: ["twt-design-system-define"], why: "Synthesizes the canonical system to measure against when none is provided." },
    { to: ["twt-design-system-validate"], why: "Scores the system's quality." },
    { to: ["twt-brand"], why: "Brings in brand context to judge fit, when it's available." },
    { to: ["twt-block-preview"], why: "Captures block screenshots and HTML previews for the visual audit report." },
  ],
  "twt-curation-define": [
    { to: ["twt-content-fetch"], why: "Pulls in source content to curate when it hasn't been fetched yet." },
    { to: ["twt-brand-define"], why: "Brings in brand voice so keep/elevate calls match the tone." },
    { to: ["twt-ia-define"], why: "Brings in the sitemap so content maps onto real pages." },
  ],
  "twt-ia-define": [
    { to: ["twt-positioning-define"], why: "Grounds the structure in who the site is for and what to promote." },
    { to: ["twt-content-fetch"], why: "Brings in existing content so the sitemap reflects what's real." },
  ],
};

function sequenceBlock(skill, pageDir = "skills") {
  const seq = callSequences[skill.slug];
  if (!seq) return "";
  const rel = relFrom(pageDir);
  const items = seq
    .map((step) => {
      const links = step.to
        .map((slug) =>
          skills.has(slug)
            ? `<a href="${rel}skills/${slug}.html"><code>/${slug}</code></a>`
            : `<code>${escapeHtml(slug)}</code>`
        )
        .join(" or ");
      return `<li>${links}<span class="file-desc">${formatInline(step.why)}</span></li>`;
    })
    .join("");
  return `<section class="detail-panel wide reveal">
    <h2>Skills it runs, in order</h2>
    <p class="panel-note">This skill is an orchestrator — it dispatches the skills below (via the Agent tool) rather than doing their work itself. Here's each one, in the order it runs, and why.</p>
    <ol class="sequence">${items}</ol>
  </section>`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanGenerated() {
  ensureDir(outDir);
  for (const entry of ["assets", "blocks", "skills"]) {
    fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  }
  ensureDir(path.join(outDir, "assets", "previews", "blocks"));
  ensureDir(path.join(outDir, "assets", "previews", "skills"));
  ensureDir(path.join(outDir, "blocks"));
  ensureDir(path.join(outDir, "skills"));
}

function escapeHtml(value = "") {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatInline(value = "") {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function cleanText(value = "") {
  return String(value)
    .replaceAll("\u00e2\u2020\u2019", "->")
    .replaceAll("\u00e2\u20ac\u201d", "-")
    .replaceAll("\u00e2\u20ac\u201c", "-")
    .replaceAll("\u00e2\u20ac\u00a6", "...")
    .replaceAll("\u00c2\u00b7", "-")
    .replaceAll("\u00c2\u00a7", "section ")
    .replaceAll("\u00c2\u00b1", "+/-")
    .replaceAll("\u00e2\u2030\u00a5", ">=")
    .replaceAll("\u00e2\u2030\u00a4", "<=")
    .replaceAll("\u00e2\u20ac\u02dc", "'")
    .replaceAll("\u00e2\u20ac\u2122", "'")
    .replaceAll("\u00e2\u20ac\u0153", '"')
    .replaceAll("\u00e2\u20ac\u009d", '"');
}

function slugify(value) {
  return value.replace(/^\//, "").replaceAll("/", "").toLowerCase();
}

function stripVersion(description = "") {
  return description.replace(/^\(v[^)]+\)\s*/, "");
}

function shortText(value = "", max = 180) {
  const text = cleanText(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}...` : text;
}

function displayName(skill) {
  return skill.command
    .replace(/^\/twt-/, "")
    .replace(/-define$/, "")
    .split("-")
    .map((part) => {
      const upper = part.toUpperCase();
      return ["QA", "IA", "PDF", "HTML", "DOCX"].includes(upper)
        ? upper
        : part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function tokenMeterMarkup(filledSegments) {
  return Array.from({ length: 4 }, (_, index) =>
    `<i${index < filledSegments ? ' class="is-filled"' : ""}></i>`
  ).join("");
}

function tokenUsageMarkup(skill, { compact = false } = {}) {
  const usage = tokenUsageFor(skill.slug);
  const segments = tokenMeterMarkup(usage.segments);
  const classes = ["token-usage", `token-usage--${usage.key}`];
  if (compact) classes.push("token-usage--compact");
  return `<span class="${classes.join(" ")}" data-token-usage="${usage.key}" aria-label="Token usage: ${usage.label}">
    <span class="token-usage__label">Token usage</span>
    <span class="token-meter" aria-hidden="true">${segments}</span>
    <strong>${usage.label}</strong>
  </span>`;
}

function parseSkills(markdown) {
  const headingMatches = [...markdown.matchAll(/^##\s+\/twt-[^\n]+/gm)];
  const bySlug = new Map();

  for (let index = 0; index < headingMatches.length; index++) {
    const start = headingMatches[index].index;
    const end = headingMatches[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end).trim();
    const heading = section.match(/^##\s+(\/twt-[^\n]+)/);
    if (!heading) continue;
    const command = heading[1].trim();
    const slug = slugify(command);
    const category = section.match(/\*\*Category:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "";
    const version = section.match(/\*\*Version:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "";
    const acceptsArguments =
      section.match(/\*\*Accepts arguments:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "";
    const purpose =
      section.match(/\*\*Accepts arguments:\*\*\s*[^\n]+\n\n([\s\S]*?)(?=\n\n\*\*Inputs:\*\*)/)?.[1]?.trim() ??
      "";

    bySlug.set(slug, {
      command,
      slug,
      category,
      version,
      acceptsArguments,
      purpose,
      inputs: extractList(section, "Inputs"),
      reads: extractList(section, "Reads"),
      writes: extractList(section, "Writes"),
      nonGoals: extractList(section, "Non-goals"),
      success: extractList(section, "Success criteria"),
      block: blockBySkill.get(slug),
    });
  }

  return bySlug;
}

function extractList(section, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(
    new RegExp(`\\*\\*${escaped}:\\*\\*\\n([\\s\\S]*?)(?=\\n\\*\\*[^\\n]+:\\*\\*|\\n---\\n|$)`)
  );
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter((line) => line && line !== "---" && cleanText(line) !== "--");
}

const skills = parseSkills(source);

function relFrom(pageDir) {
  return pageDir === "root" ? "" : "../";
}

function header(pageDir = "root") {
  const rel = relFrom(pageDir);
  return `
    <header class="site-header" data-header>
      <a class="brand" href="${rel}index.html" aria-label="twt skills home">
        <span class="logo-pair" aria-hidden="true">
          <img class="logo-dark" src="${rel}assets/logo.svg" alt="" width="56" height="56">
        </span>
        <span>twt</span>
      </a>
      <button class="menu-toggle" type="button" aria-label="Open navigation" aria-expanded="false" data-menu-toggle>
        <span></span><span></span>
      </button>
      <nav class="main-nav" aria-label="Primary" data-nav>
        <a href="${rel}index.html">Home</a>
        ${blocks
          .map((block) =>
            block.status === "Coming soon"
              ? `<span class="nav-disabled" aria-disabled="true">${escapeHtml(block.name)}</span>`
              : `<a href="${rel}${block.href}">${escapeHtml(block.name)}</a>`
          )
          .join("")}
      </nav>
    </header>`;
}

function footer(pageDir = "root") {
  const rel = relFrom(pageDir);
  return `
    <footer class="site-footer">
      <span class="logo-pair footer-logo" aria-hidden="true">
        <img class="logo-dark" src="${rel}assets/logo.svg" alt="" width="36" height="36">
      </span>
      <p>Copyright &copy; ${new Date().getFullYear()} twt Skills Marketplace.</p>
    </footer>`;
}

function breadcrumbs(items, pageDir = "root") {
  const rel = relFrom(pageDir);
  return `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <a href="${rel}index.html">Home</a>
      ${items
        .map((item) => {
          const commandClass = item.label.startsWith("/") ? ` class="breadcrumb-command"` : "";
          return item.href
            ? `<span>/</span><a${commandClass} href="${rel}${item.href}">${escapeHtml(item.label)}</a>`
            : `<span>/</span><strong${commandClass}>${escapeHtml(item.label)}</strong>`;
        })
        .join("")}
    </nav>`;
}

function layout({ title, body, pageDir = "root", description = "twt skills documentation hub" }) {
  const rel = relFrom(pageDir);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)} | twt skills</title>
  <link rel="icon" href="${rel}assets/logo.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700;800;900&display=swap">
  <link rel="stylesheet" href="${rel}assets/styles.css">
</head>
<body>
  <div class="grain" aria-hidden="true"></div>
  ${header(pageDir)}
  <main>
    ${body}
  </main>
  ${footer(pageDir)}
  <script src="${rel}assets/app.js"></script>
</body>
</html>`;
}

function write(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content.trimStart() + "\n", "utf8");
}

function blockPreviewSvg(block, index) {
  const palettes = [
    ["#ca221f", "#0b68b7", "#f8f9fc"],
    ["#0b68b7", "#f6c22b", "#f8f9fc"],
    ["#f6c22b", "#ca221f", "#f8f9fc"],
    ["#0b68b7", "#ca221f", "#f8f9fc"],
    ["#f6c22b", "#0b68b7", "#f8f9fc"],
  ];
  const [a, b, bg] = palettes[index % palettes.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600" role="img" aria-label="${escapeHtml(block.name)} preview">
  <rect width="960" height="600" fill="${bg}"/>
  <path d="M0 80 H960 M0 200 H960 M0 320 H960 M0 440 H960 M120 0 V600 M300 0 V600 M480 0 V600 M660 0 V600 M840 0 V600" stroke="#090e22" stroke-width="1.5" opacity=".06"/>
  <path d="M0 404 C134 292 276 492 438 332 S728 118 960 226 V600 H0Z" fill="${a}" opacity=".9"/>
  <path d="M84 100 H810 M84 166 H620 M84 232 H714" stroke="#090e22" stroke-width="14" stroke-linecap="round"/>
  <g transform="translate(560 286) rotate(-7)">
    <rect width="276" height="178" rx="14" fill="#ffffff" stroke="#dde0ee" stroke-width="2"/>
    <rect x="34" y="36" width="118" height="18" rx="9" fill="${bg}"/>
    <rect x="34" y="78" width="210" height="16" rx="8" fill="${bg}" opacity=".55"/>
    <rect x="34" y="118" width="154" height="32" rx="8" fill="${b}"/>
  </g>
  <circle cx="150" cy="430" r="52" fill="${b}" opacity=".9"/>
  <circle cx="238" cy="430" r="52" fill="#ffffff" opacity=".9"/>
  <circle cx="326" cy="430" r="52" fill="${b}" opacity=".9"/>
</svg>`;
}

function skillPreviewSvg(skill, block) {
  const palette = ["#ca221f", "#0b68b7", "#f6c22b"];
  const offset = Math.abs([...skill.slug].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % palette.length;
  const accent = palette[offset];
  const secondary = palette[(offset + 1) % palette.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="460" viewBox="0 0 720 460" role="img" aria-label="${escapeHtml(skill.command)} preview">
  <rect width="720" height="460" fill="#f8f9fc"/>
  <path d="M0 70 H720 M0 170 H720 M0 270 H720 M0 370 H720 M90 0 V460 M210 0 V460 M330 0 V460 M450 0 V460 M570 0 V460" stroke="#090e22" stroke-width="1.5" opacity=".06"/>
  <circle cx="576" cy="88" r="126" fill="${accent}" opacity=".9"/>
  <path d="M0 340 L190 240 L332 298 L470 190 L720 290 V460 H0Z" fill="${secondary}" opacity=".65"/>
  <rect x="54" y="58" width="406" height="252" rx="16" fill="#ffffff" stroke="#dde0ee" stroke-width="2"/>
  <rect x="84" y="94" width="180" height="18" rx="9" fill="#090e22"/>
  <rect x="84" y="138" width="316" height="14" rx="7" fill="#090e22" opacity=".5"/>
  <rect x="84" y="172" width="270" height="14" rx="7" fill="#090e22" opacity=".3"/>
  <rect x="84" y="224" width="132" height="40" rx="8" fill="${accent}"/>
  <text x="54" y="392" fill="#090e22" font-family="Montserrat, Arial, sans-serif" font-size="38" font-weight="800">${escapeHtml(skill.command)}</text>
  <text x="56" y="424" fill="#7a82a8" font-family="Arial, sans-serif" font-size="18" letter-spacing="1">${escapeHtml((block?.name ?? skill.category).toUpperCase())}</text>
</svg>`;
}

function writeAssets() {
  write(
    path.join(outDir, "assets", "logo.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="twt logo">
  <rect width="128" height="128" rx="18" fill="#ffffff"/>
  <rect x="8" y="8" width="112" height="112" rx="12" fill="none" stroke="#090e22" stroke-width="4"/>
  <path d="M18 25 C35 38 47 52 61 72" fill="none" stroke="#090e22" stroke-width="8" stroke-linecap="round"/>
  <path d="M47 86 C60 78 71 69 86 58" fill="none" stroke="#090e22" stroke-width="8" stroke-linecap="round"/>
  <path d="M66 56 C78 72 91 88 104 104" fill="none" stroke="#ca221f" stroke-width="8" stroke-linecap="round"/>
  <path d="M76 83 C91 73 107 63 121 55" fill="none" stroke="#ca221f" stroke-width="8" stroke-linecap="round"/>
  <circle cx="94" cy="51" r="14" fill="#0b68b7"/>
  <circle cx="11" cy="16" r="5" fill="#f6c22b"/>
</svg>`
  );

  blocks.forEach((block, index) => {
    write(path.join(outDir, "assets", "previews", "blocks", `${block.id}.svg`), blockPreviewSvg(block, index));
  });

  for (const skill of skills.values()) {
    const block = skill.block ?? inferBlock(skill);
    write(path.join(outDir, "assets", "previews", "skills", `${skill.slug}.svg`), skillPreviewSvg(skill, block));
  }

  write(path.join(outDir, "assets", "styles.css"), css());
  write(path.join(outDir, "assets", "app.js"), js());
}

function inferBlock(skill) {
  if (["qa"].includes(skill.category)) return blocks.find((block) => block.id === "qa");
  if (["site-dev"].includes(skill.category)) return blocks.find((block) => block.id === "general");
  if (["html", "elementor", "develop"].includes(skill.category)) return blocks.find((block) => block.id === "develop");
  if (["design", "design-system", "component", "layout", "mockup"].includes(skill.category)) return blocks.find((block) => block.id === "design");
  if (["brand", "positioning", "ia", "curation", "spec", "content", "intake", "pre-design"].includes(skill.category)) return blocks.find((block) => block.id === "pre-design");
  return blocks.find((block) => block.id === "general");
}

function blockCard(block) {
  const coming = block.status === "Coming soon";
  const body = `
    <img src="assets/previews/blocks/${block.id}.svg" alt="${escapeHtml(block.name)} preview">
    ${coming ? `<span class="tape" aria-hidden="true"><span>Coming soon</span></span>` : ""}
    <span class="phase-meta"><span>${escapeHtml(block.kicker)}</span><span class="${coming ? "pill soon" : "pill"}">${escapeHtml(block.status)}</span></span>
    <strong>${escapeHtml(block.name)}</strong>
    <p>${escapeHtml(block.description)}</p>`;
  return coming
    ? `<div class="phase-card is-disabled reveal" aria-disabled="true">${body}</div>`
    : `<a class="phase-card reveal" href="${block.href}">${body}</a>`;
}

function skillCard(skill, pageDir = "blocks") {
  const rel = relFrom(pageDir);
  return `<a class="skill-card reveal" href="${rel}skills/${skill.slug}.html">
    <img src="${rel}assets/previews/skills/${skill.slug}.svg" alt="${escapeHtml(skill.command)} preview">
    <span>${escapeHtml(skill.category)} · v${escapeHtml(skill.version)}</span>
    <strong>${escapeHtml(skill.command)}</strong>
    <p>${escapeHtml(cardCopy(skill))}</p>
  </a>`;
}

function skillListCard(skill, pageDir = "blocks") {
  const rel = relFrom(pageDir);
  const icon = skill.command.replace("/twt-", "").charAt(0).toUpperCase();
  const writesCount = skill.writes.filter((item) => item !== "(none)").length;
  return `<a class="skill-card skill-row reveal" href="${rel}skills/${skill.slug}.html" data-skill="${skill.slug}">
    <span class="skill-icon" aria-hidden="true">${escapeHtml(icon)}</span>
    <span class="skill-heading">
      <span class="skill-title">${escapeHtml(displayName(skill))}</span>
      <span class="skill-owner">${escapeHtml(skill.command)}</span>
    </span>
    <span class="skill-version">v${escapeHtml(skill.version)}</span>
    <span class="skill-copy">${formatInline(cardCopy(skill))}</span>
    ${tokenUsageMarkup(skill, { compact: true })}
    <span class="skill-stats">inputs ${escapeHtml(skill.acceptsArguments)} · reads ${skill.reads.length} · writes ${writesCount}</span>
    <span class="skill-action">View details</span>
  </a>`;
}

function writeHome() {
  const body = `
    <section class="hero">
      <div class="hero-copy reveal">
        <p class="eyebrow">A local field guide for the twt workflow</p>
        <h1>Find the right twt skill for the job.</h1>
        <p class="lede">Explore the marketplace by phase, see what every command expects, and understand what each one leaves behind.</p>
        <div class="hero-actions">
          <a class="button primary" href="blocks/pre-design.html">Start with Pre-design</a>
          <a class="button ghost" href="blocks/general.html">View utilities</a>
        </div>
      </div>
      <div class="hero-mark reveal" aria-hidden="true">
        <span class="logo-pair hero-logo">
          <img class="logo-dark" src="assets/logo.svg" alt="">
        </span>
        <div class="orbit one"></div>
        <div class="orbit two"></div>
        <div class="terminal-card">
          <span>/twt-site auto</span>
          <span>pre-design -> design -> develop -> qa</span>
        </div>
      </div>
    </section>
    <section class="section-band">
      <div class="section-title reveal">
        <h2>Pick the part of the pipeline you are working in.</h2>
      </div>
      <div class="phase-grid">
        ${blocks.map(blockCard).join("")}
      </div>
    </section>`;
  write(path.join(outDir, "index.html"), layout({ title: "Home", body }));
}

function writeAltIndex() {
  const blockSkillsOf = (id) => blocks.find((block) => block.id === id)?.skills ?? [];
  const groups = [
    {
      id: "orchestration",
      kicker: "Purpose",
      title: "Run the whole pipeline",
      purpose:
        "Master orchestrators that chain the phases end to end. Pick one of these when you want the pipeline to drive itself — the full guided path, or the express lane from a finished Figma design.",
      skills: ["twt-site", "twt-site-dev"],
    },
    {
      id: "setup",
      kicker: "Purpose",
      title: "Set up and maintain a project",
      purpose:
        "One-time setup and ongoing housekeeping: merging the permission allowlist, spotting stale artifacts, regenerating the marketplace's own reference docs, and smoke-testing the skills themselves.",
      skills: ["twt-setup", "twt-status", "twt-marketplace-docs", "twt-eval-smoke"],
    },
    {
      id: "pre-design",
      kicker: "Phase 1",
      title: "Shape the project — Pre-design",
      purpose: blocks.find((block) => block.id === "pre-design").description,
      skills: [...blockSkillsOf("pre-design"), "twt-audience", "twt-seo"],
    },
    {
      id: "design",
      kicker: "Phase 2",
      title: "Design the system and pages",
      purpose: blocks.find((block) => block.id === "design").description,
      skills: (() => {
        const [orchestrator, ...rest] = blockSkillsOf("design");
        return [orchestrator, "twt-direction-define", ...rest];
      })(),
    },
    {
      id: "develop",
      kicker: "Phase 3",
      title: "Build the site",
      purpose: blocks.find((block) => block.id === "develop").description,
      maintenance: true,
      skills: blockSkillsOf("develop"),
    },
    {
      id: "qa",
      kicker: "Phase 4",
      title: "Check the result — QA",
      purpose: blocks.find((block) => block.id === "qa").description,
      maintenance: true,
      skills: blockSkillsOf("qa"),
    },
    {
      id: "wiki",
      kicker: "Purpose",
      title: "Remember the project — the wiki",
      purpose:
        "The project's durable memory, kept apart from generated artifacts: decisions and the reasons behind them, client answers, and ideas not yet scoped — plus a way to ask questions against all of it.",
      skills: ["twt-wiki", "twt-wiki-fetch", "twt-wiki-query"],
    },
    {
      id: "export",
      kicker: "Purpose",
      title: "Export polished documents",
      purpose:
        "Turn Markdown into polished, on-brand deliverables — PDF, Word, or slides — plus the reusable templates that keep them consistent.",
      skills: [
        "twt-export",
        "twt-export-docx",
        "twt-export-pdf",
        "twt-export-presentation",
        "twt-export-template-create",
      ],
    },
    {
      id: "utilities",
      kicker: "Purpose",
      title: "Standalone utilities",
      purpose: "Focused helpers you can run on any project, whether or not the pipeline is involved.",
      skills: ["twt-search-site", "twt-content-optimize"],
    },
  ];

  // Every skill in SKILLS.md must appear exactly once: anything the groups
  // above don't name falls back to the group matching its inferred block.
  const grouped = new Set(groups.flatMap((group) => group.skills));
  const fallbackGroupId = { general: "utilities", "pre-design": "pre-design", design: "design", develop: "develop", qa: "qa" };
  for (const skill of skills.values()) {
    if (grouped.has(skill.slug)) continue;
    const blockId = (skill.block ?? inferBlock(skill)).id;
    groups.find((group) => group.id === fallbackGroupId[blockId]).skills.push(skill.slug);
    grouped.add(skill.slug);
  }

  const groupSection = (group) => {
    const groupSkills = group.skills.map((slug) => skills.get(slug)).filter(Boolean);
    if (!groupSkills.length) return "";
    const items = groupSkills
      .map(
        (skill) => `<li class="reveal" data-skill="${skill.slug}">
        <span class="alt-skill-head">
          <a href="skills/${skill.slug}.html"><code>${escapeHtml(skill.command)}</code></a>
          <span class="alt-skill-name">${escapeHtml(displayName(skill))}</span>
          <span class="alt-skill-version">v${escapeHtml(skill.version)}</span>
        </span>
        <p class="alt-skill-desc">${formatInline(detailCopy(skill))}</p>
        ${tokenUsageMarkup(skill)}
      </li>`
      )
      .join("");
    const maintenanceClass = group.maintenance ? " is-maintenance" : "";
    const maintenanceAttribute = group.maintenance ? ` data-maintenance-section="${group.id}"` : "";
    return `<section class="section-band catalog-section${maintenanceClass}"${maintenanceAttribute}>
      <div class="section-title reveal">
        <div>
          <p class="eyebrow">${escapeHtml(group.kicker)} · ${groupSkills.length} skills</p>
          <h2>${escapeHtml(group.title)}</h2>
        </div>
      </div>
      ${group.maintenance ? `<p class="maintenance-notice">${escapeHtml(MAINTENANCE_NOTICE)}</p>\n      ` : ""}<p class="alt-group-note reveal">${escapeHtml(group.purpose)}</p>
      <ul class="alt-skill-list">${items}</ul>
    </section>`;
  };

  const body = `
    ${breadcrumbs([{ label: "Marketplace overview" }], "root")}
    <section class="skill-hero docs-hero">
      <div class="reveal">
        <p class="eyebrow">The twt skills marketplace</p>
        <h1>Every skill, one page — what this marketplace is and what's inside.</h1>
        <p class="lede">A plain-language tour of the marketplace: what a skills marketplace even is, why this one exists, and all ${skills.size} skills grouped by what they're for.</p>
      </div>
    </section>
    <section class="marketplace-story" aria-label="Marketplace introduction">
      <section class="marketplace-story__step">
        <span class="marketplace-story__index" aria-hidden="true">01</span>
        <h2>What is a skills marketplace?</h2>
        <p>A skills marketplace is a catalog of installed, versioned command packages. Each skill gives Claude Code a repeatable way to handle one job, so you can run the same workflow across projects without explaining it again every time.</p>
      </section>
      <section class="marketplace-story__step">
        <span class="marketplace-story__index" aria-hidden="true">02</span>
        <h2>What this marketplace is for</h2>
        <p>twt carries a website project from raw notes to a QA-checked build. Its commands cover Pre-design, Design, Development, and QA; focused utilities handle exports, content quality, search, and project memory alongside that pipeline.</p>
      </section>
    </section>
    <section class="knowledge-guide" aria-labelledby="knowledge-guide-title">
      <header class="orientation-heading">
        <p class="eyebrow">How the pieces fit together</p>
        <h2 id="knowledge-guide-title">One project, one source of knowledge</h2>
        <p>The hub brings the project's durable knowledge and its repeatable workflows into one place, so decisions, context, and execution stay connected.</p>
      </header>
      <div class="orientation-rows">
        <article class="orientation-row">
          <h3>Project wiki</h3>
          <p>The project's durable memory: facts, decisions and their rationale, sources, open questions, and useful context. It is maintained knowledge, not a generated pipeline artifact.</p>
        </article>
        <article class="orientation-row">
          <h3>Pipeline skills</h3>
          <p>Orchestrators that coordinate several phases, skills, dependencies, and approval points in the right sequence. Use one when you want the workflow to manage the path.</p>
        </article>
        <article class="orientation-row">
          <h3>Single-task skills</h3>
          <p>Focused commands that perform one defined operation. Use one when you already know the exact job, such as validating content, exporting a PDF, or checking links.</p>
        </article>
      </div>
    </section>
    <section class="install-guide" aria-labelledby="install-guide-title">
      <header class="orientation-heading">
        <p class="eyebrow">Get started</p>
        <h2 id="install-guide-title">Install in Claude Code</h2>
        <p>Use the same setup in Claude Code CLI or the Claude desktop app.</p>
      </header>
      <ol class="install-steps">
        <li>
          <span class="install-step__number" aria-hidden="true">01</span>
          <div><strong>Add the marketplace</strong><pre><code>/plugin marketplace add vadym-shliachkov/twt</code></pre></div>
        </li>
        <li>
          <span class="install-step__number" aria-hidden="true">02</span>
          <div><strong>Install the plugin</strong><pre><code>/plugin install twt@twt-marketplace</code></pre></div>
        </li>
        <li>
          <span class="install-step__number" aria-hidden="true">03</span>
          <div><strong>Restart Claude Code</strong><p>Restart the CLI or desktop app so the new commands are loaded.</p></div>
        </li>
        <li>
          <span class="install-step__number" aria-hidden="true">04</span>
          <div><strong>Prepare each project once</strong><p>Run <code>/twt-setup</code> inside the project to merge the curated runtime permission allowlist.</p></div>
        </li>
      </ol>
    </section>
    <aside class="token-usage-legend" aria-labelledby="token-usage-title">
      <header class="orientation-heading">
        <p class="eyebrow">Planning aid</p>
        <h2 id="token-usage-title">Token usage estimates</h2>
        <p>Qualitative cost for a typical complete command run, including any sub-skills it dispatches.</p>
      </header>
      <ul class="usage-guide-rows">
        ${TOKEN_USAGE_GUIDE.map((usage) => `<li data-usage-level="${usage.key}">
          <span class="token-meter" aria-hidden="true">${tokenMeterMarkup(usage.segments)}</span>
          <strong>${escapeHtml(usage.label)}</strong>
          <span class="usage-window">Approx. ${escapeHtml(usage.windowImpact)} of a 5-hour usage window</span>
          <p>${escapeHtml(usage.description)}</p>
        </li>`).join("")}
      </ul>
      <div class="usage-caveat">
        <strong>These are planning estimates, not a fixed token-to-quota formula.</strong>
        <p>Actual usage depends heavily on the amount of source information, loaded conversation and project context, codebase size, model and effort level, tools or connectors, other activity on the plan, and how much iteration or rerunning the task needs.</p>
      </div>
      <p class="usage-check">Use <code>/usage</code> in Claude Code to check your current allowance and reset status.</p>
    </aside>
    ${groups.map(groupSection).join("")}`;

  write(path.join(outDir, "index.html"), layout({
    title: "Marketplace overview",
    body,
    description: "What the twt skills marketplace is, why it exists, and every skill grouped by purpose.",
  }));
}

function writeBlockPages() {
  for (const block of blocks) {
    const blockSkills = block.skills.map((slug) => skills.get(slug)).filter(Boolean);
    const maintenance = block.status === "Maintenance";
    const body = `
      ${breadcrumbs([{ label: block.name }], "blocks")}
      <section class="block-hero ${maintenance ? "is-maintenance" : ""}">
        <div class="${maintenance ? "" : "reveal"}">
          <p class="eyebrow">${escapeHtml(block.kicker)}</p>
          <h1>${escapeHtml(block.name)}</h1>
          <p class="lede">${escapeHtml(block.description)}</p>${maintenance ? `
          <span class="status-ribbon maintenance">Maintenance</span>
          <p class="maintenance-notice">${escapeHtml(MAINTENANCE_NOTICE)}</p>` : ""}
        </div>
        <img class="block-image reveal" src="../assets/previews/blocks/${block.id}.svg" alt="${escapeHtml(block.name)} preview">
      </section>
      <section class="section-band catalog-section">
        <div class="section-title reveal">
          <p class="eyebrow">${blockSkills.length} skills</p>
          <h2>${escapeHtml(block.name)} command list</h2>
        </div>
        <div class="skill-list">
          ${blockSkills.map((skill) => skillListCard(skill, "blocks")).join("")}
        </div>
      </section>`;
    write(path.join(outDir, "blocks", `${block.id}.html`), layout({
      title: block.name,
      body,
      pageDir: "blocks",
      description: block.description,
    }));
  }
}

function listBlock(title, items, { wide = false } = {}) {
  if (!items.length) return "";
  const cls = wide ? "detail-panel wide reveal" : "detail-panel reveal";
  if (items.length === 1) {
    return `<section class="${cls}">
    <h2>${escapeHtml(title)}</h2>
    <p>${formatInline(items[0])}</p>
  </section>`;
  }
  return `<section class="${cls}">
    <h2>${escapeHtml(title)}</h2>
    <ul>${items.map((item) => `<li>${formatInline(item)}</li>`).join("")}</ul>
  </section>`;
}

function writeSkillPages() {
  for (const skill of skills.values()) {
    const block = skill.block ?? inferBlock(skill);
    const body = `
      ${breadcrumbs(
        [
          { label: block.name, href: block.href },
          { label: skill.command },
        ],
        "skills"
      )}
      <section class="skill-hero docs-hero">
        <div class="reveal">
          <p class="eyebrow">${escapeHtml(block.name)} · ${escapeHtml(skill.category)}</p>
          <h1>${escapeHtml(skill.command)}</h1>
          <p class="lede">${formatInline(cardCopy(skill))}</p>
          <div class="fact-row">
            <span>Version ${escapeHtml(skill.version)}</span>
            <span>Arguments: ${escapeHtml(skill.acceptsArguments)}</span>
            ${tokenUsageMarkup(skill, { compact: true })}
          </div>
        </div>
      </section>
      <section class="detail-grid">
        ${listBlock("Purpose", [detailCopy(skill)], { wide: true })}
        ${sequenceBlock(skill, "skills")}
        ${listBlock("Parameters it can expect", skill.inputs)}
        ${fileListBlock("What it reads", skill.reads)}
        ${fileListBlock("Result it provides", skill.writes)}
        ${listBlock("Boundaries", skill.nonGoals)}
        ${listBlock("Success criteria", skill.success)}
      </section>`;
    write(path.join(outDir, "skills", `${skill.slug}.html`), layout({
      title: skill.command,
      body,
      pageDir: "skills",
      description: stripVersion(detailCopy(skill)).slice(0, 150),
    }));
  }
}

function css() {
  return `:root {
  /* doc-hub-light house style — mirrors templates/themes/doc-hub-light/css/tokens.css */
  --ink: #090e22;
  --paper: #090e22;        /* legacy alias: primary ink / text color */
  --text: #3a3f5c;
  --muted: #7a82a8;
  --line: #dde0ee;
  --bg: #ffffff;
  --surface: #f8f9fc;
  --surface-soft: #f8f9fc;
  --surface-card: #ffffff;
  --header-bg: rgba(255, 255, 255, .82);
  --mobile-nav-bg: #ffffff;
  --code-bg: #f8f9fc;
  --acid: #ca221f;
  --cyan: #0b68b7;
  --cyan-strong: #0a5ca3;
  --coral: #f6c22b;
  --disabled: #aab1cc;
  --subtle: #7a82a8;
  --copy: #3a3f5c;
  --quiet: #7a82a8;
  --radius: 10px;
  --radius-sm: 8px;
  --radius-pill: 999px;
  /* doc-landing language: flat — hairline rules, no drop shadows */
  --shadow: none;
  --shadow-strong: none;
  --shadow-hover: none;
  --grad: linear-gradient(90deg, var(--acid) 0 33%, var(--cyan) 33% 66%, var(--coral) 66% 100%);
  --ease: cubic-bezier(.23, 1, .32, 1);
  --font-heading: Montserrat, "Avenir Next", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-body: Inter, "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  line-height: 1.55;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4 { font-family: var(--font-heading); color: var(--ink); line-height: 1.15; text-wrap: balance; }
p { text-wrap: pretty; }
a { color: inherit; text-decoration: none; }
img { display: block; max-width: 100%; }
code {
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: .05rem .32rem;
  background: var(--code-bg);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: .88em;
}
strong { color: var(--ink); font-weight: 700; }
.grain { display: none; }
.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1rem clamp(1rem, 4vw, 3rem);
  border-bottom: 1px solid var(--line);
  background: var(--header-bg);
  backdrop-filter: blur(18px);
}
.brand { display: inline-flex; align-items: center; gap: .7rem; font-family: var(--font-heading); font-size: 1.15rem; font-weight: 800; letter-spacing: -.01em; text-transform: lowercase; color: var(--ink); }
.logo-pair {
  position: relative;
  display: inline-grid;
  width: 42px;
  height: 42px;
  place-items: center;
  flex: 0 0 auto;
}
.logo-pair img {
  grid-area: 1 / 1;
  width: 100%;
  height: 100%;
}
.footer-logo { width: 34px; height: 34px; }
.main-nav { display: flex; align-items: center; gap: .35rem; }
.main-nav a {
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: .5rem .8rem;
  color: var(--text);
  font-size: .92rem;
  font-weight: 600;
  transition: background 160ms var(--ease), color 160ms var(--ease);
}
.main-nav a:hover, .main-nav a:focus-visible { background: var(--surface); color: var(--ink); outline: none; }
.nav-disabled {
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: .5rem .8rem;
  color: var(--disabled);
  cursor: not-allowed;
  font-size: .92rem;
  font-weight: 600;
}
.menu-toggle { display: none; background: none; border: 0; padding: .5rem; }
.menu-toggle span { display: block; width: 24px; height: 2px; margin: 5px 0; background: var(--ink); }
main { min-height: 78vh; }
main > section,
main > nav {
  max-width: 1860px;
  margin-inline: auto;
}
.hero, .block-hero, .skill-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(280px, .95fr);
  align-items: center;
  gap: clamp(2rem, 6vw, 6rem);
  padding: clamp(4rem, 10vw, 8rem) clamp(1rem, 4vw, 3rem);
}
.hero h1, .block-hero h1, .skill-hero h1 {
  margin: 0;
  max-width: 980px;
  font-size: clamp(2.6rem, 5.5vw, 5rem);
  line-height: 1.03;
  letter-spacing: -.02em;
  font-weight: 800;
}
.skill-hero h1 { font-size: clamp(2.2rem, 4.5vw, 4rem); overflow-wrap: anywhere; }
.eyebrow {
  display: block;
  margin: 0 0 1.1rem;
  color: var(--cyan);
  font-family: var(--font-heading);
  font-size: .82rem;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.eyebrow::after {
  content: "";
  display: block;
  width: 72px;
  height: 4px;
  margin-top: .7rem;
  border-radius: var(--radius-pill);
  background: var(--grad);
}
.lede {
  margin: 1.4rem 0 0;
  max-width: 720px;
  color: var(--muted);
  font-size: clamp(1.05rem, 2vw, 1.35rem);
}
.hero-actions { display: flex; flex-wrap: wrap; gap: .85rem; margin-top: 2rem; }
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .55rem;
  min-height: 48px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: .75rem 1.3rem;
  color: var(--ink);
  font-family: var(--font-heading);
  font-weight: 800;
  letter-spacing: -.005em;
  background: var(--surface-card);
  transition: background 160ms var(--ease), border-color 160ms var(--ease), color 160ms var(--ease);
}
.button.primary { background: var(--ink); border-color: var(--ink); color: #fff; }
.button.primary::before {
  content: "";
  width: 22px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--grad);
}
.button.primary:hover { background: var(--cyan); border-color: var(--cyan); }
.button.ghost { background: var(--surface-card); color: var(--ink); }
.button.ghost:hover { border-color: var(--cyan); color: var(--cyan); }
.hero-mark { position: relative; min-height: 440px; }
.hero-logo {
  position: relative;
  display: grid;
  left: clamp(1rem, 2.4vw, 3rem);
  width: min(420px, 70vw);
  height: min(420px, 70vw);
  margin: 0 auto;
  filter: drop-shadow(0 18px 40px rgba(9, 14, 34, .12));
  animation: float 8s ease-in-out infinite;
}
.orbit {
  position: absolute;
  border: 16px solid var(--cyan);
  border-radius: 999px;
  inset: 10% 5%;
  transform: rotate(-12deg);
  opacity: .1;
}
.orbit.two { inset: 22% 0 16% 10%; transform: rotate(17deg); border-color: var(--acid); opacity: .1; }
.terminal-card {
  position: absolute;
  left: 3%;
  bottom: 8%;
  display: grid;
  gap: .35rem;
  width: min(340px, 86vw);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  background: var(--surface-card);
  box-shadow: var(--shadow-strong);
  color: var(--ink);
  font-family: var(--font-mono);
}
.terminal-card span:last-child { color: var(--cyan); font-size: .85rem; }
.section-band { padding: clamp(3rem, 7vw, 6rem) clamp(1rem, 4vw, 3rem); border-top: 1px solid var(--line); }
.catalog-section { padding-top: clamp(2rem, 4vw, 3.4rem); }
.section-title { display: flex; align-items: end; justify-content: space-between; gap: 2rem; margin-bottom: 1.4rem; }
.section-title h2 { margin: 0; max-width: 780px; font-size: clamp(1.8rem, 4vw, 3.4rem); line-height: 1.06; letter-spacing: -.015em; font-weight: 800; }
.catalog-section .section-title {
  max-width: 1860px;
  margin-inline: auto;
  align-items: center;
  margin-bottom: 1rem;
}
.catalog-section .section-title h2 {
  max-width: 640px;
  font-size: clamp(1.9rem, 3vw, 2.6rem);
  line-height: 1.1;
}
.phase-grid, .skill-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.phase-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.skill-list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  max-width: 1860px;
  margin-inline: auto;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-card);
  box-shadow: var(--shadow-strong);
}
.phase-card, .detail-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-card);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.phase-card { position: relative; }
.phase-card { transition: border-color 180ms var(--ease); }
.phase-card:hover { border-color: var(--cyan); }
.phase-card.is-disabled { cursor: not-allowed; }
.phase-card.is-disabled:hover { border-color: var(--line); }
.phase-card.is-disabled img { filter: grayscale(.4) opacity(.72); }
.tape {
  position: absolute;
  left: 50%;
  top: 1rem;
  transform: translateX(-50%);
  z-index: 3;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--surface-card);
  color: var(--muted);
  padding: .35rem .75rem;
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  box-shadow: var(--shadow);
  white-space: nowrap;
}
.tape span { display: block; transform: none; }
.phase-card img { aspect-ratio: 16 / 10; width: 100%; object-fit: cover; }
.phase-card > img { height: clamp(150px, 15vw, 220px); }
.phase-card strong { display: block; padding: 0 1.1rem; margin-top: 1rem; color: var(--ink); font-size: 1.25rem; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
.phase-card p { margin: .6rem 0 0; padding: 0 1.1rem 1.15rem; color: var(--muted); }
.phase-meta {
  display: flex;
  justify-content: space-between;
  gap: .75rem;
  padding: 1rem 1.1rem;
  color: var(--muted);
  font-size: .74rem;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.pill { color: #fff; background: var(--cyan); border-radius: var(--radius-pill); padding: .18rem .5rem; font-weight: 700; }
.pill.soon, .status-ribbon { background: var(--coral); color: var(--ink); }
.status-ribbon { display: inline-flex; margin-top: 1.5rem; border: 1px solid var(--coral); border-radius: var(--radius-pill); padding: .4rem .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; box-shadow: var(--shadow); }
.maintenance-notice {
  max-width: 860px;
  margin: 0 0 1.4rem;
  border-left: 4px solid var(--coral);
  padding: 1rem 1.15rem;
  background: #fff8df;
  color: var(--ink);
  font-weight: 650;
  line-height: 1.55;
}
.block-hero .maintenance-notice { margin: 1rem 0 0; }
.catalog-section.is-maintenance { border-top-color: var(--coral); }
.skill-card.skill-row {
  position: relative;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) auto;
  grid-template-rows: auto 1fr auto auto;
  column-gap: 1rem;
  row-gap: 1rem;
  min-height: 260px;
  border: 0;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 1.7rem 1.8rem;
  color: inherit;
  background: var(--surface-card);
  box-shadow: none;
  overflow: hidden;
  transition: background 160ms var(--ease);
}
.skill-card.skill-row:nth-child(4n) { border-right: 0; }
.skill-row:hover {
  transform: none;
  border-color: var(--line);
  background: var(--surface);
}
.skill-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--cyan);
  font-size: 1.2rem;
  font-weight: 800;
}
.skill-heading {
  display: block;
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  padding-right: .75rem;
}
.skill-title {
  display: block;
  color: var(--ink);
  font-size: 1.12rem;
  font-weight: 700;
  line-height: 1.16;
  overflow-wrap: anywhere;
}
.skill-owner {
  display: block;
  color: var(--subtle);
  font-size: .82rem;
  line-height: 1.3;
}
.skill-copy {
  display: block;
  grid-column: 1 / 4;
  grid-row: 2;
  max-width: 92%;
  margin-top: .15rem;
  color: var(--copy);
  font-size: .95rem;
  line-height: 1.45;
}
.skill-version {
  display: inline-flex;
  justify-content: center;
  align-self: start;
  grid-column: 3;
  grid-row: 1;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  padding: .22rem .58rem;
  background: var(--code-bg);
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: .72rem;
  white-space: nowrap;
}
.skill-stats {
  display: block;
  align-self: end;
  grid-column: 1 / 3;
  grid-row: 4;
  color: var(--quiet);
  font-family: var(--font-mono);
  font-size: .72rem;
  line-height: 1.3;
}
.skill-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: end;
  justify-self: end;
  grid-column: 3;
  grid-row: 4;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: .46rem .72rem;
  color: var(--ink);
  font-size: .86rem;
  font-weight: 700;
  transition: background 160ms var(--ease), border-color 160ms var(--ease);
}
.skill-action:hover { background: var(--surface); border-color: var(--cyan); color: var(--cyan); }
.block-image { border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-strong); }
.breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem;
  padding: 1.4rem clamp(1rem, 4vw, 3rem) 0;
  color: var(--muted);
  font-size: .82rem;
  font-weight: 700;
  letter-spacing: .03em;
  text-transform: uppercase;
}
.breadcrumbs a:hover { color: var(--ink); }
.breadcrumbs strong { color: var(--cyan); }
.breadcrumbs .breadcrumb-command { text-transform: none; }
.fact-row { display: flex; flex-wrap: wrap; gap: .7rem; margin-top: 1.5rem; }
.fact-row > span { border: 1px solid var(--line); border-radius: var(--radius-pill); padding: .45rem .8rem; color: var(--ink); background: var(--surface); font-size: .9rem; }
.docs-hero {
  display: block;
  padding-block: clamp(3.2rem, 8vw, 6rem);
}
.docs-hero h1 {
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: clamp(1.75rem, 5vw, 4rem);
  font-weight: 800;
  letter-spacing: -.02em;
}
.docs-hero .lede { max-width: 980px; }
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  padding: 0 clamp(1rem, 4vw, 3rem) clamp(4rem, 8vw, 7rem);
}
.detail-panel { padding: 1.5rem; }
.detail-panel.wide { grid-column: 1 / -1; }
.detail-panel h2 { margin: 0 0 .8rem; font-size: 1.35rem; font-weight: 700; color: var(--ink); }
.detail-panel p { margin: 0; color: var(--muted); }
.detail-panel ul { margin: 0; padding-left: 1.15rem; color: var(--muted); }
.detail-panel li + li { margin-top: .45rem; }
.panel-note { margin: 0 0 1.1rem !important; font-size: .96rem; }
.file-list { margin: 0; padding: 0; list-style: none; }
.file-list li { margin: 0 0 .85rem; }
.file-list li:last-child { margin-bottom: 0; }
.file-list code { display: inline-block; margin-bottom: .2rem; color: var(--cyan); font-size: .82rem; word-break: break-word; }
.file-desc { display: block; color: var(--muted); font-size: .92rem; line-height: 1.45; }
.detail-panel ol.sequence { margin: 0; padding-left: 1.4rem; color: var(--muted); }
.detail-panel ol.sequence li { margin: 0 0 .9rem; padding-left: .25rem; }
.detail-panel ol.sequence li:last-child { margin-bottom: 0; }
.detail-panel ol.sequence li::marker { color: var(--cyan); font-weight: 700; }
.detail-panel ol.sequence a { color: var(--ink); }
.detail-panel ol.sequence a:hover code { border-color: var(--cyan); color: var(--cyan); }
.detail-panel ol.sequence code { font-size: .82rem; }
.marketplace-story {
  padding: 0 clamp(1rem, 4vw, 3rem) clamp(3rem, 7vw, 5.5rem);
}
.marketplace-story__step {
  display: grid;
  grid-template-columns: 56px minmax(260px, .72fr) minmax(0, 1.28fr);
  gap: clamp(1.5rem, 4vw, 5rem);
  padding: clamp(2.4rem, 5vw, 4.4rem) 0;
  border-top: 1px solid var(--line);
}
.marketplace-story__step:last-child { border-bottom: 1px solid var(--line); }
.marketplace-story__index {
  position: relative;
  align-self: stretch;
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: .86rem;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
.marketplace-story__step:first-child .marketplace-story__index::after {
  content: "";
  position: absolute;
  top: 2rem;
  bottom: -4.4rem;
  left: .55rem;
  width: 1px;
  background: var(--line);
}
.marketplace-story__step h2 {
  margin: -.15rem 0 0;
  max-width: 520px;
  font-size: clamp(1.75rem, 3vw, 3rem);
  letter-spacing: -.015em;
}
.marketplace-story__step p {
  max-width: 72ch;
  margin: 0;
  color: var(--copy);
  font-size: clamp(1rem, 1.4vw, 1.16rem);
  line-height: 1.7;
}
.knowledge-guide,
.install-guide,
.token-usage-legend {
  box-sizing: border-box;
  width: calc(100% - 2rem);
  max-width: 1120px;
  margin: 0 auto;
  padding: clamp(3rem, 7vw, 5.5rem) 0;
  border-top: 1px solid var(--line);
}
.token-usage-legend { display: block; border-bottom: 1px solid var(--line); }
.orientation-heading {
  display: grid;
  grid-template-columns: minmax(240px, .75fr) minmax(0, 1.25fr);
  gap: 1rem clamp(2rem, 6vw, 5rem);
  margin-bottom: clamp(2rem, 5vw, 3.5rem);
}
.orientation-heading .eyebrow { grid-column: 1 / -1; margin-bottom: .2rem; }
.orientation-heading h2 {
  margin: 0;
  font-size: clamp(1.9rem, 4vw, 3.5rem);
  line-height: 1.06;
  letter-spacing: -.018em;
}
.orientation-heading > p:last-child {
  max-width: 66ch;
  margin: .1rem 0 0;
  color: var(--copy);
  font-size: clamp(1rem, 1.4vw, 1.12rem);
  line-height: 1.7;
}
.orientation-rows { border-bottom: 1px solid var(--line); }
.orientation-row {
  display: grid;
  grid-template-columns: minmax(200px, .62fr) minmax(0, 1.38fr);
  gap: 1.25rem clamp(2rem, 6vw, 5rem);
  padding: 1.55rem 0;
  border-top: 1px solid var(--line);
}
.orientation-row h3 { margin: 0; font-size: 1.08rem; }
.orientation-row p { max-width: 72ch; margin: 0; color: var(--copy); line-height: 1.65; }
.install-steps,
.usage-guide-rows { list-style: none; margin: 0; padding: 0; border-bottom: 1px solid var(--line); }
.install-steps li {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 1.25rem;
  padding: 1.4rem 0;
  border-top: 1px solid var(--line);
}
.install-step__number {
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: .78rem;
  font-variant-numeric: tabular-nums;
}
.install-steps strong { display: block; margin-bottom: .7rem; }
.install-steps p { margin: 0; color: var(--copy); line-height: 1.65; }
.install-steps pre {
  max-width: 100%;
  margin: 0;
  padding: .9rem 1rem;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
}
.install-steps pre code { border: 0; padding: 0; color: var(--ink); background: transparent; white-space: pre-wrap; overflow-wrap: anywhere; }
.usage-guide-rows li {
  display: grid;
  grid-template-columns: 72px 90px minmax(220px, .85fr) minmax(0, 1.15fr);
  align-items: center;
  gap: 1rem 1.4rem;
  padding: 1.3rem 0;
  border-top: 1px solid var(--line);
}
.usage-guide-rows strong { color: var(--ink); }
.usage-window {
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: .76rem;
  line-height: 1.45;
}
.usage-guide-rows p { margin: 0; color: var(--copy); line-height: 1.55; }
.usage-caveat {
  margin-top: 1.5rem;
  border-left: 4px solid var(--coral);
  padding: 1.15rem 1.25rem;
  background: var(--surface);
}
.usage-caveat strong { display: block; color: var(--ink); }
.usage-caveat p { max-width: 88ch; margin: .55rem 0 0; color: var(--copy); line-height: 1.6; }
.usage-check { margin: 1rem 0 0; color: var(--copy); }
.usage-check code { color: var(--cyan); }
}
.alt-group-note {
  max-width: 860px;
  margin: 0 0 1.4rem;
  color: var(--muted);
  font-size: 1.02rem;
}
.alt-skill-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-width: 1860px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-card);
  overflow: hidden;
}
.alt-skill-list li { padding: 1.15rem 1.4rem; border-bottom: 1px solid var(--line); }
.alt-skill-list li:last-child { border-bottom: 0; }
.alt-skill-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .65rem; }
.alt-skill-head a:hover code { border-color: var(--cyan); color: var(--cyan); }
.alt-skill-head code { color: var(--cyan); }
.alt-skill-name { color: var(--ink); font-weight: 700; }
.alt-skill-version {
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  padding: .1rem .5rem;
  background: var(--code-bg);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: .72rem;
  white-space: nowrap;
}
.alt-skill-desc { margin: .45rem 0 0; max-width: 980px; color: var(--copy); font-size: .95rem; line-height: 1.5; }
.token-usage {
  display: inline-flex;
  align-items: center;
  gap: .55rem;
  margin-top: .8rem;
  color: var(--copy);
  font-family: var(--font-mono);
  font-size: .72rem;
  line-height: 1;
}
.token-usage__label { color: var(--copy); }
.token-usage strong { color: var(--ink); font: inherit; font-weight: 500; }
.token-meter { display: inline-flex; gap: 3px; }
.token-meter i {
  display: block;
  width: 13px;
  height: 4px;
  border-radius: 2px;
  background: var(--line);
}
.token-meter i.is-filled { background: var(--cyan); }
.token-usage--low .token-meter i.is-filled { background: var(--subtle); }
.token-usage--very-high .token-meter i.is-filled { background: var(--ink); }
.token-usage--compact { margin-top: 0; }
.skill-row .token-usage {
  align-self: end;
  grid-column: 1 / 4;
  grid-row: 3;
}
.fact-row .token-usage {
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  padding: .45rem .8rem;
  background: var(--surface);
}
.site-footer {
  display: flex;
  align-items: center;
  gap: .8rem;
  padding: 1.4rem clamp(1rem, 4vw, 3rem);
  border-top: 1px solid var(--line);
  color: var(--muted);
  background: var(--surface);
}
.site-footer img { width: 34px; height: 34px; }
.reveal { opacity: 0; transform: translateY(22px); transition: opacity 200ms ease-out, transform 200ms ease-out; }
.reveal.is-visible { opacity: 1; transform: translateY(0); }
@keyframes float {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50% { transform: translateY(-14px) rotate(1deg); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
}
@media (max-width: 1280px) {
  .skill-list { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .skill-card.skill-row:nth-child(4n) { border-right: 1px solid var(--line); }
  .skill-card.skill-row:nth-child(3n) { border-right: 0; }
}
@media (max-width: 980px) {
  .hero, .block-hero, .skill-hero { grid-template-columns: 1fr; }
  .phase-grid, .skill-grid, .detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .skill-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .skill-card.skill-row { border-right: 1px solid var(--line); }
  .skill-card.skill-row:nth-child(4n) { border-right: 1px solid var(--line); }
  .skill-card.skill-row:nth-child(3n) { border-right: 1px solid var(--line); }
  .skill-card.skill-row:nth-child(2n) { border-right: 0; }
}
@media (max-width: 720px) {
  body { background: var(--bg); }
  .menu-toggle { display: block; }
  .main-nav {
    position: absolute;
    top: 100%;
    right: 1rem;
    left: 1rem;
    display: none;
    flex-direction: column;
    align-items: stretch;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: .75rem;
    background: var(--mobile-nav-bg);
    box-shadow: var(--shadow-strong);
  }
  .main-nav.is-open { display: flex; }
  .phase-grid, .skill-grid, .detail-grid { grid-template-columns: 1fr; }
  .phase-grid { grid-template-columns: 1fr; }
  .skill-list { grid-template-columns: 1fr; }
  .skill-card.skill-row,
  .skill-card.skill-row:nth-child(2n),
  .skill-card.skill-row:nth-child(4n) { border-right: 0; }
  .skill-card.skill-row {
    grid-template-columns: 44px minmax(0, 1fr);
    min-height: 0;
    padding: 1.25rem;
  }
  .skill-heading { grid-column: 2; }
  .skill-copy {
    grid-column: 1 / 3;
    max-width: none;
  }
  .skill-version {
    justify-self: start;
    grid-column: 2;
    grid-row: 3;
    margin-top: .9rem;
  }
  .skill-row .token-usage {
    grid-column: 1 / 3;
    grid-row: 4;
    margin-top: .35rem;
  }
  .skill-stats {
    grid-column: 1 / 3;
    grid-row: 5;
    margin-top: 1rem;
  }
  .skill-action {
    justify-self: start;
    grid-column: 1 / 3;
    grid-row: 6;
    margin-top: 1rem;
  }
  .marketplace-story__step {
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 1rem;
    padding: 2.4rem 0;
  }
  .marketplace-story__index { grid-row: 1 / 3; }
  .marketplace-story__step h2,
  .marketplace-story__step p { grid-column: 2; }
  .marketplace-story__step:first-child .marketplace-story__index::after { bottom: -2.4rem; }
  .orientation-heading,
  .orientation-row { grid-template-columns: 1fr; gap: .8rem; }
  .orientation-heading .eyebrow { grid-column: 1; }
  .orientation-row { padding: 1.35rem 0; }
  .usage-guide-rows li {
    grid-template-columns: 72px minmax(0, 1fr);
    gap: .7rem 1rem;
  }
  .usage-guide-rows strong { align-self: center; }
  .usage-window,
  .usage-guide-rows p { grid-column: 2; }
  .hero-logo { left: 0; }
  .hero-mark { min-height: 340px; }
  .section-title { display: block; }
  .site-footer { align-items: flex-start; }
}`;
}

function js() {
  return `const toggle = document.querySelector("[data-menu-toggle]");
const nav = document.querySelector("[data-nav]");

if (toggle && nav) {
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
}

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }
}, { threshold: 0.14 });

document.querySelectorAll(".reveal").forEach((node) => observer.observe(node));

document.addEventListener("pointermove", (event) => {
  const mark = document.querySelector(".hero-mark");
  if (!mark || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const x = (event.clientX / window.innerWidth - 0.5) * 12;
  const y = (event.clientY / window.innerHeight - 0.5) * 12;
  mark.style.transform = \`translate3d(\${x}px, \${y}px, 0)\`;
});`;
}

cleanGenerated();
writeAssets();
writeAltIndex();
writeBlockPages();
writeSkillPages();

console.log(`Generated ${blocks.length} block pages, ${skills.size} skill pages, and index.html in ${path.relative(root, outDir)}`);
