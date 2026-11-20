// Per-browser player preferences and resume positions. Everything is optional: a private window or blocked
// storage just means defaults every time.
import { useCallback, useState } from "react";
import { DEFAULT_EDIT, type EditSettings } from "../shared/edl.ts";

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
}

export const DEFAULT_PREFS: Prefs = {
  edit: DEFAULT_EDIT, rateMode: "auto", targetWpm: 250, manualRate: 1.5, subtitles: true, karaoke: true,
  subtitleSize: 1, panel: "chapters", stopAtExampleEnd: true, volume: 1,
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

type Resume = Record<string, { t: number; at: number; done?: boolean }>;

export const resume = {
  all: (): Resume => read<Resume>("lectern.resume", {}),
  get: (key: string) => resume.all()[key],
  set(key: string, t: number, done = false) {
    const all = resume.all();
    all[key] = { t: Math.floor(t), at: Date.now(), done: done || all[key]?.done };
    write("lectern.resume", all);
  },
};
