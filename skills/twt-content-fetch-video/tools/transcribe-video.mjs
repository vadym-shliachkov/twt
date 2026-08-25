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
//   node transcribe-video.mjs probe <path> [--python <exe>]
//     Report the media's stream layout — video, every audio track (flagging a
//     real audio-description track), and text vs bitmap subtitle streams.
//
//   node transcribe-video.mjs run <url-or-path> [--out-dir <dir>] [--model base]
//        [--language auto] [--python <exe>] [--keep-source] [--force]
//        [--descriptive] [--max-frames 60] [--frame-gap 4] [--frame-width 960]
//     Resolve the source, transcribe it locally with faster-whisper, and write
//     index.md + segments.json + _meta.md under <out-dir>/<slug>/. With
//     --descriptive, also extract the deterministic half of a WCAG-style
//     descriptive transcript: media.json, keyframes + frames.json, captions.json
//     from an embedded subtitle track, audio-description.md from a real
//     description track, speaker-turn candidates and non-speech spans in
//     segments.json, and outline.json. The prose transcript.md is written by the
//     model from those, window by window.
//
//   node transcribe-video.mjs slice <transcript-dir> [--window <n>]
//        [--from <t>] [--to <t>] [--window-seconds 300]
//     Print everything known about ONE window — its frames, speech, silences,
//     and caption cues — and nothing about any other. This is how the
//     descriptive pass reads a long recording without loading all of it.
//
// No npm dependencies — native fetch (Node 18+) plus the bundled Python workers.
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
const PROBE = join(HERE, "media_probe.py");
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
const BOOLEAN_FLAGS = new Set(["--keep-source", "--force", "--descriptive"]);

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
  console.error("       transcribe-video.mjs probe <path> [--python <exe>]");
  console.error("       transcribe-video.mjs run <url-or-path> [--out-dir <dir>] [--model base]");
  console.error("           [--language auto] [--python <exe>] [--keep-source] [--force]");
  console.error("           [--descriptive] [--max-frames 60] [--frame-gap 4] [--frame-width 960]");
  console.error("       transcribe-video.mjs slice <transcript-dir> [--window <n> | --from <t> --to <t>]");
  console.error("           [--window-seconds 300]");
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

// ---- descriptive-pass structure ------------------------------------------------
// None of this decides what the recording *means* — it marks where a turn, a
// silence, or a visual change happened so the descriptive pass can look there.

// A pause long enough to be a handover. The shorter threshold applies only when
// the previous segment closed a sentence; mid-sentence pauses are just breath.
export const TURN_GAP_SENTENCE = 0.9;
export const TURN_GAP_ANY = 2.0;
// Silence worth marking as a non-speech span in the transcript.
export const GAP_MIN_SECONDS = 3.0;
// How much recording the descriptive pass reads and looks at in one go.
export const WINDOW_SECONDS = 300;

// Speaker-turn *candidates*, not speaker identities: numbered handover points
// the descriptive pass clusters into named speakers from context.
export function assignTurns(segments) {
  let turn = 0;
  let prev = null;
  return segments.map((seg) => {
    if (prev) {
      const gap = seg.start - prev.end;
      if (gap >= TURN_GAP_ANY || (gap >= TURN_GAP_SENTENCE && endsSentence(prev.text))) turn += 1;
    }
    prev = seg;
    return { ...seg, turn };
  });
}

// Spans with no speech in them — where music, effects, or on-screen-only action
// live. A gap before the first segment counts: titles and stings open there.
export function nonSpeechGaps(segments, duration, min = GAP_MIN_SECONDS) {
  const gaps = [];
  let end = 0;
  for (const seg of segments) {
    if (seg.start - end >= min) gaps.push({ start: round3(end), end: round3(seg.start) });
    end = Math.max(end, seg.end);
  }
  if (duration && duration - end >= min) gaps.push({ start: round3(end), end: round3(duration) });
  return gaps;
}

function round3(n) { return Math.round((n || 0) * 1000) / 1000; }
function words(text, n) { return text.split(/\s+/).filter(Boolean).slice(0, n).join(" "); }
function lastWords(text, n) {
  const all = text.split(/\s+/).filter(Boolean);
  return all.slice(Math.max(0, all.length - n)).join(" ");
}
const inWindow = (t, w) => t >= w.start && t < w.end;

// A bounded planning digest: one row per window, never the transcript itself.
// A 90-minute recording outlines to ~18 rows — small enough to read whole.
export function buildOutline({ segments, gaps = [], frames = [], captions = [],
  duration, windowSeconds = WINDOW_SECONDS }) {
  const turned = segments[0] && "turn" in segments[0] ? segments : assignTurns(segments);
  const span = duration || (turned.length ? turned[turned.length - 1].end : 0);
  const count = Math.max(1, Math.ceil(span / windowSeconds));
  const windows = [];
  for (let i = 0; i < count; i++) {
    const w = { start: i * windowSeconds, end: Math.min(span, (i + 1) * windowSeconds) };
    const mine = turned.filter((s) => inWindow(s.start, w));
    const text = mine.map((s) => s.text).join(" ");
    windows.push({
      n: i + 1,
      start: fmtTime(w.start, span >= 3600),
      end: fmtTime(w.end, span >= 3600),
      words: wordCount(text),
      turns: mine.length ? [mine[0].turn, mine[mine.length - 1].turn] : [],
      frames: frames.filter((f) => inWindow(f.t, w)).map((f) => f.file),
      non_speech_spans: gaps.filter((g) => inWindow(g.start, w)).length,
      caption_cues: captions.filter((c) => inWindow(c.start, w)).length,
      opens: mine.length ? words(text, 18) : "(no speech)",
      closes: mine.length ? lastWords(text, 12) : "",
    });
  }
  return { duration: fmtTime(span, true), window_seconds: windowSeconds, windows };
}

// "90" | "1:30" | "1:02:03" -> seconds.
export function parseTime(value) {
  const raw = String(value ?? "").trim().split(":");
  // Number("") is 0, so an empty field has to be rejected before the conversion.
  if (!raw.length || raw.some((p) => p === "")) return null;
  const parts = raw.map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// The descriptive pass's read primitive: everything known about ONE window and
// nothing about any other, so a long recording never lands in context at once.
export function buildSlice({ from, to, duration, segments, gaps = [], frames = [],
  captions = [], framesDir = "frames" }) {
  const forceHours = (duration || 0) >= 3600;
  const at = (t) => fmtTime(t, forceHours);
  const w = { start: from, end: to };
  const turned = segments[0] && "turn" in segments[0] ? segments : assignTurns(segments);
  const mine = turned.filter((s) => inWindow(s.start, w));

  const lines = [`## Window ${at(from)}–${at(to)} of ${fmtTime(duration, true)}`, ""];

  const shots = frames.filter((f) => inWindow(f.t, w));
  lines.push(shots.length
    ? `### Frames in this window (${shots.length}) — view each before writing\n`
      + shots.map((f) => `- ${at(f.t)} — ${framesDir}/${f.file}`).join("\n")
    : "### Frames in this window\n- None (audio-only source, or no frame fell in this window).");
  lines.push("");

  // Speech and silence on one timeline, so a silence is never mistaken for a cut.
  // Paragraphs stop at every turn boundary here — unlike index.md, which reads as
  // continuous prose — because a handover is exactly where the speaker may change.
  lines.push("### Speech and silence");
  const byTurn = [];
  for (const seg of mine) {
    const last = byTurn[byTurn.length - 1];
    if (last && last.turn === seg.turn) last.segs.push(seg);
    else byTurn.push({ turn: seg.turn, segs: [seg] });
  }
  const events = [
    ...byTurn.flatMap((t) => paragraphize(t.segs)
      .map((p) => ({ t: p.start, kind: "speech", p, turn: t.turn }))),
    ...gaps.filter((g) => inWindow(g.start, w)).map((g) => ({ t: g.start, kind: "gap", g })),
  ].sort((a, b) => a.t - b.t);
  if (!events.length) lines.push("_Nothing in this window._");
  for (const ev of events) {
    if (ev.kind === "gap") {
      lines.push(`\n_[no speech ${at(ev.g.start)}–${at(ev.g.end)} — ${Math.round(ev.g.end - ev.g.start)}s]_`);
      continue;
    }
    lines.push(`\n**[${at(ev.p.start)}]** _(turn ${ev.turn})_ ${ev.p.text}`);
  }

  const cues = captions.filter((c) => inWindow(c.start, w));
  if (cues.length) {
    lines.push("", `### Embedded caption cues (${cues.length}) — the file's own subtitle track`,
      ...cues.map((c) => `- **[${at(c.start)}]** ${c.text}`));
  }
  return lines.join("\n") + "\n";
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

export function buildMetaMd({ source, localPath, bytes, result, warnings, keptSource, descriptive }) {
  const extras = descriptive ? [
    "",
    "## Descriptive-pass inputs",
    "",
    `- **Keyframes extracted:** ${descriptive.frames}`,
    `- **Embedded caption cues:** ${descriptive.captions}`,
    `- **Audio-description track:** ${descriptive.audio_description ? "found and transcribed to `audio-description.md`" : "none in this file"}`,
    `- **Speaker-turn candidates:** ${descriptive.turns ?? 0} (pause-derived — boundaries are approximate and unnamed)`,
    `- **Non-speech spans:** ${descriptive.non_speech_spans ?? 0}`,
    `- **Reading windows:** ${descriptive.windows ?? 0}`,
    "",
    "> Sounds are inferred from silence and picture, not from an audio-event classifier:",
    "> an off-screen noise with nothing on screen to show it can be missed. Speaker turns",
    "> mark where a handover probably happened, not who spoke.",
  ] : [];
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
    ...extras,
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

// ---- descriptive pass: deterministic extraction --------------------------------

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function pyProbe(py, args) {
  return spawnSync(py.exe, [...py.args, PROBE, ...args],
    { stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
}

function pyTranscribe(py, media, outJson) {
  return spawnSync(py.exe, [...py.args, WORKER, "--media", media, "--out", outJson,
    "--model", flag("--model", "base"), "--language", flag("--language", "auto")],
  { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
}

// Everything a descriptive transcript needs that a machine can settle: which
// streams exist, what the picture does, the file's own captions, and a real
// audio-description track if the publisher shipped one.
function enrichDescriptive({ py, mediaPath, outDir, result, warnings }) {
  const out = { frames: 0, captions: 0, audio_description: false, files: [] };

  const mediaJson = join(outDir, "media.json");
  if (pyProbe(py, ["probe", "--media", mediaPath, "--out", mediaJson]).status !== 0) {
    warnings.push("Stream probe failed — the descriptive extras (frames, captions, description track) were skipped.");
    return null;
  }
  const info = readJson(mediaJson) || {};
  out.files.push(mediaJson);
  out.streams = (info.streams || []).length;

  let frames = [];
  if (info.has_video) {
    const framesJson = join(outDir, "frames.json");
    const r = pyProbe(py, ["frames", "--media", mediaPath, "--out-dir", join(outDir, "frames"),
      "--out", framesJson, "--max", flag("--max-frames", "60"),
      "--min-gap", flag("--frame-gap", "4"), "--width", flag("--frame-width", "960")]);
    if (r.status === 0) {
      frames = (readJson(framesJson) || {}).frames || [];
      out.files.push(framesJson);
    } else {
      warnings.push("Frame extraction failed — the descriptive pass has no visuals to describe from.");
    }
  } else {
    warnings.push("No video stream in this source — on-screen text, actions, and visual description cannot be produced from it.");
  }
  out.frames = frames.length;

  let captions = [];
  if (info.subtitle_index !== null && info.subtitle_index !== undefined) {
    const capJson = join(outDir, "captions.json");
    if (pyProbe(py, ["subs", "--media", mediaPath, "--out", capJson]).status === 0) {
      captions = (readJson(capJson) || {}).cues || [];
      out.files.push(capJson);
    }
  } else if ((info.bitmap_subtitles || []).length) {
    warnings.push(`Subtitle stream(s) ${info.bitmap_subtitles.join(", ")} are bitmap subtitles — their text is only in the picture, so read it off the frames.`);
  }
  out.captions = captions.length;

  // A publisher-supplied description track is authoritative: it beats anything
  // inferred from frames, so transcribe it rather than paraphrasing the video.
  if (info.audio_description_index !== null && info.audio_description_index !== undefined) {
    const tmp = mkdtempSync(join(tmpdir(), "twt-video-ad-"));
    try {
      const wav = join(tmp, "audio-description.wav");
      const ex = pyProbe(py, ["audio", "--media", mediaPath,
        "--stream", String(info.audio_description_index), "--out", wav]);
      if (ex.status === 0) {
        console.error(`transcribing the audio-description track (stream ${info.audio_description_index}) …`);
        const adJson = join(outDir, "audio-description.json");
        if (pyTranscribe(py, wav, adJson).status === 0) {
          const ad = readJson(adJson);
          const forceHours = (result.duration || 0) >= 3600;
          const body = paragraphize(ad.segments || []).map(
            (p) => `**[${fmtTime(p.start, forceHours)}]** ${p.text}`).join("\n\n");
          const adMd = join(outDir, "audio-description.md");
          writeFileSync(adMd,
            `# Audio description track\n\n_Transcribed from audio stream ${info.audio_description_index} `
            + `of the source — the publisher's own description of the visuals. Prefer it over anything `
            + `inferred from the frames._\n\n${body || "_The description track carried no speech._"}\n`, "utf8");
          out.audio_description = true;
          out.files.push(adMd, adJson);
        } else {
          warnings.push("The audio-description track was found but could not be transcribed.");
        }
      } else {
        warnings.push(`Audio-description track (stream ${info.audio_description_index}) could not be extracted.`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // Turn candidates and silences go back into segments.json; the outline is the
  // only whole-recording view the model is meant to read.
  const gaps = nonSpeechGaps(result.segments, result.duration);
  const segmentsPath = join(outDir, "segments.json");
  writeFileSync(segmentsPath, JSON.stringify({
    ...result, segments: assignTurns(result.segments), non_speech: gaps,
  }), "utf8");
  out.non_speech_spans = gaps.length;
  out.turns = new Set(assignTurns(result.segments).map((s) => s.turn)).size;

  const outlinePath = join(outDir, "outline.json");
  writeFileSync(outlinePath, JSON.stringify(buildOutline({
    segments: result.segments, gaps, frames, captions, duration: result.duration,
    windowSeconds: Number(flag("--window-seconds", String(WINDOW_SECONDS))) || WINDOW_SECONDS,
  }), null, 2), "utf8");
  out.files.push(outlinePath);
  out.windows = (readJson(outlinePath) || {}).windows?.length || 0;
  return out;
}

// ---- probe / slice -------------------------------------------------------------

function doProbe() {
  const source = firstPositional();
  if (!source) usage("Missing <path>.");
  if (/^https?:\/\//i.test(source)) {
    console.error("probe reads a local file. Download it first, or use `run --descriptive`, which probes the source itself.");
    process.exit(2);
  }
  if (!existsSync(source)) { console.error(`No such file: ${source}`); process.exit(2); }
  const py = findPython(flag("--python", null));
  if (!py) { console.error("No Python interpreter found. Run `check` for install guidance."); process.exit(3); }

  const tmp = mkdtempSync(join(tmpdir(), "twt-video-probe-"));
  try {
    const out = join(tmp, "media.json");
    if (pyProbe(py, ["probe", "--media", resolve(source), "--out", out]).status !== 0) {
      console.error("Could not read the media's stream layout.");
      process.exit(1);
    }
    console.log(JSON.stringify(readJson(out), null, 2));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function doSlice() {
  const dir = firstPositional();
  if (!dir) usage("Missing <transcript-dir>.");
  const segs = readJson(join(dir, "segments.json"));
  if (!segs) { console.error(`No segments.json under ${dir}. Run \`run --descriptive\` first.`); process.exit(2); }

  const windowSeconds = Number(flag("--window-seconds", String(WINDOW_SECONDS))) || WINDOW_SECONDS;
  let from = parseTime(flag("--from", "0"));
  const nth = flag("--window", null);
  if (nth !== null) from = (Math.max(1, Number(nth)) - 1) * windowSeconds;
  if (from === null) usage("--from must be seconds or mm:ss.");
  const to = parseTime(flag("--to", String(from + windowSeconds)));
  if (to === null || to <= from) usage("--to must be after --from.");

  process.stdout.write(buildSlice({
    from, to, duration: segs.duration, segments: segs.segments,
    gaps: segs.non_speech || nonSpeechGaps(segs.segments, segs.duration),
    frames: (readJson(join(dir, "frames.json")) || {}).frames || [],
    captions: (readJson(join(dir, "captions.json")) || {}).cues || [],
  }));
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

    // The verbatim transcript is complete at this point; the descriptive extras
    // are additive, so a failure in them never costs the run its transcript.
    const descriptive = has("--descriptive")
      ? enrichDescriptive({ py, mediaPath, outDir, result, warnings })
      : null;

    writeFileSync(join(outDir, "_meta.md"),
      buildMetaMd({ source, localPath: mediaPath, bytes, result, warnings, descriptive,
        keptSource: !isUrl || keepSource }), "utf8");

    console.log(JSON.stringify({
      ok: true, slug, outDir, duration: fmtTime(result.duration, true),
      language: result.language, model: result.model,
      segments: result.segments.length,
      words: result.segments.reduce((n, s) => n + wordCount(s.text), 0),
      descriptive,
      warnings,
      files: [indexPath, jsonPath, join(outDir, "_meta.md"), ...(descriptive?.files || [])],
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
  else if (cmd === "probe") doProbe();
  else if (cmd === "slice") doSlice();
  else if (cmd === "run") await doRun();
  else usage(cmd ? `Unknown command: ${cmd}` : "Missing command.");
}
