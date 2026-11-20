---
name: lecture-exam-prep
description: End-to-end exam revision pipeline for university courses. Ranks course material by exam importance and writes a study plan, then condenses lecture recordings into ~1 h watch-order videos — local ASR with word timestamps, LLM review of off-topic/admin/non-examinable parts, silence and stutter-pause removal, speed-up to ~250 wpm, burned-in karaoke subtitles, chapter markers, automated re-transcription QA — writes a PDF of what another lecture group covered that the student's group didn't, and publishes everything to Lectern, a local lecture player (toggleable cuts/pauses, auto speed, karaoke subtitles, topic chapters, a worked-example index) with annotation PDFs whose questions link to the moment they were worked in lecture, playable beside the notes in padSync's Lecture tab. Use this whenever someone wants to study for finals/midterms from a folder of lecture videos, slides or past papers; to watch lectures in Lectern or link notes/problem sets to lecture moments; to shorten, speed up, cut silences from, subtitle or merge lecture recordings; to rank topics or plan revision; or to compare two lecture groups' recordings, even if they only ask for one of these pieces.
---

# Lecture exam prep

Turns a course folder (slides, notes, past papers, lecture recordings) into: a topic ranking + study plan, condensed
subtitled lecture videos, a Lectern library (interactive player + annotation packs), and optional supplements. Deterministic work is in `scripts/`; judgement calls go to LLM
agents briefed from `references/briefs/`. Do the phases the user asks for; each one stands alone.

`SKILL` below = this skill's directory. Run scripts **from the work directory** with the venv python printed by
setup (`PY`). Scripts read `config.json` in the work dir (defaults and every key: `scripts/common.py`).

## Phase 0 — Scope (ask only what you can't infer)
- Course folder, module codes, what is NOT examinable, exam dates/rules if known (lecture transcripts often state
  them — Phase 2 can find them later).
- Which recordings are the student's own lecture group. Other groups teaching the same syllabus are usually better
  summarised (Phase 4) than condensed; say so and proceed with the student's group by default.
- Delegation: if the user names a model/effort for helpers, use it for every agent below.
- Work dir: a scratch folder outside the course folder (renders need ~3 GB per 25 h of output). Outputs go to
  `<course>/<module>/edited_videos/` unless told otherwise.

## Phase 1 — Rank material and plan (no videos needed)
1. `PY SKILL/scripts/extract_text.py "<course folder>" <work>/txt` — text of every PDF/DOCX/PPTX with page markers.
2. One agent per module with `references/briefs/analysis.md` (fill in scope rules, paths, dates). They write
   `<MODULE>_analysis.md`: exam facts, topic map, tiered ranking with mark counts from past papers, practice sources
   per topic, traps, hours per topic.
3. You write the study plan from both analyses: a day-by-day table (both modules interleaved, morning/afternoon
   blocks, last day before each exam = timed mock + review), honouring real exam order. Put the ranking tables and
   plan in the reply; link the analysis files; flag facts that must be checked (dates, calculator, help sheet).

## Phase 2 — Condense lecture videos
```bash
PY=$(bash SKILL/scripts/setup.sh)          # ffmpeg-full, pandoc, typst, Parakeet venv (idempotent)
cd <work>
$PY SKILL/scripts/manifest.py add --module CS2030S --prefix cs --glob "<dir>/*.mp4" --sort date
$PY SKILL/scripts/manifest.py move cs03 --before cs02      # fix watch order where needed
$PY SKILL/scripts/transcribe.py                            # background it; ~80x realtime; flags CLIPPED audio
```
Build the manifest in **watch order**: chronological for live lectures (filenames are often numbered newest-first),
pre-recorded intro videos before the first live lecture, pre-lecture/chapter clips just before the lesson where that
chapter starts. Probe a few files first (`ffprobe`) for durations/resolutions and look for duplicates.

**Semantic cut review** — while later sources still transcribe, start agents on finished ones:
`$PY SKILL/scripts/batch_sources.py -n 4 --module X` → copy `references/briefs/cuts.md` to `CUT_BRIEF.md`, fill in
the module rules (non-examinable topics to cut) and title convention, and give each agent a batch. They write
`cuts/<id>.json` (cuts + a content title per recording). Short scripted clips rarely need cuts but still need titles.

**Term fixes**: grep transcripts for the course's key names/jargon (from slide text) in their likely misspellings;
add `term_fixes` to config.json, e.g.
`[{"match": "(?:de|des) ?mo(?:iv|is|ir|iver|ss|v)('s)?", "replace": "De Moivre\\1"},
  {"match": "(?:computable|completable) future", "replace": "CompletableFuture"}]` (regex over 1–3 words).

**Plan, test, render, assemble**:
```bash
$PY SKILL/scripts/plan.py                 # per-source cut/kept/wpm/factor/out table + packed videos; warns on clipping
$PY SKILL/scripts/run_renders.py -j 5 <one short source id>    # test one first, look at a frame + verify it
$PY SKILL/scripts/run_renders.py -j 5     # everything (background); safe to re-run, skips finished parts
$PY SKILL/scripts/assemble.py --dry-run   # planned file names; write better ones into config "names"
$PY SKILL/scripts/assemble.py             # stream-copy concat + chapters into out_dirs
```
For a clipped source, set `factor_override` (~1.3) before rendering. Check frames with
`ffmpeg -ss 600 -i <video> -frames:v 1 f.png` and Read the PNG: subtitles should sit in the bottom bar, small,
current word highlighted, slides uncovered.

## Phase 3 — Pause review (dead air, stutters ≥ 0.75 s)
Run on the pre-review plan (no `silence/decided/` yet):
```bash
$PY SKILL/scripts/silence_candidates.py -j 4 && $PY SKILL/scripts/silence_candidates.py --batches 6
```
Copy `references/briefs/pauses.md` → `SILENCE_BRIEF.md` (fill target wpm etc.), one agent per batch in
`silence/batches.json`. Agents look at the contact sheets and write `silence/decisions/<src>.json`. Then:
```bash
$PY SKILL/scripts/silence_apply.py        # errors if any candidate is undecided; corrections in silence/overrides.json
$PY SKILL/scripts/plan.py && $PY SKILL/scripts/run_renders.py -j 5 --force && $PY SKILL/scripts/assemble.py --force
```
Packing may change after this; re-check `assemble.py --dry-run` against config `names` (assemble refuses mismatches).
Phases 2 and 3 can be combined in one render if the user asks for both up front: run the pause review after
`plan.py` and before the first full render.

## Phase 4 — Other lecture group supplement (PDF)
Add the group with its own prefix (`manifest.py add --module X --prefix g2_ --kind other`), transcribe only those
(`transcribe.py --only ...`), and keep them out of rendering (they have no cuts/titles; give them a separate module
name like `X-other` so they pack separately, or don't plan them). Agents per date range with
`references/briefs/other_group.md` write `other/part_N.md`. You write a front page (`00_front.md`: YAML title block,
how it was made, a **conflicts table** between the lecturers with "what to do", other exam statements), concatenate
with `# Part N · dates: topics` headings, then `bash SKILL/scripts/md2pdf.sh all.md out.pdf` and render 2–3 pages
to PNG to eyeball tables/math. Save the PDF next to the module's material.

## Phase 5 — Verify and report
```bash
$PY SKILL/scripts/verify_all.py           # ~1 min/video; final/verify.json + list of videos needing a look
```
Healthy: match ≥ 0.90 (≥ 0.85 for poor audio), |offset_med| ≤ 0.08 s, wpm ≈ target, LUFS within ~1.5 LU, no black
stretches, subtitles narrower than the bar, residual pauses only the reviewed trims/keeps. Investigate outliers
with `verify.py <video> <words.json> --start S --dur 300` over consecutive windows to localise them; compare against
the source (re-transcribe the original window) before blaming the pipeline.

Report to the user: where the files are, hours before → after, what was cut (by category), how it was checked (the
numbers), and anything they must know (exam facts found in transcripts, distorted sources, skipped duplicate
groups, length range vs the ~1 h target and why). Mention the work dir's `parts/` can be deleted once they're happy.

## Phase 6 — Lectern library, annotation packs, padSync
Lectern is the local player that ships with this skill (the repo this skill lives in: `SKILL/../..`, usually
`~/Repo/lectern`; README there). It plays the *original* recordings and applies cuts, pauses and speed live, so the
student can toggle them; nothing is uploaded. Needs Phase 2's transcripts, `cuts/` and `plan.json` (Phase 3's pause
review makes the skips better but isn't required). Library default: `~/Lectern/library`.

1. **Index**: copy `references/briefs/index.md` → `INDEX_BRIEF.md` (fill in work dir and the extracted course text
   dir from Phase 1), agents per `batch_sources.py` batch write `index/<id>.json` (topic chapters + every worked
   example/tutorial/problem-set/quiz question with its document ref). Refs must use the documents' own labels
   ("Notes Ex 3.2.15", "Tutorial 2.5(a)", "L04 slide 5", "PS05 Q2") — that's what links packs to lectures.
2. **Publish**:
   ```bash
   $PY SKILL/scripts/make_proxies.py ~/Lectern/library -j 4      # H.264 copies, 1 s keyframes (background; ~25x realtime)
   $PY SKILL/scripts/export_lectern.py ~/Lectern/library         # sources/<id>.json + module.json
   ```
3. **Annotation packs**: write `packs_spec.json` (format in `make_packs.py`'s docstring): one pack per slide deck
   (`"slides": "L04"`), per notes chapter (page ranges; leave out non-examinable chapters), problem sets, past papers.
   ```bash
   $PY SKILL/scripts/make_packs.py ~/Lectern/library packs_spec.json && $PY SKILL/scripts/export_lectern.py ~/Lectern/library
   ```
   Each page: document left, blank right half for handwriting, a link chip beside every question that was worked in a
   lecture. Check the link count per pack and render a page or two to PNG (pypdf one page → `sips -s format png`); a
   pack with 0 links where you expected some means refs didn't match the document's labels — fix the refs in
   `index/` rather than the matcher. Links point at `--base` (default `http://localhost:4747`).
4. **Run**: in the Lectern repo `npm install && npm run build && npm start` → http://localhost:4747
   (`npm run start:lan` for an iPad). Smoke-test `curl localhost:4747/api/health` and one `/watch/...` link.
5. **padSync**: import a pack as a PDF notebook; the side panel's **Lecture** tab (`LecternPanel`) lists the
   lecture links on the page being viewed and plays them in an embedded player beside the page; the address is
   Settings → Notebook → Lectern address. On an iPad the https padSync page can't embed the Mac's http address
   (mixed content): use the tab's "Open ↗" with Safari Split View instead.

Report: library path, recordings/examples/links per module, any packs with few links, and how to start Lectern.

## Optional follow-ups worth offering
Chapter markers remuxed into the condensed videos (no re-encode); a fresh retry question for each indexed past-paper
question; help-sheet drafts; audio-only versions for
commuting. If the user asks for a second opinion, delegate a read-only brainstorm to the model they name.

## Files
- `scripts/` — `setup.sh`, `extract_text.py`, `manifest.py`, `transcribe.py`, `batch_sources.py`, `plan.py`,
  `render.py`, `run_renders.py`, `assemble.py`, `silence_candidates.py`, `silence_apply.py`, `verify.py`,
  `verify_all.py`, `md2pdf.sh`, `make_proxies.py`, `export_lectern.py`, `make_packs.py`, `common.py` (config defaults). Each has a usage docstring at the top.
- `references/briefs/` — agent briefs: `analysis.md`, `cuts.md`, `pauses.md`, `other_group.md`, `index.md`.
- `references/pipeline-notes.md` — why each design choice was made, timings, pitfalls (clipped audio, ASR term
  errors, sync-measurement artefacts, zsh globbing). Read it before changing defaults or when QA numbers look odd.
