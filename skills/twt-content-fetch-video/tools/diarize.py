#!/usr/bin/env python3
"""diarize.py — optional speaker diarization behind /twt-content-fetch-video.

Invoked only by transcribe-video.mjs; not a user-facing entry point.

  python diarize.py check [--models <dir>]
      Report whether sherpa-onnx is importable and whether the two model files
      are already on disk. Always exits 0; the caller reads the JSON.

  python diarize.py fetch-models [--models <dir>]
      Download and unpack the segmentation and embedding models. ~90 MB, once.

  python diarize.py run --media <16k-mono-wav> --out <json> [--models <dir>]
                        [--speakers <n>] [--cluster-threshold 0.5]
      Write {ok, speakers, turns: [{start, end, speaker}], ...} to --out.

WHY THIS EXISTS. Everything else in this skill attributes speech by reading
name cards off downscaled keyframes, which is why the transcript rules need
three paragraphs about `[?]` and why `verify` carries a heuristic for names
with a capital letter in the middle of them. That approach is good at *naming*
a speaker and bad at *separating* them: pause-derived turns miss any handover
with no pause, which on an interview film is most of them. This pass separates
them acoustically, so the frame reading only has to answer the question it is
actually good at — which of these clusters is Maria Collins.

It is opt-in and degrades to nothing. No model here ever names anybody: the
output is `speaker_0`, `speaker_1`, and where they talk.

Exit 0 on success, 3 when sherpa-onnx or the models are missing, 1 otherwise.
"""
import argparse
import json
import os
import sys
import tarfile
import urllib.request
import wave
from pathlib import Path

RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download"

# Two models, two jobs. The segmentation model says *when* somebody is speaking
# and where the turns are (including overlapped speech); the embedding model
# turns each turn into a vector so turns by the same voice can be clustered.
# Both are pinned by URL rather than resolved at run time — a diarization that
# silently changes model between two runs of the same recording produces two
# different speaker counts and no way to tell which was which.
SEGMENTATION = {
    "name": "sherpa-onnx-pyannote-segmentation-3-0",
    "url": f"{RELEASES}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    "member": "sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
    "file": "segmentation.onnx",
    "size": "~6 MB",
}
EMBEDDING = {
    "name": "nemo_en_titanet_small",
    "url": f"{RELEASES}/speaker-recongition-models/nemo_en_titanet_small.onnx",
    "file": "embedding.onnx",
    "size": "~38 MB",
}


def model_dir(explicit=None):
    if explicit:
        return Path(explicit)
    env = os.environ.get("TWT_VIDEO_MODEL_DIR")
    if env:
        return Path(env)
    home = os.environ.get("USERPROFILE") or os.environ.get("HOME") or "."
    return Path(home) / ".cache" / "twt-video-models"


def have_sherpa():
    try:
        import sherpa_onnx  # noqa: F401
        import sherpa_onnx as s
        return getattr(s, "__version__", "unknown")
    except Exception:  # noqa: BLE001 — not installed is a normal answer
        return None


def have_numpy():
    """sherpa-onnx takes audio as a numpy array, and does not depend on numpy
    itself. In this skill's normal environment faster-whisper has already pulled
    it in through ctranslate2, so it is all but guaranteed — but 'all but' is how
    a readiness check reports ready and then dies on the first import, half an
    hour into a run."""
    try:
        import numpy  # noqa: F401
        return True
    except ImportError:
        return False


def state(models):
    seg = models / SEGMENTATION["file"]
    emb = models / EMBEDDING["file"]
    version = have_sherpa()
    numpy_ok = have_numpy()
    return {
        "sherpa_onnx": version,
        "numpy": numpy_ok,
        "models_dir": str(models),
        "segmentation": seg.exists(),
        "embedding": emb.exists(),
        "ready": bool(version) and numpy_ok and seg.exists() and emb.exists(),
        "download_mb": 44,
        "install": f"{sys.executable} -m pip install sherpa-onnx"
                   + ("" if numpy_ok else " numpy"),
    }


def cmd_check(args):
    print(json.dumps(state(model_dir(args.models)), indent=2))


def _download(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"downloading {url} …", file=sys.stderr)
    with urllib.request.urlopen(url) as res, open(tmp, "wb") as fh:  # noqa: S310 — pinned https
        while True:
            chunk = res.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
    # Renamed only once it is whole, so an interrupted download can never leave a
    # truncated .onnx that loads and then produces nonsense.
    tmp.replace(dest)
    return dest


def cmd_fetch(args):
    models = model_dir(args.models)
    models.mkdir(parents=True, exist_ok=True)
    emb = models / EMBEDDING["file"]
    if not emb.exists():
        _download(EMBEDDING["url"], emb)
    seg = models / SEGMENTATION["file"]
    if not seg.exists():
        archive = models / "segmentation.tar.bz2"
        _download(SEGMENTATION["url"], archive)
        with tarfile.open(archive, "r:bz2") as tf:
            member = tf.getmember(SEGMENTATION["member"])
            src = tf.extractfile(member)
            with open(seg, "wb") as fh:
                fh.write(src.read())
        archive.unlink(missing_ok=True)
    print(json.dumps(state(models), indent=2))


def read_wav(path):
    """The 16 kHz mono PCM the audio extractor already wrote, as float32.

    Read with the standard library rather than soundfile/librosa: this worker
    only ever sees the WAV `media_probe.py audio` produced, whose format is
    fixed, and a third pip dependency to re-read a known format is not worth
    the install prompt."""
    import numpy as np
    with wave.open(str(path), "rb") as wf:
        if wf.getsampwidth() != 2 or wf.getnchannels() != 1:
            raise ValueError(
                f"expected 16-bit mono PCM, got {wf.getsampwidth() * 8}-bit "
                f"{wf.getnchannels()}-channel")
        rate = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return samples, rate


def cmd_run(args):
    models = model_dir(args.models)
    st = state(models)
    if not st["ready"]:
        print(json.dumps({"ok": False, "reason": "not-installed", **st}), file=sys.stderr)
        sys.exit(3)
    import sherpa_onnx

    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(models / SEGMENTATION["file"])),
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(models / EMBEDDING["file"])),
        # Either the caller knows how many voices there are — from the name cards,
        # or because the user said — or it does not, and the threshold decides.
        # Passing a known count is much the stronger signal: clustering a
        # two-hander into three speakers is the common failure, and a count
        # removes it outright.
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=args.speakers if args.speakers and args.speakers > 0 else -1,
            threshold=args.cluster_threshold),
        min_duration_on=args.min_on,
        min_duration_off=args.min_off,
    )
    if not config.validate():
        print("the diarization config was rejected by sherpa-onnx", file=sys.stderr)
        sys.exit(1)

    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    samples, rate = read_wav(args.media)
    if rate != sd.sample_rate:
        raise ValueError(f"expected {sd.sample_rate} Hz audio, got {rate} Hz")

    print(f"diarizing {len(samples) / rate:.0f}s of audio …", file=sys.stderr)
    result = sd.process(samples).sort_by_start_time()
    turns = [{"start": round(float(s.start), 3),
              "end": round(float(s.end), 3),
              "speaker": f"speaker_{s.speaker}"} for s in result]
    speakers = sorted({t["speaker"] for t in turns})
    payload = {
        "ok": True,
        "speakers": len(speakers),
        "labels": speakers,
        "turns": turns,
        "engine": f"sherpa-onnx {st['sherpa_onnx']}",
        "segmentation_model": SEGMENTATION["name"],
        "embedding_model": EMBEDDING["name"],
        "num_clusters": args.speakers if args.speakers and args.speakers > 0 else None,
        "cluster_threshold": args.cluster_threshold,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    print(f"done: {len(turns)} turns across {len(speakers)} speaker(s)", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("check")
    c.add_argument("--models", default=None)
    c.set_defaults(fn=cmd_check)

    f = sub.add_parser("fetch-models")
    f.add_argument("--models", default=None)
    f.set_defaults(fn=cmd_fetch)

    r = sub.add_parser("run")
    r.add_argument("--media", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--models", default=None)
    r.add_argument("--speakers", type=int, default=0)
    r.add_argument("--cluster-threshold", dest="cluster_threshold", type=float, default=0.5)
    r.add_argument("--min-on", dest="min_on", type=float, default=0.3)
    r.add_argument("--min-off", dest="min_off", type=float, default=0.5)
    r.set_defaults(fn=cmd_run)

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
        print(f"diarization failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
