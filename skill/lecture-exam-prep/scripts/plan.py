"""Build plan.json: keep-intervals + speed factor per source, split very long sources, pack parts into ~1h videos.

  plan.py            (reads manifest.json, transcripts/, cuts/<id>.json, silence/decided/<id>.json, config.json)

- cuts/<id>.json            semantic cuts from the LLM review: {"title": ..., "cuts": [{"start","end","reason"}]}
- silence/decided/<id>.json source ranges removed by the pause review (silence_apply.py)
The speed factor is fixed from the speaking rate *before* the pause review, so trimmed pauses shorten the video
instead of being absorbed by a slower speed-up. Re-running is cheap and deterministic.
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import cfg, modules

C = cfg()
FPS = C["fps"]


def snap_down(t): return math.floor(t * FPS) / FPS
def snap_up(t): return math.ceil(t * FPS) / FPS


def subtract(spans, cuts):
    out = []
    for a, b in spans:
        segs = [(a, b)]
        for c0, c1 in cuts:
            nxt = []
            for x, y in segs:
                if c1 <= x or c0 >= y: nxt.append((x, y)); continue
                if x < c0: nxt.append((x, c0))
                if c1 < y: nxt.append((c1, y))
            segs = nxt
        out += segs
    return out


def source_plan(it):
    tr = json.load(open(f"transcripts/{it['id']}.json"))
    cf = f"cuts/{it['id']}.json"
    meta = json.load(open(cf)) if os.path.exists(cf) else {}
    cuts = sorted((c["start"], c["end"]) for c in meta.get("cuts", []))
    incut = lambda t: any(a <= t < b for a, b in cuts)
    words = [w for w in tr["words"] if not incut((w[0] + w[1]) / 2)]
    spans = []
    for s, e, _ in words:
        a, b = max(0, s - C["pad_pre"]), min(tr["duration"], e + C["pad_post"])
        if spans and a - spans[-1][1] <= C["max_gap"]: spans[-1][1] = max(spans[-1][1], b)
        else: spans.append([a, b])
    spans = subtract(spans, cuts)
    spans = [(snap_down(a), snap_up(b)) for a, b in spans if b - a >= 0.15]
    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]: merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else: merged.append((a, b))
    if not merged:
        return None
    kept = sum(b - a for a, b in merged)
    wpm = len(words) / kept * 60
    factor = C["factor_override"].get(it["id"]) or min(C["max_factor"], max(C["min_factor"], C["target_wpm"] / wpm))
    sf = f"silence/decided/{it['id']}.json"
    if os.path.exists(sf):
        merged = [iv for iv in subtract(merged, sorted(map(tuple, json.load(open(sf))))) if iv[1] - iv[0] >= 1 / FPS]
        kept = sum(b - a for a, b in merged)
        wpm = len(words) / kept * 60
    out_min = kept / factor / 60
    n = max(1, round(out_min / C["target_min"])) if out_min > C["max_min"] else 1
    bounds, cum, acc = [0], [], 0
    for a, b in merged: cum.append(acc); acc += b - a
    for k in range(1, n):   # split at the widest pause near each equal-length target
        tgt = kept * k / n
        bounds.append(max(range(1, len(merged)), key=lambda i: (merged[i][0] - merged[i - 1][1]) - abs(cum[i] - tgt) / 30))
    bounds.append(len(merged))
    parts = []
    for k in range(n):
        iv = merged[bounds[k]:bounds[k + 1]]
        lo, hi = iv[0][0], iv[-1][1]
        parts.append(dict(id=f"{it['id']}_p{k + 1}", src=it["id"], path=it["path"], intervals=iv, factor=factor,
                          words=[w for w in words if lo <= w[0] < hi], out_sec=sum(b - a for a, b in iv) / factor,
                          k=k + 1, n=n, prefilter=C["prefilter"].get(it["id"])))
    return dict(id=it["id"], module=it["module"], label=it["label"], title=meta.get("title", it["label"]),
                src_min=tr["duration"] / 60, kept_min=kept / 60, raw_wpm=len(tr["words"]) / tr["duration"] * 60,
                wpm=wpm, factor=factor, out_min=out_min, cut_min=sum(b - a for a, b in cuts) / 60,
                clip_frac=tr.get("clip_frac", 0), parts=parts)


def pack(parts):
    """DP over consecutive parts minimising squared distance of each video's length to the target."""
    L = [p["out_sec"] / 60 for p in parts]
    N = len(L)
    best, prev = [0.0] + [math.inf] * N, [0] * (N + 1)
    for j in range(1, N + 1):
        tot = 0
        for i in range(j - 1, -1, -1):
            tot += L[i]
            if tot > C["max_min"] and i < j - 1: break
            c = best[i] + (tot - C["target_min"]) ** 2
            if c < best[j]: best[j], prev[j] = c, i
    groups, j = [], N
    while j: groups.append((prev[j], j)); j = prev[j]
    return [parts[i:j] for i, j in reversed(groups)]


if __name__ == "__main__":
    items = json.load(open("manifest.json"))
    srcs = [s for s in (source_plan(it) for it in items if os.path.exists(f"transcripts/{it['id']}.json")) if s]
    titles = {s["id"]: s["title"] for s in srcs}
    videos = []
    for mod in modules(items):
        seq = [p for s in srcs if s["module"] == mod for p in s["parts"]]
        for n, g in enumerate(pack(seq) if seq else [], 1):
            names = []
            for p in g:
                t = titles[p["src"]] + (f" (part {p['k']} of {p['n']})" if p["n"] > 1 else "")
                if t not in names: names.append(t)
            videos.append(dict(module=mod, num=n, parts=[p["id"] for p in g], names=names,
                               minutes=sum(p["out_sec"] for p in g) / 60))
    json.dump(dict(sources=srcs, videos=videos), open("plan.json", "w"))
    for s in srcs:
        warn = "  CLIPPED AUDIO: consider factor_override ~1.3" if s["clip_frac"] > 1e-3 and s["id"] not in C["factor_override"] else ""
        print(f"{s['id']:10s} src {s['src_min']:6.1f}m cut {s['cut_min']:5.1f}m kept {s['kept_min']:6.1f}m "
              f"raw {s['raw_wpm']:4.0f}wpm talk {s['wpm']:4.0f}wpm x{s['factor']:.2f} out {s['out_min']:5.1f}m parts {len(s['parts'])}{warn}")
    for v in videos:
        print(f"{v['module']} {v['num']:02d} {v['minutes']:5.1f}m  {' + '.join(v['names'])[:160]}")
    print(f"TOTAL {sum(v['minutes'] for v in videos) / 60:.1f} h in {len(videos)} videos")
