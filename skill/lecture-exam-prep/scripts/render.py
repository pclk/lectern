"""Render plan parts: cut + retime video/audio, fit into a fixed canvas with a subtitle bar, burn karaoke subtitles.

  render.py <part_id> [<part_id> ...]          (normally called by run_renders.py)

Layout: source scaled into the top W x content_height area, subtitles in the black bar below, so they never cover
slides. Current word is highlighted, spoken words solid, upcoming words dimmed. Audio: sample-accurate cuts with
6 ms fades, rubberband pitch-preserving stretch, loudnorm to -16 LUFS. Video: frame selection via a binary-search
if() tree (a flat "between()+between()+..." expression with ~1500 terms makes ffmpeg fail with ENOMEM).
Also writes work/<part>.words.json (subtitle words on the output timeline) used by assemble/verify.
"""
import bisect, json, os, re, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from common import cfg, ff, mono, video_size

C = cfg()
FPS, SR = C["fps"], 48000
W, H, CH = C["layout"]["width"], C["layout"]["height"], C["layout"]["content_height"]
FADE = int(0.006 * SR)
S = C["subtitle"]


def bgr(hex_rgb): return hex_rgb[4:6] + hex_rgb[2:4] + hex_rgb[0:2]


ASS_HEAD = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{S['font']},{S['size']},&H00{bgr(S['spoken'])},&H00{bgr(S['spoken'])},&H00000000,&H64000000,0,0,0,0,100,100,0.3,0,1,1.2,0,2,40,40,{S['margin_v']},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
SPOKEN = r"{\1c&H%s&\1a&H00&}" % bgr(S["spoken"])
CURRENT = r"{\1c&H%s&\1a&H00&}" % bgr(S["current"])
UPCOMING = r"{\1c&H%s&\1a&H%s&}" % (bgr(S["spoken"]), S["upcoming_alpha"])
FIXES = [(re.compile(f["match"], re.I), f["replace"]) for f in C["term_fixes"]]


def ts(t):
    cs = int(round(max(0, t) * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def mapper(intervals, factor):
    """Source time -> output time (times inside removed gaps clamp to the nearest kept edge)."""
    starts, cum, acc = [], [], 0.0
    for a, b in intervals: starts.append(a); cum.append(acc); acc += b - a
    def f(t):
        i = max(0, bisect.bisect_right(starts, t) - 1)
        a, b = intervals[i]
        return (cum[i] + min(max(t, a), b) - a) / factor
    return f, acc / factor


def fix_terms(words):
    """Apply config term_fixes: each regex is tried against 3-, 2- then 1-word windows (trailing punctuation kept)."""
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


def build_ass(part, path):
    f, total = mapper(part["intervals"], part["factor"])
    words = [(f(s), f(e), w.replace("{", "(").replace("}", ")").replace("\\", "/"), s, e) for s, e, w in fix_terms(part["words"])]
    json.dump([[round(a, 3), round(b, 3), t] for a, b, t, _, _ in words], open(path[:-4] + ".words.json", "w"))
    lines, cur = [], []
    for w in words:
        if cur:
            text = " ".join(x[2] for x in cur)
            gap = w[3] - cur[-1][4]
            if len(text) + len(w[2]) > S["max_chars"] or (gap > 0.9 and len(cur) >= 3) or \
               (cur[-1][2][-1:] in ".?!" and len(cur) >= 4) or (len(text) > 40 and cur[-1][2][-1:] in ",;:"):
                lines.append(cur); cur = []
        cur.append(w)
    if cur: lines.append(cur)
    ev = []
    for li, ln in enumerate(lines):
        end = min(ln[-1][1] + 1.2, lines[li + 1][0][0] if li + 1 < len(lines) else total)
        for i, w in enumerate(ln):
            s = w[0] if i else ln[0][0]
            e = ln[i + 1][0] if i + 1 < len(ln) else end
            if e - s < 0.01: continue
            txt = " ".join((CURRENT if j == i else SPOKEN if j < i else UPCOMING) + x[2] for j, x in enumerate(ln))
            ev.append(f"Dialogue: 0,{ts(s)},{ts(e)},Cap,,0,0,0,,{txt}")
    open(path, "w").write(ASS_HEAD + "\n".join(ev) + "\n")


def build_audio(part, path):
    lo, hi = part["intervals"][0][0], part["intervals"][-1][1]
    raw = subprocess.run([ff(), "-v", "error", "-ss", f"{lo}", "-t", f"{hi - lo + 1}", "-i", part["path"], "-vn",
                          *mono(part["path"], part.get("prefilter")), "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32)
    ramp = np.linspace(0, 1, FADE, dtype=np.float32)
    chunks = []
    for a, b in part["intervals"]:
        i, j = round((a - lo) * SR), round((b - lo) * SR)
        c = x[i:j].copy()
        if len(c) < j - i: c = np.pad(c, (0, j - i - len(c)))
        if len(c) > 2 * FADE: c[:FADE] *= ramp; c[-FADE:] *= ramp[::-1]
        chunks.append(c)
    y = np.clip(np.concatenate(chunks), -32768, 32767).astype(np.int16)
    subprocess.run([ff(), "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", path], input=y.tobytes(), check=True)


def render(part, out):
    os.makedirs("work", exist_ok=True)
    src_w, src_h = video_size(part["path"])
    pid = part["id"]; ass = f"work/{pid}.ass"; wav = f"work/{pid}.wav"
    build_ass(part, ass); build_audio(part, wav)
    lo = part["intervals"][0][0]
    iv = [(a - lo - 0.5 / FPS, b - lo - 0.5 / FPS) for a, b in part["intervals"]]
    def tree(i, j):
        if j - i == 1: return f"between(t,{iv[i][0]:.4f},{iv[i][1]:.4f})"
        m = (i + j) // 2
        return f"if(lt(t,{iv[m][0]:.4f}),{tree(i, m)},{tree(m, j)})"
    sel = tree(0, len(iv)).replace(",", "\\,")
    s = min(W / src_w, CH / src_h); sw, sh = int(src_w * s) // 2 * 2, int(src_h * s) // 2 * 2
    F, E = part["factor"], C["encode"]
    vf = (f"fps={FPS},select@s={sel},setpts=N/({FPS * F:.6f}*TB),fps={FPS},"
          f"scale={sw}:{sh}:flags=lanczos,pad={W}:{H}:{(W - sw) // 2}:{(CH - sh) // 2}:black,ass={ass},format=yuv420p")
    af = (f"rubberband=tempo={F:.5f}:transients=mixed:detector=soft:window=standard:formant=preserved:pitchq=quality,"
          f"loudnorm=I=-16:TP=-1.5:LRA=11,aresample={SR},pan=stereo|c0=c0|c1=c0")
    script = f"work/{pid}.fg"
    open(script, "w").write(f"[0:v]{vf}[v];[1:a]{af}[a]")
    subprocess.run([ff(), "-v", "error", "-y", "-ss", f"{lo}", "-i", part["path"], "-i", wav,
                    "-/filter_complex", script, "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-preset", E["preset"], "-crf", str(E["crf"]), "-tune", E["tune"], "-g", "300",
                    "-threads", str(E["threads"]), "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
                    "-c:a", "aac", "-b:a", f"{E['audio_kbps']}k", "-ar", str(SR),
                    "-t", f"{sum(b - a for a, b in part['intervals']) / F:.3f}", "-movflags", "+faststart", out], check=True)
    os.remove(wav)


if __name__ == "__main__":
    plan = json.load(open("plan.json"))
    parts = {p["id"]: p for s in plan["sources"] for p in s["parts"]}
    os.makedirs("parts", exist_ok=True)
    for pid in sys.argv[1:]:
        out = f"parts/{pid}.mp4"
        if os.path.exists(out): continue
        render(parts[pid], out + ".tmp.mp4")
        os.rename(out + ".tmp.mp4", out)
        print("done", pid, flush=True)
