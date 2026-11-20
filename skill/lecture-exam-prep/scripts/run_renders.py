"""Render plan parts in parallel (libx264 software path; ~13x realtime per worker at 4 threads).

  run_renders.py [-j 5] [--force] [source_id ...]     (no ids = every part in plan.json)

Finished parts in parts/ are skipped, so it is safe to re-run after a failure. --force deletes the selected
parts first (needed after changing cuts, silence decisions, factors or term fixes for those sources).
"""
import argparse, json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser(); ap.add_argument("-j", type=int, default=5); ap.add_argument("--force", action="store_true")
ap.add_argument("ids", nargs="*")
args = ap.parse_args()
plan = json.load(open("plan.json"))
pids = [p["id"] for s in plan["sources"] if not args.ids or s["id"] in args.ids for p in s["parts"]]
if args.force:
    for pid in pids:
        if os.path.exists(f"parts/{pid}.mp4"): os.remove(f"parts/{pid}.mp4")
render = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render.py")
fails = []


def go(pid):
    r = subprocess.run([sys.executable, render, pid], capture_output=True, text=True)
    ok = r.returncode == 0
    if not ok: fails.append(pid)
    print(pid, "ok" if ok else "FAIL\n" + r.stderr[-1500:], flush=True)


with ThreadPoolExecutor(args.j) as ex: list(ex.map(go, pids))
print(f"{len(pids) - len(fails)}/{len(pids)} parts rendered", "FAILED: " + " ".join(fails) if fails else "")
sys.exit(1 if fails else 0)
