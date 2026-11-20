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
