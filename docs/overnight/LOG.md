# Lectern overnight log

## Run 1: 04:20–04:26
Shipped (all on main, tests 11/11, typecheck + build clean, server restarted):
- `411870a` **Feature 1: adjustable pause trimming.** `shared/pauses.ts` (+ `tests/pauses.test.ts`). Edits tab: "Keep at most [reviewed | 2 … 0.12] s of each pause" (prefs `pauseMax`), derived from word gaps so it needs only the library. ⏩ Tighten / `t` trims the current chapter one level harder (±2 min without chapters), shift+`t` undoes, overrides listed/editable in Edits, stored per recording (`lectern.localPauses`). Auto speed now comes from the *default* edit (`baseTl`), so trimming shortens the lecture instead of slowing speech. Measured: the reviewed pauses ≈ the 0.3 s level (cs06: 69.1 min kept vs 69.3 at 0.3 s), so the first Tighten goes to 0.2 s.
- `177c656` A second link into the same recording (another chip, `lectern:open`) now seeks and focuses the example (verified in Chromium: 700 s → 2001 s).
- `fb353a4` Server hardening: `stream.pipeline` (fd leak on aborted ranges / crash on stream error), no leading-dot names + resolved-path check (verified `..` → 404), corrupt module/source JSON skipped and logged (verified with a broken library), non-finite `?t=`/`lectern:seek` ignored.
- (this commit) Background-tab skips via a `timeupdate` fallback (verified: rAF disabled, a 5 min break cut still skipped), example auto-stop compares with `tl.snap(end)` and scales its window by rate, URL `?t=` sync debounced 600 ms with try/catch.
- ROADMAP.md written from the three brainstorms (student / QA / padSync+iPad); owner runs assigned.

Notes for later runs:
- **Playwright's Chrome for Testing *does* decode these H.264 proxies** (the video played headless), so real playback checks work without WebKit. playwright-core is installed at
  `/private/tmp/claude-501/-Users-weiheng--t3-scratch-2026-11-20-users-weiheng-notes-course-material-8234e2ca/e5274395-717f-47c1-bccc-296c60a24c22/scratchpad/pw`; launch with
  `executablePath: ~/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` and `--autoplay-policy=no-user-gesture-required`. Example scripts beside it: `shot.mjs`, `nav.mjs`, `bg.mjs`.
- Tight pause levels (0.2/0.12 s) mean a seek every few words; check smoothness in run 4 (ROADMAP QA 19).

## Run 2: 04:45–04:51
Shipped (all on main, tests 11/11, typecheck + build clean, server restarted; each verified in Chrome for Testing with real playback, no page errors):
- `9b0f205` **Feature 2: next/previous recording** (⇤ ⇥, shift+P / shift+N) in watch order (module.json order). At the end an **Up next** card counts down 8 s and plays the next recording (autoplay toggle on the card, pref `autoNext`, default on), with Replay; last recording says so. Verified: clip ended → card → autoplayed ma_c3_02, embed kept; shift+P back.
  **Feature 4: watched state**: ✓/○ Watched in the player controls; ✓/○ and ↺ reset per row on the module page; Mark all watched / unwatched / Reset progress (confirm) per module. `done` is now set by reaching 95% or by hand and only cleared by hand; the position is kept, and a recording opened from its end restarts at 0 (so a half-done rewatch resumes). Lists re-render live via `useResume()` (useSyncExternalStore + storage events). Verified 1→70→69→0 of 70.
  Also fixed: position saved on unmount (ref captured, QA 8); embed decided once at startup (`?embed=1` or framed) so it survives in-app navigation (padSync 3). Bug found while testing: our own end-of-video seek fired `seeking` and hid the Up next card; only seeks away from the end clear it now.
- `ceff8e5` **Loop example** (r / ⟲ on the banner, pref `loopExample`; verified it jumps back to the start), **say that again** (a / ↶ Again: current line at 1×, then back; verified 1.5 → 1 → 1.5), **explain this moment** (x / 🤖 copies a Claude prompt with module, lecture, chapter, example, ±60 s of transcript, link; verified clipboard), **? key help overlay**, padSync messages: `lectern:ready`, `lectern:state` on play/pause changes with `path` and `v: 1`, `lectern:idle` on leaving the player (verified from an iframe host). Existing message fields unchanged, so the current padSync keeps working.
- (this commit) Feature 3 started early: `make_proxies.py --tier H [--threads N]` writes `media/<H>p/<id>.mp4` from the existing proxy (identical duration, verified 352.57 s both), never touching the proxy. **Background job running**: `nice -n 19 make_proxies.py ~/Lectern/library --tier 540 -j 1 --threads 2` from the vidwork dir, log `~/Lectern/tier540.log` (check with `pgrep -fl "tier 540"`, `ls ~/Lectern/library/*/media/540p | wc -l`); ~76× realtime on a short clip, so roughly 40–60 min for all 83. Run 3: server route + player selector + fallback.

Left for later runs: everything in ROADMAP Run 3/4. Note the controls bar is getting crowded (wraps on narrow windows); run 4 could group secondary buttons into a ⋯ menu.

## Run 3: 05:10–05:16
Shipped (all on main, tests 12/12, typecheck + build clean, server restarted; each verified in Chrome for Testing, no page errors):
- `cae3a9d` **Feature 3: quality tiers.** `/media/<m>/<id>.mp4?q=540` serves `media/540p/<id>.mp4` or falls back to the proxy; `/api/source` adds `tiers` (heights available). Player menu "Full quality / 540p" (pref `quality`), hidden when a recording has no tier and none is chosen; switching keeps position + play state (verified 901.4 → 901.5 s, still playing, videoHeight 640 → 540); a recording without the tier plays full quality and the menu says "(not made yet)". `make_proxies.py --tier` landed in run 2.
- `e138162` **Examples-only mode** (o / 🎯, `EditSettings.examplesOnly`, `outside()` in shared/edl.ts + test; cs06 1:09:03 → 47:32), **example ratings** ✓/~/✗ (Examples tab + a prompt when a linked example ends; module example list filters "Redo + Shaky" / not rated / each, with badges; store `lectern.ratings` + `useRatings()`), **time left per module** at your wpm on the home cards, **picture in picture** (i / ⧉, Safari presentation-mode fallback), **"Tap to play"** when autoplay is refused (verified with a gesture-required autoplay policy).
- `5f99a8b` Stretch: **progress kept on the Mac**: `GET/PUT /api/state` → `<library>/.lectern-state.json` ({store: {key: {v, at}}}, newer wins, removals as null); `web/sync.ts` pulls first (server wins for entries both have), pushes diffs debounced 1.5 s, commits only after a successful PUT, pulls on focus/visibility/60 s. Covers resume/watched, ratings, pause overrides. Verified with two separate browser profiles (watched + rating appeared on B; B's unmark reached A on focus). Test state file removed afterwards.
- `aef26ed` Stretch: **`--https`** (`npm run start:lan:https`; cert/key default `~/Lectern/certs/lectern{,-key}.pem`, clear error if missing; verified with a throwaway self-signed cert) and `--lan` prints the Bonjour name (`scutil --get LocalHostName`) + LAN IPs. README "iPad" section with the mkcert steps. No certificate was created or trusted (that changes the system trust store: the student's call).

**Background job** (started in run 2): `nice -n 19 python3 skill/lecture-exam-prep/scripts/make_proxies.py ~/Lectern/library --tier 540 -j 1 --threads 2` run from the vidwork dir. Progress: 36/83 at 05:16. Check: `pgrep -fl "tier 540"`, `tail ~/Lectern/tier540.log`, `ls ~/Lectern/library/*/media/540p | wc -l`. Safe to stop (`pkill -f "tier 540"`) and resume later; finished files are skipped and partial ones are written as `.tmp.mp4` first. New tiers show up without a restart (the source API checks the disk).

For run 4: everything under "Run 4" in ROADMAP. New surface to review: sync.ts merge logic, the /api/state PUT (no auth; with --lan anyone on the Wi-Fi can write progress: low risk, note it), quality switching, the rating banner. The controls bar now wraps on narrow windows: consider a ⋯ menu.

## Run 4: 05:35–05:45 (hardening) and the night's summary
Run 4 commits:
- `b4bcc8e` QA list:
  - **skips:** re-seek loop guard; ranges merged before slivers are dropped; skips < 0.15 s apart joined; pause cuts < 0.15 s skipped;
  - **errors:** missing-video message + Try again; error boundary;
  - **playback:** reloading a page paused at its own `?t=` doesn't autoplay; iPhone fullscreen fallback, no double-click fullscreen in embed, `defaultPlaybackRate`;
  - **input:** shortcuts work after ticking a checkbox; focused buttons blurred; seek bar `pointercancel` / lost capture;
  - **embedding:** postMessage only from the host/opener, replies to its origin (`web/host.ts`);
  - **speed:** memoised transcript search and kept-wpm.
- `bba271a` fixes from an independent review of the whole night's diff (11 findings, all confirmed):
  - **sync:**
    - the server stamps changes in arrival order (device clocks never compared);
    - pulls don't overwrite unpushed local changes;
    - synced bookkeeping persisted and shared across tabs;
    - keepalive push on hide/close;
    - `__proto__` keys refused; 413 for huge PUTs.
  - **player:**
    - only real moves are saved (an idle tab no longer overwrites another device's progress);
    - watched is set on crossing 95% (unmarking sticks);
    - pause overrides follow sync;
    - an example ending inside a skip still loops / prompts before Up next;
    - stale rating prompt cleared;
    - no pending quality carry.
  - **tests:** `tests/state.test.ts`.
- (this commit) README feature list and SKILL.md Phase 6 updated (tiers, https, the player's controls, shared progress); skill zip rebuilt.

**Verification.** Same smoke script in Chromium (Chrome for Testing) and **WebKit 27.2** (installed tonight with `npx playwright-core install webkit`, so Safari's engine). Both pass with no page errors:
- the 5 min break cut was skipped during real playback;
- keys work after ticking a checkbox;
- a reload stays paused;
- 0.12 s pauses advance with no seek loop;
- the missing-video message shows;
- an iframe host gets `ready`/`state`, its `lectern:seek` works, and a message from elsewhere is ignored.

Two-profile sync test:
- Mac 108 s → iPad 255 s;
- the idle Mac tab didn't overwrite it over two save cycles;
- the Mac's copy followed on focus;
- a rating carried across.

Test state files were deleted afterwards. 17/17 unit tests, typecheck and build clean, server restarted on :4747 (http, `127.0.0.1`).

### The night in one list
Shipped (all on `main`):
1. **Adjustable pause trimming**: global level + ⏩ Tighten / `t` per chapter, remembered per recording.
2. **Next/previous recording** + Up next autoplay.
3. **Quality tiers**: `make_proxies.py --tier`, `?q=`, a player menu with fallback. **All 83 recordings have 540p copies** (the background job finished).
4. **Watched/unwatched/reset** per recording and module.

Plus:
- example tools: loop, examples-only mode, ratings with the "Redo + Shaky" filter;
- playback: say-that-again at 1×, explain-this-moment prompt, `?` help, time left per module, PiP, tap-to-play;
- **progress shared across devices** through the server;
- **`--https`** for the iPad;
- the hardening above.

Open / known issues:
- **Not checked by ear:** whether 0.12–0.2 s pause trimming sounds smooth. It now skips cuts under 0.15 s and joins near-adjacent ones, but each remaining pause is still a seek.
- **Layout:** the controls bar wraps on narrow windows (⋯ menu in ROADMAP "Later").
- **Network mode:** with `--lan`, anyone on the same Wi-Fi can read the library and write progress (no auth).
- **WebKit noise:** WebKit logs cancelled `/api/state` fetches during navigation as errors (harmless, caught).
- **iPad https:** needs the student to run the mkcert steps in the README. Nothing was installed or trusted on their behalf.
- **Not done:** the one-click-handler / virtualised transcript.

padSync needs (not changed tonight; details in ROADMAP "padSync changes to write up"):
1. **LecternPanel readiness:** treat the iframe as ready only on `lectern:ready` (not `onLoad`). Reset that on an address change, queue a pending open, and fall back to remounting if no `lectern:state` arrives.
2. **Message source check:** check `e.source === frame.contentWindow`. Lectern now also only accepts messages from its parent/opener, so padSync's existing `lectern:open` still works.
3. **Open ↗:** use `window.open(url, "lectern")` and keep the handle, so later chips drive the same tab in Split View.
4. **Optional:**
   - handle `lectern:idle` (clear the footer);
   - use `path` from `lectern:state` instead of rebuilding the URL;
   - add footer play / ±10 s buttons.

No change in padSync is *required*: the message fields it reads are unchanged.
