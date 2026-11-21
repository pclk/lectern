"""Find pauses (>= silence.out_min s of OUTPUT time) left inside the kept material, measure picture change, and
write review material for LLM agents. Run after the first plan.py (cuts applied, before silence review).

  silence_candidates.py [-j 4] [source_id ...]      then  silence_candidates.py --batches 6

Why energy + word masking: ASR word timestamps often stretch sentence-final words over the following silence,
so the gap-based first pass misses real pauses. A 10 ms frame is "silent" when it is far below this source's
speech level (p80 - below_p80_db) AND not covered by a normal-length word (duration capped by word length).
Filler words (uh/um) don't count as speech, so "pause-uh-pause" becomes one candidate.

Writes silence/cand/<src>.jsonl and, for candidates whose picture changes, contact sheets
silence/img/<src>_NNN.png (rows: start | 1/3 | 2/3 | end | changed-pixel map). --batches N writes
silence/batches.json: contiguous source groups of similar review effort, one per agent.
"""
import argparse, bisect, glob, json, os, subprocess, sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
from common import cfg, ff, mono

C = cfg()
SR, HOP, VFPS, TW, TH = 16000, 160, 4, 256, 128
FILLERS = {"uh", "um", "er", "erm", "ah", "hmm", "mm"}


def label_font():
    for f in ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"]:
        if os.path.exists(f): return ImageFont.truetype(f, 13)
    return ImageFont.load_default()


def energy(path):
    raw = subprocess.run([ff(), "-v", "error", "-i", path, "-vn", *mono(path), "-ar", str(SR), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    n = len(x) // HOP
    return 20 * np.log10(np.sqrt((x[:n * HOP].reshape(n, HOP) ** 2).mean(1)) + 1e-9)


def thumbs(path):
    raw = subprocess.run([ff(), "-v", "error", "-i", path, "-an", "-vf", f"fps={VFPS},scale={TW}:{TH}:flags=area,format=gray",
                          "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, TH, TW)


def run(src):
    if os.path.exists(f"silence/decided/{src}.json"):
        raise RuntimeError(f"silence/decided/{src}.json exists: candidates must be measured on the pre-review plan. "
                 "Delete silence/decided/ and re-run plan.py first.")
    plan = json.load(open("plan.json"))
    s = next(x for x in plan["sources"] if x["id"] == src)
    words = json.load(open(f"transcripts/{src}.json"))["words"]
    path = s["parts"][0]["path"]
    rms, vid = energy(path), thumbs(path)
    frame_at = lambda t: vid[min(len(vid) - 1, max(0, int(round(t * VFPS))))]
    cover = np.zeros(len(rms), bool)
    for ws, we, wt in words:
        if wt.lower().strip(".,?!;:") in FILLERS: continue
        cap = max(0.25, 0.085 * sum(ch.isalnum() for ch in wt))
        cover[max(0, int((ws - 0.05) * 100)):int((min(we, ws + cap) + 0.05) * 100)] = True
    cands = []
    for part in s["parts"]:
        F = part["factor"]
        ivs = part["intervals"]
        starts = [a for a, _ in ivs]
        def inkept(t):
            i = bisect.bisect_right(starts, t) - 1
            return i >= 0 and t < ivs[i][1]
        idx = np.concatenate([np.arange(int(a * 100), int(b * 100)) for a, b in ivs])
        idx = idx[idx < len(rms)]
        e = rms[idx]
        low = (e < np.percentile(e, 80) - C["silence"]["below_p80_db"]) & ~cover[idx]
        n = len(low)
        i = 0
        while i < n:      # bridge sub-80 ms blips (clicks, breaths) inside a silence
            if not low[i]:
                j = i
                while j < n and not low[j]: j += 1
                if j - i < 8 and i > 0 and j < n: low[i:j] = True
                i = j
            else: i += 1
        i = 0
        while i < n:
            if not low[i]: i += 1; continue
            j = i
            while j < n and low[j]: j += 1
            out_dur = (j - i) * 0.01 / F
            if out_dur >= C["silence"]["out_min"]:
                t0, t1 = idx[i] / 100, idx[j - 1] / 100 + 0.01
                inside = [w[2] for w in words if t0 + 0.05 < (w[0] + w[1]) / 2 < t1 - 0.05 and inkept((w[0] + w[1]) / 2)]
                fr = [frame_at(t0 + (t1 - t0) * k / 3) for k in range(4)]
                d_end = np.abs(fr[3].astype(int) - fr[0].astype(int))
                motion = max(float((np.abs(frame_at(t).astype(int) - fr[0].astype(int)) > 30).mean())
                             for t in np.arange(t0, t1, 1 / VFPS)) if t1 - t0 > 0.3 else 0.0
                cands.append(dict(id=f"{src}#{len(cands):04d}", src=src, start=round(t0, 2), end=round(t1, 2),
                                  out_dur=round(out_dur, 2), factor=round(F, 3),
                                  change_end=round(float((d_end > 30).mean()), 4), motion_max=round(motion, 4),
                                  asr_words_inside=inside,
                                  only_fillers=bool(inside) and all(w.lower().strip(".,?!") in FILLERS for w in inside),
                                  before=" ".join([w[2] for w in words if w[1] <= t0 + 0.05 and inkept(w[0])][-14:])[-110:],
                                  after=" ".join([w[2] for w in words if w[0] >= t1 - 0.05 and inkept(w[0])][:14])[:110],
                                  _fr=fr, _d=d_end))
            i = j
    os.makedirs("silence/cand", exist_ok=True); os.makedirs("silence/img", exist_ok=True)
    for old in glob.glob(f"silence/img/{src}_*.png"): os.remove(old)
    need = [c for c in cands if c["change_end"] > 0.002 or c["motion_max"] > 0.01]
    font = label_font()
    for k in range(0, len(need), 6):
        grp = need[k:k + 6]
        sheet = Image.new("L", (TW * 5 + 16, (TH + 18) * len(grp)), 255)
        dr = ImageDraw.Draw(sheet)
        for r, c in enumerate(grp):
            y = r * (TH + 18)
            dr.text((2, y + 2), f"{c['id']}  pause {c['out_dur']}s  change_end={c['change_end']}  motion={c['motion_max']}   "
                    "[start | 1/3 | 2/3 | end | changed pixels]", fill=0, font=font)
            for q, im in enumerate(c["_fr"] + [np.where(c["_d"] > 30, 0, 235).astype(np.uint8)]):
                sheet.paste(Image.fromarray(im), (q * (TW + 4), y + 18))
        name = os.path.abspath(f"silence/img/{src}_{k // 6:03d}.png")
        sheet.save(name)
        for c in grp: c["image"] = name
    # the intervals the candidates were measured on (pre-review); silence_apply.py works on these
    json.dump({p["id"]: p["intervals"] for p in s["parts"]}, open(f"silence/cand/{src}.intervals.json", "w"))
    with open(f"silence/cand/{src}.jsonl", "w") as f:
        for c in cands:
            c.pop("_fr"); c.pop("_d"); f.write(json.dumps(c) + "\n")
    return f"{src} {len(cands)} candidates, {len(need)} with picture change, {sum(c['out_dur'] for c in cands) / 60:.1f} min"


def batches(n):
    plan = json.load(open("plan.json"))
    order = [s["id"] for s in plan["sources"]]
    w = {s: sum(1 for _ in open(f"silence/cand/{s}.jsonl")) + 6 * len(glob.glob(f"silence/img/{s}_*.png")) for s in order}
    tot, out, cur, acc = sum(w.values()), [], [], 0
    for s in order:
        cur.append(s); acc += w[s]
        if acc >= tot / n * (len(out) + 1) and len(out) < n - 1: out.append(cur); cur = []
    if cur: out.append(cur)
    json.dump(out, open("silence/batches.json", "w"))
    for i, b in enumerate(out):
        print(i, sum(w[s] for s in b), "effort:", " ".join(b))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("-j", type=int, default=4); ap.add_argument("--batches", type=int)
    ap.add_argument("ids", nargs="*"); a = ap.parse_args()
    if a.batches: batches(a.batches); sys.exit()
    ids = a.ids or [s["id"] for s in json.load(open("plan.json"))["sources"]]
    with ProcessPoolExecutor(a.j) as ex:
        for line in ex.map(run, ids): print(line, flush=True)
    c = [json.loads(l) for f in glob.glob("silence/cand/*.jsonl") for l in open(f)]
    print(f"TOTAL {len(c)} candidates, {sum('image' in x for x in c)} with picture change, {sum(x['out_dur'] for x in c) / 60:.1f} min of pauses")
