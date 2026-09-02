#!/usr/bin/env node
// site-crawl.mjs — deterministic site crawler behind /twt-search-site and
// /twt-content-fetch-site. Crawling, text extraction, substring search, and
// Markdown conversion are mechanical; running them through the model burns
// tokens (up to 50 pages of context) and gives non-reproducible results.
//
//   node site-crawl.mjs search <query> <url> [--max 50] [--out <path>]
//     Crawl internal pages, case-insensitive substring search on visible text,
//     write the search report, print a JSON summary.
//
//   node site-crawl.mjs fetch <url> [--scope all|homepage] [--max 50] [--out-dir <dir>]
//     Crawl internal pages, convert each to clean frontmatter-tagged Markdown
//     under <out-dir>/<url-path>/index.md, write _sitemap.md, print a JSON summary.
//
// No dependencies — native fetch (Node 18+) + a pragmatic regex HTML converter.
// Exit 0 on success (even with unreachable pages); exit 2 on bad usage.
'use strict';
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ASSET_EXT = /\.(pdf|zip|jpe?g|png|gif|svg|webp|css|js|ico|woff2?|ttf|mp4|webm|xml|json|txt)$/i;
const AUTH_PATH = /\/(wp-admin|wp-login|login|logout|signin|signout)(\/|$)/i;
const UA = "Mozilla/5.0 (compatible; twt-site-crawl/1.0; +https://github.com/vadym-shliachkov/twt)";
const FETCH_TIMEOUT_MS = 15000;
const PAGE_DELAY_MS = 150;

// ---- CLI ----------------------------------------------------------------------

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name, dflt) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
function positionals(n) {
  const out = [];
  for (let i = 1; i < argv.length && out.length < n; i++) {
    if (argv[i].startsWith("--")) { i++; continue; }
    out.push(argv[i]);
  }
  return out;
}
function usage(msg) {
  console.error(msg);
  console.error("Usage: site-crawl.mjs search <query> <url> [--max 50] [--out <path>]");
  console.error("       site-crawl.mjs fetch <url> [--scope all|homepage] [--max 50] [--out-dir <dir>]");
  process.exit(2);
}

// ---- URL helpers ----------------------------------------------------------------

function normalizeUrl(raw, base) {
  let u;
  try { u = base ? new URL(raw, base) : new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = ""; u.search = "";
  let s = u.toString();
  if (u.pathname !== "/" && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function isCrawlable(url, host) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname !== host) return false;
  if (ASSET_EXT.test(u.pathname)) return false;
  if (AUTH_PATH.test(u.pathname)) return false;
  return true;
}

// URL path -> file path under the domain dir: "/" -> index.md, "/about" ->
// about/index.md, "/docs/api.html" -> docs/api/index.md.
function pathToFile(url) {
  const p = new URL(url).pathname.replace(/\.html?$/i, "").replace(/^\/+|\/+$/g, "");
  const safe = p.split("/").filter(Boolean)
    .map((seg) => decodeURIComponent(seg).replace(/[<>:"|?*\\]/g, "-")).join("/");
  return safe ? `${safe}/index.md` : "index.md";
}

// ---- HTML processing --------------------------------------------------------------

const NAMED_ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", eacute: "é", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß" };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENT[n.toLowerCase()] ?? m);
}

function stripChrome(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const abs = normalizeUrl(href, baseUrl);
    if (abs) links.add(abs);
  }
  return [...links];
}

function extractTitle(html) {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return t ? decodeEntities(t[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : "";
}

function visibleText(html) {
  return decodeEntities(stripChrome(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Prefer the main-content region when the page declares one.
function contentRegion(html) {
  for (const tag of ["main", "article"]) {
    const m = html.match(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "i"));
    if (m) return m[0];
  }
  const body = html.match(/<body\b[\s\S]*?<\/body>/i);
  return body ? body[0] : html;
}

function tableToMd(tbl) {
  const rows = [...tbl.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((r) =>
    [...r[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      decodeEntities(c[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  return ["", line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line), ""].join("\n");
}

// Pragmatic HTML -> Markdown for reference content (not a spec-complete converter;
// unhandled markup degrades to plain text, never breaks the file).
function htmlToMarkdown(html, baseUrl) {
  let s = stripChrome(contentRegion(html));

  // fenced code blocks + tables first (protect their internals)
  s = s.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (m) => {
    const code = m.replace(/<\/?(pre|code)\b[^>]*>/gi, "");
    return `\n\n\`\`\`\n${decodeEntities(code.replace(/<[^>]+>/g, ""))}\n\`\`\`\n\n`;
  });
  s = s.replace(/<table\b[\s\S]*?<\/table>/gi, (m) => `\n${tableToMd(m)}\n`);

  // inline
  s = s.replace(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (m, _q, d, sq, txt) => {
    const label = txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const href = normalizeUrl((d ?? sq ?? "").trim(), baseUrl);
    return label ? (href ? `[${label}](${href})` : label) : "";
  });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_");
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // blocks
  for (let h = 1; h <= 6; h++) {
    s = s.replace(new RegExp(`<h${h}\\b[^>]*>`, "gi"), `\n\n${"#".repeat(h)} `)
         .replace(new RegExp(`<\\/h${h}>`, "gi"), "\n\n");
  }
  s = s.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "");
  s = s.replace(/<\/(ul|ol|p|div|section|blockquote|figure)>/gi, "\n\n");
  s = s.replace(/<(p|blockquote)\b[^>]*>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");

  // strip the rest, decode, tidy
  s = decodeEntities(s.replace(/<[^>]+>/g, " "));
  s = s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trimEnd()).join("\n");
  s = s.replace(/^[ \t]+(?![-#*\d`|])/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

// ---- fetching --------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml/i.test(type)) throw new Error(`not HTML (${type.split(";")[0] || "unknown"})`);
  return { html: await res.text(), finalUrl: normalizeUrl(res.url) || url };
}

// Follow any redirect on the start URL (apex -> www, http -> https) so the
// crawl host and the output domain folder reflect the final destination —
// otherwise every link on the redirected-to site fails the same-host check
// and the crawl dies after one page.
async function resolveStartUrl(startUrl) {
  try { return (await fetchPage(startUrl)).finalUrl; }
  catch { return startUrl; } // unreachable start is reported by crawl() itself
}

// BFS crawl over internal pages. onPage(url, html, n) is called per fetched page.
async function crawl(startUrl, max, onPage) {
  const host = new URL(startUrl).hostname;
  const visited = new Set();
  const unreachable = [];
  const queue = [startUrl];
  let fetched = 0;
  while (queue.length && fetched < max) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    let page;
    try { page = await fetchPage(url); }
    catch (e) { unreachable.push({ url, reason: e.message }); continue; }
    if (visited.has(page.finalUrl) && page.finalUrl !== url) continue; // redirect to an already-seen page
    if (new URL(page.finalUrl).hostname !== host) { // redirected off-site — never save foreign content
      unreachable.push({ url, reason: `redirects off-site to ${page.finalUrl}` });
      continue;
    }
    visited.add(page.finalUrl);
    fetched++;
    await onPage(page.finalUrl, page.html, fetched);
    for (const link of extractLinks(page.html, page.finalUrl)) {
      if (isCrawlable(link, host) && !visited.has(link) && !queue.includes(link)) queue.push(link);
    }
    if (queue.length) await sleep(PAGE_DELAY_MS);
  }
  return { unreachable, capHit: queue.length > 0 && fetched >= max };
}

const today = () => new Date().toISOString().slice(0, 10);
const write = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, "utf8"); };

// ---- search subcommand -------------------------------------------------------------

async function runSearch() {
  const [query, rawUrl] = positionals(2);
  if (!query || !rawUrl) usage("search needs <query> and <url>");
  const givenUrl = normalizeUrl(rawUrl);
  if (!givenUrl) usage(`invalid URL: ${rawUrl}`);
  const startUrl = await resolveStartUrl(givenUrl);
  const max = Number(flag("--max", 50));
  const domain = new URL(startUrl).hostname;
  const slug = (query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "query").slice(0, 40);
  const outPath = flag("--out", join(".twt-artifacts", "search", domain, `search-report-${slug}.md`));

  const pages = []; // { url, matches: [snippet], extra }
  const needle = query.toLowerCase();

  const { unreachable, capHit, visited } = await crawl(startUrl, max, (url, html, n) => {
    const text = visibleText(html);
    const lower = text.toLowerCase();
    const matches = [];
    let extra = 0, i = 0;
    while ((i = lower.indexOf(needle, i)) !== -1) {
      if (matches.length >= 20) { extra++; i += needle.length; continue; }
      const s = Math.max(0, i - 100), e = Math.min(text.length, i + needle.length + 100);
      matches.push(`${s > 0 ? "…" : ""}${text.slice(s, i)}**${text.slice(i, i + needle.length)}**${text.slice(i + needle.length, e)}${e < text.length ? "…" : ""}`);
      i += needle.length;
    }
    pages.push({ url, matches, extra });
    console.error(`[${n}/${max}] Scanned: ${new URL(url).pathname} — ${matches.length + extra} matches`);
  });

  const withMatches = pages.filter((p) => p.matches.length);
  const noMatches = pages.filter((p) => !p.matches.length);
  const total = pages.reduce((n, p) => n + p.matches.length + p.extra, 0);

  const matchSections = withMatches.map((p) =>
    `### ${p.url}\n${p.matches.map((s, i) => `${i + 1}. ${s}`).join("\n")}${p.extra ? `\n(+${p.extra} more occurrences on this page)` : ""}`).join("\n\n");
  const body = withMatches.length
    ? `## Matches\n\n${matchSections}`
    : `## Matches\n\nNo occurrences of \`${query}\` found across ${pages.length} scanned pages.`;
  const unreachableSection = unreachable.length
    ? `\n\n## Unreachable pages\n\n${unreachable.map((u) => `- ${u.url} — ${u.reason}`).join("\n")}`
    : "";

  write(outPath, `---
query: ${query}
site: ${startUrl}
domain: ${domain}
searched_at: ${today()}
match_mode: case-insensitive substring
pages_scanned: ${pages.length}
pages_with_matches: ${withMatches.length}
total_matches: ${total}
---

# Search report: "${query}" on ${domain}

${body}

## Pages scanned without matches

${noMatches.length} pages${noMatches.length ? ` — ${noMatches.map((p) => p.url).join(" · ")}` : ""}${unreachableSection}
`);

  console.log(JSON.stringify({
    report_path: outPath, pages_scanned: pages.length, pages_with_matches: withMatches.length,
    total_matches: total, cap_hit: capHit, cap: max,
    unreachable: unreachable.map((u) => `${u.url} (${u.reason})`),
  }, null, 2));
}

// ---- fetch subcommand --------------------------------------------------------------

async function runFetch() {
  const [rawUrl] = positionals(1);
  if (!rawUrl) usage("fetch needs <url>");
  const givenUrl = normalizeUrl(rawUrl);
  if (!givenUrl) usage(`invalid URL: ${rawUrl}`);
  const startUrl = await resolveStartUrl(givenUrl);
  const scope = flag("--scope", "all");
  const max = scope === "homepage" ? 1 : Number(flag("--max", 50));
  const domain = new URL(startUrl).hostname;
  const outDir = flag("--out-dir", join(".twt-artifacts", "pre-design", "content", "fetched", "site", domain));

  const written = []; // { url, file, title }
  const { unreachable, capHit } = await crawl(startUrl, max, (url, html, n) => {
    const file = pathToFile(url);
    const title = extractTitle(html) || new URL(url).pathname;
    const md = htmlToMarkdown(html, url);
    write(join(outDir, file), `---
url: ${url}
title: ${title.replace(/\n/g, " ")}
fetched_at: ${today()}
---

${md}
`);
    written.push({ url, file, title });
    console.error(`[${n}/${max}] Fetched: ${new URL(url).pathname} → ${join(outDir, file)}`);
  });

  if (scope !== "homepage") {
    write(join(outDir, "_sitemap.md"), `---
domain: ${domain}
crawled_at: ${today()}
total_pages: ${written.length}
---

# Site Map: ${domain}

| Page | File |
|------|------|
${written.map((w) => `| ${w.url} | ${w.file} |`).join("\n")}
`);
  }

  console.log(JSON.stringify({
    out_dir: outDir, pages_written: written.length,
    sitemap: scope !== "homepage" ? join(outDir, "_sitemap.md") : null,
    cap_hit: capHit, cap: max,
    unreachable: unreachable.map((u) => `${u.url} (${u.reason})`),
  }, null, 2));
}

// ---- main ------------------------------------------------------------------------

if (cmd === "search") await runSearch();
else if (cmd === "fetch") await runFetch();
else usage(`unknown subcommand: ${cmd ?? "(none)"}`);
