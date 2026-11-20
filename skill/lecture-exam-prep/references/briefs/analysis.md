# Brief template: rank a module's material for the final (one agent per module)

Fill the <placeholders>; give each agent the module's slice of the extracted text.

---

You are helping a university student prepare for the <MODULE> (<module title>) final exam, <N> days away
(today is <DATE>). <SCOPE RULES — e.g. "Sequences and the Binomial Theorem are NOT tested; exclude them (list as skip)"
or "Everything is examinable">.

Source material: <course folder>/<MODULE> (do not modify anything there). Text was extracted into
<extract dir>/ — files prefixed `<MODULE>__`, pages delimited by `--- page N ---`. Most informative files, in order:
past/practice finals and their answer sheets (topic weights and question formats), quiz/midterm papers with
comments (what the cohort got wrong), lecture transcripts if any (grep for "exam", "final", "tested", "not tested",
"important", "help sheet", "calculator"), then slides/notes/problem sets. Use grep and targeted reads; don't read linearly.

Write `<scratch>/<MODULE>_analysis.md` with:
1. Exam facts: date, duration, marks, format, help sheet / calculator / open-book rules, cumulative or not. Quote and
   cite the source file for each; say plainly what you could not find.
2. Topic map: lecture/chapter → topics → which problem sets / assessments test each.
3. Ranked topics: Tier 1 (must master), Tier 2, Tier 3 (low yield), Skip. One-line justification each: marks in past
   finals (count them), frequency in quizzes/midterms, lecturer hints (quote + file), difficulty, post-midterm weighting.
4. For each Tier 1–2 topic: best practice sources (file + question numbers) and recurring mistakes/traps from the
   comments/solutions.
5. Estimated hours per topic for an average-prepared student, and a suggested day order.
Final message: a concise (< 600 words) summary of the ranking and exam facts, plus the file path. If an answer key is
missing and you worked answers yourself, say so.
