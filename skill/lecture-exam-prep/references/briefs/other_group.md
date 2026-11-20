# Brief: what did the other lecture group say that the student's group didn't?  (copy to <work dir>/OTHER_BRIEF.md)

A student in <MODULE> lecture group <A> has their final on <date> (<exam rules>; <not-tested topics>). Group <B> had a
different lecturer teaching the same syllabus. The student won't watch group <B>'s recordings; they want a summary PDF of
**everything in group <B> that group <A> did not cover**, so nothing is missed.

Work dir: <work dir>
- Group <B> transcripts (yours): `transcripts/<prefix>*.txt`, `[h:mm:ss]` stamps.
- Group <A> material to compare against (search it, don't read it all): `transcripts/<ids>.txt` (titles in
  `cuts/<id>.json` → "title"), plus common notes/slides text in <extract dir>. Something in the notes that group <A>'s
  lecturer never explained still counts as new if group <B> explains it — say "(in notes §x)".
- grep group <A> transcripts for key terms/examples before declaring something "not covered" (ASR spelling varies;
  try a few spellings).

## Include (only what group <A> did NOT cover, or covered clearly differently)
1. Worked examples / question types: the problem, key idea, main steps, final answer (exact where the transcript or
   slides allow; if a number is unclear say so — never guess). Check arithmetic; if the lecturer/slide made a slip,
   give the corrected value and mark it.
2. Methods, shortcuts, tricks, alternative approaches, intuitions.
3. Warnings and common mistakes emphasised.
4. Exam-related statements (what's tested, format, marking, calculator/help-sheet rules, hints). Flag anything that
   **conflicts** with group <A>'s lecturer as **⚠ Conflict:** — the exam is common, so the student should know.
5. Skip non-examinable topics (one line noting the skip), admin, banter, and content group <A> covered equivalently.
   If a recording is empty/no class, say so.

## Output: `other/part_<N>.md`
Markdown with LaTeX math (`$...$`, `$$...$$`, simple valid LaTeX — converted with pandoc→Typst). Group by topic in
syllabus order, not by date:
```
## <Topic heading>
**Source:** Group B, 15 Sep (0:12:30–0:20:10) · **Group A equivalent:** Lesson 10 / none
- ...
```
Dense revision material, no preamble. Final message: the most important differences, especially exam-related ones and
conflicts (these go on the PDF's front page).
