"""Concatenate rendered parts into the final videos (stream copy, no re-encode) with one chapter per source segment.

  assemble.py [--force] [--dry-run]

File name: "<NN> - <name>.mp4" in config out_dirs[<module>] (default ./out/<module>). Names come from
config names[<module>] (a list, one per packed video, in order) or are generated from the source titles.
--dry-run prints the planned names so you can write nicer ones into config.json before assembling.
"""
import argparse, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import cfg, ff, duration

C = cfg()
ap = argparse.ArgumentParser(); ap.add_argument("--force", action="store_true"); ap.add_argument("--dry-run", action="store_true")
args = ap.parse_args()
plan = json.load(open("plan.json"))
titles = {s["id"]: s["title"] for s in plan["sources"]}
src_of = {p["id"]: p["src"] for s in plan["sources"] for p in s["parts"]}


def safe(name): return re.sub(r'[/\\:*?"<>|]', "-", name).strip()[:120]


os.makedirs("final", exist_ok=True)
for v in plan["videos"]:
    mod, n = v["module"], v["num"]
    count = sum(1 for x in plan["videos"] if x["module"] == mod)
    given = C["names"].get(mod)
    if given and len(given) != count:
        sys.exit(f"config names[{mod}] has {len(given)} entries but the plan has {count} videos — update it (see --dry-run)")
    name = safe(given[n - 1] if given else " + ".join(v["names"]))
    out_dir = C["out_dirs"].get(mod, os.path.abspath(f"out/{mod}"))
    out = f"{out_dir}/{n:02d} - {name}.mp4"
    if args.dry_run:
        print(f"{mod} {n:02d} {v['minutes']:5.1f}m  {os.path.basename(out)}"); continue
    if os.path.exists(out) and not args.force: continue
    files = [f"parts/{pid}.mp4" for pid in v["parts"]]
    missing = [f for f in files if not os.path.exists(f)]
    if missing: print("skip, parts missing:", mod, n, missing[:3]); continue
    os.makedirs(out_dir, exist_ok=True)
    tag = f"final/{re.sub(r'[^A-Za-z0-9]+', '_', mod)}_{n:02d}"
    words, t = [], 0.0
    with open(tag + ".txt", "w") as fl, open(tag + ".meta", "w") as fm:
        fm.write(f";FFMETADATA1\ntitle={mod} {n:02d} - {name}\n")
        for pid, f in zip(v["parts"], files):
            d = duration(f)
            fl.write(f"file '{os.path.abspath(f)}'\n")
            fm.write(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={int(t * 1000)}\nEND={int((t + d) * 1000)}\ntitle={titles[src_of[pid]]}\n")
            words += [[a + t, b + t, w] for a, b, w in json.load(open(f"work/{pid}.words.json"))]
            t += d
    json.dump(words, open(tag + ".words.json", "w"))
    subprocess.run([ff(), "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", tag + ".txt", "-i", tag + ".meta",
                    "-map", "0", "-map_metadata", "1", "-map_chapters", "1", "-c", "copy", "-movflags", "+faststart",
                    out + ".tmp.mp4"], check=True)
    os.replace(out + ".tmp.mp4", out)
    json.dump(dict(out=out, words=tag + ".words.json", module=mod, num=n, parts=v["parts"], expected_sec=t), open(tag + ".json", "w"))
    print(f"{mod} {n:02d} {t / 60:5.1f} min  {os.path.basename(out)}", flush=True)
