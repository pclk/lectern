import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LibraryStore } from "../server/library.ts";

const store = () => new LibraryStore(fs.mkdtempSync(path.join(os.tmpdir(), "lectern-state-")));

test("mergeState stamps changes in arrival order, whatever the device clocks say", () => {
  const s = store();
  const a = s.mergeState({ resume: { "M/a": { v: { t: 10 }, at: 9e15 } } }); // a device clock far in the future
  const b = s.mergeState({ resume: { "M/a": { v: { t: 40 }, at: 1 } } }); // a later change from a slow clock
  assert.deepEqual(b.resume["M/a"].v, { t: 40 });
  assert.ok(b.resume["M/a"].at > a.resume["M/a"].at);
  assert.deepEqual(s.state().resume["M/a"].v, { t: 40 }, "persisted");
});

test("mergeState keeps removals as null and leaves other entries alone", () => {
  const s = store();
  s.mergeState({ ratings: { x: { v: "got", at: 1 }, y: { v: "redo", at: 1 } } });
  const r = s.mergeState({ ratings: { x: { v: null, at: 2 } } });
  assert.equal(r.ratings.x.v, null);
  assert.equal(r.ratings.y.v, "redo");
});

test("mergeState ignores __proto__ and other prototype keys", () => {
  const s = store();
  s.mergeState(JSON.parse('{"__proto__": {"k": {"v": 1, "at": 1}}, "resume": {"__proto__": {"v": 1, "at": 1}, "constructor": {"v": 1, "at": 1}}}'));
  assert.equal(({} as Record<string, unknown>).k, undefined);
  assert.deepEqual(Object.keys(s.state().resume ?? {}), []);
});
