"""Split transcribed sources into N contiguous batches of similar word count, one per review agent.

  batch_sources.py -n 4 [--module MA1301] [--kind lecture] [--prefix g2_]

Prints one line per batch: total words and the ids. ~60-80k words per agent works well for the cut review
(each 2 h lecture is ~12-18k words); short pre-recorded clips can go many to a batch.
"""
import argparse, json, os

ap = argparse.ArgumentParser(); ap.add_argument("-n", type=int, required=True)
ap.add_argument("--module"); ap.add_argument("--kind"); ap.add_argument("--prefix"); ap.add_argument("--manifest", default="manifest.json")
a = ap.parse_args()
items = [it for it in json.load(open(a.manifest)) if (not a.module or it["module"] == a.module)
         and (not a.kind or it.get("kind") == a.kind) and (not a.prefix or it["id"].startswith(a.prefix))
         and os.path.exists(f"transcripts/{it['id']}.json")]
w = {it["id"]: len(json.load(open(f"transcripts/{it['id']}.json"))["words"]) for it in items}
tot, out, cur, acc = sum(w.values()), [], [], 0
for it in items:
    cur.append(it["id"]); acc += w[it["id"]]
    if acc >= tot / a.n * (len(out) + 1) and len(out) < a.n - 1: out.append(cur); cur = []
if cur: out.append(cur)
for i, b in enumerate(out):
    print(f"batch {i}: {sum(w[x] for x in b):6d} words  {' '.join(b)}")
