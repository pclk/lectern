"""Quality report for every assembled video -> final/verify.json (+ a printed table).

  verify_all.py [--windows 8] [--win-sec 150] [--only <module>]

Per video: duration, A/V length difference, chapters, re-transcription vs subtitles on N evenly spaced windows
(content match, sync offset median/p90, measured wpm), residual pauses >= silence.out_min (should only be the
ones the review kept or trimmed), integrated loudness (LUFS), black stretches >= 2 s, widest subtitle line (px).
Healthy: match >= 0.90 (lower = poor source audio or too fast), |offset_med| <= 0.08 s, wpm near target_wpm,
LUFS within ~1.5 LU across videos, black_2s = 0, widest_sub_px < layout width - 80.
"""
import argparse, glob, json, os, re, statistics, subprocess, sys
import numpy as np
from PIL import ImageFont
sys.path.insert(0, os.path.dirname(__file__))
from common import cfg, ff, ffprobe
import verify

C = cfg()
FONT_FILES = ["/System/Library/Fonts/Avenir Next.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"]


def font():
    for f in FONT_FILES:
        if os.path.exists(f):
            for i in range(8):
                try:
                    ft = ImageFont.truetype(f, C["subtitle"]["size"], index=i)
                    if " ".join(ft.getname()) == C["subtitle"]["font"] or i == 7: return ft
                except OSError: break
            return ImageFont.truetype(f, C["subtitle"]["size"])
    return ImageFont.load_default()


def residual_pauses(path, words):
    raw = subprocess.run([ff(), "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    n = len(x) // 160
    e = 20 * np.log10(np.sqrt((x[:n * 160].reshape(n, 160) ** 2).mean(1)) + 1e-9)
    low = e < np.percentile(e, 80) - C["silence"]["below_p80_db"]
    for a, b, w in words:
        cap = max(0.15, 0.05 * sum(c.isalnum() for c in w))
        low[max(0, int((a - 0.03) * 100)):int((min(b, a + cap) + 0.03) * 100)] = False
    runs, i, need = [], 0, int(C["silence"]["out_min"] * 100)
    while i < n:
        if low[i]:
            j = i
            while j < n and low[j]: j += 1
            if j - i >= need: runs.append((j - i) / 100)
            i = j
        else: i += 1
    return len(runs), max(runs, default=0)


def loudness(path):
    err = subprocess.run([ff(), "-hide_banner", "-nostats", "-i", path, "-vn", "-af", "ebur128", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", err)
    return float(m[-1]) if m else None


def black(path):
    err = subprocess.run([ff(), "-hide_banner", "-nostats", "-i", path, "-an", "-vf", "fps=2,blackdetect=d=2:pix_th=0.05",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    return len(re.findall(r"black_start", err))


def widest_sub(parts, ft):
    w = 0
    for pid in parts:
        for line in open(f"work/{pid}.ass"):
            if line.startswith("Dialogue:"):
                w = max(w, ft.getlength(re.sub(r"\{[^}]*\}", "", line.split(",", 9)[9].strip())))
    return round(w)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--windows", type=int, default=8); ap.add_argument("--win-sec", type=float, default=150)
    ap.add_argument("--only"); a = ap.parse_args()
    ft, rows = font(), []
    for f in sorted(glob.glob("final/*_[0-9][0-9].json")):
        info = json.load(open(f))
        if a.only and info["module"] != a.only: continue
        pr = json.loads(subprocess.check_output([ffprobe(), "-v", "error", "-show_entries", "stream=codec_type,width,height,duration",
                                                 "-show_chapters", "-of", "json", info["out"]]))
        st = {s["codec_type"]: s for s in pr["streams"]}
        vd, ad = float(st["video"]["duration"]), float(st["audio"]["duration"])
        words = json.load(open(info["words"]))
        res = []
        for k in range(a.windows):
            s0 = (vd - a.win_sec) * (k + 0.5) / a.windows
            res.append(verify.check(info["out"], words, max(0, s0), a.win_sec))
        offs = [r["offset_med"] for r in res if r["offset_med"] is not None]
        np_, longest = residual_pauses(info["out"], words)
        row = dict(file=os.path.basename(info["out"]), module=info["module"], num=info["num"], min=round(vd / 60, 1),
                   res=f"{st['video']['width']}x{st['video']['height']}", av_diff=round(ad - vd, 2), chapters=len(pr["chapters"]),
                   match=round(statistics.mean(r["match"] for r in res), 3), match_min=min(r["match"] for r in res),
                   offset_med=round(statistics.median(offs), 3) if offs else None, offset_worst=max(offs, key=abs) if offs else None,
                   wpm=round(statistics.mean(r["wpm"] for r in res)), pauses=np_, longest_pause=longest,
                   lufs=loudness(info["out"]), black_2s=black(info["out"]), widest_sub_px=widest_sub(info["parts"], ft))
        rows.append(row)
        print(" ".join(f"{k}={v}" for k, v in row.items() if k != "file"), "|", row["file"][:60], flush=True)
    json.dump(rows, open("final/verify.json", "w"), indent=1)
    bad = [r for r in rows if r["match_min"] < 0.85 or abs(r["offset_med"] or 0) > 0.08 or r["black_2s"] or
           r["widest_sub_px"] > C["layout"]["width"] - 80 or abs(r["av_diff"]) > 0.5]
    print(f"\n{len(rows)} videos checked; {len(bad)} need a look:", ", ".join(f"{r['module']} {r['num']:02d}" for r in bad) or "none")
