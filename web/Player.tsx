import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { activeCuts, atTime, autoRate, DEFAULT_EDIT, exampleTitle, fmt, keptWpm, skipRanges, Timeline } from "../shared/edl.ts";
import { PAUSE_LEVELS, pauseLevelAt, pauseRanges, setLocal, tighter, type LocalPause, type PauseSettings } from "../shared/pauses.ts";
import { buildLines, buildParagraphs, currentWord, type Line } from "../shared/subtitles.ts";
import type { CutCategory, Example, Source, SourceSummary } from "../shared/types.ts";
import { api, mediaUrl, useLoad, watchUrl } from "./api.ts";
import { navigate } from "./main.tsx";
import { fromHost, tellHost } from "./host.ts";
import { Header } from "./Library.tsx";
import { localPauses, RATING_LABEL, ratings, useLocalPauses, usePrefs, resume, useRatings, useResume, type Prefs, type Rating } from "./prefs.ts";

const CATEGORY_LABEL: Record<CutCategory, string> = {
  "dead-time": "Before/after lecture", break: "Breaks", admin: "Admin & logistics", technical: "Technical hiccups",
  "off-topic": "Off-topic chat", "not-examinable": "Not examinable",
};
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3];

interface Props { module: string; id: string; embed: boolean; startAt?: number; example?: string }

export function Player(p: Props) {
  const src = useLoad(() => api.source(p.module, p.id), [p.module, p.id]);
  if (src.error) return <div className="page">{!p.embed && <Header />}<p className="error wrap">Couldn't open {p.module}/{p.id}: {src.error}</p></div>;
  if (!src.data) return <div className="page">{!p.embed && <Header />}<p className="muted wrap">Loading…</p></div>;
  return <PlayerView {...p} src={src.data} />;
}

function PlayerView({ module, id, embed, startAt, example, src }: Props & { src: Source }) {
  const [prefs, setPrefs] = usePrefs();
  const key = `${module}/${id}`;
  const [keepCuts, setKeepCuts] = useState<number[]>([]);
  const local = useLocalPauses(key); // re-reads when sync brings another device's overrides
  const updateLocal = useCallback((l: LocalPause[]) => localPauses.set(key, l), [key]);
  const pauseSettings = useMemo<PauseSettings>(() => ({ max: prefs.pauseMax, local }), [prefs.pauseMax, local]);
  const pauses = useMemo(() => pauseRanges(src, pauseSettings), [src, pauseSettings]);
  const edit = useMemo(() => ({ ...prefs.edit, keepCuts }), [prefs.edit, keepCuts]);
  const tl = useMemo(() => new Timeline(skipRanges(src, edit, pauses), src.duration), [src, edit, pauses]);
  // Auto speed comes from the default edit, not the current one: trimming more pauses then shortens the lecture
  // instead of being absorbed by a slower speed (the pipeline fixes its speed-up the same way).
  const baseTl = useMemo(() => new Timeline(skipRanges(src, DEFAULT_EDIT), src.duration), [src]);
  const rate = useMemo(() => prefs.rateMode === "auto" ? autoRate(src.words, baseTl, prefs.targetWpm) : prefs.manualRate,
    [prefs.rateMode, prefs.targetWpm, prefs.manualRate, src.words, baseTl]);
  const lines = useMemo(() => buildLines(src.words), [src.words]);

  const video = useRef<HTMLVideoElement>(null);
  // Quality: the preferred copy if this recording has it, else full quality.
  const quality = prefs.quality != null && src.tiers?.includes(prefs.quality) ? prefs.quality : undefined;
  // Switching quality swaps the video's src: carry the position and play state over.
  const carry = useRef<{ t: number; play: boolean } | null>(null);
  const setQuality = (q: number | null) => {
    const v = video.current;
    const next = q != null && src.tiers?.includes(q) ? q : undefined;
    // only when the file actually changes: otherwise no load follows and the carry would linger
    if (v && ready && next !== quality) carry.current = { t: v.currentTime, play: !v.paused };
    setPrefs({ quality: q });
  };
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState("");
  const [focus, setFocus] = useState<Example | null>(() => src.examples.find((e) => e.id === example) ?? null);
  const [ended, setEnded] = useState(false);
  // Safari (and a padSync iframe without a tap) refuses play() without a user gesture: say so instead of a silent ▶.
  const [blocked, setBlocked] = useState(false);
  const [videoError, setVideoError] = useState("");
  const tryPlay = useCallback(() => {
    void video.current?.play().then(() => setBlocked(false), (e: Error) => { if (e.name === "NotAllowedError") setBlocked(true); });
  }, []);
  // A linked example that just finished, waiting for a rating.
  const [toRate, setToRate] = useState<Example | null>(null);
  const watched = !!useResume()[key]?.done;

  // Neighbours in watch order, for previous/next and "Up next".
  const lib = useLoad(api.library, []);
  const order = lib.data?.modules.find((m) => m.code === module)?.sources ?? [];
  const idx = order.findIndex((s) => s.id === id);
  const prev: SourceSummary | undefined = idx > 0 ? order[idx - 1] : undefined;
  const next: SourceSummary | undefined = idx >= 0 ? order[idx + 1] : undefined;
  const go = useCallback((s: SourceSummary) => navigate(watchUrl(module, s.id)), [module]);

  // refs read by the frame loop, so it never restarts
  // "Say that again": replay the current subtitle line at 1×, back to normal speed after source time `again`.
  const [again, setAgain] = useState<number | null>(null);
  const live = useRef({ tl, focus, stopAtEnd: prefs.stopAtExampleEnd, loop: prefs.loopExample, again });
  live.current = { tl, focus, stopAtEnd: prefs.stopAtExampleEnd, loop: prefs.loopExample, again };

  const flash = useCallback((msg: string) => { setToast(msg); window.setTimeout(() => setToast(""), 1600); }, []);

  // "Tighten here": trim pauses harder in the chapter being watched (or ±2 min without chapters); each press steps
  // one level tighter. Loosen removes the override for this spot.
  const tightenHere = useCallback((loosen = false) => {
    const now = video.current?.currentTime ?? 0;
    if (loosen) {
      const left = local.filter((l) => !(now >= l.start && now < l.end));
      updateLocal(left);
      flash(left.length < local.length ? "Pauses here back to normal" : "No tightening here");
      return;
    }
    const ci = src.indexed ? atTime(src.chapters, now + 0.5) : -1;
    const [start, end, label] = ci >= 0
      ? [src.chapters[ci].start, src.chapters[ci + 1]?.start ?? src.duration, src.chapters[ci].title]
      : [Math.max(0, now - 120), Math.min(src.duration, now + 120), `around ${fmt(now)}`];
    const max = tighter(pauseLevelAt(pauseSettings, now));
    updateLocal(setLocal(local, { start, end, max, label }));
    if (!prefs.edit.skipPauses) setPrefs({ edit: { ...prefs.edit, skipPauses: true } });
    flash(`Pauses in “${label}” cut to ${max} s`);
  }, [local, updateLocal, flash, src, pauseSettings, prefs.edit, setPrefs]);

  useEffect(() => { document.title = `${src.label} ${src.title} · Lectern`; }, [src]);
  // defaultPlaybackRate too: iOS resets playbackRate to it when playback (re)starts
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.defaultPlaybackRate = rate;
    v.playbackRate = again != null ? 1 : rate;
  }, [rate, ready, again]);
  useEffect(() => { const v = video.current; if (v) v.volume = prefs.volume; }, [prefs.volume, ready]);

  // Frame loop: jump over skipped stretches, stop at the end of a linked example, publish the clock. Browsers stop
  // animation frames in a background tab while the audio plays on, so `timeupdate` (still ~4/s there) runs the
  // same check.
  useEffect(() => {
    const v = video.current!;
    let raf = 0, last = -1, target = -1;
    const check = () => {
      const { tl, focus, stopAtEnd, loop, again } = live.current;
      const ct = v.currentTime;
      if (!v.seeking && !v.paused) {
        const r = tl.skipAt(ct + 0.02);
        // A linked example ends when playback reaches its end, or when a skip is about to jump over it (its end
        // inside a cut, a pause, or the skip to the end of the video in examples-only mode). Handled before the
        // skip, so the loop / rating prompt wins over "Up next".
        const end = focus ? tl.snap(focus.end) : 0;
        const exampleDone = focus != null && ((ct >= end && ct < end + 1.5 * Math.max(1, v.playbackRate)) ||
          (r != null && ct < focus.end && r[1] >= focus.end));
        if (exampleDone && loop) { v.currentTime = tl.snap(focus.start); return; }
        if (exampleDone && stopAtEnd) { v.pause(); setToRate(focus); setFocus(null); return; }
        if (r) {
          if (r[1] >= tl.duration - 0.05) { v.pause(); v.currentTime = tl.duration; setEnded(true); }
          // landed short of where we sent it (Safari rounds to frames)? push past instead of seeking there forever
          else { v.currentTime = r[1] === target ? r[1] + 0.1 : r[1]; target = r[1]; }
        }
        if (again != null && ct >= again) setAgain(null);
      }
      if (Math.abs(ct - last) >= 0.04) { last = ct; setT(ct); }
    };
    const tick = () => { check(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    v.addEventListener("timeupdate", check);
    return () => { cancelAnimationFrame(raf); v.removeEventListener("timeupdate", check); };
  }, []);

  const seek = useCallback((source: number) => {
    const v = video.current;
    if (!v || !Number.isFinite(source)) return;
    v.currentTime = live.current.tl.snap(Math.max(0, Math.min(source, src.duration)));
    setT(v.currentTime);
  }, [src.duration]);
  const seekVirtual = useCallback((virtual: number) => seek(live.current.tl.toSource(Math.max(0, virtual))), [seek]);
  const nudge = useCallback((dv: number) => seekVirtual(live.current.tl.toVirtual(video.current?.currentTime ?? 0) + dv), [seekVirtual]);
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) tryPlay(); else v.pause();
  }, [tryPlay]);
  const playExample = useCallback((e: Example) => { setFocus(e); setToRate(null); seek(e.start); tryPlay(); }, [seek, tryPlay]);

  // Start position: ?t= / ?e= from a link, else where you left off.
  const onLoaded = () => {
    if (carry.current) {
      const { t: at, play } = carry.current;
      carry.current = null;
      seek(at);
      if (play) tryPlay();
      return;
    }
    const at = resume.get(key);
    // resume where you left off, unless that was the end (then it's a rewatch from the start)
    const finished = at && tl.toVirtual(at.t) > tl.virtualDuration * 0.95;
    const start = startAt ?? focus?.start ?? (at && !finished ? at.t : 0);
    seek(start);
    setReady(true);
    const own = (history.state as { lecternOwn?: boolean } | null)?.lecternOwn;
    if ((startAt != null && !own) || focus) tryPlay();
  };

  // A later link into this same recording (another chip on the page, lectern:open) only changes ?t= / ?e=:
  // the player stays mounted, so jump there here.
  const navigatedTo = useRef({ startAt, example });
  useEffect(() => {
    if (navigatedTo.current.startAt === startAt && navigatedTo.current.example === example) return;
    navigatedTo.current = { startAt, example };
    if (!ready) return; // onLoaded reads the new props itself
    const e = src.examples.find((x) => x.id === example) ?? null;
    setFocus(e);
    setToRate(null);
    const target = startAt ?? e?.start;
    if (target != null) { seek(target); tryPlay(); }
  }, [startAt, example, ready, src.examples, seek]);

  // Remember the position; mark watched when playback crosses 95%. Only a real move is saved: an idle open tab
  // re-saving the same spot would keep overwriting progress made on another device (sync).
  useEffect(() => {
    if (!ready) return;
    const v = video.current; // React clears the ref before this effect's cleanup runs
    const past = () => !!v && tl.toVirtual(v.currentTime) > tl.virtualDuration * 0.95;
    let saved = v?.currentTime ?? 0, wasPast = past();
    const save = () => {
      if (!v || !v.currentTime || Math.abs(v.currentTime - saved) < 1) return;
      const now = past();
      resume.set(key, v.currentTime, now && !wasPast ? true : undefined); // so unmarking near the end sticks
      saved = v.currentTime;
      wasPast = now;
    };
    const timer = window.setInterval(save, 5000);
    window.addEventListener("pagehide", save);
    return () => { save(); clearInterval(timer); window.removeEventListener("pagehide", save); };
  }, [ready, key, tl]);

  // Keep ?t= current while paused, so a reload or a copied address resumes here.
  // Debounced: scrubbing changes t many times a second, and Safari throws after ~100 replaceState calls.
  useEffect(() => {
    if (playing || !ready) return;
    const timer = window.setTimeout(() => {
      try {
        const u = new URL(location.href);
        u.searchParams.set("t", String(Math.floor(t)));
        u.searchParams.delete("e");
        history.replaceState({ lecternOwn: true }, "", u.pathname + u.search); // a reload shouldn't autoplay
      } catch { /* the address is a convenience */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [playing, ready, t]);

  const chapterIdx = atTime(src.chapters, t + 0.5);
  const chapter = src.chapters[chapterIdx];

  // Embedded in padSync: report where we are, about once a second.
  // Also sent at once when play/pause changes; `lectern:idle` when the player closes. `path` is host-free.
  const lastPost = useRef({ t: -10, playing: false });
  useEffect(() => {
    if (!embed || window.parent === window) return;
    if (Math.abs(t - lastPost.current.t) < 1 && playing === lastPost.current.playing) return;
    lastPost.current = { t, playing };
    tellHost({ type: "lectern:state", module, source: id, title: src.title, label: src.label, t,
      chapter: chapter?.title ?? null, url: location.origin + watchUrl(module, id, t), path: watchUrl(module, id, t), playing });
  }, [embed, t, playing, module, id, src, chapter]);
  useEffect(() => () => { if (embed) tellHost({ type: "lectern:idle" }); }, [embed]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!fromHost(e)) return;
      const d = e.data as { type?: string; t?: number } | null;
      if (d?.type === "lectern:seek" && typeof d.t === "number") seek(d.t);
      if (d?.type === "lectern:toggle") toggle();
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [seek, toggle]);

  // "Say that again" (a): the current subtitle line (or the previous one, right after a line starts) at 1×.
  const sayAgain = useCallback(() => {
    const now = video.current?.currentTime ?? 0;
    const i = atTime(lines, now);
    if (i < 0) return;
    const line = now - lines[i].start < 1 && i > 0 ? lines[i - 1] : lines[i];
    setAgain(line.words[line.words.length - 1][1]);
    seek(line.start);
    tryPlay();
  }, [lines, seek, tryPlay]);

  // "Explain this moment" (x): a ready-to-paste prompt with what was said around now.
  const explain = useCallback(async () => {
    const now = video.current?.currentTime ?? 0;
    const said = src.words.filter((w) => w[0] >= now - 60 && w[0] <= now + 60).map((w) => w[2]).join(" ");
    const ex = src.examples.find((e) => now >= e.start && now < e.end) ?? focus;
    const ch = src.chapters[atTime(src.chapters, now + 0.5)];
    const text = [
      `I'm revising ${module} for my final exam and watching "${src.label} ${src.title}"${ch ? `, chapter "${ch.title}"` : ""}, at ${fmt(now)} in the recording.`,
      ex ? `The lecturer is working through ${ex.ref ?? "an example"}: ${ex.label}${ex.summary ? ` (${ex.summary})` : ""}.` : "",
      `Automatic transcript of about a minute either side (may contain recognition errors):\n"""${said}"""`,
      "Explain what the lecturer is saying here, step by step, the way I'd need it in the exam, and point out common mistakes. Then give me one similar practice question, with the answer at the very end.",
      `Link to this moment: ${location.origin + watchUrl(module, id, now)}`,
    ].filter(Boolean).join("\n\n");
    try { await navigator.clipboard.writeText(text); flash("Prompt copied: paste it into Claude"); } catch { flash("Couldn't copy the prompt"); }
  }, [src, focus, module, id, flash]);

  const [help, setHelp] = useState(false);

  const copyLink = useCallback(async () => {
    const url = location.origin + watchUrl(module, id, video.current?.currentTime ?? t);
    try { await navigator.clipboard.writeText(url); flash("Link copied"); } catch { flash(url); }
  }, [module, id, t, flash]);

  const pip = () => {
    const v = video.current as (HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void }) | null;
    if (!v) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else if (document.pictureInPictureEnabled) void v.requestPictureInPicture().catch(() => flash("Picture in picture isn't available here"));
    else if (v.webkitSetPresentationMode) v.webkitSetPresentationMode("picture-in-picture");
    else flash("Picture in picture isn't available here");
  };

  const fullscreen = () => {
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (box.current?.requestFullscreen) void box.current.requestFullscreen().catch(() => {});
    else v?.webkitEnterFullscreen?.(); // iPhone: only the video element itself can go fullscreen
  };

  // Keyboard: space/k play · j/l ±10 s · ←/→ ±5 s · [ ] speed · c captions · s cuts · p pauses · n/b chapter · e next example · f fullscreen
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // typing in a text field is typing; a ticked checkbox or a clicked button shouldn't swallow the shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea")) return;
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) el.blur(); // else space would also click it
      const curRate = prefs.rateMode === "auto" ? rate : prefs.manualRate;
      const step = (d: number) => setPrefs({ rateMode: "manual", manualRate: Math.round(Math.min(3, Math.max(0.5, curRate + d)) * 100) / 100 });
      const k = e.key;
      if (k === " " || k === "k") toggle();
      else if (k === "j") nudge(-10);
      else if (k === "l") nudge(10);
      else if (k === "ArrowLeft") nudge(-5);
      else if (k === "ArrowRight") nudge(5);
      else if (k === "[") step(-0.1);
      else if (k === "]") step(0.1);
      else if (k === "c") setPrefs({ subtitles: !prefs.subtitles });
      else if (k === "s") setPrefs({ edit: { ...prefs.edit, skipCuts: !prefs.edit.skipCuts } });
      else if (k === "p") setPrefs({ edit: { ...prefs.edit, skipPauses: !prefs.edit.skipPauses } });
      else if (k === "t") tightenHere();
      else if (k === "N" && next) go(next);
      else if (k === "P" && prev) go(prev);
      else if (k === "T") tightenHere(true);
      else if (k === "n" && src.chapters[chapterIdx + 1]) seek(src.chapters[chapterIdx + 1].start);
      else if (k === "b" && chapter) seek(t - chapter.start > 3 || chapterIdx === 0 ? chapter.start : src.chapters[chapterIdx - 1].start);
      else if (k === "e") { const nx = src.examples.find((x) => x.start > t + 1); if (nx) playExample(nx); }
      else if (k === "f" && !embed) fullscreen();
      else if (k === "a") sayAgain();
      else if (k === "o" && src.examples.length) setPrefs({ edit: { ...prefs.edit, examplesOnly: !prefs.edit.examplesOnly } });
      else if (k === "i") pip();
      else if (k === "x") void explain();
      else if (k === "r") {
        if (!focus) { const ex = src.examples.find((x) => t >= x.start && t < x.end); if (ex) { setFocus(ex); setToRate(null); } }
        setPrefs({ loopExample: !prefs.loopExample });
        flash(prefs.loopExample ? "Example loop off" : "Looping this example");
      }
      else if (k === "?") setHelp(!help);
      else if (k === "Escape" && help) setHelp(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  // Headphone / lock-screen controls
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: src.title, artist: module, album: src.label });
    navigator.mediaSession.setActionHandler("seekbackward", () => nudge(-10));
    navigator.mediaSession.setActionHandler("seekforward", () => nudge(10));
    return () => {
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
    };
  }, [src, module, nudge]);

  const vNow = tl.toVirtual(t);
  const remaining = (tl.virtualDuration - vNow) / rate;

  return (
    <div className={`player${embed ? " is-embed" : ""}`}>
      {help && <KeyHelp close={() => setHelp(false)} />}
      {!embed && <Header crumbs={[{ href: `/m/${module}`, label: module }, { href: watchUrl(module, id), label: src.label }]} />}
      <div className="player-body">
        <section className="stage">
          <div className="video-box" ref={box} onDoubleClick={embed ? undefined : fullscreen}>
            <video ref={video} src={mediaUrl(module, id, quality)} preload="auto" playsInline onClick={toggle}
              onLoadedMetadata={onLoaded} onPlay={() => { setPlaying(true); setEnded(false); }} onPause={() => setPlaying(false)}
              onError={(e) => {
                const err = e.currentTarget.error;
                setVideoError(err?.code === 4 ? "The video file for this recording is missing or can't be played." : `The video stopped loading (${err?.message || "network error"}).`);
              }}
              onCanPlay={() => setVideoError("")}
              onEnded={() => setEnded(true)} onSeeking={(e) => { if (e.currentTarget.currentTime < src.duration - 0.5) setEnded(false); }} />
            {prefs.subtitles && <Subtitles lines={lines} t={t} karaoke={prefs.karaoke} size={prefs.subtitleSize} />}
            {((!playing && ready && !ended) || blocked) && (
              <button className={`big-play${blocked ? " wide" : ""}`} onClick={toggle} aria-label="Play">{blocked ? `▶ Tap to play · ${src.label} ${fmt(tl.toVirtual(t))}` : "▶"}</button>
            )}
            {toRate && !focus && (
              <div className="example-banner">
                <span>How did <b>{toRate.ref ?? "this example"}</b> go?</span>
                <span className="row">
                  {(Object.keys(RATING_LABEL) as Rating[]).map((r) => (
                    <button key={r} onClick={() => { ratings.set(`${key}/${toRate.id}`, r); setToRate(null); flash(RATING_LABEL[r]); }}>{RATING_LABEL[r]}</button>
                  ))}
                  <button onClick={() => setToRate(null)} title="Don't rate">×</button>
                </span>
              </div>
            )}
            {ended && <UpNext next={next} auto={prefs.autoNext} setAuto={(v) => setPrefs({ autoNext: v })} go={go} replay={() => { seek(0); void video.current?.play(); }} />}
            {focus && (
              <div className="example-banner">
                <span><b>{focus.ref ?? "Example"}</b> {exampleTitle(focus)}</span>
                <span className="row">
                  <button className={prefs.loopExample ? "on" : ""} onClick={() => setPrefs({ loopExample: !prefs.loopExample })} title="Loop this example (r)">⟲</button>
                  <button onClick={() => setFocus(null)} title="Keep playing past the end of this example">×</button>
                </span>
              </div>
            )}
            {videoError && (
              <div className="video-error">
                <p>{videoError}</p>
                <p className="small">Transcript, chapters and examples still work. Is the Lectern server running, and was <code>make_proxies.py</code> run for {src.label}?</p>
                <button className="btn" onClick={() => { setVideoError(""); video.current?.load(); }}>Try again</button>
              </div>
            )}
            {toast && <div className="toast">{toast}</div>}
          </div>
          <SeekBar src={src} tl={tl} t={t} onSeek={seek} />
          <div className="controls">
            <button onClick={toggle} className="play" aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
            <button onClick={() => nudge(-10)} title="Back 10 s (j)">↺10</button>
            <button onClick={() => nudge(10)} title="Forward 10 s (l)">10↻</button>
            <button onClick={() => prev && go(prev)} disabled={!prev} title={prev ? `Previous: ${prev.label} ${prev.title} (shift+P)` : "First recording"}>⇤</button>
            <button onClick={() => next && go(next)} disabled={!next} title={next ? `Next: ${next.label} ${next.title} (shift+N)` : "Last recording"}>⇥</button>
            <span className="clock" title={`Recording time ${fmt(t)} / ${fmt(src.duration)}`}>
              {fmt(vNow)} / {fmt(tl.virtualDuration)} <span className="muted">· {fmt(remaining)} left</span>
            </span>
            <span className="chapter-now">{chapter?.title}</span>
            <span className="spacer" />
            <SpeedMenu prefs={prefs} rate={rate} setPrefs={setPrefs} />
            {(src.tiers?.length || prefs.quality != null) ? <select className="quality" value={prefs.quality ?? ""} onChange={(e) => setQuality(e.target.value ? Number(e.target.value) : null)}
              title={prefs.quality != null && quality == null ? `No ${prefs.quality}p copy of this recording yet: playing full quality` : "Video quality (lower = smaller download, e.g. on an iPad over Wi-Fi)"}>
              <option value="">Full quality</option>
              {[...new Set([...(src.tiers ?? []), ...(prefs.quality != null ? [prefs.quality] : [])])].sort((a, b) => b - a).map((h) => (
                <option key={h} value={h}>{h}p{src.tiers?.includes(h) ? "" : " (not made yet)"}</option>
              ))}
            </select> : null}
            <button className={prefs.subtitles ? "on" : ""} onClick={() => setPrefs({ subtitles: !prefs.subtitles })} title="Subtitles (c)">CC</button>
            <button className={prefs.edit.skipCuts ? "on" : ""} onClick={() => setPrefs({ edit: { ...prefs.edit, skipCuts: !prefs.edit.skipCuts } })} title="Skip cuts: off-topic, admin, breaks (s)">✂ Cuts</button>
            <button className={prefs.edit.skipPauses ? "on" : ""} onClick={() => setPrefs({ edit: { ...prefs.edit, skipPauses: !prefs.edit.skipPauses } })} title="Skip pauses (p)">⏭ Pauses</button>
            <button className={local.some((l) => t >= l.start && t < l.end) ? "on" : ""}
              onClick={() => tightenHere()} title="Still too slow here? Trim pauses harder in this chapter (t; shift+t undoes)">⏩ Tighten</button>
            <button className={watched ? "on" : ""} onClick={() => resume.mark([key], !watched)} title={watched ? "Watched: click to mark unwatched" : "Mark as watched"}>{watched ? "✓ Watched" : "○ Watched"}</button>
            {src.examples.length > 0 && (
              <button className={prefs.edit.examplesOnly ? "on" : ""} onClick={() => setPrefs({ edit: { ...prefs.edit, examplesOnly: !prefs.edit.examplesOnly } })}
                title="Examples only: skip everything except the worked examples (o)">🎯 Examples</button>
            )}
            <button onClick={sayAgain} title="Say that again: replay this line at 1× (a)">↶ Again</button>
            <button onClick={() => void explain()} title="Copy a prompt asking Claude to explain this moment (x)">🤖</button>
            <button onClick={copyLink} title="Copy a link to this moment (for your notes)">🔗</button>
            <button onClick={() => setHelp(true)} title="Keyboard shortcuts (?)">?</button>
            <button onClick={pip} title="Picture in picture: keep the lecture floating over other windows (i)">⧉</button>
            {!embed && <button onClick={fullscreen} title="Fullscreen (f)">⛶</button>}
          </div>
        </section>
        <SidePanel src={src} tl={tl} t={t} prefs={prefs} setPrefs={setPrefs} seek={seek} playExample={playExample}
          focus={focus} chapterIdx={chapterIdx} keepCuts={keepCuts} setKeepCuts={setKeepCuts} rate={rate}
          pauses={pauses} local={local} setLocal={updateLocal} />
      </div>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["space / k", "play / pause"], ["j / l", "back / forward 10 s"], ["← / →", "back / forward 5 s"],
  ["a", "say that again: replay this line at 1×"], ["[ / ]", "slower / faster (switches to manual speed)"],
  ["n / b", "next / previous chapter"], ["e", "next worked example"], ["r", "loop the current example"],
  ["shift+N / shift+P", "next / previous recording"], ["c", "subtitles on/off"], ["s", "skip cuts on/off"],
  ["p", "skip pauses on/off"], ["t / shift+T", "trim pauses harder in this chapter / undo"],
  ["o", "examples only: skip everything but the worked examples"], ["i", "picture in picture"],
  ["x", "copy an \"explain this moment\" prompt for Claude"], ["f", "fullscreen"], ["?", "this help"],
];

function KeyHelp({ close }: { close: () => void }) {
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="row"><h2>Keyboard shortcuts</h2><span className="spacer" /><button className="link" onClick={close}>Close</button></div>
        <dl className="keys">{KEYS.map(([k, d]) => <div key={k}><dt>{k}</dt><dd>{d}</dd></div>)}</dl>
      </div>
    </div>
  );
}

/** End of a recording: what's next, with a countdown when autoplay is on. */
function UpNext({ next, auto, setAuto, go, replay }: { next?: SourceSummary; auto: boolean; setAuto: (v: boolean) => void; go: (s: SourceSummary) => void; replay: () => void }) {
  const [left, setLeft] = useState(8);
  useEffect(() => {
    if (!next || !auto) return;
    if (left <= 0) { go(next); return; }
    const timer = window.setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(timer);
  }, [next, auto, left, go]);
  return (
    <div className="up-next">
      {next ? (
        <>
          <p className="muted small">Up next{auto ? ` in ${left} s` : ""}</p>
          <p className="up-title"><b>{next.label}</b> {next.title}</p>
          <div className="row">
            <button className="btn primary" onClick={() => go(next)}>▶ Play now</button>
            <button className="btn" onClick={replay}>↺ Replay</button>
          </div>
        </>
      ) : (
        <>
          <p className="up-title">End of the module's last recording.</p>
          <button className="btn" onClick={replay}>↺ Replay</button>
        </>
      )}
      <label className="row small"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setLeft(8); }} /> Autoplay the next recording</label>
    </div>
  );
}

function Subtitles({ lines, t, karaoke, size }: { lines: Line[]; t: number; karaoke: boolean; size: number }) {
  const i = atTime(lines, t);
  const line = lines[i];
  if (!line || t > line.end) return null;
  const k = currentWord(line, t);
  return (
    <div className="subs" style={{ fontSize: `calc(${size} * clamp(14px, 2.6cqw, 30px))` }}>
      <span>
        {line.words.map((w, j) => (
          <span key={j} className={!karaoke ? "" : j < k ? "said" : j === k ? "now" : "next"}>{w[2]} </span>
        ))}
      </span>
    </div>
  );
}

function SeekBar({ src, tl, t, onSeek }: { src: Source; tl: Timeline; t: number; onSeek: (s: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; v: number } | null>(null);
  const dragging = useRef(false);
  const total = tl.virtualDuration || 1;
  const pct = (source: number) => `${(tl.toVirtual(source) / total) * 100}%`;
  const at = (e: RPointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
    return { x, v: (x / r.width) * total };
  };
  const hoverSource = hover ? tl.toSource(hover.v) : 0;
  const hc = hover ? src.chapters[atTime(src.chapters, hoverSource)] : undefined;
  return (
    <div className="seek" ref={bar}
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); onSeek(tl.toSource(at(e).v)); }}
      onPointerMove={(e) => { const h = at(e); setHover(h); if (dragging.current) onSeek(tl.toSource(h.v)); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      onLostPointerCapture={() => { dragging.current = false; }}
      onPointerLeave={() => setHover(null)}>
      <div className="track">
        {src.examples.map((e) => (
          <div key={e.id} className="ex-span" style={{ left: pct(e.start), width: `calc(${pct(e.end)} - ${pct(e.start)})` }} />
        ))}
        <div className="fill" style={{ width: pct(t) }} />
        {src.chapters.slice(1).map((c) => <div key={c.start} className="tick" style={{ left: pct(c.start) }} />)}
        <div className="knob" style={{ left: pct(t) }} />
      </div>
      {hover && (
        <div className="seek-tip" style={{ left: hover.x }}>
          <b>{fmt(hover.v)}</b> {hc?.title}
        </div>
      )}
    </div>
  );
}

function SpeedMenu({ prefs, rate, setPrefs }: { prefs: Prefs; rate: number; setPrefs: (p: Partial<Prefs>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="menu-wrap">
      <button onClick={() => setOpen(!open)} title="Speed ([ and ])">{prefs.rateMode === "auto" ? "Auto " : ""}{rate.toFixed(2)}×</button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          <label className="row">
            <input type="radio" checked={prefs.rateMode === "auto"} onChange={() => setPrefs({ rateMode: "auto" })} />
            Auto: speech at
            <input type="number" min={120} max={400} step={10} value={prefs.targetWpm}
              onChange={(e) => setPrefs({ rateMode: "auto", targetWpm: Number(e.target.value) || 250 })} /> wpm
          </label>
          <div className="rates">
            {RATES.map((r) => (
              <button key={r} className={prefs.rateMode === "manual" && prefs.manualRate === r ? "on" : ""}
                onClick={() => { setPrefs({ rateMode: "manual", manualRate: r }); setOpen(false); }}>{r}×</button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

type PanelProps = {
  src: Source; tl: Timeline; t: number; prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; seek: (s: number) => void;
  playExample: (e: Example) => void; focus: Example | null; chapterIdx: number; keepCuts: number[];
  setKeepCuts: (k: number[]) => void; rate: number;
  pauses: [number, number][]; local: LocalPause[]; setLocal: (l: LocalPause[]) => void;
};

function SidePanel(p: PanelProps) {
  const { src, prefs, setPrefs } = p;
  const tabs: [Prefs["panel"], string][] = [["chapters", `Chapters`], ["examples", `Examples (${src.examples.length})`], ["transcript", "Transcript"], ["cuts", "Edits"]];
  return (
    <aside className="panel">
      <nav className="tabs">
        {tabs.map(([k, label]) => <button key={k} className={prefs.panel === k ? "on" : ""} onClick={() => setPrefs({ panel: k })}>{label}</button>)}
      </nav>
      <div className="panel-body">
        {prefs.panel === "chapters" && <Chapters {...p} />}
        {prefs.panel === "examples" && <Examples {...p} />}
        {prefs.panel === "transcript" && <Transcript src={src} t={p.t} seek={p.seek} />}
        {prefs.panel === "cuts" && <Edits {...p} />}
      </div>
    </aside>
  );
}

function Chapters({ src, tl, t, seek, chapterIdx }: PanelProps) {
  const cur = useRef<HTMLLIElement>(null);
  useEffect(() => { cur.current?.scrollIntoView({ block: "nearest" }); }, [chapterIdx]);
  if (!src.indexed) return <p className="muted pad">Chapters for this recording haven't been indexed yet.</p>;
  return (
    <ol className="list">
      {src.chapters.map((c, i) => (
        <li key={c.start} ref={i === chapterIdx ? cur : undefined} className={i === chapterIdx ? "on" : i < chapterIdx ? "past" : ""}>
          <button onClick={() => seek(c.start)}>
            <span className="time">{fmt(tl.toVirtual(c.start))}</span>
            <span>{c.title}</span>
            {i === chapterIdx && <span className="progress" style={{ width: `${chapterProgress(src, tl, i, t) * 100}%` }} />}
          </button>
        </li>
      ))}
    </ol>
  );
}

function chapterProgress(src: Source, tl: Timeline, i: number, t: number) {
  const a = tl.toVirtual(src.chapters[i].start), b = tl.toVirtual(src.chapters[i + 1]?.start ?? src.duration);
  return b > a ? Math.min(1, Math.max(0, (tl.toVirtual(t) - a) / (b - a))) : 0;
}

function Examples({ src, tl, t, playExample, focus, prefs, setPrefs }: PanelProps) {
  const rated = useRatings();
  const base = `${src.module}/${src.id}`;
  if (!src.examples.length) return <p className="muted pad">{src.indexed ? "No worked examples in this recording." : "Worked examples for this recording haven't been indexed yet."}</p>;
  return (
    <>
      <label className="row pad small">
        <input type="checkbox" checked={prefs.stopAtExampleEnd} onChange={(e) => setPrefs({ stopAtExampleEnd: e.target.checked })} />
        Pause when an example I open finishes
      </label>
      <ul className="list examples-list">
        {src.examples.map((e) => {
          const on = t >= e.start && t < e.end;
          return (
            <li key={e.id} className={`${on ? "on" : ""} ${focus?.id === e.id ? "focus" : ""}`}>
              <button onClick={() => playExample(e)}>
                <span className="time">{fmt(tl.toVirtual(e.start))}</span>
                <span>
                  {e.ref && <span className="ref">{e.ref}</span>} {exampleTitle(e)}
                  {e.summary && <span className="summary">{e.summary}</span>}
                </span>
              </button>
              <span className="rate">
                {(Object.keys(RATING_LABEL) as Rating[]).map((r) => (
                  <button key={r} className={`r-${r}${rated[`${base}/${e.id}`] === r ? " on" : ""}`}
                    onClick={() => ratings.set(`${base}/${e.id}`, rated[`${base}/${e.id}`] === r ? null : r)}>{RATING_LABEL[r]}</button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const Paragraph = memo(function Paragraph({ line, word, seek }: { line: Line; word: number; seek: (s: number) => void }) {
  return (
    <p className={word >= 0 ? "on" : ""} data-start={line.start}>
      <span className="time" onClick={() => seek(line.start)}>{fmt(line.start)}</span>
      {line.words.map((w, j) => (
        <span key={j} className={j === word ? "now" : undefined} onClick={() => seek(w[0])}>{w[2]} </span>
      ))}
    </p>
  );
});

function Transcript({ src, t, seek }: { src: Source; t: number; seek: (s: number) => void }) {
  const paras = useMemo(() => buildParagraphs(src.words), [src.words]);
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const i = atTime(paras, t);
  const active = paras[i] && t <= paras[i].end + 2.5 ? i : -1;
  const w = active >= 0 ? currentWord(paras[active], t) : -1;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const texts = useMemo(() => paras.map((p) => p.words.map((x) => x[2]).join(" ").toLowerCase()), [paras]);
  const shown = useMemo(() => terms.length ? paras.filter((_, i) => terms.every((x) => texts[i].includes(x))) : paras,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paras, texts, q]);
  useEffect(() => {
    if (!follow || terms.length || active < 0) return;
    box.current?.querySelector("p.on")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, follow, terms.length]);
  return (
    <div className="transcript">
      <div className="row pad">
        <input type="search" placeholder="Find in transcript" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="small"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow</label>
      </div>
      <div className="paras" ref={box}>
        {shown.map((p) => <Paragraph key={p.start} line={p} word={paras[active] === p ? w : -1} seek={seek} />)}
        {terms.length > 0 && shown.length === 0 && <p className="muted">Not said in this recording.</p>}
      </div>
    </div>
  );
}

function Edits({ src, tl, prefs, setPrefs, keepCuts, setKeepCuts, seek, rate, pauses, local, setLocal: updateLocal }: PanelProps) {
  const active = new Set(activeCuts(src.cuts, { ...prefs.edit, keepCuts }));
  const cats = [...new Set(src.cuts.map((c) => c.category))];
  const pauseSec = pauses.reduce((a, [x, y]) => a + y - x, 0);
  const level = (v: number | null) => v == null ? "reviewed" : String(v);
  const kept = useMemo(() => keptWpm(src.words, tl), [src.words, tl]);
  const setCat = (c: CutCategory, skip: boolean) => {
    const keep = prefs.edit.keepCategories.filter((x) => x !== c);
    setPrefs({ edit: { ...prefs.edit, keepCategories: skip ? keep : [...keep, c] } });
  };
  return (
    <div className="pad edits">
      <p className="small muted">
        Recording {fmt(src.duration)} → {fmt(tl.virtualDuration)} kept → <b>{fmt(tl.virtualDuration / rate)}</b> at {rate.toFixed(2)}×
        (speech {Math.round(kept)} → {Math.round(kept * rate)} wpm).
      </p>
      <label className="row">
        <input type="checkbox" checked={prefs.edit.skipPauses} onChange={(e) => setPrefs({ edit: { ...prefs.edit, skipPauses: e.target.checked } })} />
        Skip pauses <span className="muted">({pauses.length} pauses, {fmt(pauseSec)})</span>
      </label>
      {prefs.edit.skipPauses && (
        <div className="cats">
          <label className="row small">
            Keep at most
            <select value={level(prefs.pauseMax)} onChange={(e) => setPrefs({ pauseMax: e.target.value === "reviewed" ? null : Number(e.target.value) })}>
              <option value="reviewed">reviewed pauses (default)</option>
              {PAUSE_LEVELS.map((l) => <option key={l} value={l}>{l} s of each pause</option>)}
            </select>
          </label>
          {local.map((l, i) => (
            <div key={`${l.start}-${l.end}`} className="row small">
              <button className="link" onClick={() => seek(l.start)} title="Go there">{l.label ?? `${fmt(l.start)}–${fmt(l.end)}`}</button>
              <select value={l.max} onChange={(e) => updateLocal(local.map((x, j) => j === i ? { ...x, max: Number(e.target.value) } : x))}>
                {PAUSE_LEVELS.map((v) => <option key={v} value={v}>{v} s</option>)}
              </select>
              <button className="link" onClick={() => updateLocal(local.filter((_, j) => j !== i))} title="Back to the global setting">×</button>
            </div>
          ))}
          <p className="muted small">Still too slow somewhere? Press <b>t</b> or ⏩ Tighten while watching to trim pauses harder in that chapter (again for tighter, shift+t to undo). Remembered for this recording.</p>
        </div>
      )}
      <label className="row">
        <input type="checkbox" checked={prefs.edit.skipCuts} onChange={(e) => setPrefs({ edit: { ...prefs.edit, skipCuts: e.target.checked } })} />
        Skip cuts <span className="muted">({src.cuts.length} reviewed stretches)</span>
      </label>
      {src.examples.length > 0 && (
        <label className="row">
          <input type="checkbox" checked={!!prefs.edit.examplesOnly} onChange={(e) => setPrefs({ edit: { ...prefs.edit, examplesOnly: e.target.checked } })} />
          Examples only <span className="muted">(play just the {src.examples.length} worked examples)</span>
        </label>
      )}
      {prefs.edit.skipCuts && cats.length > 0 && (
        <div className="cats">
          {cats.map((c) => (
            <label key={c} className="row small">
              <input type="checkbox" checked={!prefs.edit.keepCategories.includes(c)} onChange={(e) => setCat(c, e.target.checked)} />
              {CATEGORY_LABEL[c] ?? c}
            </label>
          ))}
        </div>
      )}
      <ul className="list cuts">
        {src.cuts.map((c, i) => (
          <li key={i} className={active.has(c) ? "" : "kept"}>
            <input type="checkbox" checked={active.has(c)} disabled={!prefs.edit.skipCuts || prefs.edit.keepCategories.includes(c.category)}
              title="Skip this stretch" onChange={(e) => setKeepCuts(e.target.checked ? keepCuts.filter((k) => k !== i) : [...keepCuts, i])} />
            <button onClick={() => seek(c.start)} title="Watch this stretch (turn the checkbox off first to hear it)">
              <span className="time">{fmt(c.start)}</span>
              <span>{c.reason} <span className="muted">· {fmt(c.end - c.start)} · {CATEGORY_LABEL[c.category] ?? c.category}</span></span>
            </button>
          </li>
        ))}
      </ul>
      <p className="small muted">Press <b>?</b> for keyboard shortcuts.</p>
    </div>
  );
}
