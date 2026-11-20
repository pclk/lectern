"""Turn the agents' pause decisions into source ranges to remove: silence/decided/<src>.json (read by plan.py).

  silence_apply.py [--auto-missing cut|keep]

Input: silence/decisions/<src>.json  [{"id", "action": cut|trim|keep, "keep_out"?: seconds}]
       silence/overrides.json (optional) {"<cand id>": {"action": ...}} for corrections after review.
cut -> pause shortened to silence.cut_to s of output; trim -> keep_out s; keep -> untouched. The kept part is
split evenly between the start and end of the pause, measured on the kept timeline (a candidate may span ranges
already removed by the semantic cuts). Afterwards: plan.py, run_renders.py --force, assemble.py --force.
"""
import argparse, glob, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import cfg

C = cfg()
ap = argparse.ArgumentParser(); ap.add_argument("--auto-missing", choices=["cut", "keep"]); a = ap.parse_args()
plan = json.load(open("plan.json"))
over = json.load(open("silence/overrides.json")) if os.path.exists("silence/overrides.json") else {}
os.makedirs("silence/decided", exist_ok=True)
tot, saved, problems = {"cut": 0, "trim": 0, "keep": 0}, 0.0, []
for s in plan["sources"]:
    src = s["id"]
    if not os.path.exists(f"silence/cand/{src}.jsonl"): continue
    cands = {c["id"]: c for c in map(json.loads, open(f"silence/cand/{src}.jsonl"))}
    dfile = f"silence/decisions/{src}.json"
    dec = {d["id"]: d for d in json.load(open(dfile))} if os.path.exists(dfile) else {}
    missing = set(cands) - set(dec)
    if missing:
        if not a.auto_missing: problems.append(f"{src}: {len(missing)} undecided"); continue
        for m in missing: dec[m] = {"id": m, "action": a.auto_missing}
    ivs = [iv for p in json.load(open(f"silence/cand/{src}.intervals.json")).values() for iv in p]
    F, rm = s["factor"], []
    for cid, c in cands.items():
        d = over.get(cid, dec[cid]); tot[d["action"]] += 1
        if d["action"] == "keep": continue
        keep_out = C["silence"]["cut_to"] if d["action"] == "cut" else max(C["silence"]["cut_to"], float(d["keep_out"]))
        pieces = [(max(x, c["start"]), min(y, c["end"])) for x, y in ivs if x < c["end"] and y > c["start"]]
        K = sum(y - x for x, y in pieces); k = min(K, keep_out * F)
        lo, hi, acc = k / 2, K - k / 2, 0.0
        for x, y in pieces:
            x0, x1 = max(x, x + lo - acc), min(y, x + hi - acc)
            if x1 - x0 > 1e-3: rm.append([round(x0, 4), round(x1, 4)])
            acc += y - x
        saved += max(0, K - k) / F
    json.dump(sorted(rm), open(f"silence/decided/{src}.json", "w"))
if problems: sys.exit("Decisions incomplete:\n" + "\n".join(problems) + "\n(re-run the agent, or pass --auto-missing)")
print(tot, f"removes {saved / 60:.1f} min of pauses from the output")
