// Per-browser player preferences and resume positions. Everything is optional: a private window or blocked
// storage just means defaults every time.
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { DEFAULT_EDIT, type EditSettings } from "../shared/edl.ts";
import type { LocalPause } from "../shared/pauses.ts";

export interface Prefs {
  edit: EditSettings;
  /** auto = speed chosen per recording so kept speech runs at targetWpm */
  rateMode: "auto" | "manual";
  targetWpm: number;
  manualRate: number;
  subtitles: boolean;
  karaoke: boolean;
  subtitleSize: number;
  panel: "chapters" | "examples" | "transcript" | "cuts";
  /** pause when a worked example opened from a link finishes */
  stopAtExampleEnd: boolean;
  volume: number;
  /** keep at most this many seconds of each pause between words; null = the pipeline's reviewed pauses */
  pauseMax: number | null;
  /** at the end of a recording, start the next one after a short countdown */
  autoNext: boolean;
  /** replay a worked example from its start when it ends, instead of pausing */
  loopExample: boolean;
  /** preferred lower-quality copy (e.g. 540); null = full quality */
  quality: number | null;
}

export const DEFAULT_PREFS: Prefs = {
  edit: DEFAULT_EDIT, rateMode: "auto", targetWpm: 250, manualRate: 1.5, subtitles: true, karaoke: true,
  subtitleSize: 1, panel: "chapters", stopAtExampleEnd: true, volume: 1, pauseMax: null, autoNext: true, loopExample: false, quality: null,
};

function read<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch { return def; }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = read("lectern.prefs", DEFAULT_PREFS);
    return { ...p, edit: { ...DEFAULT_EDIT, ...p.edit, keepCuts: [] } };
  });
  const update = useCallback((patch: Partial<Prefs>) => setPrefs((p) => {
    const next = { ...p, ...patch };
    // which individual cuts were switched back on is per recording, not a global preference
    write("lectern.prefs", { ...next, edit: { ...next.edit, keepCuts: [] } });
    return next;
  }), []);
  return [prefs, update];
}

type Entry = { t: number; at: number; done?: boolean };
type Resume = Record<string, Entry>;
const RESUME_EVENT = "lectern:resume";

/**
 * Where each recording ("<module>/<id>") was left, and whether it counts as watched. `done` is set by reaching the
 * end or by hand, and only cleared by hand; the position is kept either way, so rewatching resumes too.
 */
export const resume = {
  all: (): Resume => read<Resume>("lectern.resume", {}),
  get: (key: string): Entry | undefined => resume.all()[key],
  save(all: Resume) {
    write("lectern.resume", all);
    window.dispatchEvent(new Event(RESUME_EVENT));
  },
  /** Save a position; `done` true marks watched, undefined keeps what it was. */
  set(key: string, t: number, done?: boolean) {
    const all = resume.all();
    all[key] = { t: Math.floor(t), at: Date.now(), done: done ?? all[key]?.done };
    resume.save(all);
  },
  mark(keys: string[], done: boolean) {
    const all = resume.all();
    for (const k of keys) all[k] = { t: all[k]?.t ?? 0, at: Date.now(), done };
    resume.save(all);
  },
  /** Forget position and watched state. */
  reset(keys: string[]) {
    const all = resume.all();
    for (const k of keys) delete all[k];
    resume.save(all);
  },
};

function subscribeResume(fn: () => void) {
  window.addEventListener(RESUME_EVENT, fn);
  window.addEventListener("storage", fn);
  return () => { window.removeEventListener(RESUME_EVENT, fn); window.removeEventListener("storage", fn); };
}
function resumeSnapshot() {
  try { return localStorage.getItem("lectern.resume") ?? ""; } catch { return ""; }
}

/** All resume entries, re-rendering when any changes (here or in another tab). */
export function useResume(): Resume {
  const raw = useSyncExternalStore(subscribeResume, resumeSnapshot, resumeSnapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => resume.all(), [raw]);
}

/** "Tighten here" overrides, per recording ("<module>/<id>"). */
export const localPauses = {
  get: (key: string): LocalPause[] => read<Record<string, LocalPause[]>>("lectern.localPauses", {})[key] ?? [],
  set(key: string, local: LocalPause[]) {
    const all = read<Record<string, LocalPause[]>>("lectern.localPauses", {});
    if (local.length) all[key] = local; else delete all[key];
    write("lectern.localPauses", all);
  },
};

export type Rating = "got" | "shaky" | "redo";
export const RATING_LABEL: Record<Rating, string> = { got: "✓ Got it", shaky: "~ Shaky", redo: "✗ Redo" };
const RATINGS_EVENT = "lectern:ratings";

/** How each worked example went ("<module>/<source>/<exampleId>"), for triaging the last days of revision. */
export const ratings = {
  all: (): Record<string, Rating> => read<Record<string, Rating>>("lectern.ratings", {}),
  set(key: string, r: Rating | null) {
    const all = ratings.all();
    if (r) all[key] = r; else delete all[key];
    write("lectern.ratings", all);
    window.dispatchEvent(new Event(RATINGS_EVENT));
  },
};

function subscribeRatings(fn: () => void) {
  window.addEventListener(RATINGS_EVENT, fn);
  window.addEventListener("storage", fn);
  return () => { window.removeEventListener(RATINGS_EVENT, fn); window.removeEventListener("storage", fn); };
}
function ratingsSnapshot() {
  try { return localStorage.getItem("lectern.ratings") ?? ""; } catch { return ""; }
}
export function useRatings(): Record<string, Rating> {
  const raw = useSyncExternalStore(subscribeRatings, ratingsSnapshot, ratingsSnapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ratings.all(), [raw]);
}
