#!/usr/bin/env node
// transcribe-video.mjs — deterministic transcript builder behind
// /twt-content-fetch-video. Downloading, transcribing, and paragraphing are
// mechanical; running them through the model would burn the whole transcript
// as context (a 90-minute talk is ~15k words) for a worse, non-reproducible
// result. The model reads the summary line, not the transcript.
//
//   node transcribe-video.mjs check [--python <exe>]
//     Preflight: report the Python interpreter and whether faster-whisper is
//     importable. Always exits 0; read the STATUS line.
//
//   node transcribe-video.mjs run <url-or-path> [--out-dir <dir>] [--model base]
//        [--language auto] [--python <exe>] [--keep-source] [--force]
//     Resolve the source, transcribe it locally with faster-whisper, and write
//     index.md + segments.json + _meta.md under <out-dir>/<slug>/.
//
// No npm dependencies — native fetch (Node 18+) plus the bundled Python worker.
// Exit 0 on success; 2 bad usage; 3 missing Python/faster-whisper;
// 4 output exists (pass --force); 1 anything else.
'use strict';
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, "whisper_transcribe.py");
const DEFAULT_OUT = ".twt-artifacts/pre-design/content/fetched/video";
const MEDIA_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|mpe?g|m4a|mp3|wav|aac|ogg|opus|flac)$/i;
const UA = "Mozilla/5.0 (compatible; twt-content-fetch-video/1.0; +https://github.com/vadym-shliachkov/twt)";

// Paragraphing thresholds — tuned so a paragraph is a readable unit of speech,
// not one ASR segment (~5 seconds) and not a wall of text.
const GAP_SECONDS = 1.5;
const MIN_WORDS = 40;
const MAX_WORDS = 120;
const HARD_WORDS = 200;

// ---- CLI ----------------------------------------------------------------------

const argv = process.argv.slice(2);
const cmd = argv[0];
const BOOLEAN_FLAGS = new Set(["--keep-source", "--force"]);

function flag(name, dflt) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
function has(name) { return argv.includes(name); }
function firstPositional() {
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { if (!BOOLEAN_FLAGS.has(argv[i])) i++; continue; }
    return argv[i];
  }
  return null;
}
function usage(msg) {
  console.error(msg);
  console.error("Usage: transcribe-video.mjs check [--python <exe>]");
  console.error("       transcribe-video.mjs run <url-or-path> [--out-dir <dir>] [--model base]");
  console.error("           [--language auto] [--python <exe>] [--keep-source] [--force]");
  process.exit(2);
}

// ---- Python discovery ----------------------------------------------------------

function probe(exe, args) {
  try {
    return spawnSync(exe, args, { encoding: "utf8", windowsHide: true });
  } catch {
    return { status: null, stdout: "", stderr: "" };
  }
}

// Returns {exe, args, version, executable} for the first interpreter that runs.
function findPython(explicit) {
  const candidates = explicit
    ? [[explicit, []]]
    : [["python", []], ["python3", []], ["py", ["-3"]]];
  for (const [exe, pre] of candidates) {
    const r = probe(exe, [...pre, "-c", "import sys; print(sys.version.split()[0]); print(sys.executable)"]);
    if (r.status === 0 && r.stdout.trim()) {
      const [version, executable] = r.stdout.trim().split(/\r?\n/);
      return { exe, args: pre, version, executable: executable || exe };
    }
  }
  return null;
}

function hasFasterWhisper(py) {
  const r = probe(py.exe, [...py.args, "-c", "import faster_whisper; print(faster_whisper.__version__)"]);
  return r.status === 0 ? (r.stdout.trim() || "unknown") : null;
}

function doCheck() {
  const py = findPython(flag("--python", null));
  if (!py) {
    console.log("python: NOT FOUND");
    console.log("STATUS: missing-python");
    console.log("Install Python 3.9-3.14 from https://www.python.org/downloads/ and re-run this check.");
    return;
  }
  console.log(`python: ${py.version} (${py.executable})`);
  const fw = hasFasterWhisper(py);
  if (!fw) {
    console.log("faster-whisper: NOT INSTALLED");
    console.log("STATUS: missing-package");
    console.log(`Install with: ${py.exe} -m pip install faster-whisper`);
    console.log("It pulls ctranslate2, av, onnxruntime and friends (~200MB). No system ffmpeg needed —");
    console.log("av decodes the media. The first run of each model size then downloads its weights.");
    return;
  }
  console.log(`faster-whisper: ${fw}`);
  console.log("STATUS: ok");
}

// ---- Source resolution ---------------------------------------------------------

export function slugify(s) {
  return (s || "video").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video";
}

export function extFromContentType(ct) {
  const map = {
    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
    "video/x-matroska": ".mkv", "video/mpeg": ".mpeg", "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a", "audio/wav": ".wav", "audio/x-wav": ".wav",
    "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/flac": ".flac",
  };
  return map[(ct || "").split(";")[0].trim().toLowerCase()] || ".mp4";
}

function nameFromUrl(url) {
  return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "video");
}

async function downloadTo(url, dir) {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("download failed: empty response body");
  const ct = res.headers.get("content-type") || "";
  if (/^text\/html/i.test(ct)) {
    throw new Error(`the URL returned an HTML page, not a media file (content-type: ${ct}). ` +
      "This skill takes a direct link to a video/audio file, not a player or watch page.");
  }
  let name = nameFromUrl(url);
  if (!MEDIA_EXT.test(name)) name += extFromContentType(ct);
  const dest = join(dir, name.replace(/[<>:"|?*\\/]/g, "-"));
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return { path: dest, contentType: ct, bytes: statSync(dest).size };
}

// ---- Transcript assembly -------------------------------------------------------

export function fmtTime(seconds, forceHours) {
  const t = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h || forceHours)
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function endsSentence(text) { return /[.!?…"')\]]\s*$/.test(text); }
function wordCount(text) { return text.split(/\s+/).filter(Boolean).length; }

// Group ASR segments into paragraphs: break on a real pause at a sentence end,
// or on length once a sentence ends, or unconditionally if the recognizer never
// produced punctuation.
export function paragraphize(segments) {
  const paras = [];
  let cur = null;
  for (const seg of segments) {
    if (!cur) { cur = { start: seg.start, end: seg.end, text: seg.text }; continue; }
    const gap = seg.start - cur.end;
    const words = wordCount(cur.text);
    const done = words >= HARD_WORDS
      || (endsSentence(cur.text) && (words >= MAX_WORDS || (gap >= GAP_SECONDS && words >= MIN_WORDS)));
    if (done) {
      paras.push(cur);
      cur = { start: seg.start, end: seg.end, text: seg.text };
    } else {
      cur.text += " " + seg.text;
      cur.end = seg.end;
    }
  }
  if (cur) paras.push(cur);
  return paras;
}

export function titleFrom(slug) {
  return slug.split("-").filter(Boolean)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ") || "Transcript";
}

export function buildIndexMd({ source, slug, result, fetchedAt }) {
  const forceHours = (result.duration || 0) >= 3600;
  const paras = paragraphize(result.segments);
  const body = paras.length
    ? paras.map((p) => `**[${fmtTime(p.start, forceHours)}]** ${p.text}`).join("\n\n")
    : "_No speech was detected in this file._";
  const fm = [
    "---",
    `source: ${source}`,
    "type: video",
    `title: ${titleFrom(slug)}`,
    `duration: ${fmtTime(result.duration, true)}`,
    `language: ${result.language || "unknown"}`,
    "engine: faster-whisper",
    `model: ${result.model}`,
    `segments: ${result.segments.length}`,
    `fetched_at: ${fetchedAt}`,
    "---",
  ].join("\n");
  return `${fm}\n\n# ${titleFrom(slug)}\n\n${body}\n`;
}

export function buildMetaMd({ source, localPath, bytes, result, warnings, keptSource }) {
  const lines = [
    `# Transcript metadata — ${basename(source)}`,
    "",
    `- **Source:** ${source}`,
    `- **Local media:** ${keptSource ? localPath : "downloaded to a temp file and deleted after transcription"}`,
    bytes ? `- **Size:** ${(bytes / 1048576).toFixed(1)} MB` : null,
    `- **Duration:** ${fmtTime(result.duration, true)}`,
    `- **Engine:** faster-whisper (local, offline) — model \`${result.model}\`, ${result.device}/${result.compute_type}`,
    `- **Language:** ${result.language || "unknown"} (detection confidence ${result.language_probability})`,
    `- **Segments:** ${result.segments.length}`,
    `- **Transcription wall time:** ${result.transcribe_seconds}s`,
    "",
    "## Warnings",
    "",
    warnings.length ? warnings.map((w) => `- ${w}`).join("\n") : "- None.",
    "",
    "> Machine transcription. Names, jargon, and numbers are the least reliable parts —",
    "> verify anything you plan to quote or treat as fact against the source recording.",
  ];
  return lines.filter((l) => l !== null).join("\n") + "\n";
}

// ---- run -----------------------------------------------------------------------

async function doRun() {
  const source = firstPositional();
  if (!source) usage("Missing <url-or-path>.");

  const py = findPython(flag("--python", null));
  if (!py) {
    console.error("No Python interpreter found. Run `check` for install guidance.");
    process.exit(3);
  }
  if (!hasFasterWhisper(py)) {
    console.error(`faster-whisper is not installed for ${py.executable}.`);
    console.error(`Install with: ${py.exe} -m pip install faster-whisper`);
    process.exit(3);
  }

  const isUrl = /^https?:\/\//i.test(source);
  if (!isUrl && !existsSync(source)) {
    console.error(`No such file: ${source}`);
    process.exit(2);
  }

  const rawName = isUrl ? nameFromUrl(source) : basename(source);
  const slug = slugify(rawName.replace(MEDIA_EXT, ""));
  const outDir = resolve(flag("--out-dir", DEFAULT_OUT), slug);
  const indexPath = join(outDir, "index.md");
  if (existsSync(indexPath) && !has("--force")) {
    console.error(`A transcript already exists at ${indexPath}. Re-run with --force to replace it.`);
    process.exit(4);
  }
  mkdirSync(outDir, { recursive: true });

  const warnings = [];
  const keepSource = has("--keep-source");
  let tempDir = null;
  let mediaPath = isUrl ? null : resolve(source);
  let bytes = mediaPath ? statSync(mediaPath).size : 0;

  try {
    if (isUrl) {
      const target = keepSource ? outDir : (tempDir = mkdtempSync(join(tmpdir(), "twt-video-")));
      console.error(`downloading ${source} …`);
      let dl;
      try {
        dl = await downloadTo(source, target);
      } catch (err) {
        // A dead host, a redirect to a login page, or a watch page instead of a
        // file — all user-fixable. Report the cause, not a Node stack trace.
        console.error(`Could not download the source: ${err.cause?.message || err.message}`);
        console.error("Check the URL points directly at a media file and is reachable from this machine.");
        // Don't leave the empty slug directory behind for a source we never got.
        try { if (!readdirSync(outDir).length) rmSync(outDir, { recursive: true }); } catch { /* leave it */ }
        process.exit(1);
      }
      mediaPath = dl.path;
      bytes = dl.bytes;
      console.error(`downloaded ${(bytes / 1048576).toFixed(1)} MB (${dl.contentType || "unknown type"})`);
    }
    if (!MEDIA_EXT.test(mediaPath)) {
      warnings.push(`Unrecognized media extension on \`${basename(mediaPath)}\` — decoding was attempted anyway.`);
    }

    const jsonPath = join(outDir, "segments.json");
    const args = [...py.args, WORKER, "--media", mediaPath, "--out", jsonPath,
      "--model", flag("--model", "base"), "--language", flag("--language", "auto")];
    const run = spawnSync(py.exe, args, { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
    if (run.status === 3) process.exit(3);
    if (run.status !== 0) {
      console.error(`Transcription failed (exit ${run.status}).`);
      process.exit(1);
    }

    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    if (!result.segments.length) warnings.push("No speech was detected — the transcript is empty.");
    if (result.language_probability && result.language_probability < 0.6) {
      warnings.push(`Low language-detection confidence (${result.language_probability}) — pass --language <code> to force one.`);
    }
    if (result.duration >= 1800 && ["tiny", "base"].includes(result.model)) {
      warnings.push(`Long recording transcribed with the \`${result.model}\` model — re-run with --model small (or medium) if accuracy matters.`);
    }

    const fetchedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(indexPath, buildIndexMd({ source, slug, result, fetchedAt }), "utf8");
    writeFileSync(join(outDir, "_meta.md"),
      buildMetaMd({ source, localPath: mediaPath, bytes, result, warnings, keptSource: !isUrl || keepSource }), "utf8");

    console.log(JSON.stringify({
      ok: true, slug, outDir, duration: fmtTime(result.duration, true),
      language: result.language, model: result.model,
      segments: result.segments.length,
      words: result.segments.reduce((n, s) => n + wordCount(s.text), 0),
      warnings,
      files: [indexPath, jsonPath, join(outDir, "_meta.md")],
    }, null, 2));
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---- dispatch ------------------------------------------------------------------

// Only dispatch when run as a program; tests import the pure helpers above.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (cmd === "check") doCheck();
  else if (cmd === "run") await doRun();
  else usage(cmd ? `Unknown command: ${cmd}` : "Missing command.");
}
