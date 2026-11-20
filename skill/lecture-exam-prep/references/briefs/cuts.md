# Brief: mark unimportant sections of lecture recordings  (copy to <work dir>/CUT_BRIEF.md, fill <...>)

A student is condensing lecture recordings for final-exam revision. Silences are already removed automatically and
the video will be sped up, so you do NOT need to handle pauses. Your job is the semantic part: find stretches that are
not worth watching, and give each recording a short title.

Work directory: <work dir>
- Transcripts: `transcripts/<id>.txt`, one sentence per line prefixed `[h:mm:ss]` (sentence start, source time).
- Write one file per recording: `cuts/<id>.json` (create `cuts/` if missing). Do not touch anything else.

## What to cut
- Pre-lecture dead time: waiting for students, mic/AV checks, projector setup, chit-chat before teaching starts.
- Breaks and anything recorded during them; packing up / small talk after teaching ends; long tails of recording
  after the lecture (empty room).
- Pure logistics with no exam value: attendance, venue changes, lab/tutorial admin, consultation slots, survey
  reminders, technical troubles, waiting while students do an in-class quiz/poll (keep reading the question and the
  discussion of the answer).
- Long off-topic tangents/anecdotes with no course content (> ~30 s). Short jokes inside teaching: keep.
- Verbatim repeats caused by technical problems; stretches where the audio is missing/unintelligible.
- <MODULE-SPECIFIC RULES, e.g. "Sequences/series and the Binomial Theorem are NOT tested: cut all teaching of them
  (reason: 'not examinable: binomial')">

## What to KEEP (never cut)
- All teaching, worked examples, code walkthroughs, student questions and answers about content.
- Anything about the exam/assessments: format, what is/isn't tested, hints, common mistakes, "this will come out".
- When unsure, keep. Over-cutting is worse than under-cutting. Typical cuts are 0–15 % of a lecture (more only when
  the recording runs on long after class); going beyond needs a clear reason.

## Output format (`cuts/<id>.json`)
```json
{"title": "L03 Polymorphism & LSP",
 "cuts": [{"start": 0, "end": 312.0, "reason": "waiting for class to start, AV setup"},
          {"start": 3400.0, "end": 3720.0, "reason": "break"}],
 "notes": "anything notable, e.g. overlaps with another recording"}
```
- `start`/`end` are seconds in the source video: `start` = stamp of the first removed sentence, `end` = stamp of the
  first sentence kept after it. Use `"cuts": []` if nothing should go.
- `title`: ≤ 45 characters describing the content, filename-safe (no `/ : ? * " < > |`). <TITLE CONVENTION, e.g.
  "start with the deck id: 'L06 Wildcards & Type Inference'" or "Lesson N <topics>" or "Ch3.05 <topic>">.
- Read each transcript properly (skim long uninterrupted teaching; read the start, the end and transitions closely).
  grep for "break", "minutes", "quiz", "survey", "hear me", "attendance", "start", etc. to find candidates.

Final message: table of id → title, minutes cut, one-line summary of what was cut, plus anything surprising
(exam statements found, audio failures, duplicated content between recordings).
