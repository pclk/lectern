"""Re-transcribe rendered output and compare it with the subtitle words: content match, sync offset, speech rate.

  verify.py <video.mp4> <words.json> [--start S --dur D]

Measure sync on windows (e.g. 2-3 min), not a whole long file: the ASR's chunk stitching on a 60-min file can
produce a spurious global offset (~-0.1 s) even when every segment is in sync.
"""
import argparse, difflib, json, os, re, statistics, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from common import cfg, ff

_m = None
norm = lambda w: re.sub(r"[^a-z0-9']", "", w.lower())


def model():
    global _m
    if _m is None:
        from parakeet_mlx import from_pretrained
        _m = from_pretrained(cfg()["asr_model"])
    return _m


def words_of(path, start=None, dur=None):
    with tempfile.NamedTemporaryFile(suffix=".wav", dir=".") as tmp:
        cmd = [ff(), "-v", "error", "-y"] + (["-ss", str(start), "-t", str(dur)] if start is not None else []) + \
              ["-i", path, "-ac", "1", "-ar", "16000", tmp.name]
        subprocess.run(cmd, check=True)
        r = model().transcribe(tmp.name, chunk_duration=120, overlap_duration=15)
    out = []
    for s in r.sentences:
        for t in s.tokens:
            if t.text.startswith(" ") or not out: out.append([t.start, t.text.strip()])
            else: out[-1][1] += t.text
    return [(t + (start or 0), w) for t, w in out if norm(w)]


def check(mp4, expected, start=None, dur=None):
    got = words_of(mp4, start, dur)
    if start is not None: expected = [e for e in expected if start <= e[0] < start + dur]
    a, b = [norm(w) for _, w in got], [norm(e[2]) for e in expected]
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    offs = [got[i + k][0] - expected[j + k][0] for i, j, n in sm.get_matching_blocks() for k in range(n)]
    span = (got[-1][0] - got[0][0]) if len(got) > 1 else 1
    return dict(match=round(sm.ratio(), 3), offset_med=round(statistics.median(offs), 3) if offs else None,
                offset_p90=round(sorted(abs(o) for o in offs)[int(len(offs) * .9)], 3) if offs else None,
                wpm=round(len(got) / span * 60), n_got=len(got), n_exp=len(b))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("video"); ap.add_argument("words")
    ap.add_argument("--start", type=float); ap.add_argument("--dur", type=float)
    a = ap.parse_args()
    print(check(a.video, json.load(open(a.words)), a.start, a.dur))
