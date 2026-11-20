import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PAUSES, gapPauses, pauseLevelAt, pauseRanges, REVIEWED_LEVEL, setLocal, subtractRange, tighter } from "../shared/pauses.ts";
import type { Range, Word } from "../shared/types.ts";

// words at 1–2, 2.1–3, 5–6 (a 2 s gap), 6.05–7; recording 10 s long
const words: Word[] = [[1, 2, "a"], [2.1, 3, "b"], [5, 6, "c"], [6.05, 7, "d"]];
const src = { words, duration: 10, pauses: [[3.5, 4.5]] as Range[] };
const near = (a: Range[], b: Range[]) => a.length === b.length && a.every(([x, y], i) => Math.abs(x - b[i][0]) < 1e-9 && Math.abs(y - b[i][1]) < 1e-9);

test("gapPauses trims gaps, lead-in and tail down to max, split 60/40 around the gap", () => {
  const r = gapPauses(words, 10, 0.5);
  assert.ok(near(r, [[0, 0.8], [3.3, 4.8], [7.3, 10]]), JSON.stringify(r));
  // gaps of 0.1 s and 0.05 s are under the threshold; nothing below MIN_SKIP is emitted
  assert.ok(near(gapPauses(words, 10, 1.9), [[0, 0.24], [4.14, 4.24], [8.14, 10]]), JSON.stringify(gapPauses(words, 10, 1.9)));
});

test("gapPauses clips to a window", () => {
  assert.ok(near(gapPauses(words, 10, 0.5, 4, 8), [[4, 4.8], [7.3, 8]]));
  assert.deepEqual(gapPauses([], 10, 0.5), []);
});

test("subtractRange cuts a hole", () => {
  assert.deepEqual(subtractRange([[0, 2], [3, 5], [6, 8]], 1, 7), [[0, 1], [7, 8]]);
  assert.deepEqual(subtractRange([[0, 2]], 3, 4), [[0, 2]]);
});

test("pauseRanges: reviewed by default, threshold globally, local overrides win inside their range", () => {
  assert.deepEqual(pauseRanges(src, DEFAULT_PAUSES), [[3.5, 4.5]]);
  assert.ok(near(pauseRanges(src, { max: 0.5, local: [] }), [[0, 0.8], [3.3, 4.8], [7.3, 10]]));
  // tighten 4–8 to 0.2 s: reviewed pause outside stays (clipped at 4), gaps inside trimmed hard
  const r = pauseRanges(src, { max: null, local: [{ start: 4, end: 8, max: 0.2 }] });
  assert.ok(near(r, [[3.5, 4.92], [7.12, 8]]), JSON.stringify(r));
});

test("pauseLevelAt and tighter step through levels", () => {
  const s = { max: 1, local: [{ start: 0, end: 5, max: 0.3 }, { start: 2, end: 3, max: 0.2 }] };
  assert.equal(pauseLevelAt(s, 2.5), 0.2);
  assert.equal(pauseLevelAt(s, 4), 0.3);
  assert.equal(pauseLevelAt(s, 6), 1);
  assert.equal(pauseLevelAt(DEFAULT_PAUSES, 6), REVIEWED_LEVEL);
  assert.equal(tighter(REVIEWED_LEVEL), 0.2);
  assert.equal(tighter(0.4), 0.3);
  assert.equal(tighter(0.12), 0.12);
});

test("setLocal replaces an override for the same range", () => {
  const a = setLocal([], { start: 0, end: 5, max: 0.3 });
  const b = setLocal(a, { start: 0, end: 5, max: 0.2 });
  assert.equal(b.length, 1);
  assert.equal(b[0].max, 0.2);
});
