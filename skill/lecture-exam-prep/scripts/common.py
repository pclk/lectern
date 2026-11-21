"""Shared helpers: config loading (./config.json in the work dir, merged over defaults) and tool paths."""
import json, os, shutil, subprocess

DEFAULTS = {
    "asr_model": "mlx-community/parakeet-tdt-0.6b-v2",
    "fps": 30,
    "pad_pre": 0.08, "pad_post": 0.20,     # padding kept around each spoken word (s, source time)
    "max_gap": 0.40,                        # pauses longer than this (source time) are removed in the first pass
    "target_wpm": 250, "min_factor": 1.0, "max_factor": 2.5,
    "factor_override": {},                  # {"<source id>": 1.3} e.g. for distorted audio
    "prefilter": {},                        # {"<source id>": "<ffmpeg audio filter>"} applied before cutting
    "target_min": 60, "max_min": 78,        # packing target / hard cap per output video (minutes)
    "out_dirs": {},                         # {"<module>": "/abs/path/edited_videos"}; default ./out/<module>
    "names": {},                            # {"<module>": ["video 1 title", ...]}; default: built from source titles
    "term_fixes": [],                       # [{"match": "regex over 1-3 words", "replace": "text"}]
    "layout": {"width": 1280, "height": 720, "content_height": 640},
    "subtitle": {"font": "Avenir Next Demi Bold", "size": 25, "margin_v": 27,
                 "spoken": "F2F2F2", "current": "FFD84F", "upcoming_alpha": "70", "max_chars": 64},
    "encode": {"preset": "veryfast", "crf": 22, "tune": "stillimage", "threads": 4, "audio_kbps": 128},
    "silence": {"out_min": 0.75, "cut_to": 0.25, "below_p80_db": 24},
}


def cfg():
    c = json.loads(json.dumps(DEFAULTS))
    if os.path.exists("config.json"):
        user = json.load(open("config.json"))
        for k, v in user.items():
            if isinstance(v, dict) and isinstance(c.get(k), dict) and k not in ("factor_override", "prefilter", "out_dirs", "names"):
                c[k].update(v)
            else:
                c[k] = v
    return c


_FF = None


def ff():
    """ffmpeg binary with libass + rubberband (Homebrew's plain ffmpeg lacks both)."""
    global _FF
    if _FF: return _FF
    for cand in ["/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg", "/usr/local/opt/ffmpeg-full/bin/ffmpeg", shutil.which("ffmpeg")]:
        if cand and os.path.exists(cand):
            f = subprocess.run([cand, "-hide_banner", "-filters"], capture_output=True, text=True).stdout
            if " ass " in f and " rubberband " in f:
                _FF = cand
                return cand
    raise SystemExit("No ffmpeg with libass + rubberband found. Run scripts/setup.sh (installs Homebrew ffmpeg-full).")


def ffprobe():
    p = os.path.join(os.path.dirname(ff()), "ffprobe")
    return p if os.path.exists(p) else "ffprobe"


def duration(path):
    return float(subprocess.check_output([ffprobe(), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))


_MONO = {}


def inverted(path):
    """True when a stereo source's right channel is its left channel with the polarity flipped (R ~ -L), as some
    lecture-capture rooms record. Checked on three 20 s samples (20%, 50%, 80% in)."""
    import numpy as np
    out = subprocess.run([ffprobe(), "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout.strip()
    if out != "2": return False
    d, xy = duration(path), []
    for at in (0.2, 0.5, 0.8):
        raw = subprocess.run([ff(), "-v", "error", "-ss", f"{d * at:.1f}", "-t", "20", "-i", path, "-vn", "-ac", "2", "-ar", "8000",
                              "-f", "f32le", "-"], capture_output=True).stdout
        xy.append(np.frombuffer(raw, np.float32).reshape(-1, 2))
    x = np.concatenate(xy)
    if not len(x): return False
    l, r = x[:, 0].astype(np.float64), x[:, 1].astype(np.float64)
    return (l * r).mean() / (np.sqrt((l * l).mean() * (r * r).mean()) or 1) < -0.5


def mono(path, extra=None):
    """ffmpeg output args for a mono downmix of `path` (plus an optional audio filter). A plain "-ac 1" of a source whose
    channels are polarity-inverted cancels the voice to a thin residue ~27 dB down, so those are mixed as (L - R) / 2."""
    if path not in _MONO: _MONO[path] = inverted(path)
    f = (["pan=mono|c0=0.5*c0-0.5*c1"] if _MONO[path] else []) + ([extra] if extra else [])
    return (["-af", ",".join(f)] if f else []) + ["-ac", "1"]


def video_size(path):
    w, h = subprocess.check_output([ffprobe(), "-v", "error", "-select_streams", "v:0", "-show_entries",
                                    "stream=width,height", "-of", "csv=p=0", path]).decode().strip().split(",")[:2]
    return int(w), int(h)


def modules(manifest):
    seen = []
    for it in manifest:
        if it["module"] not in seen: seen.append(it["module"])
    return seen
