"""Export the work dir into a Lectern library (the local lecture player in ~/Repo/lectern).

  export_lectern.py <library dir> [--titles '{"CS2030S": "Programming Methodology II"}']

Reads manifest.json, plan.json, transcripts/, cuts/, index/ (chapters + worked examples, optional per source).
Writes <library>/<module>/module.json and <library>/<module>/sources/<id>.json. Videos come from make_proxies.py
(<library>/<module>/media/<id>.mp4) and annotation packs from make_packs.py (<library>/<module>/packs/).
All times stay in source time; Lectern applies cuts/pauses/speed live, so the user can toggle them.
"""
import argparse, json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import cfg

ap = argparse.ArgumentParser(); ap.add_argument("library"); ap.add_argument("--titles", default="{}")
a = ap.parse_args()
C = cfg()
FIXES = [(re.compile(f["match"], re.I), f["replace"]) for f in C["term_fixes"]]

CATEGORIES = [
    ("dead-time", r"before (the )?lecture|after (the )?lecture|dead|waiting|silence|setting up|starts? late"),
    ("break", r"\bbreak\b"),
    ("technical", r"mic|audio|projector|screen|technical|zoom|recording|dismissed|slides? (not|won)"),
    ("not-examinable", r"examinable|not tested|skipped by lecturer|binomial|sequence"),
    ("admin", r"admin|registration|logistic|survey|email|onboarding|announce|venue|appeal|forum|recruit|introduction|farewell|feedback"),
]


def category(reason):
    r = reason.lower()
    for cat, rx in CATEGORIES:
        if re.search(rx, r): return cat
    return "off-topic"


def fix_terms(words):
    """Same windowed regex fixes as render.py, so the player's subtitles match the burned-in ones."""
    if not FIXES: return words
    out, i = [], 0
    while i < len(words):
        hit = None
        for n in (3, 2, 1):
            if i + n > len(words): continue
            text = " ".join(w[2] for w in words[i:i + n])
            core = re.sub(r"[.,;:?!]+$", "", text)
            for rx, rep in FIXES:
                if rx.fullmatch(core):
                    hit = (n, rx.sub(rep, core) + text[len(core):]); break
            if hit: break
        if hit:
            out.append([words[i][0], words[i + hit[0] - 1][1], hit[1]]); i += hit[0]
        else:
            out.append(list(words[i])); i += 1
    return out


def subtract(spans, holes):
    out = []
    for x, y in spans:
        segs = [(x, y)]
        for h0, h1 in holes:
            segs = [s for x0, y0 in segs for s in ((x0, min(y0, h0)), (max(x0, h1), y0)) if s[1] - s[0] > 0.02]
        out += segs
    return out


def r3(x): return round(x, 3)


manifest = json.load(open("manifest.json"))
plan = {s["id"]: s for s in json.load(open("plan.json"))["sources"]}
titles = {"CS2030S": "Programming Methodology II", "MA1301": "Introductory Mathematics", **json.loads(a.titles)}
modules = {}
for order, it in enumerate(manifest):
    sid, mod = it["id"], it["module"]
    p = plan.get(sid)
    if not p: print(f"skip {sid}: not in plan.json", file=sys.stderr); continue
    tr = json.load(open(f"transcripts/{sid}.json"))
    meta = json.load(open(f"cuts/{sid}.json")) if os.path.exists(f"cuts/{sid}.json") else {}
    idx = json.load(open(f"index/{sid}.json")) if os.path.exists(f"index/{sid}.json") else {}
    dur = tr["duration"]
    cuts = [{"start": r3(c["start"]), "end": r3(c["end"]), "reason": c["reason"], "category": category(c["reason"])}
            for c in sorted(meta.get("cuts", []), key=lambda c: c["start"])]
    # pauses = everything plan.py removed that isn't a semantic cut (gaps between kept intervals)
    kept = sorted(iv for part in p["parts"] for iv in part["intervals"])
    gaps, t = [], 0.0
    for x, y in kept:
        if x > t: gaps.append((t, x))
        t = max(t, y)
    if t < dur: gaps.append((t, dur))
    pauses = [[r3(x), r3(y)] for x, y in subtract(gaps, [(c["start"], c["end"]) for c in cuts])]
    title = meta.get("title") or p.get("title") or it["label"]
    chapters = sorted(idx.get("chapters") or [{"start": 0, "title": title}], key=lambda c: c["start"])
    examples = sorted(idx.get("examples", []), key=lambda e: e["start"])
    words = [[r3(w[0]), r3(w[1]), w[2]] for w in fix_terms(tr["words"])]
    kind = "clip" if dur < 25 * 60 else "lecture"
    summary = {"id": sid, "module": mod, "title": title, "label": it["label"], "kind": kind, "order": order,
               "duration": r3(dur), "factor": round(p["factor"], 3), "wordCount": len(words),
               "chapterCount": len(chapters), "exampleCount": len(examples), "condensedMinutes": round(sum(q["out_sec"] for q in p["parts"]) / 60, 1),
               "indexed": bool(idx)}
    src = {**summary, "words": words, "cuts": cuts, "pauses": pauses, "chapters": chapters, "examples": examples}
    d = os.path.join(a.library, mod, "sources"); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, f"{sid}.json"), "w") as f: json.dump(src, f, ensure_ascii=False, separators=(",", ":"))
    modules.setdefault(mod, []).append(summary)

for mod, sources in modules.items():
    pdir = os.path.join(a.library, mod, "packs")
    packs = []
    if os.path.exists(os.path.join(pdir, "packs.json")): packs = json.load(open(os.path.join(pdir, "packs.json")))
    with open(os.path.join(a.library, mod, "module.json"), "w") as f:
        json.dump({"code": mod, "title": titles.get(mod, mod), "sources": sources, "packs": packs}, f, ensure_ascii=False, indent=1)
    missing = [s["id"] for s in sources if not os.path.exists(os.path.join(a.library, mod, "media", f"{s['id']}.mp4"))]
    print(f"{mod}: {len(sources)} sources, {sum(s['indexed'] for s in sources)} indexed, "
          f"{sum(s['exampleCount'] for s in sources)} examples" + (f"; NO VIDEO for {' '.join(missing)}" if missing else ""))
