// Reads the library directory written by the lecture-exam-prep skill:
//   <library>/<MODULE>/module.json            { code, title, sources: SourceSummary[], packs: [{file, title}] }
//   <library>/<MODULE>/sources/<id>.json      Source (words, cuts, pauses, chapters, examples)
//   <library>/<MODULE>/media/<id>.mp4         browser proxy of the original recording
//   <library>/<MODULE>/packs/<file>.pdf       annotation packs (notes + links back into the lectures)
import fs from "node:fs";
import path from "node:path";
import type { ExampleHit, Library, Module, SearchHit, Source } from "../shared/types.ts";

// A single path segment: no separators and no leading dot, so never "." or "..".
const SAFE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export class LibraryStore {
  readonly root: string;
  private modules: Module[] = [];
  private stamp = "";
  private sources = new Map<string, { mtime: number; src: Source }>();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private moduleDirs(): string[] {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root).filter((d) => SAFE.test(d) && fs.existsSync(path.join(this.root, d, "module.json"))).sort();
  }

  library(): Library {
    const dirs = this.moduleDirs();
    const stamp = dirs.map((d) => `${d}:${fs.statSync(path.join(this.root, d, "module.json")).mtimeMs}`).join("|");
    if (stamp !== this.stamp) {
      // one unreadable module.json must not take the whole library down
      this.modules = dirs.flatMap((d) => {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(this.root, d, "module.json"), "utf8")) as Module;
          return [{ ...m, code: m.code ?? d, title: m.title ?? d, sources: m.sources ?? [], packs: m.packs ?? [] }];
        } catch (e) {
          console.error(`skipping ${d}/module.json: ${(e as Error).message}`);
          return [];
        }
      });
      this.stamp = stamp;
    }
    return { modules: this.modules };
  }

  source(module: string, id: string): Source | null {
    if (!SAFE.test(module) || !SAFE.test(id)) return null;
    const file = path.join(this.root, module, "sources", `${id}.json`);
    if (!fs.existsSync(file)) return null;
    const mtime = fs.statSync(file).mtimeMs;
    const hit = this.sources.get(file);
    if (hit && hit.mtime === mtime) return hit.src;
    let src: Source;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Source;
      src = { ...raw, words: raw.words ?? [], cuts: raw.cuts ?? [], pauses: raw.pauses ?? [], chapters: raw.chapters ?? [], examples: raw.examples ?? [] };
    } catch (e) {
      console.error(`unreadable ${module}/sources/${id}.json: ${(e as Error).message}`);
      return null;
    }
    this.sources.set(file, { mtime, src });
    return src;
  }

  /** Path of a servable file inside a module folder (media/ or packs/), or null. */
  file(module: string, kind: "media" | "packs", name: string, tier?: number): string | null {
    if (!SAFE.test(module) || !SAFE.test(name)) return null;
    const p = tier ? path.join(this.root, module, kind, `${tier}p`, name) : path.join(this.root, module, kind, name);
    if (!p.startsWith(this.root + path.sep)) return null;
    return fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
  }

  search(q: string, limit = 60): SearchHit[] {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits: SearchHit[] = [];
    for (const m of this.library().modules) {
      for (const s of m.sources) {
        const src = this.source(m.code, s.id);
        if (!src) continue;
        const w = src.words;
        // slide a 12-word window; report each window containing every term once
        for (let i = 0; i < w.length; i++) {
          const first = w[i][2].toLowerCase();
          if (!first.includes(terms[0])) continue;
          const win = w.slice(Math.max(0, i - 4), i + 12);
          const text = win.map((x) => x[2]).join(" ");
          const lower = text.toLowerCase();
          if (terms.every((t) => lower.includes(t))) {
            hits.push({ module: m.code, source: s.id, sourceTitle: s.title, start: w[i][0], text });
            i += 12;
            if (hits.length >= limit) return hits;
          }
        }
      }
    }
    return hits;
  }

  /** Heights of the lower-quality copies made for a recording (make_proxies.py --tier), highest first. */
  tiers(module: string, id: string): number[] {
    if (!SAFE.test(module) || !SAFE.test(id)) return [];
    const dir = path.join(this.root, module, "media");
    try {
      return fs.readdirSync(dir).filter((d) => /^\d{3,4}p$/.test(d) && fs.existsSync(path.join(dir, d, `${id}.mp4`)))
        .map((d) => parseInt(d, 10)).sort((a, b) => b - a);
    } catch { return []; }
  }

  /** Every worked example in a module, in watch order. */
  examples(module: string): ExampleHit[] {
    const m = this.library().modules.find((x) => x.code === module);
    if (!m) return [];
    return m.sources.flatMap((s) => (this.source(m.code, s.id)?.examples ?? []).map((e) => (
      { ...e, module: m.code, source: s.id, sourceTitle: s.title, sourceLabel: s.label })));
  }

  /**
   * Progress shared by every browser and device (web/sync.ts): {store: {key: {v, at}}}. A client only sends what it
   * changed, so every entry it sends is accepted, stamped with the server's own increasing clock: the last change to
   * arrive wins, whatever the devices' clocks say.
   */
  private statePath() { return path.join(this.root, ".lectern-state.json"); }

  state(): SyncState {
    try { return JSON.parse(fs.readFileSync(this.statePath(), "utf8")) as SyncState; } catch { return {}; }
  }

  private clock = 0;

  mergeState(patch: SyncState): SyncState {
    const cur = this.state();
    const bad = (k: string) => k === "__proto__" || k === "constructor" || k === "prototype";
    for (const [store, entries] of Object.entries(patch)) {
      if (!SAFE.test(store) || bad(store) || typeof entries !== "object" || !entries) continue;
      if (!Object.hasOwn(cur, store)) cur[store] = {};
      const into = cur[store];
      for (const [k, e] of Object.entries(entries)) {
        if (bad(k) || typeof e !== "object" || !e) continue;
        this.clock = Math.max(Date.now(), this.clock + 1);
        into[k] = { v: e.v ?? null, at: this.clock };
      }
    }
    const tmp = this.statePath() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cur));
    fs.renameSync(tmp, this.statePath());
    return cur;
  }
}

export type SyncState = Record<string, Record<string, { v: unknown; at: number }>>;
