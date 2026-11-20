# Lectern overnight improvement: plan (2026-11-21, 04:20–06:00 SGT)

Shared spec for four scheduled runs. Each run starts cold: read this file, `ROADMAP.md` and `LOG.md` (this folder), and
the repo README, before touching code. Append to `LOG.md` when you finish (time, what shipped, what's left, problems).

## Goal
Make Lectern (this repo: local lecture player + the `skill/lecture-exam-prep` skill) more capable and harder to break,
for a student who starts using it for finals in a few hours. Every run leaves `main` working: typecheck, tests and
build pass, the server is restarted, and everything is committed (one commit per feature, ending with the
`Co-Authored-By` line from the session's attribution rules). Never leave a half-done feature on `main`; if a feature
won't fit, stash it on a branch `wip/<name>` and note it in `LOG.md`.

## Hard constraints
- Videos and data stay local. The library (`~/Lectern/library`) is the student's real data: never delete or rewrite media.
  You may re-run `export_lectern.py` (from the work dir below) and add new derived files.
- Pipeline work dir with transcripts, cuts, plan, silence decisions:
  `/Users/weiheng/.t3/scratch/2026-11-20-users-weiheng-notes-course-material-8234e2ca/vidwork`.
- padSync (`/Users/weiheng/Repo/padSync`) embeds Lectern in its Lecture tab (`src/components/LecternPanel.tsx`,
  `src/lib/lectern.ts`) via `?embed=1` and postMessage (`lectern:state`, `lectern:open`, `lectern:seek`). Keep that
  contract backward compatible. Don't edit padSync in these runs; if padSync needs a change, describe it in `LOG.md`.
- Another scheduled build (the annotation pack, `/Users/weiheng/Notes/_annotation_build/`) runs at 04:30, 05:00 and
  05:30 and shares the usage limit. Don't touch its files. Keep agent fan-out modest (≤ 3 helpers at a time).
- Background video encoding (quality tiers) must run under `nice -n 19` with `-j 1` until 06:00: the annotation build
  rasterises thousands of pages before its 06:00 deadline and must not be slowed down.
- Restart the server after changes: `pkill -f "node server/main.ts"; npm run build && (nohup node server/main.ts >/tmp/lectern.log 2>&1 &)`,
  then `curl -s localhost:4747/api/health`.
- Browser checks: Playwright's Chromium is at `~/Library/Caches/ms-playwright/chromium-1255` (no H.264, so the video
  won't decode there). For real playback checks, install WebKit (`npx playwright install webkit`) and drive it with a
  small Playwright script, or use the T3 preview tools.

## Features the student asked for (must ship)
1. **Adjustable minimum pause/silence**: a global "trim pauses longer than X s" control (e.g. 0.2–2 s), *and* a way to
   tighten it locally where the lecturer is still too slow (a per-chapter or per-range override, or a quick
   "tighten here" action while watching, remembered per recording). The current data only has the pipeline's
   decided pause ranges (`pauses` in each source JSON); deriving pauses at other thresholds needs the word gaps
   (`words`) and probably silence data from the work dir. Design it so it works from the library alone (export
   whatever extra data is needed in `export_lectern.py`, e.g. every inter-word gap with a silence measure).
2. **Next / previous video**: in watch order within the module, plus optional autoplay of the next one at the end.
3. **Quality option**: e.g. 360p/540p/720p/source variants (made by `make_proxies.py` with a flag; generate at
   least one lower tier for the library in the background), chosen in the player and remembered; fall back cleanly
   when a tier is missing.
4. **Mark as unwatched / watched**, reset progress, per recording and per module.

## Brainstorm (run 1)
Ask helpers to brainstorm further features and likely bugs (the student said to). Use agents on Opus at medium
effort, each with a different lens: (a) a student revising for finals in a week, (b) a QA engineer attacking the player
(seeking during skips, rate changes mid-skip, tiny or overlapping skip ranges, end of video, tab sleep, Safari/iPad,
fullscreen, a missing video, corrupt JSON, huge transcripts), (c) the padSync integration and the iPad. Merge the
results into `ROADMAP.md` as a prioritised checklist with an owner run for each item. Examples to consider:
bookmarks/notes at timestamps, A–B loop of an example, "explain this moment" hand-off, spaced-repetition queue of
worked examples, keyboard shortcut help overlay, per-module watch statistics, offline-safe resume sync with padSync,
picture-in-picture, an error boundary, and loading/empty states.

## Runs
| Time (SGT) | Run |
|---|---|
| 04:20 | 1 — brainstorm → ROADMAP.md; then ship feature 1 (adjustable pauses) |
| 04:45 | 2 — features 2 and 4 (next/prev, autoplay, watched state) + top roadmap items |
| 05:10 | 3 — feature 3 (quality tiers incl. make_proxies flag + background generation) + roadmap items |
| 05:35 | 4 — hardening: bug sweep from the QA list, tests for new logic, a /code-review-style self-review of the night's diff, README + SKILL.md updated, final commit. Done by 06:00. |

If a run finds earlier work missing or broken, fix that first. Tests live in `tests/*.test.ts` (`node --test`); put
new pure logic in `shared/` so it can be tested.
