"""Annotation packs for Lectern + padSync: each page of a course document on the left half, the right half left
blank for handwriting, and a link chip beside every question/example that was worked through in a lecture, at the
height where it appears on the page. Chips open Lectern at that moment (http://localhost:4747/watch/...).

  make_packs.py <library dir> <spec.json> [--base http://localhost:4747]

spec.json: [{"module": "MA1301", "title": "Ch 3 Integration (notes)", "file": "ma-notes-ch3",
             "docs": [{"path": "/abs/notes.pdf", "pages": "53-77", "slides": null}, ...]}, ...]
  "slides": "L04" makes refs like "L04 slide 5" / "L04 slides 5–7" point at page 5 of that document.
  Other refs are found in the document text: "Notes Ex 3.2.15" -> "Example 3.2.15", "Notes Theorem 5.2.13",
  "Tutorial 2.5(a)" -> exercise "2.5." after the chapter's "Exercises" heading, "PS05 Q2" -> "Q2"/"Question 2".
Run export_lectern.py first (examples come from <library>/<module>/sources/*.json), then again afterwards
(it lists the packs in module.json). Needs typst >= 0.14 (PDF pages as images) and pypdf.
"""
import argparse, glob, json, os, re, subprocess, tempfile
import logging
from pypdf import PdfReader
logging.getLogger("pypdf").setLevel(logging.ERROR)  # font-encoding warnings on every page

ap = argparse.ArgumentParser(); ap.add_argument("library"); ap.add_argument("spec")
ap.add_argument("--base", default="http://localhost:4747")
a = ap.parse_args()


def fmt(t):
    t = int(t); return f"{t // 3600}:{t // 60 % 60:02d}:{t % 60:02d}" if t >= 3600 else f"{t // 60}:{t % 60:02d}"


def page_range(spec, n):
    if not spec: return list(range(1, n + 1))
    out = []
    for part in str(spec).split(","):
        lo, _, hi = part.partition("-")
        out += range(int(lo), int(hi or lo) + 1)
    return [p for p in out if 1 <= p <= n]


def page_lines(reader, i):
    """Text lines of page i (0-based) with their height as a fraction from the top."""
    page = reader.pages[i]
    h = float(page.mediabox.height) or 1
    frags = []
    def visit(text, cm, tm, *_):
        if text.strip(): frags.append((tm[5] * cm[3] + cm[5], tm[4] * cm[0] + cm[4], text))
    try: page.extract_text(visitor_text=visit)
    except Exception: return []
    lines = {}
    for y, x, text in frags: lines.setdefault(round(y / 3), []).append((x, text))
    return [(1 - k * 3 / h, " ".join(t.strip() for _, t in sorted(v)).strip()) for k, v in sorted(lines.items(), reverse=True)]


def locate(ref, docs):
    """(doc index, page number, y fraction) for an example ref, or None."""
    m = re.match(r"(L\d+)\s+slides?\s+(\d+)", ref)
    if m:
        for di, d in enumerate(docs):
            if d.get("slides") == m[1] and int(m[2]) in d["pages"]: return di, int(m[2]), 0.0
        return None
    pats = []
    if (m := re.match(r"Notes (?:Ex|Example) (\d+(?:\.\d+)+)", ref)): pats = [rf"^Example {re.escape(m[1])}\b"]
    elif (m := re.match(r"Notes (Theorem|Properties|Definition|Proposition|Lemma) (\d+(?:\.\d+)+)", ref)): pats = [rf"^{m[1]} {re.escape(m[2])}\b"]
    elif (m := re.match(r"Tutorial (\d+)\.(\d+)", ref)): pats = [rf"^{m[1]}\.{m[2]}\.\s"]; exercises = m[1]
    elif (m := re.match(r"PS0?(\d+).*?Q(\d+)", ref)): pats = [rf"^(Q|Question)\s*{m[2]}\b"]
    if not pats: return None
    for di, d in enumerate(docs):
        after_heading = not ref.startswith("Tutorial")
        for p in d["pages"]:
            for y, line in d["lines"][p]:
                if not after_heading and re.match(rf"^{exercises}\.\d+ Exercises$", line): after_heading = True
                if after_heading and any(re.search(x, line) for x in pats): return di, p, y
    return None


def esc(s): return s.replace("\\", "\\\\").replace('"', '\\"')


spec = json.load(open(a.spec))
by_module = {}
for pack in spec:
    mod = pack["module"]
    examples = []
    for f in sorted(glob.glob(os.path.join(a.library, mod, "sources", "*.json"))):
        s = json.load(open(f))
        examples += [{**e, "source": s["id"], "slabel": s["label"]} for e in s["examples"] if e.get("ref")]
    docs = []
    for d in pack["docs"]:
        r = PdfReader(d["path"])
        pages = page_range(d.get("pages"), len(r.pages))
        docs.append({**d, "pages": pages, "lines": {p: page_lines(r, p - 1) for p in pages},
                     "aspect": {p: float(r.pages[p - 1].mediabox.height) / float(r.pages[p - 1].mediabox.width) for p in pages}})
    chips = {}
    for e in examples:
        hit = locate(e["ref"], docs)
        if hit: chips.setdefault(hit[:2], []).append((hit[2], e))
    # one page per document page, twice its width: document left, blank right, chips beside what they refer to
    src = ['#set text(font: ("Helvetica Neue", "Helvetica"), size: 9.5pt)',
           '#let chip(url, ref, label, where) = link(url, box(fill: rgb("#f6ebcf"), stroke: 0.6pt + rgb("#c7911f"), radius: 4pt, inset: (x: 6pt, y: 4pt), width: 100%)[#text(fill: rgb("#8a5a00"), weight: "bold")[▶ #ref] #h(4pt) #label #h(1fr) #text(fill: rgb("#6b7080"), size: 8pt)[#where]])']
    linked = 0
    for di, d in enumerate(docs):
        rel = os.path.abspath(d["path"])
        for p in d["pages"]:
            h = max(100.0, 210 * d["aspect"][p])  # mm; slides get short pages instead of floating in an A4 one
            src.append(f'#page(width: 420mm, height: {h:.1f}mm, margin: 0pt)[')
            src.append(f'#place(top + left, box(width: 210mm, height: {h:.1f}mm, inset: 6mm, align(center + horizon, image("{esc(rel)}", page: {p}, width: 100%, height: 100%, fit: "contain"))))')
            src.append(f'#place(top + left, dx: 210mm, line(start: (0pt, 0pt), end: (0pt, {h:.1f}mm), stroke: 0.5pt + rgb("#d0cec6")))')
            items = sorted(chips.get((di, p), []), key=lambda x: (x[0], x[1]["start"]))
            last_y = -1.0
            for y, e in items:
                url = f'{a.base}/watch/{mod}/{e["source"]}?t={int(e["start"])}&e={e["id"]}'
                top = max(y * h - 4, last_y + 9, 6)  # mm, keep chips from overlapping
                last_y = top
                label = esc(re.sub(r"^.*?—\s*", "", e["label"]) if e["label"].startswith(e["ref"]) else e["label"])
                src.append(f'#place(top + left, dx: 216mm, dy: {top:.1f}mm, box(width: 120mm, chip("{esc(url)}", "{esc(e["ref"])}", "{label}", "{esc(e["slabel"])} · {fmt(e["start"])}")))')
                linked += 1
            src.append("]")
    out_dir = os.path.join(a.library, mod, "packs"); os.makedirs(out_dir, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".typ", delete=False) as f:
        f.write("\n".join(src))
    out = os.path.join(out_dir, f"{pack['file']}.pdf")
    subprocess.run(["typst", "compile", "--root", "/", f.name, out], check=True)
    os.unlink(f.name)
    by_module.setdefault(mod, []).append({"file": f"{pack['file']}.pdf", "title": pack["title"]})
    print(f"{out}: {sum(len(d['pages']) for d in docs)} pages, {linked} lecture links")

for mod, packs in by_module.items():
    with open(os.path.join(a.library, mod, "packs", "packs.json"), "w") as f: json.dump(packs, f, indent=1)
