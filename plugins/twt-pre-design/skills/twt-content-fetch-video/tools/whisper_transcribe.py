#!/usr/bin/env python3
"""whisper_transcribe.py — faster-whisper worker behind /twt-content-fetch-video.

Invoked only by transcribe-video.mjs; not a user-facing entry point.

  python whisper_transcribe.py --media <path> --out <json> [--model medium]
                               [--language auto] [--device auto]
                               [--compute-type auto] [--vocabulary "a, b, c"]
                               [--no-word-timestamps]

Writes a single JSON object to --out:
  {language, language_probability, duration, model, device, compute_type,
   device_requested, device_notes, decode, faster_whisper,
   segments: [{start, end, text, avg_logprob, no_speech_prob,
               compression_ratio, words: [{start, end, word, probability}]}, ...]}

The three per-segment scores are the recognizer's own confidence signals and
are what the caller's issue detector reads: avg_logprob falls when the audio
was hard, no_speech_prob rises when there may have been nothing to transcribe,
and compression_ratio rises when the decoder fell into a repetition loop.

Progress goes to stderr so the caller can stream it. Exit 0 on success,
3 when faster-whisper is not importable, 1 on any other failure.
"""
import argparse
import json
import sys
import time


# Preference order per device. Every entry is checked against what this
# CTranslate2 build actually supports before it is used, because an unsupported
# type does not degrade — it raises inside the model constructor, after the
# weights have been read.
COMPUTE_PREFERENCE = {
    "cuda": ["float16", "int8_float16", "bfloat16", "float32"],
    "cpu": ["int8", "int8_float32", "float32"],
}


def cuda_devices():
    """How many CUDA devices this CTranslate2 build can see.

    Both halves matter: a build compiled without CUDA raises on the call, and a
    build compiled with it still returns 0 on a machine with no card or no
    driver. Either way the answer is 'use the CPU', and neither is an error."""
    try:
        import ctranslate2
        return int(ctranslate2.get_cuda_device_count())
    except Exception:  # noqa: BLE001 — no CUDA is a normal answer, not a failure
        return 0


def supported_compute_types(device):
    try:
        import ctranslate2
        return set(ctranslate2.get_supported_compute_types(device))
    except Exception:  # noqa: BLE001 — fall back to the safe universal type
        return set()


def resolve_placement(device, compute_type):
    """Turn --device/--compute-type into a placement this build can honour.

    Returns (device, compute_type, notes). `auto` picks the GPU when there is
    one, because it is worth roughly an order of magnitude of wall time and the
    whole cost model of this skill descends from that one choice. An explicit
    device is honoured as asked — if someone says cuda on a machine with no
    card, they get the error rather than a silent CPU run that takes forty
    times as long and never says why."""
    notes = []
    requested = device
    if device == "auto":
        count = cuda_devices()
        missing = cuda_support_libraries() if count else []
        if count and missing:
            # Visible card, unusable card. Choosing it here would load the weights
            # onto the GPU and then die partway into the decode, which costs the
            # model load twice and reads as a transcription failure rather than a
            # missing library.
            device = "cpu"
            notes.append(
                f"device auto-selected: cpu — {count} CUDA device(s) are visible but "
                f"{' and '.join(missing)} could not be loaded, so CTranslate2 cannot use them. "
                "Install the CUDA runtime libraries to make the GPU available.")
        else:
            device = "cuda" if count else "cpu"
            notes.append(
                f"device auto-selected: {device}"
                + (f" ({count} CUDA device(s) visible)" if count
                   else " (no CUDA device visible to CTranslate2)"))
    if compute_type == "auto":
        supported = supported_compute_types(device)
        for candidate in COMPUTE_PREFERENCE.get(device, ["int8"]):
            if not supported or candidate in supported:
                compute_type = candidate
                break
        else:
            compute_type = "int8"
        notes.append(f"compute type auto-selected: {compute_type}")
    else:
        supported = supported_compute_types(device)
        if supported and compute_type not in supported:
            notes.append(
                f"compute type '{compute_type}' is not supported on {device} by this "
                f"CTranslate2 build (it has {', '.join(sorted(supported))})")
    return device, compute_type, notes, requested


def cuda_support_libraries():
    """Which CUDA runtime libraries CTranslate2 needs but cannot load.

    `get_cuda_device_count()` returning 1 does NOT mean a CUDA placement will
    work: it reports the driver's view of the hardware, and says nothing about
    whether cuBLAS and cuDNN are on the search path. On Windows they routinely
    are not — the pip wheels do not carry them — so the card is visible, the
    model constructs happily, and the run dies on the first matmul with
    'Library cublas64_12.dll is not found'. Naming that gap before a 40-minute
    transcription starts is worth the two ctypes calls it costs."""
    import ctypes
    import platform
    win = platform.system() == "Windows"
    # Majors rather than exact versions: CTranslate2 4.x wants cuBLAS 12 and
    # cuDNN 9, but a machine carrying a newer pair works fine and must not be
    # reported as broken.
    wanted = [("cuBLAS", ["cublas64_13.dll", "cublas64_12.dll", "cublas64_11.dll"] if win
               else ["libcublas.so.13", "libcublas.so.12", "libcublas.so.11"]),
              ("cuDNN", ["cudnn64_9.dll", "cudnn64_8.dll"] if win
               else ["libcudnn.so.9", "libcudnn.so.8"])]
    missing = []
    for label, names in wanted:
        if not any(_loadable(ctypes, name) for name in names):
            missing.append(label)
    return missing


def _loadable(ctypes, name):
    try:
        ctypes.CDLL(name)
        return True
    except OSError:
        return False


def load_model(model_name, device, compute_type, notes):
    """Construct the model, falling back to the CPU if the GPU will not have it."""
    from faster_whisper import WhisperModel
    try:
        return WhisperModel(model_name, device=device, compute_type=compute_type), device, compute_type
    except Exception as exc:  # noqa: BLE001 — the fallback is the point
        if device != "cuda":
            raise
        return _fall_back(WhisperModel, model_name, notes, exc, "placement")


def _fall_back(WhisperModel, model_name, notes, exc, phase):
    """Rebuild the model on the CPU after a CUDA failure, and say so.

    Two phases can fail and only one of them is the constructor. CTranslate2
    resolves cuBLAS lazily, on the first matmul, so a machine with a visible
    card and no CUDA libraries loads the weights onto the GPU without complaint
    and then dies partway into the decode. Catching only construction meant the
    fallback did not fire in the single most common way a CUDA run fails on
    Windows. The note is what stops the fallback being silent — a run that
    quietly took an order of magnitude longer is the one nobody can explain
    afterwards."""
    notes.append(
        f"CUDA {phase} failed ({type(exc).__name__}: {exc}) — fell back to the CPU. "
        "The transcript is unaffected; the run is roughly an order of magnitude slower. "
        + ("Install the CUDA runtime libraries (cuBLAS + cuDNN) to use the GPU."
           if "cublas" in str(exc).lower() or "cudnn" in str(exc).lower() else ""))
    print(f"CUDA {phase} failed: {exc}\nfalling back to cpu/int8 …", file=sys.stderr)
    return WhisperModel(model_name, device="cpu", compute_type="int8"), "cpu", "int8"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--media", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="medium")
    ap.add_argument("--language", default="auto")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--compute-type", dest="compute_type", default="auto")
    ap.add_argument("--beam-size", dest="beam_size", type=int, default=5)
    # Domain vocabulary. The whole model-size argument this skill makes to the
    # user is that the small models fail on the words a recording is *about*
    # ("bereavement" as "grievement", "grief-sensitive" as "grease-sensitive").
    # Naming those words up front is the cheapest available defence, and it
    # helps every size including the default.
    ap.add_argument("--vocabulary", default=None)
    ap.add_argument("--no-word-timestamps", dest="word_timestamps",
                    action="store_false", default=True)
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel  # noqa: F401 — probed before the real import
    except ImportError as exc:
        print(f"faster-whisper is not installed: {exc}", file=sys.stderr)
        sys.exit(3)

    device, compute_type, notes, requested = resolve_placement(args.device, args.compute_type)
    for note in notes:
        print(note, file=sys.stderr)

    print(f"loading model '{args.model}' ({device}/{compute_type}) …", file=sys.stderr)
    print("first use of a model size downloads its weights from HuggingFace", file=sys.stderr)
    t0 = time.time()
    model, device, compute_type = load_model(args.model, device, compute_type, notes)
    print(f"model ready in {time.time() - t0:.1f}s; transcribing …", file=sys.stderr)

    language = None if args.language in ("auto", "", None) else args.language
    # Decoding is pinned rather than left to the defaults, so two runs of the same
    # file are comparable. temperature=0 removes the temperature-fallback ladder,
    # whose retries are the loudest source of run-to-run drift; turning off
    # condition_on_previous_text stops one diverging segment from re-steering
    # every segment after it, which is how the same recording came back as 24
    # segments one run and 31 the next. Exact bit-for-bit reproduction is still
    # not promised — CTranslate2's CPU kernels vary with thread count — so the
    # settings travel with the output instead of being assumed.
    #
    # word_timestamps is on because three separate things downstream are paying
    # for its absence: the timeline anchors beats against 5-second segment starts
    # and marks what it cannot place, the generated caption cues interpolate
    # inside a segment rather than landing on a word, and turn detection reads
    # pauses off segment boundaries — which the caller already warns is blind on
    # any file whose segments butt up against each other. One flag settles all
    # three. It costs roughly 15-25% of the decode.
    decode = {
        "beam_size": args.beam_size,
        "temperature": 0.0,
        "condition_on_previous_text": False,
        "word_timestamps": args.word_timestamps,
        "vad_filter": True,
        "vad_parameters": {"min_silence_duration_ms": 500},
    }
    vocabulary = (args.vocabulary or "").strip()
    if vocabulary:
        # `hotwords`, not `initial_prompt`, and the difference is the whole point.
        # faster-whisper seeds initial_prompt into the *previous tokens*, and with
        # condition_on_previous_text off those are reset after every window — so an
        # initial prompt biases the first thirty seconds and nothing after it. The
        # hotwords path re-attaches on every window that has no previous tokens,
        # which with this decode is all of them. Older builds without the parameter
        # fall back to the prompt, and say so.
        if _accepts_hotwords():
            decode["hotwords"] = vocabulary
        else:
            decode["initial_prompt"] = vocabulary
            notes.append("This faster-whisper build has no `hotwords` parameter, so the "
                         "vocabulary was passed as `initial_prompt` — it biases the opening "
                         "of the recording only, not the whole of it.")
            print(notes[-1], file=sys.stderr)

    t1 = time.time()
    try:
        out_segments, duration, info = decode_all(model, args.media, language, decode)
    except Exception as exc:  # noqa: BLE001 — see _fall_back: this is where CUDA usually dies
        if device != "cuda":
            raise
        from faster_whisper import WhisperModel as _WM
        model, device, compute_type = _fall_back(_WM, args.model, notes, exc, "decode")
        t1 = time.time()
        out_segments, duration, info = decode_all(model, args.media, language, decode)

    payload = {
        "language": getattr(info, "language", None),
        "language_probability": round(float(getattr(info, "language_probability", 0.0) or 0.0), 3),
        "duration": round(duration, 3),
        "model": args.model,
        "device": device,
        "device_requested": requested,
        "device_notes": notes,
        "compute_type": compute_type,
        "transcribe_seconds": round(time.time() - t1, 1),
        "decode": decode,
        "vocabulary": vocabulary or None,
        "faster_whisper": _engine_version(),
        "segments": out_segments,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    words_total = sum(len(s.get("words") or []) for s in out_segments)
    print(f"done: {len(out_segments)} segments"
          + (f", {words_total} word timings" if words_total else "")
          + f" in {payload['transcribe_seconds']}s", file=sys.stderr)


def decode_all(model, media, language, decode):
    """Run the decode to completion and return (segments, duration).

    Fully consumed here rather than streamed to the caller because the generator
    is where a CUDA run actually fails, and the retry has to be able to start
    over on the CPU with nothing half-written. `info` travels back with the rows
    for the same reason: on a retry it is the second decode's, not the first's."""
    segments, info = model.transcribe(media, language=language, **decode)
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    rows = []
    t0 = time.time()
    last_report = 0.0
    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        row = {"start": round(float(seg.start), 3),
               "end": round(float(seg.end), 3),
               "text": text,
               "avg_logprob": score(seg, "avg_logprob"),
               "no_speech_prob": score(seg, "no_speech_prob"),
               "compression_ratio": score(seg, "compression_ratio")}
        words = word_rows(seg)
        if words:
            row["words"] = words
        rows.append(row)
        if seg.end - last_report >= 30.0:
            last_report = seg.end
            elapsed = time.time() - t0
            pct = f" ({seg.end / duration * 100:.0f}%)" if duration else ""
            print(f"  … {fmt(seg.end)} of {fmt(duration)}{pct} — {elapsed:.0f}s elapsed",
                  file=sys.stderr)
    return rows, duration, info


def _accepts_hotwords():
    try:
        import inspect
        from faster_whisper import WhisperModel
        return "hotwords" in inspect.signature(WhisperModel.transcribe).parameters
    except Exception:  # noqa: BLE001 — assume not, and say so
        return False


def _engine_version():
    """The faster-whisper build that produced this file.

    Recorded because the payload's shape depends on it: a build that does not
    expose the per-segment confidence scores yields a transcript nothing can
    check mechanically, and without the version stamped here that is invisible
    after the fact."""
    try:
        import faster_whisper
        return getattr(faster_whisper, "__version__", None)
    except Exception:  # noqa: BLE001 — a missing version never fails a run
        return None


def word_rows(seg):
    """Per-word timings, or [] if this build or this decode did not produce them.

    Rounded to the millisecond the model actually resolves: the extra float
    digits are noise, and they triple the size of a file the caller reads on
    every slice."""
    out = []
    for w in getattr(seg, "words", None) or []:
        try:
            out.append({"start": round(float(w.start), 3),
                        "end": round(float(w.end), 3),
                        "word": w.word,
                        "probability": round(float(getattr(w, "probability", 0.0) or 0.0), 3)})
        except (TypeError, ValueError):
            continue
    return out


def score(seg, name):
    """One of the recognizer's confidence scores, or None if this build omits it.

    Returned as None rather than 0 on purpose: a missing score must not read as
    a confident one downstream, and the issue detector skips None."""
    value = getattr(seg, name, None)
    if value is None:
        return None
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


def fmt(seconds):
    seconds = int(seconds or 0)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001 — the caller only sees stderr + exit code
        print(f"transcription failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
