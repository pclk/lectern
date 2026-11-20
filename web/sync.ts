// Keeps resume points, watched marks, example ratings and pause overrides in step across browsers and devices
// (the Mac, the iPad, padSync's embedded player) through the Lectern server (`/api/state`). Each entry carries the
// time it last changed; the newer change wins, and removals travel as `null`. localStorage stays the working copy,
// so everything still works offline or against an older server.
const STORES = { resume: "lectern.resume", ratings: "lectern.ratings", local: "lectern.localPauses" } as const;
const EVENTS: Record<Store, string> = { resume: "lectern:resume", ratings: "lectern:ratings", local: "lectern:localPauses" };
type Store = keyof typeof STORES;
type Entry = { v: unknown; at: number };
type State = Partial<Record<Store, Record<string, Entry>>>;

const map = (s: Store): Record<string, unknown> => {
  try { return JSON.parse(localStorage.getItem(STORES[s]) ?? "{}") as Record<string, unknown>; } catch { return {}; }
};
/** What each entry looked like when last in step with the server (JSON), and when it changed. */
let known: Record<Store, Record<string, string>> = { resume: {}, ratings: {}, local: {} };
let stamps: Record<Store, Record<string, number>> = { resume: {}, ratings: {}, local: {} };
let started = false, timer = 0, applying = false;

function apply(state: State) {
  applying = true;
  for (const s of Object.keys(STORES) as Store[]) {
    const entries = state[s] ?? {};
    const cur = map(s);
    let changed = false;
    for (const [k, e] of Object.entries(entries)) {
      if (e.at <= (stamps[s][k] ?? 0)) continue;
      stamps[s][k] = e.at;
      if (e.v == null) delete cur[k]; else cur[k] = e.v;
      known[s][k] = JSON.stringify(e.v ?? null);
      changed = true;
    }
    if (changed) {
      try { localStorage.setItem(STORES[s], JSON.stringify(cur)); } catch { /* storage full or blocked */ }
      window.dispatchEvent(new Event(EVENTS[s]));
    }
  }
  try { localStorage.setItem("lectern.syncStamps", JSON.stringify(stamps)); } catch { /* ignore */ }
  applying = false;
}

async function pull() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (r.ok) apply(await r.json() as State);
  } catch { /* offline: keep working locally */ }
}

async function push() {
  const patch: State = {};
  const now = Date.now();
  for (const s of Object.keys(STORES) as Store[]) {
    const cur = map(s);
    for (const k of new Set([...Object.keys(cur), ...Object.keys(known[s])])) {
      const j = JSON.stringify(cur[k] ?? null);
      if (j === (known[s][k] ?? "null")) continue;
      (patch[s] ??= {})[k] = { v: cur[k] ?? null, at: now };
    }
  }
  if (!Object.keys(patch).length) return;
  try {
    const r = await fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (!r.ok) return;
    // only now is it in step: a failed push leaves the diff in place for the next try
    for (const s of Object.keys(patch) as Store[]) for (const [k, e] of Object.entries(patch[s]!)) {
      stamps[s][k] = e.at;
      known[s][k] = JSON.stringify(e.v ?? null);
    }
    apply(await r.json() as State);
  } catch { /* offline: the next change, focus or pull tries again */ }
}

const schedule = () => { if (applying) return; clearTimeout(timer); timer = window.setTimeout(() => void push(), 1500); };

/** Start syncing: pull first (so this device can't overwrite newer progress from another), then push what's new. */
export function startSync() {
  if (started) return;
  started = true;
  try { stamps = { ...stamps, ...JSON.parse(localStorage.getItem("lectern.syncStamps") ?? "{}") }; } catch { /* fresh */ }
  void pull().then(() => {
    // entries never synced: mark them as already known unless the server lacks them, then push the rest
    for (const s of Object.keys(STORES) as Store[]) for (const k of Object.keys(stamps[s])) known[s][k] ??= JSON.stringify(map(s)[k] ?? null);
    void push();
  });
  for (const s of Object.keys(STORES) as Store[]) window.addEventListener(EVENTS[s], schedule);
  window.addEventListener("focus", () => void pull().then(() => push()));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void pull(); else void push(); });
  window.setInterval(() => void pull(), 60_000);
}
