// Edit decision list: which stretches of a recording to skip under the current settings, and the mapping between
// source time and the condensed ("virtual") timeline the player shows. Pure functions; tested in tests/edl.test.ts.
import type { Cut, CutCategory, Range, Source, Word } from "./types.ts";

export interface EditSettings {
  /** Skip semantic cuts (admin, breaks, off-topic, non-examinable...). */
  skipCuts: boolean;
  /** Cut categories the user chose to keep even when skipCuts is on. */
  keepCategories: CutCategory[];
  /** Individual cuts (by index) the user switched back on. */
  keepCuts: number[];
  skipPauses: boolean;
  /** Skip everything outside the worked examples (a last pass over exam-style problems). */
  examplesOnly?: boolean;
}

export const DEFAULT_EDIT: EditSettings = { skipCuts: true, keepCategories: [], keepCuts: [], skipPauses: true };

/**
 * Sort and merge, joining ranges less than `joinGap` apart (a sliver of kept time between two skips is a second
 * seek for nothing), then drop what's still shorter than `minLen`. Merging first means a tiny range that bridges
 * two others still joins them.
 */
export function mergeRanges(ranges: Range[], minLen = 0.02, joinGap = 0): Range[] {
  const sorted = ranges.filter(([a, b]) => b > a).map(([a, b]): Range => [a, b]).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + joinGap + 1e-6) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.filter(([a, b]) => b - a >= minLen);
}

export function activeCuts(cuts: Cut[], s: EditSettings): Cut[] {
  if (!s.skipCuts) return [];
  return cuts.filter((c, i) => !s.keepCategories.includes(c.category) && !s.keepCuts.includes(i));
}

/** `pauses` defaults to the pipeline's reviewed pauses; shared/pauses.ts derives others from a threshold. */
export function skipRanges(src: Pick<Source, "cuts" | "pauses" | "duration"> & { examples?: Source["examples"] }, s: EditSettings,
  pauses: Range[] = src.pauses): Range[] {
  const r: Range[] = activeCuts(src.cuts, s).map((c) => [c.start, c.end]);
  if (s.examplesOnly && src.examples?.length) r.push(...outside(src.examples.map((e): Range => [e.start, e.end]), src.duration));
  if (s.skipPauses) r.push(...pauses.map(([a, b]): Range => [a, b]));
  // every skip is a seek: don't keep a sliver shorter than 0.15 s between two of them
  return mergeRanges(r.map(([a, b]): Range => [Math.max(0, a), Math.min(src.duration, b)]), 0.02, 0.15);
}

/** The parts of [0, duration) not covered by `ranges`. */
export function outside(ranges: Range[], duration: number): Range[] {
  const out: Range[] = [];
  let t = 0;
  for (const [a, b] of mergeRanges(ranges, 0)) {
    if (a > t) out.push([t, a]);
    t = Math.max(t, b);
  }
  if (t < duration) out.push([t, duration]);
  return out;
}

/** Index of the last range starting at or before t (-1 if none). */
function floorIndex(ranges: Range[], t: number): number {
  let lo = 0, hi = ranges.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][0] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export class Timeline {
  readonly skips: Range[];
  readonly duration: number;
  /** cumulative skipped seconds before skips[i] */
  private readonly before: number[];
  readonly virtualDuration: number;

  constructor(skips: Range[], duration: number) {
    this.skips = skips;
    this.duration = duration;
    this.before = [];
    let acc = 0;
    for (const [a, b] of skips) { this.before.push(acc); acc += b - a; }
    this.virtualDuration = Math.max(0, duration - acc);
  }

  /** The skip range containing t, if any. */
  skipAt(t: number): Range | null {
    const i = floorIndex(this.skips, t);
    return i >= 0 && t < this.skips[i][1] ? this.skips[i] : null;
  }

  /** First kept time at or after t. */
  snap(t: number): number {
    const r = this.skipAt(t);
    return r ? Math.min(r[1], this.duration) : t;
  }

  toVirtual(t: number): number {
    const i = floorIndex(this.skips, t);
    if (i < 0) return t;
    const [a, b] = this.skips[i];
    return t < b ? a - this.before[i] : t - this.before[i] - (b - a);
  }

  toSource(v: number): number {
    // binary search on the virtual start of each kept stretch
    let lo = 0, hi = this.skips.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.skips[mid][0] - this.before[mid] <= v) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans < 0) return Math.max(0, v);
    const [a, b] = this.skips[ans];
    const vStart = a - this.before[ans];
    return Math.min(this.duration, b + (v - vStart));
  }

  keptSeconds(from: number, to: number): number {
    return Math.max(0, this.toVirtual(to) - this.toVirtual(from));
  }
}

/** Words per minute of speech that survives the skips (counts only words whose midpoint is kept). */
export function keptWpm(words: Word[], tl: Timeline): number {
  let n = 0;
  for (const w of words) if (!tl.skipAt((w[0] + w[1]) / 2)) n++;
  return tl.virtualDuration > 0 ? (n / tl.virtualDuration) * 60 : 0;
}

export function autoRate(words: Word[], tl: Timeline, targetWpm: number): number {
  const wpm = keptWpm(words, tl);
  if (!wpm) return 1;
  return Math.round(Math.min(3, Math.max(0.75, targetWpm / wpm)) * 100) / 100;
}

export function fmt(t: number): string {
  t = Math.max(0, Math.floor(t));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`;
}

/** Latest item whose start <= t (items sorted by start). */
export function atTime<T extends { start: number }>(items: T[], t: number): number {
  let lo = 0, hi = items.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** An example's label without its ref repeated in front ("Tutorial 2.17 — max-area…" → "max-area…"), for showing
 * next to the ref. */
export function exampleTitle(e: { ref: string | null; label: string }): string {
  if (!e.ref || !e.label.startsWith(e.ref)) return e.label;
  return e.label.slice(e.ref.length).replace(/^\s*[—–:-]\s*/, "").trim() || e.label;
}
