# Brief: topic chapters + worked-example index for lecture recordings  (copy to <work dir>/INDEX_BRIEF.md)

The student watches lectures in a local player (Lectern) with chapter navigation, and studies from annotated
documents where each question links to the moment in a lecture where that question (or the same idea) is worked
through. You build both indexes for your recordings.

Work dir: <work dir>
- Transcripts: `transcripts/<id>.txt`, `[h:mm:ss]` sentence stamps (source time). Titles of each recording and the
  stretches already cut as non-content: `cuts/<id>.json` (ignore cut stretches — don't put chapters/examples there).
- Course material text (slides, notes, problem sets, quizzes, papers), to learn how questions are numbered and named:
  <extract dir>/ (files prefixed by module, pages delimited `--- page N ---`). Check names there so references match
  the real documents ("PS03 Q2" only if problem set 03 has a question 2 about this).

## Output: `index/<id>.json` per recording
```json
{"chapters": [{"start": 0, "title": "Recap: subtyping and variance"},
              {"start": 412, "title": "Wildcards: ? extends T"}],
 "examples": [{"id": "ps04-q1", "label": "PS04 Q1 — Animal hierarchy with wildcards", "ref": "PS04 Q1",
               "kind": "problem-set", "start": 1520, "end": 1875,
               "summary": "Which of copy(List<? extends T>, List<? super T>) calls compile; answer T = S"}]}
```
- **chapters**: topic changes, roughly every 3–10 minutes of source time (more often when topics change fast).
  `start` = stamp (seconds) of the sentence where the topic starts; first chapter starts at the first teaching
  sentence. Titles ≤ 48 chars, specific ("Washer method about y = −1", not "Examples").
- **examples**: every worked example, tutorial/problem-set/quiz/past-paper question, slide exercise or poll question
  that is solved or discussed, plus important derivations. `start` = where the question is introduced/read out,
  `end` = where its discussion finishes. `kind` ∈ problem-set | tutorial | quiz | midterm | past-paper | slide-example
  | notes-example | lecture-example | poll | derivation. `ref` = the document's own label when it has one
  ("Tutorial 3.8", "Notes Ex 2.4.6", "Quiz 2 Q5", "PS05 Q2", "Midterm Q6", "L06 slide 17"), else null.
  `id` = short unique slug within the recording. `summary` = one line: what's asked + the key idea/answer.
- Sentence stamps are seconds; convert `[0:12:34]` → 754.
- Pre-recorded short clips: 1–4 chapters, examples for each worked example in them.

Final message: per recording, number of chapters and examples, and any refs you couldn't match to a document.
