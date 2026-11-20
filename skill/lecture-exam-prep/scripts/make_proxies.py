"""Browser-friendly copies of every manifest source for the Lectern player (no cuts, no burned subtitles).

  make_proxies.py <library dir> [-j 4] [--only id ...]

Writes <library>/<module>/media/<id>.mp4: H.264 30 fps, <= 1280 wide, a keyframe every second (Lectern skips
pauses by seeking/fast-forwarding, so seeks must be cheap), mono AAC, +faststart for instant range playback.
Lecture capture files are often 60-240 fps with sparse keyframes and extra data/subtitle tracks, which play
badly in Safari at 2x. ~25x realtime per worker. Finished files are skipped.
"""
import argparse, json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
from common import ff

ap = argparse.ArgumentParser(); ap.add_argument("library"); ap.add_argument("-j", type=int, default=4); ap.add_argument("--only", nargs="*")
a = ap.parse_args()
items = [it for it in json.load(open("manifest.json")) if not a.only or it["id"] in a.only]


def go(it):
    out = os.path.join(a.library, it["module"], "media", f"{it['id']}.mp4")
    if os.path.exists(out): return f"{it['id']} exists"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    r = subprocess.run([ff(), "-v", "error", "-y", "-i", it["path"], "-map", "0:v:0", "-map", "0:a:0",
                        "-vf", "fps=30,scale='min(1280,iw)':-2:flags=lanczos,format=yuv420p",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-tune", "stillimage",
                        "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-threads", "4",
                        "-c:a", "aac", "-b:a", "96k", "-ac", "1", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
                        "-movflags", "+faststart", out + ".tmp.mp4"], capture_output=True, text=True)
    if r.returncode: return f"{it['id']} FAIL {r.stderr[-400:]}"
    os.replace(out + ".tmp.mp4", out)
    return f"{it['id']} ok"


with ThreadPoolExecutor(a.j) as ex:
    for line in ex.map(go, items): print(line, flush=True)
