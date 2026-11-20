// Subtitle lines from word timings, using the same line-breaking rules as the skill's burned-in subtitles
// (render.py): <= 64 chars, break after sentence ends, after a comma past 40 chars, or at a pause > 0.9 s.
import type { Word } from "./types.ts";

export interface Line {
  start: number;
  end: number;
  /** index of the first word in the source's word list */
  first: number;
  words: Word[];
}

export function buildLines(words: Word[], maxChars = 64): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [], first = 0, len = 0;
  const push = () => {
    if (!cur.length) return;
    lines.push({ start: cur[0][0], end: cur[cur.length - 1][1], first, words: cur });
  };
  words.forEach((w, i) => {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const last = prev[2].slice(-1);
      const gap = w[0] - prev[1];
      if (len + w[2].length + 1 > maxChars || (gap > 0.9 && cur.length >= 3) || (".?!".includes(last) && cur.length >= 4) ||
          (len > 40 && ",;:".includes(last))) {
        push(); cur = []; len = 0;
      }
    }
    if (!cur.length) first = i;
    cur.push(w); len += w[2].length + (cur.length > 1 ? 1 : 0);
  });
  push();
  // keep a line on screen until the next one starts (max 1.2 s after its last word)
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    lines[i].end = Math.min(lines[i].end + 1.2, next ? next.start : Infinity);
  }
  return lines;
}

/** Sentence-ish paragraphs for the transcript panel. */
export function buildParagraphs(words: Word[], maxWords = 60): Line[] {
  const out: Line[] = [];
  let cur: Word[] = [], first = 0;
  words.forEach((w, i) => {
    if (!cur.length) first = i;
    cur.push(w);
    const ends = /[.?!]$/.test(w[2]);
    const gap = i + 1 < words.length ? words[i + 1][0] - w[1] : 0;
    if ((ends && cur.length >= 18) || cur.length >= maxWords || gap > 2.5) {
      out.push({ start: cur[0][0], end: cur[cur.length - 1][1], first, words: cur });
      cur = [];
    }
  });
  if (cur.length) out.push({ start: cur[0][0], end: cur[cur.length - 1][1], first, words: cur });
  return out;
}

/** Index of the word being spoken at t within a line (-1 before the first word). */
export function currentWord(line: Line, t: number): number {
  let k = -1;
  for (let i = 0; i < line.words.length; i++) if (line.words[i][0] <= t) k = i; else break;
  return k;
}
