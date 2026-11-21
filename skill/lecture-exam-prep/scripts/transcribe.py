"""Transcribe every manifest entry with word timestamps (Parakeet TDT via MLX, ~80x realtime on Apple Silicon).

  transcribe.py [--manifest manifest.json] [--only id1 id2 ...]

Writes transcripts/<id>.json  {duration, words: [[start, end, word]], sentences: [[start, end, text]], clip_frac}
       transcripts/<id>.txt   "[h:mm:ss] sentence" lines, for LLM review.
Audio is extracted in parallel first (ffmpeg, 6 at a time) so the GPU is never waiting. Re-runs skip finished ids.
clip_frac = share of samples at full scale; > ~1e-3 means distorted audio (consider a lower speed via factor_override).
"""
import argparse, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from common import cfg, ff, mono


def hms(t): return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{int(t % 60):02d}"


def extract(it):
    wav = f"wav/{it['id']}.wav"
    if os.path.exists(f"transcripts/{it['id']}.json") or os.path.exists(wav): return
    subprocess.run([ff(), "-v", "error", "-y", "-i", it["path"], "-vn", *mono(it["path"]), "-ar", "16000", "-f", "wav", wav + ".tmp"], check=True)
    os.rename(wav + ".tmp", wav)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--manifest", default="manifest.json"); ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    items = [it for it in json.load(open(args.manifest)) if not args.only or it["id"] in args.only]
    os.makedirs("wav", exist_ok=True); os.makedirs("transcripts", exist_ok=True)
    pool = ThreadPoolExecutor(6); futs = {it["id"]: pool.submit(extract, it) for it in items}
    from parakeet_mlx import from_pretrained
    m = from_pretrained(cfg()["asr_model"])
    for it in items:
        out = f"transcripts/{it['id']}.json"
        if os.path.exists(out): continue
        futs[it["id"]].result()
        wav = f"wav/{it['id']}.wav"; t0 = time.time()
        r = m.transcribe(wav, chunk_duration=120, overlap_duration=15)
        words, sents = [], []
        for s in r.sentences:
            sents.append([round(s.start, 3), round(s.end, 3), s.text.strip()])
            for tok in s.tokens:        # tokens are sub-words; a leading space starts a new word
                if tok.text.startswith(" ") or not words or words[-1][3] != len(sents):
                    words.append([tok.start, tok.end, tok.text.strip(), len(sents)])
                else:
                    words[-1][1] = tok.end; words[-1][2] += tok.text
        words = [[round(a, 3), round(b, 3), w] for a, b, w, _ in words if w]
        x = np.memmap(wav, np.int16, "r", offset=44)
        clip = float((np.abs(x[::4].astype(np.int32)) >= 32000).mean())
        dur = len(x) / 16000
        json.dump(dict(id=it["id"], duration=dur, words=words, sentences=sents, clip_frac=clip), open(out, "w"))
        with open(f"transcripts/{it['id']}.txt", "w") as f:
            f.write(f"# {it['module']} {it['label']} (source duration {hms(dur)})\n")
            for a, b, t in sents: f.write(f"[{hms(a)}] {t}\n")
        del x; os.remove(wav)
        flag = "  <-- CLIPPED AUDIO" if clip > 1e-3 else ""
        print(f"{it['id']} {dur / 60:.1f}min asr {time.time() - t0:.0f}s {len(words)} words clip={clip:.1e}{flag}", flush=True)


if __name__ == "__main__":
    main()
