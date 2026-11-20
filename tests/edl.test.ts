import assert from "node:assert/strict";
import { test } from "node:test";
import { autoRate, mergeRanges, skipRanges, Timeline } from "../shared/edl.ts";
import { buildLines } from "../shared/subtitles.ts";
import type { Cut, Word } from "../shared/types.ts";

const cut = (start: number, end: number, category: Cut["category"] = "off-topic"): Cut => ({ start, end, reason: "x", category });

test("mergeRanges sorts, merges overlaps and drops slivers", () => {
  assert.deepEqual(mergeRanges([[5, 6], [1, 3], [2, 4], [8, 8.01]]), [[1, 4], [5, 6]]);
});

test("mergeRanges merges before dropping slivers, and joins near-adjacent ranges", () => {
  // a 0.01 s range bridging two others must still join them
  assert.deepEqual(mergeRanges([[10, 20], [20, 20.01], [20.01, 30]]), [[10, 30]]);
  assert.deepEqual(mergeRanges([[0, 1], [1.1, 2], [3, 4]], 0.02, 0.15), [[0, 2], [3, 4]]);
  assert.deepEqual(mergeRanges([[0, 1], [1.2, 2]], 0.02, 0.15), [[0, 1], [1.2, 2]]);
});

test("skipRanges joins skips separated by a sliver of kept time", () => {
  const src = { duration: 100, cuts: [cut(10, 20)], pauses: [[20.1, 21]] as [number, number][] };
  assert.deepEqual(skipRanges(src, { skipCuts: true, keepCategories: [], keepCuts: [], skipPauses: true }), [[10, 21]]);
});

test("skipRanges honours toggles, kept categories and kept cuts", () => {
  const src = { duration: 100, cuts: [cut(10, 20), cut(50, 60, "admin")], pauses: [[30, 31], [70, 72]] as [number, number][] };
  const base = { skipCuts: true, keepCategories: [], keepCuts: [], skipPauses: true };
  assert.deepEqual(skipRanges(src, base), [[10, 20], [30, 31], [50, 60], [70, 72]]);
  assert.deepEqual(skipRanges(src, { ...base, skipCuts: false }), [[30, 31], [70, 72]]);
  assert.deepEqual(skipRanges(src, { ...base, keepCategories: ["admin"] }), [[10, 20], [30, 31], [70, 72]]);
  assert.deepEqual(skipRanges(src, { ...base, keepCuts: [0], skipPauses: false }), [[50, 60]]);
});

test("Timeline maps source <-> virtual time around skips", () => {
  const tl = new Timeline([[10, 20], [30, 35]], 100);
  assert.equal(tl.virtualDuration, 85);
  assert.equal(tl.toVirtual(5), 5);
  assert.equal(tl.toVirtual(15), 10); // inside a skip clamps to its start
  assert.equal(tl.toVirtual(25), 15);
  assert.equal(tl.toVirtual(40), 25);
  for (const v of [0, 5, 10, 14.9, 15, 20, 50, 85]) assert.ok(Math.abs(tl.toVirtual(tl.toSource(v)) - v) < 1e-9, `round trip ${v}`);
  assert.equal(tl.toSource(10), 20);
  assert.deepEqual(tl.skipAt(12), [10, 20]);
  assert.equal(tl.skipAt(20), null);
  assert.equal(tl.snap(32), 35);
  assert.equal(tl.snap(36), 36);
});

test("autoRate targets kept speech wpm within bounds", () => {
  // 120 words over 60 s = 120 wpm
  const words: Word[] = Array.from({ length: 120 }, (_, i) => [i * 0.5, i * 0.5 + 0.4, "w"]);
  const tl = new Timeline([], 60);
  assert.equal(autoRate(words, tl, 240), 2);
  assert.equal(autoRate(words, tl, 1000), 3);
});

test("buildLines breaks long runs and sentence ends", () => {
  const words: Word[] = "This is the first sentence here. And then a second one follows on.".split(" ").map((w, i) => [i, i + 0.8, w]);
  const lines = buildLines(words);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].words.at(-1)![2], "here.");
  assert.ok(lines[0].end <= lines[1].start);
});

test("outside and examples-only mode keep just the worked examples", async () => {
  const { outside } = await import("../shared/edl.ts");
  assert.deepEqual(outside([[10, 20], [15, 30], [50, 60]], 100), [[0, 10], [30, 50], [60, 100]]);
  assert.deepEqual(outside([], 5), [[0, 5]]);
  const ex = (start: number, end: number) => ({ id: "x", label: "x", ref: null, kind: "k", start, end });
  const src = { duration: 100, cuts: [cut(12, 14)], pauses: [] as [number, number][], examples: [ex(10, 20), ex(40, 50)] };
  const s = { skipCuts: true, keepCategories: [], keepCuts: [], skipPauses: true, examplesOnly: true };
  assert.deepEqual(skipRanges(src, s), [[0, 10], [12, 14], [20, 40], [50, 100]]);
  assert.equal(new Timeline(skipRanges(src, s), 100).virtualDuration, 18);
  // no examples indexed: nothing extra is skipped
  assert.deepEqual(skipRanges({ ...src, examples: [] }, s), [[12, 14]]);
});
