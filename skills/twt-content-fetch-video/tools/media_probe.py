#!/usr/bin/env python3
"""media_probe.py — PyAV worker for the descriptive pass of /twt-content-fetch-video.

Invoked only by transcribe-video.mjs; not a user-facing entry point. PyAV ships
as a faster-whisper dependency, so everything here works with no extra install
and no system ffmpeg.

  python media_probe.py probe   --media <path> --out <json>
  python media_probe.py frames  --media <path> --out-dir <dir> --out <json>
                                [--max 60] [--min-gap 4] [--width 960]
  python media_probe.py subs    --media <path> --out <json> [--stream <i>]
  python media_probe.py audio   --media <path> --stream <i> --out <wav>

Exit 0 on success, 3 when PyAV is not importable, 5 when the requested stream
does not exist, 1 on any other failure. Progress goes to stderr.
"""
import argparse
import json
import math
import os
import re
import sys

# ffmpeg AV_DISPOSITION bits we care about. Read off the int so this works on
# every PyAV that exposes `stream.disposition`, enum or not.
DISPOSITION_BITS = {
    "default": 1, "dub": 2, "original": 4, "comment": 8, "lyrics": 16,
    "karaoke": 32, "forced": 64, "hearing_impaired": 128, "visual_impaired": 256,
    "clean_effects": 512, "attached_pic": 1024, "timed_thumbnails": 2048,
    "captions": 65536, "descriptions": 131072, "metadata": 262144, "dependent": 524288,
}
# Text-based subtitle codecs we can decode into words. Bitmap subs (pgs, dvdsub)
# carry their text as images and are reported but not extracted.
TEXT_SUB_CODECS = {"subrip", "srt", "ass", "ssa", "mov_text", "text", "webvtt",
                   "eia_608", "subviewer"}
# Title strings that mark an audio-description track when the disposition bit is not set.
AD_TITLE_HINTS = ("audio description", "described", "descriptive", "narration",
                  " ad ", "(ad)", "[ad]")


def load_av():
    try:
        import av
    except ImportError as exc:
        print("PyAV is not installed: " + str(exc), file=sys.stderr)
        sys.exit(3)
    return av


def flags_of(stream):
    try:
        raw = int(stream.disposition)
    except Exception:
        return []
    return sorted(name for name, bit in DISPOSITION_BITS.items() if raw & bit)


def meta(stream, key):
    try:
        return stream.metadata.get(key)
    except Exception:
        return None


def duration_of(container, stream=None):
    if stream is not None:
        value, base = getattr(stream, "duration", None), getattr(stream, "time_base", None)
        if value and base:
            return float(value * base)
    if container.duration:
        return float(container.duration) / 1000000.0
    return 0.0


def describe(container):
    """Every stream in the file, plus the picks the caller actually needs."""
    streams = []
    for s in container.streams:
        codec = getattr(getattr(s, "codec_context", None), "name", None)
        entry = {
            "index": s.index,
            "type": s.type,
            "codec": codec,
            "language": getattr(s, "language", None) or meta(s, "language"),
            "title": meta(s, "title") or meta(s, "handler_name"),
            "dispositions": flags_of(s),
            "duration": round(duration_of(container, s), 3) or None,
        }
        if s.type == "video":
            entry.update({
                "width": getattr(s, "width", None),
                "height": getattr(s, "height", None),
                "fps": round(float(s.average_rate), 3) if getattr(s, "average_rate", None) else None,
                "frames": getattr(s, "frames", None) or None,
            })
        elif s.type == "audio":
            cc = s.codec_context
            entry.update({
                "channels": getattr(cc, "channels", None),
                "sample_rate": getattr(cc, "sample_rate", None),
            })
        elif s.type == "subtitle":
            entry["text_based"] = (codec or "").lower() in TEXT_SUB_CODECS
        streams.append(entry)

    video = [s for s in streams if s["type"] == "video" and "attached_pic" not in s["dispositions"]]
    audio = [s for s in streams if s["type"] == "audio"]
    subs = [s for s in streams if s["type"] == "subtitle"]

    def is_ad(s):
        if "visual_impaired" in s["dispositions"] or "descriptions" in s["dispositions"]:
            return True
        title = " " + (s["title"] or "").lower() + " "
        return any(hint in title for hint in AD_TITLE_HINTS)

    ad = [s for s in audio if is_ad(s)]
    text_subs = [s for s in subs if s.get("text_based")]
    return {
        "duration": round(duration_of(container), 3),
        "streams": streams,
        "has_video": bool(video),
        "video_index": video[0]["index"] if video else None,
        "audio_tracks": len(audio),
        # Only a *secondary* track can be the description track: with one audio
        # stream there is nothing to describe against, whatever it is labelled.
        "audio_description_index": ad[0]["index"] if (ad and len(audio) > 1) else None,
        "subtitle_index": text_subs[0]["index"] if text_subs else None,
        "bitmap_subtitles": [s["index"] for s in subs if not s.get("text_based")],
    }


def cmd_probe(args):
    av = load_av()
    with av.open(args.media) as container:
        payload = describe(container)
    write_json(args.out, payload)
    print("streams: " + json.dumps([s["type"] for s in payload["streams"]]), file=sys.stderr)


# ---- frames -------------------------------------------------------------------

def thumb(frame, size=32):
    """A tiny grayscale array — enough to score visual change, cheap to hold."""
    return frame.reformat(width=size, height=size, format="gray").to_ndarray().astype("int16")


def diff_score(a, b):
    if a is None or b is None:
        return 1.0
    return float(abs(a - b).mean()) / 255.0


def save_frame(av, frame, path, width):
    """JPEG via Pillow when present, else through PyAV's own mjpeg encoder."""
    w = min(width, frame.width) or frame.width
    h = max(2, int(round(frame.height * (w / float(frame.width)))))
    w, h = w - (w % 2), h - (h % 2)
    try:
        from PIL import Image  # noqa: F401  (imported only to prove it is available)
        frame.reformat(width=w, height=h, format="rgb24").to_image().save(path, quality=82)
        return
    except ImportError:
        pass
    out = frame.reformat(width=w, height=h, format="yuvj420p")
    with av.open(path, "w", format="mjpeg") as oc:
        stream = oc.add_stream("mjpeg", rate=1)
        stream.width, stream.height, stream.pix_fmt = w, h, "yuvj420p"
        for packet in stream.encode(out):
            oc.mux(packet)
        for packet in stream.encode():
            oc.mux(packet)


def keyframe_candidates(av, media, video_index):
    """Decode I-frames only — fast, and they cluster on real visual changes."""
    out = []
    with av.open(media) as container:
        stream = container.streams[video_index]
        stream.codec_context.skip_frame = "NONKEY"
        stream.thread_type = "AUTO"
        for frame in container.decode(stream):
            if frame.pts is None:
                continue
            out.append((float(frame.pts * stream.time_base), thumb(frame)))
    return out


def seek_candidates(av, media, video_index, times):
    """Fill coverage holes: decode one frame at each requested second."""
    out = []
    with av.open(media) as container:
        stream = container.streams[video_index]
        stream.thread_type = "AUTO"
        for want in times:
            try:
                container.seek(int(want / stream.time_base), stream=stream)
                for frame in container.decode(stream):
                    if frame.pts is None:
                        continue
                    out.append((float(frame.pts * stream.time_base), thumb(frame)))
                    break
            except Exception:
                continue
    return out


def pick_frames(candidates, duration, max_frames, min_gap, threshold):
    """Greedy in time order: keep a frame that is far enough from the last kept
    one in both time and appearance. Then top up for coverage and cap by score."""
    candidates = sorted(candidates, key=lambda c: c[0])
    kept, last = [], None
    for ts, small in candidates:
        if not kept:
            kept.append({"t": ts, "score": 1.0})
            last = (ts, small)
            continue
        score = diff_score(small, last[1])
        if ts - last[0] < min_gap or score < threshold:
            continue
        kept.append({"t": ts, "score": round(score, 4)})
        last = (ts, small)

    # A static talking head yields almost no scene changes; sample it anyway so
    # the descriptive pass still gets a look at the whole recording.
    target = max(4, min(max_frames, int(math.ceil((duration or 0) / max(min_gap * 4, 30))) + 1))
    if len(kept) < target:
        have = [k["t"] for k in kept]
        for ts, _small in candidates:
            if len(kept) >= target:
                break
            if all(abs(ts - t) >= min_gap * 2 for t in have):
                kept.append({"t": ts, "score": 0.0})
                have.append(ts)
        kept.sort(key=lambda k: k["t"])

    if len(kept) > max_frames:
        # Drop the least visually distinct, never the opening frame.
        ranked = sorted(kept[1:], key=lambda k: k["score"], reverse=True)[: max_frames - 1]
        kept = [kept[0]] + sorted(ranked, key=lambda k: k["t"])
    return kept


def stamp(seconds):
    t = int(seconds or 0)
    if t >= 3600:
        return "%dh%02dm%02ds" % (t // 3600, (t % 3600) // 60, t % 60)
    return "%02dm%02ds" % ((t % 3600) // 60, t % 60)


def cmd_frames(args):
    av = load_av()
    with av.open(args.media) as container:
        info = describe(container)
    if not info["has_video"]:
        write_json(args.out, {"frames": [], "reason": "no video stream — audio-only source"})
        print("no video stream; skipping frame extraction", file=sys.stderr)
        return

    duration = info["duration"]
    vi = info["video_index"]
    print("scanning keyframes of stream %d (%.0fs) ..." % (vi, duration), file=sys.stderr)
    candidates = keyframe_candidates(av, args.media, vi)
    print("  %d keyframes" % len(candidates), file=sys.stderr)

    # Long gaps between keyframes (or barely any at all) get a seek pass.
    step = max(args.min_gap * 4, 30)
    if duration:
        have = sorted(t for t, _ in candidates)
        wanted = [t for t in (i * step for i in range(int(duration // step) + 1))
                  if all(abs(t - h) >= step / 2 for h in have)]
        if wanted:
            print("  filling %d coverage gap(s) by seeking" % len(wanted), file=sys.stderr)
            candidates += seek_candidates(av, args.media, vi, wanted[: args.max * 2])

    kept = pick_frames(candidates, duration, args.max, args.min_gap, args.threshold)
    os.makedirs(args.out_dir, exist_ok=True)

    written = []
    with av.open(args.media) as container:
        stream = container.streams[vi]
        stream.thread_type = "AUTO"
        for n, item in enumerate(kept, start=1):
            name = "%03d-%s.jpg" % (n, stamp(item["t"]))
            path = os.path.join(args.out_dir, name)
            try:
                container.seek(int(item["t"] / stream.time_base), stream=stream)
                frame = next(f for f in container.decode(stream) if f.pts is not None)
                save_frame(av, frame, path, args.width)
            except Exception as exc:  # noqa: BLE001 — one bad frame must not lose the rest
                print("  frame at %.1fs failed: %s" % (item["t"], exc), file=sys.stderr)
                continue
            written.append({"n": n, "t": round(item["t"], 3), "file": name,
                            "change": item["score"]})
    write_json(args.out, {"frames": written, "candidates": len(candidates),
                          "duration": duration, "video_index": vi})
    print("wrote %d frames to %s" % (len(written), args.out_dir), file=sys.stderr)


# ---- subtitles ----------------------------------------------------------------

def clean_sub(raw):
    raw = re.sub(r"\{\\[^}]*\}", "", raw)          # ASS override blocks
    raw = re.sub(r"<[^>]+>", "", raw)              # SRT/VTT html tags
    raw = raw.replace("\\N", " ").replace("\\n", " ")
    return re.sub(r"\s+", " ", raw).strip()        # cues wrap for display, not for reading


def sub_text(sub):
    # `dialogue` is the payload without ASS's leading layer/style fields; `text`
    # carries plain formats. `ass` is the raw line, kept as a last resort.
    for attr in ("dialogue", "text", "ass"):
        raw = getattr(sub, attr, None)
        if raw:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", "replace")
            if attr == "ass" and raw.count(",") >= 8:
                # ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
                raw = raw.split(",", 8)[-1]
            return clean_sub(raw)
    return ""


def flatten_subs(decoded):
    """PyAV has returned both a flat list of Subtitles and a list of iterable
    SubtitleSets across versions — walk whatever shape came back."""
    queue = [decoded]
    while queue:
        item = queue.pop(0)
        if item is None:
            continue
        if hasattr(item, "dialogue") or hasattr(item, "ass") or hasattr(item, "text"):
            yield item
            continue
        try:
            queue = list(item) + queue
        except TypeError:
            continue


def cmd_subs(args):
    av = load_av()
    with av.open(args.media) as container:
        info = describe(container)
        index = args.stream if args.stream is not None else info["subtitle_index"]
        if index is None:
            write_json(args.out, {"cues": [], "reason": "no text-based subtitle stream",
                                  "bitmap_subtitles": info["bitmap_subtitles"]})
            print("no text-based subtitle stream", file=sys.stderr)
            return
        stream = container.streams[index]
        cues = []
        for packet in container.demux(stream):
            if packet.pts is None:
                continue
            start = float(packet.pts * stream.time_base)
            end = None
            if packet.duration:
                end = round(start + float(packet.duration * stream.time_base), 3)
            try:
                decoded = packet.decode()
            except Exception:
                continue
            for sub in flatten_subs(decoded):
                text = sub_text(sub)
                if text:
                    cues.append({"start": round(start, 3), "end": end, "text": text})
    write_json(args.out, {"cues": cues, "stream": index})
    print("%d subtitle cues from stream %d" % (len(cues), index), file=sys.stderr)


# ---- audio track extraction ---------------------------------------------------

def cmd_audio(args):
    av = load_av()
    with av.open(args.media) as container:
        try:
            stream = container.streams[args.stream]
        except (IndexError, KeyError):
            print("no stream at index %d" % args.stream, file=sys.stderr)
            sys.exit(5)
        if stream.type != "audio":
            print("stream %d is %s, not audio" % (args.stream, stream.type), file=sys.stderr)
            sys.exit(5)
        stream.thread_type = "AUTO"
        with av.open(args.out, "w") as out:
            # 16 kHz mono is what whisper resamples to anyway.
            ostream = out.add_stream("pcm_s16le", rate=16000)
            ostream.layout = "mono"
            resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
            for frame in container.decode(stream):
                for chunk in resampler.resample(frame):
                    chunk.pts = None
                    for packet in ostream.encode(chunk):
                        out.mux(packet)
            for packet in ostream.encode():
                out.mux(packet)
    print("extracted audio stream %d to %s" % (args.stream, args.out), file=sys.stderr)


# ---- plumbing ------------------------------------------------------------------

def write_json(path, payload):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("probe")
    p.add_argument("--media", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_probe)

    p = sub.add_parser("frames")
    p.add_argument("--media", required=True)
    p.add_argument("--out-dir", dest="out_dir", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--max", type=int, default=60)
    p.add_argument("--min-gap", dest="min_gap", type=float, default=4.0)
    p.add_argument("--width", type=int, default=960)
    p.add_argument("--threshold", type=float, default=0.06)
    p.set_defaults(fn=cmd_frames)

    p = sub.add_parser("subs")
    p.add_argument("--media", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--stream", type=int, default=None)
    p.set_defaults(fn=cmd_subs)

    p = sub.add_parser("audio")
    p.add_argument("--media", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--stream", type=int, required=True)
    p.set_defaults(fn=cmd_audio)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — the caller only sees stderr + exit code
        print("%s: %s" % (type(exc).__name__, exc), file=sys.stderr)
        sys.exit(1)
