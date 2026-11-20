# Brief: decide which remaining pauses to cut  (copy to <work dir>/SILENCE_BRIEF.md, fill <...>)

A student is watching condensed lecture recordings for revision and wants to waste as little time as possible on
dead air and stutter pauses. The videos were already cut and sped up (~<target> wpm). A detector found every remaining
stretch where **nobody is speaking for ≥ <out_min> s of output time**. You decide, for **every candidate**, what
happens to it. The rule: remove pauses **where the video is not changing much and there is no speech**.

Work dir: <work dir>

## Input: `silence/cand/<src>.jsonl`, one candidate per line
- `id`, `src`, `start`/`end` (source seconds), `out_dur` (seconds of pause in the final video), `factor` (speed-up)
- `change_end`: fraction of thumbnail pixels differing between the first and last frame of the pause
- `motion_max`: largest such fraction at any sampled moment (catches transient motion, e.g. scrolling)
- `asr_words_inside`: words the transcriber placed inside the pause. Usually the stretched tail of a sentence-final
  word (`["covariant?"]`) whose timestamp overran into the silence — NOT speech. Real speech only if several distinct
  words sit inside (quiet speech, e.g. a student answering).
- `only_fillers`: the only "speech" inside is uh/um/er — treat as silence (removing these is desired).
- `before` / `after`: transcript text around the pause.
- `image` (only when the picture changes at all): PNG contact sheet, one row per candidate labelled with its id:
  `start | 1/3 | 2/3 | end | changed pixels` (black = changed). **Open the sheets with Read and look at them.**
  No `image` = essentially frozen picture.

## Decision per candidate
- `cut` — dead air and the picture isn't conveying anything new (static slide, lecturer thinking, stutter/restart,
  "uh", waiting, a single slide flip or window switch, mouse pointer drift, the webcam/room-camera inset moving,
  toolbars popping up, a projector glitch). It is shortened to a natural <cut_to> s.
- `trim` — something meaningful happens on screen but doesn't need the full duration (short handwriting, a slide
  animation step, typing a short line of code, program output appearing, scrolling to new content).
  Give `keep_out` = output seconds to keep (≥ <cut_to>, < out_dur).
- `keep` — the silence carries content for its whole length: silently writing/drawing a derivation or diagram,
  live-coding, a demo running/printing; or real quiet speech inside (several distinct words).
- A cut never loses words. When in doubt between cut and trim, trim; between trim and keep, look at the image again.
- Numbers alone don't separate handwriting from camera motion (both ~0.002–0.05): judge from the images.

## Output: `silence/decisions/<src>.json` for every source in your batch
```json
[{"id": "cs08#0000", "action": "cut"},
 {"id": "cs08#0007", "action": "trim", "keep_out": 0.8, "why": "writes 'T <: S' on slide"},
 {"id": "cs08#0012", "action": "keep", "why": "draws the full type hierarchy silently"}]
```
Every candidate id must appear exactly once; `why` required for trim/keep. Sources with no candidates get `[]`.
Before finishing, verify with a short script that every id is covered and actions are valid.

Final message: per-source counts of cut/trim/keep and anything notable — especially candidates where the detector
looks wrong (e.g. many words "inside" a short pause: that usually means it spans an earlier semantic cut, and the
pause itself is silent; say so instead of keeping it).
