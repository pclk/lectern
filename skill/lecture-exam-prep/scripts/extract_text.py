"""Extract text from every PDF/DOCX/PPTX/TXT/MD under a course folder, for ranking topics and building briefs.

  extract_text.py "<course folder>" <out dir>

Output: one .txt per document, path separators replaced by "__", pages delimited by "--- page N ---".
Prints a size table (pages, chars) so you can see which files are slides, notes, papers or answer keys.
Scanned PDFs come out empty: mention them to the user rather than guessing their content.
"""
import os, sys, zipfile, re
import pypdf

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def office_text(path, inner):
    with zipfile.ZipFile(path) as z:
        parts = sorted(n for n in z.namelist() if re.match(inner, n))
        return "\n".join(f"--- page {i + 1} ---\n" + re.sub(r"<[^>]+>", " ", z.read(n).decode("utf8", "ignore"))
                         for i, n in enumerate(parts))


for root, _, files in os.walk(src):
    for f in sorted(files):
        p = os.path.join(root, f); ext = f.lower().rsplit(".", 1)[-1]
        try:
            if ext == "pdf":
                r = pypdf.PdfReader(p)
                t = "\n".join(f"--- page {i + 1} ---\n" + (pg.extract_text() or "") for i, pg in enumerate(r.pages)); n = len(r.pages)
            elif ext == "docx": t = office_text(p, r"word/document\.xml"); n = 1
            elif ext == "pptx": t = office_text(p, r"ppt/slides/slide\d+\.xml"); n = t.count("--- page")
            elif ext in ("txt", "md"): t = open(p, errors="ignore").read(); n = 1
            else: continue
        except Exception as e:
            t, n = f"ERROR {e}", 0
        name = os.path.relpath(p, src).replace("/", "__").rsplit(".", 1)[0] + ".txt"
        open(os.path.join(out, name), "w").write(t)
        flag = "  (no text: scanned?)" if n and len(t.strip()) < 50 * n else ""
        print(f"{n:4d}p {len(t):8d}c  {name}{flag}")
