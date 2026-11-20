// Pause trimming at a threshold the student chooses, globally or for one stretch of a recording ("tighten here").
// The pipeline's reviewed pauses (`Source.pauses`) are the default; a threshold instead trims every gap between
// words longer than it down to it, using the word timings, so it works from the library alone.
import { mergeRanges } from "./edl.ts";
import type { Range, Word } from "./types.ts";

/** Pause lengths the controls step through, loosest first (seconds of silence kept). */
export const PAUSE_LEVELS = [2, 1.5, 1, 0.75, 0.5, 0.4, 0.3, 0.2, 0.12];
/** What the pipeline's reviewed pauses come to (measured: kept time matches the 0.3 s level), for stepping from the default. */
export const REVIEWED_LEVEL = 0.3;
/** Gaps trimmed by less than this aren't worth a seek. */
const MIN_SKIP = 0.08;

export interface LocalPause {
  start: number;
  end: number;
  /** seconds of silence kept between words inside [start, end) */
  max: number;
  label?: string;
}

export interface PauseSettings {
  /** null = the pipeline's reviewed pauses */
  max: number | null;
  /** per-recording overrides; later ones win where they overlap */
  local: LocalPause[];
}

export const DEFAULT_PAUSES: PauseSettings = { max: null, local: [] };

/**
 * Skips that leave at most `max` seconds of silence in each gap between words (and before the first / after the
 * last word), restricted to [from, to). Silence is kept on both sides of the cut, more after a word than before
 * the next, so sentences don't sound clipped.
 */
export function gapPauses(words: Word[], duration: number, max: number, from = 0, to = duration): Range[] {
  const out: Range[] = [];
  const add = (a: number, b: number) => {
    const s = Math.max(a, from), e = Math.min(b, to);
    if (e - s >= MIN_SKIP) out.push([s, e]);
  };
  if (!words.length) return out;
  add(0, words[0][0] - max * 0.4);
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1][1], b = words[i][0];
    if (b - a > max) add(a + max * 0.6, b - max * 0.4);
  }
  add(words[words.length - 1][1] + max * 0.6, duration);
  return out;
}

/** `ranges` with [from, to) removed. Ranges must be sorted and non-overlapping. */
export function subtractRange(ranges: Range[], from: number, to: number): Range[] {
  const out: Range[] = [];
  for (const [a, b] of ranges) {
    if (b <= from || a >= to) { out.push([a, b]); continue; }
    if (a < from) out.push([a, from]);
    if (b > to) out.push([to, b]);
  }
  return out;
}

/** The pause skips for a recording under these settings (sorted, merged). */
export function pauseRanges(src: { words: Word[]; pauses: Range[]; duration: number }, s: PauseSettings): Range[] {
  let r = mergeRanges(s.max == null ? src.pauses.map(([a, b]): Range => [a, b]) : gapPauses(src.words, src.duration, s.max), 0);
  for (const l of s.local) {
    r = mergeRanges([...subtractRange(r, l.start, l.end), ...gapPauses(src.words, src.duration, l.max, l.start, l.end)], 0);
  }
  return r;
}

/** The pause length in force at time t (the last local override covering t, else the global one). */
export function pauseLevelAt(s: PauseSettings, t: number): number {
  for (let i = s.local.length - 1; i >= 0; i--) if (t >= s.local[i].start && t < s.local[i].end) return s.local[i].max;
  return s.max ?? REVIEWED_LEVEL;
}

/** The next tighter level below `current` (never below the tightest). */
export function tighter(current: number): number {
  return PAUSE_LEVELS.find((l) => l < current - 1e-9) ?? PAUSE_LEVELS[PAUSE_LEVELS.length - 1];
}

/** Set (or replace) the override for exactly [start, end). */
export function setLocal(local: LocalPause[], o: LocalPause): LocalPause[] {
  return [...local.filter((l) => !(Math.abs(l.start - o.start) < 0.01 && Math.abs(l.end - o.end) < 0.01)), o];
}
