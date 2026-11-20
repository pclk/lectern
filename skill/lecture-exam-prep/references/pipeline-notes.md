# Video pipeline: design notes, tunables, pitfalls

Read when something looks off, or before changing a default. Numbers come from a real run: 83 sources / ~47 h of
lecture video on an M5 Pro → 26 videos / 22.9 h.

## Timings (Apple Silicon, M-series Pro)
| Step | Speed | 47 h of source |
|---|---|---|
| transcribe.py (Parakeet TDT 0.6B v2) | ~80× realtime + parallel extraction | ~35–45 min |
| cut review agents (4–5 Opus agents) | ~4–10 min per agent | ~10 min wall |
| run_renders.py -j 5 | ~13× realtime per worker | ~45 min |
| silence_candidates.py -j 4 | ~30 s per 2 h source | ~10 min |
| pause review agents (6) | ~2.5 min each | ~3 min wall |
| assemble.py (stream copy) | seconds | ~1 min |
| verify_all.py (8 windows × 150 s) | ~1 min per video | ~25 min |

## Why these choices
- **ASR: Parakeet TDT 0.6B v2 over Whisper large-v3-turbo.** On the same lecture clips it was ~3× faster,
  kept punctuation/casing (Whisper turbo degenerated to lowercase run-ons mid-file), gave tighter word timings and
  doesn't hallucinate on silence. Its word *end* times for sentence-final words stretch over the following silence,
  which is why the pause pass uses energy + capped word coverage, not just gaps between words.
- **ffmpeg-full**: Homebrew's default `ffmpeg` has no libass (no subtitle burn-in), no drawtext, no rubberband.
- **Encoder**: libx264 `veryfast -crf 22 -tune stillimage` was ~4× faster than h264_videotoolbox with hwaccel decode
  in this pipeline, and slide content compresses to ~1.5–3 Mbit/s. 5 parallel workers × 4 threads saturate an M-Pro.
- **Frame selection**: a flat `select='between()+between()+…'` with ~1500 terms fails ("Cannot allocate memory").
  render.py builds a balanced `if(lt(t,m),left,right)` tree: log depth, also faster.
- **Audio**: cut at exact samples in numpy with 6 ms fades (ffmpeg `aselect` quantises to 23 ms frames → clicks),
  then `rubberband` (pitch-preserving, better than `atempo` at 1.5–2×), then `loudnorm` → all videos within ~1.5 LU.
- **Layout**: 1280×720 canvas, content scaled into the top 1280×640, 80 px black bar for subtitles → captions never
  cover slides. Mixed source sizes (976×528, 1152×720, 800×600, 1280×640) all fit; outputs can be stream-copied
  together because every part has identical encoding parameters.
- **Subtitles**: one ASS event per word; current word amber, spoken solid, upcoming dimmed; ≤ 64 chars/line, single
  line, 25 px Avenir Next Demi Bold. Line breaks at sentence ends, commas after 40 chars, or > 0.9 s gaps.
- **Speed**: factor = target_wpm / (words per kept minute), clamped 1.0–2.5, computed **before** the pause review
  and then frozen. (If recomputed after, removing pauses just lowers the speed-up and saves no time.)
- **Packing**: DP over parts in watch order minimising Σ(len − 60)², cap 78 min. One 2 h live lecture usually
  condenses to 40–52 min and stays alone; short clips pack together. Sources > 78 min split at the widest pause.

## Pitfalls seen
- **Distorted (clipped) source audio** (e.g. mean volume −5.5 dB, 1M+ clipped samples in 5 min): re-transcription
  match drops to ~0.7 at 1.6×. Declipping (`adeclip`) made it *worse*. Fix: `factor_override` ~1.3 for that source
  (match 0.76→0.87 at 1.0×; 1.3× is the compromise). transcribe.py reports `clip_frac`; plan.py warns.
- **Term errors**: ASR mangles names/jargon consistently ("De Mois", "DeMoss" → De Moivre; "computable future" →
  CompletableFuture). Grep transcripts for the course's key terms (from slides) and add `term_fixes` before rendering.
  Only parts whose words change need re-rendering.
- **Pause candidates spanning earlier cuts**: a pause measured on the kept timeline can bridge a removed tangent; its
  `asr_words_inside` used to list the removed words. Now filtered to kept intervals, but if an agent reports "70 words
  inside a 3 s pause", it is this — override to cut.
- **Quiet speech flagged as silence**: student answers from the audience, asides away from the mic. Masking frames
  covered by normal-length words fixes this (258 raw low-energy runs → 70 real pauses in one lecture).
- **Whole-file verification sync artifact**: re-transcribing a 50-min file in one go gave a −0.14 s "offset" while
  every 2-min window was within +0.02–0.06 s. verify_all.py measures windows.
- **Duplicate recordings**: another lecture group, pre-recorded + live versions of the same week, recordings that run
  25 min past the end of class. Ask which group is the student's; summarise the other group instead of condensing it.
- **Shell**: paths with spaces and en-dashes are common in lecture filenames; use the Python scripts (they handle
  them) rather than `xargs`/globs in zsh (a non-matching glob aborts a `&&` chain in zsh).
- **Watch-order**: file numbering is often reverse-chronological (latest = 001). Sort by the date in the name;
  interleave pre-lecture clips before the lesson where their chapter starts (`manifest.py move`).

## Tunables (config.json keys; defaults in scripts/common.py)
`target_wpm` 250 · `max_gap` 0.40 s · `pad_pre/post` 0.08/0.20 s · `target_min/max_min` 60/78 ·
`silence.out_min` 0.75 s · `silence.cut_to` 0.25 s · `silence.below_p80_db` 24 · `subtitle.size` 25 ·
`subtitle.current` FFD84F · `encode.crf` 22 · `factor_override`, `prefilter`, `term_fixes`, `names`, `out_dirs`.
