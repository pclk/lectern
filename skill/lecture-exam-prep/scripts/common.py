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


def video_size(path):
    w, h = subprocess.check_output([ffprobe(), "-v", "error", "-select_streams", "v:0", "-show_entries",
                                    "stream=width,height", "-of", "csv=p=0", path]).decode().strip().split(",")[:2]
    return int(w), int(h)


def modules(manifest):
    seen = []
    for it in manifest:
        if it["module"] not in seen: seen.append(it["module"])
    return seen
