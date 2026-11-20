# Lectern overnight roadmap

From three brainstorms in run 1 (student revising, QA attack on the player, padSync + iPad). Ordered by priority
within each run. `[x]` = shipped (commit in LOG.md). Effort: S < 20 min, M < 1 h.

## Run 1 (04:20)
- [x] **Feature 1: adjustable pause trimming**: global "keep at most X s of each pause", plus ⏩ Tighten / `t` to trim the current chapter harder (shift+`t` undoes), per recording, editable in Edits. Auto speed now comes from the default edit, so trimming shortens the lecture.
- [x] Second link into the same recording didn't seek (padSync chips, search hits, `lectern:open`). (QA 3 / padSync 1)
- [x] Server: `createReadStream().pipe()` leaks file handles on aborted range requests, and crashes on a stream error → `pipeline`. (QA 4)
- [x] Server: `..` passes the name check (`/media/..%2Fx`); also check that the resolved path stays inside the library. (QA 12)
- [x] Server: one corrupt `module.json` / source JSON stops startup or crashes pages → skip bad files, fill missing arrays. (QA 10, server half)
- [x] `?t=abc` / `lectern:seek NaN` sets `currentTime = NaN` and breaks the player → accept finite numbers only. (QA 5)

## Run 2 (04:45): features 2 + 4, then
- [x] **Feature 2: next/previous recording** in watch order, plus optional autoplay of the next one at the end (keys `N`/`P`?; buttons by the title; "Up next" card at the end).
- [x] **Feature 4: mark watched/unwatched, reset progress**, per recording (player + module list) and per module. Also fixes "watched never clears": `resume.set` ORs `done` forever (QA 15).
- [x] Unmount doesn't save the position: `save()` reads `video.current` after React has cleared it → capture `v` in the effect. (QA 8)
- [x] Embed flag lost when navigating inside Lectern (Library links drop `embed=1`) → decide embed once (`embed=1` or `window.self !== window.top`) and keep it. (padSync 3)
- [x] `lectern:ready` posted to the parent once listeners are attached; `lectern:state` also on play/pause changes and on leaving the player (`null`); add a host-free `path` and `v: 1`. (padSync 2, 5 / QA 11)
- [x] **Loop example** (⟲ on the example banner, `r`). (student 1, S)
- [x] **"Say that again"** (`a`): back to the start of the current subtitle line at 1×, then resume speed. (student 2, S)
- [x] **Keyboard help overlay** on `?`, replacing the key list at the bottom of Edits. (student 3, S)
- [x] **"Explain this moment"** (`x` / 🤖): copy a Claude prompt with module, lecture, chapter, current example and ±60 s of transcript, plus the link. (student 4, S)

## Run 3 (05:10): feature 3, then
- [ ] **Feature 3: quality tiers** (started early in run 2: `make_proxies.py --tier H` done and the 540p encode is running in the background, log `~/Lectern/tier540.log`; server + player selector still to do) (`make_proxies.py --tier 360/540`, background generation under `nice -n 19 -j 1`, server `/media/<m>/<id>.mp4?q=540` or `media/<tier>/`, player selector remembered, fallback when a tier is missing).
- [ ] Autoplay blocked in the padSync iframe/Safari fails silently → on `NotAllowedError` show "Tap to play · L04 10:03" with the banner. (padSync 9)
- [ ] **Examples-only mode**: skip everything outside worked examples (`EditSettings.examplesOnly` in `skipRanges`), with tests. (student 5, M)
- [ ] **Rate examples** ✓ Got it / ~ Shaky / ✗ Redo on the banner and the Examples rows; module page filter "Redo + Shaky". (student 6, M)
- [ ] **Time left per module** at your speed on module cards. (student 8, S)
- [ ] **Picture-in-picture** (`i`). (student 12, S)
- [ ] Stretch: **progress stored on the Mac** (`GET/PUT /api/state` in `<library>/.lectern-state.json`) so the Mac, `mac.local` and the iPad share resume/watched/ratings. (student 9 / padSync 13, M)
- [ ] Stretch: **`--https`** with a local cert (mkcert) so the iPad's https padSync can embed Lectern (mixed content blocks it today); `--lan` prints the Bonjour name and LAN IPs. (padSync 6, 7, M)

## Run 4 (05:35): hardening (the first three were done early in run 1)
- [x] Skips and the example auto-stop stop in background tabs (rAF is paused, audio isn't) → also check on `timeupdate` / a timer to the next skip. (QA 1, high)
- [x] `history.replaceState` on every `t` change while paused/scrubbing → Safari SecurityError (~100 calls) → white screen. Debounce, try/catch. (QA 2, high)
- [x] "Pause when the example ends" missed when the end falls inside a skip, or at 3× with a throttled frame → detect crossing `tl.snap(focus.end)`. (QA 6)
- [ ] Possible re-seek loop at a skip boundary when the browser lands just before `r[1]` → seek to `r[1] + 0.05` / remember last target. (QA 7)
- [ ] Very short skips cost a seek each (audible glitch), worse at tight pause levels (0.2 / 0.12 s) → merge before filtering, minimum skip ~0.15–0.25 s, test on WebKit. (QA 19)
- [ ] Missing video = black box with no message → `onError` state; show the play button when the video can't play yet. (QA 9)
- [ ] React error boundary + defaults for missing arrays on the client. (QA 10, client half)
- [ ] Reloading a paused page autoplays (its own `?t=`) → autoplay only for `?e=` or an explicit play flag. (QA 14)
- [ ] Re-render cost: memoise transcript search and `keptWpm`; one click handler on the transcript container. (QA 13)
- [ ] Keyboard: don't ignore keys when a checkbox/radio has focus; blur buttons after click; effect deps. (QA 17)
- [ ] Seek bar stuck dragging after `pointercancel` (iPad gestures). (QA 18)
- [ ] Fullscreen: `webkitEnterFullscreen` fallback on iPhone; no `f`/double-click fullscreen in embed; set `defaultPlaybackRate` too. (QA 16)
- [ ] postMessage: accept only from `window.parent`/`opener`, post to the parent's origin (`ancestorOrigins`/referrer) instead of `"*"`. (QA 20 / padSync 4)
- [ ] Self-review of the night's diff, tests for new pure logic, README + SKILL.md, WebKit smoke test.

## padSync changes to write up (for the student; not done tonight)
- LecternPanel: mark loaded only on `lectern:ready`; reset on address change; queue a pending open; fall back to remounting if no `lectern:state` within ~1.5 s. (padSync 2)
- "Open ↗": `window.open(url, "lectern")` and keep the handle so later chips drive the same tab (Split View). (padSync 10)
- Insert a "clip this moment" chip into the notebook from `lectern:clip`. (padSync 11)
- Send `lectern:context {links}` on page change so Lectern can highlight that page's examples. (padSync 12)
- Footer play / ±10 s buttons; Pencil double-tap → `lectern:toggle`. (padSync 14)
- Check `e.source === frame.contentWindow` on messages. (padSync 4)

## Later (not tonight)
- Bookmarks with notes (`m`), a Marks tab, ticks on the seek bar. (student 10)
- Spaced-repetition "due today" queue on top of ratings. (student 11)
- Quiz-me mode (pause before the answer; needs an `answerAt` per example for precision). (student 7)
- Export marks/ratings as Markdown. (student 13)
- Per-example watched ticks. (student 14)
- Shared-library access token for `--lan` on public Wi-Fi. (padSync 8)
- Transcript virtualisation for very long lectures. (QA 13)
