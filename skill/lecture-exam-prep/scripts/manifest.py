"""Build manifest.json: the ordered list of source videos (watch order) with short ids.

  manifest.py add --module CS2030S --prefix cs --glob "/path/videos/*.mp4" [--sort date|natural|name] [--label-from date|name]
  manifest.py list
  manifest.py move <id> --before <id>        # reorder (e.g. put pre-lecture clips before the lesson that uses them)

Order in manifest.json IS the watch order; packing into ~1h videos follows it. Ids must be unique; transcripts,
cut files and renders are keyed by them, so don't rename ids after transcribing.
"""
import argparse, glob, json, os, re, sys

MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def date_key(path):
    n = os.path.basename(path)
    m = re.search(r"(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})", n)
    if m: return (int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r"(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})", n)              # dd_mm_yyyy
    if m: return (int(m[3]), int(m[2]), int(m[1]))
    m = re.search(r"([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})", n)        # "October 2, 2026"
    if m and m[1].lower() in MONTHS: return (int(m[3]), MONTHS[m[1].lower()], int(m[2]))
    m = re.search(r"(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})", n)             # "2 Oct 2026"
    if m and m[2].lower() in MONTHS: return (int(m[3]), MONTHS[m[2].lower()], int(m[1]))
    return None


def natural_key(path):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", os.path.basename(path))]


def load():
    return json.load(open("manifest.json")) if os.path.exists("manifest.json") else []


def save(items):
    json.dump(items, open("manifest.json", "w"), indent=1)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add")
    a.add_argument("--module", required=True); a.add_argument("--prefix", required=True)
    a.add_argument("--glob", required=True, action="append", help="repeatable; files are combined then sorted")
    a.add_argument("--sort", default="natural", choices=["date", "natural", "name"])
    a.add_argument("--kind", default="lecture", help="free tag, e.g. lecture / pre / other-group")
    sub.add_parser("list")
    mv = sub.add_parser("move"); mv.add_argument("id"); mv.add_argument("--before", required=True)
    args = ap.parse_args()
    items = load()
    if args.cmd == "add":
        files = sorted({f for g in args.glob for f in glob.glob(g)})
        if not files: sys.exit(f"no files match {args.glob}")
        if args.sort == "date":
            missing = [f for f in files if date_key(f) is None]
            if missing: sys.exit("no date found in: " + ", ".join(map(os.path.basename, missing)) + " (use --sort natural)")
            files.sort(key=date_key)
        elif args.sort == "natural": files.sort(key=natural_key)
        else: files.sort()
        used = {it["id"] for it in items}
        n = 1
        for f in files:
            while f"{args.prefix}{n:02d}" in used: n += 1
            iid = f"{args.prefix}{n:02d}"; used.add(iid)
            label = os.path.splitext(os.path.basename(f))[0]
            items.append(dict(id=iid, module=args.module, path=os.path.abspath(f), label=label, kind=args.kind))
        save(items)
    elif args.cmd == "move":
        it = next(x for x in items if x["id"] == args.id); items.remove(it)
        items.insert(next(i for i, x in enumerate(items) if x["id"] == args.before), it)
        save(items)
    for i, it in enumerate(items):
        print(f"{i:3d} {it['id']:10s} {it['module']:10s} {it.get('kind', ''):8s} {it['label']}")


if __name__ == "__main__":
    main()
