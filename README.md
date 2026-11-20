# Lectern

A local lecture player for exam revision. It plays your own lecture recordings from this Mac (nothing is uploaded) with:

- **Live edits you can toggle**: skip reviewed cuts (admin, breaks, off-topic, non-examinable, per category or per cut) and pauses
- **Speed**: Auto (each recording sped up so speech runs at a target wpm, 250 by default) or a fixed 0.75–3×
- **Karaoke subtitles** from the word timings, plus a searchable, click-to-seek transcript
- **Topic chapters** and a **worked-example index**: every tutorial/problem-set/quiz question or slide example that was worked through, searchable per module ("Tutorial 3.6(b)", "L06 slide 17")
- **Search across every lecture** of every module
- Resume where you left off, `?t=` links to any moment, keyboard shortcuts (shown in the Edits tab)

## Run

```bash
npm install
npm run build
npm start                # http://localhost:4747
npm run start:lan        # also reachable from an iPad at http://<mac-name>.local:4747
npm run dev              # development: Vite on 4747, API on 4748
npm test
```

Options: `--port 4747`, `--library ~/Lectern/library` (or `LECTERN_PORT` / `LECTERN_LIBRARY`).

## The Claude skill

`skill/lecture-exam-prep/` is the Claude Code skill that builds Lectern's library from a course folder (Phase 6 of its
`SKILL.md`), as well as condensed videos, a topic ranking and a study plan. `npm run build` zips it into
`/downloads/lecture-exam-prep.zip`, linked from Lectern's home page. To install, unzip it into `~/.claude/skills/`, or
symlink it so edits here go live straight away:

```bash
ln -s "$PWD/skill/lecture-exam-prep" ~/.claude/skills/lecture-exam-prep
```

## Library

Written by the skill's scripts (`skill/lecture-exam-prep/scripts/`), run from its work directory:

```bash
python make_proxies.py ~/Lectern/library                    # browser-friendly H.264 copies of every recording
python export_lectern.py ~/Lectern/library                  # transcripts, cuts, pauses, chapters, examples
python make_packs.py ~/Lectern/library packs_spec.json      # annotation packs (needs typst, pypdf)
python export_lectern.py ~/Lectern/library                  # again, to list the packs
```

```
<library>/<MODULE>/module.json          module + recording summaries + packs
<library>/<MODULE>/sources/<id>.json    words, cuts, pauses, chapters, examples (all in recording time)
<library>/<MODULE>/media/<id>.mp4
<library>/<MODULE>/packs/<file>.pdf
```

## Annotation packs and padSync

Each pack page has a page from the slides, notes or a problem set on the left and an empty right half for writing. Next to every question that was worked through in a lecture is a link chip that opens Lectern at that moment. When the player is opened from a link it shows the question and pauses when the example's discussion ends.

In padSync, import a pack as a PDF notebook and open the side panel's **Lecture** tab. It lists the lecture links on the page you're on and plays them in an embedded player. Set the address under Settings → Notebook → Lectern address. While embedded (`?embed=1`), the player posts `{type: "lectern:state", url, t, …}` to padSync and accepts `{type: "lectern:open", url}` and `{type: "lectern:seek", t}`.
