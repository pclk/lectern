import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { activeCuts, atTime, autoRate, DEFAULT_EDIT, fmt, keptWpm, skipRanges, Timeline } from "../shared/edl.ts";
import { PAUSE_LEVELS, pauseLevelAt, pauseRanges, setLocal, tighter, type LocalPause, type PauseSettings } from "../shared/pauses.ts";
import { buildLines, buildParagraphs, currentWord, type Line } from "../shared/subtitles.ts";
import type { CutCategory, Example, Source } from "../shared/types.ts";
import { api, mediaUrl, useLoad, watchUrl } from "./api.ts";
import { Header } from "./Library.tsx";
import { localPauses, usePrefs, resume, type Prefs } from "./prefs.ts";

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
  const [local, setLocalState] = useState<LocalPause[]>(() => localPauses.get(key));
  const updateLocal = useCallback((l: LocalPause[]) => { setLocalState(l); localPauses.set(key, l); }, [key]);
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
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState("");
  const [focus, setFocus] = useState<Example | null>(() => src.examples.find((e) => e.id === example) ?? null);

  // refs read by the frame loop, so it never restarts
  const live = useRef({ tl, focus, stopAtEnd: prefs.stopAtExampleEnd });
  live.current = { tl, focus, stopAtEnd: prefs.stopAtExampleEnd };

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
  useEffect(() => { const v = video.current; if (v) v.playbackRate = rate; }, [rate, ready]);
  useEffect(() => { const v = video.current; if (v) v.volume = prefs.volume; }, [prefs.volume, ready]);

  // Frame loop: jump over skipped stretches, stop at the end of a linked example, publish the clock.
  useEffect(() => {
    const v = video.current!;
    let raf = 0, last = -1;
    const tick = () => {
      const { tl, focus, stopAtEnd } = live.current;
      const ct = v.currentTime;
      if (!v.seeking && !v.paused) {
        const r = tl.skipAt(ct + 0.02);
        if (r) {
          if (r[1] >= tl.duration - 0.05) { v.pause(); v.currentTime = tl.duration; }
          else v.currentTime = r[1];
        }
        if (focus && stopAtEnd && ct >= focus.end && ct < focus.end + 1.5) { v.pause(); setFocus(null); }
      }
      if (Math.abs(ct - last) >= 0.04) { last = ct; setT(ct); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const seek = useCallback((source: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = live.current.tl.snap(Math.max(0, Math.min(source, src.duration)));
    setT(v.currentTime);
  }, [src.duration]);
  const seekVirtual = useCallback((virtual: number) => seek(live.current.tl.toSource(Math.max(0, virtual))), [seek]);
  const nudge = useCallback((dv: number) => seekVirtual(live.current.tl.toVirtual(video.current?.currentTime ?? 0) + dv), [seekVirtual]);
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {}); else v.pause();
  }, []);
  const playExample = useCallback((e: Example) => { setFocus(e); seek(e.start); void video.current?.play().catch(() => {}); }, [seek]);

  // Start position: ?t= / ?e= from a link, else where you left off.
  const onLoaded = () => {
    const at = resume.get(key);
    const start = startAt ?? focus?.start ?? (at && !at.done ? at.t : 0);
    seek(start);
    setReady(true);
    if (startAt != null || focus) void video.current?.play().catch(() => {});
  };

  // Remember the position; mark watched near the end.
  useEffect(() => {
    if (!ready) return;
    const save = () => {
      const v = video.current;
      if (!v) return;
      resume.set(key, v.currentTime, tl.toVirtual(v.currentTime) > tl.virtualDuration * 0.95);
    };
    const timer = window.setInterval(save, 5000);
    window.addEventListener("pagehide", save);
    return () => { save(); clearInterval(timer); window.removeEventListener("pagehide", save); };
  }, [ready, key, tl]);

  // Keep ?t= current while paused, so a reload or a copied address resumes here.
  useEffect(() => {
    if (playing || !ready) return;
    const u = new URL(location.href);
    u.searchParams.set("t", String(Math.floor(t)));
    u.searchParams.delete("e");
    history.replaceState(null, "", u.pathname + u.search);
  }, [playing, ready, t]);

  const chapterIdx = atTime(src.chapters, t + 0.5);
  const chapter = src.chapters[chapterIdx];

  // Embedded in padSync: report where we are, about once a second.
  const lastPost = useRef(0);
  useEffect(() => {
    if (!embed || window.parent === window || Math.abs(t - lastPost.current) < 1) return;
    lastPost.current = t;
    window.parent.postMessage({ type: "lectern:state", module, source: id, title: src.title, label: src.label, t,
      chapter: chapter?.title ?? null, url: location.origin + watchUrl(module, id, t), playing }, "*");
  }, [embed, t, playing, module, id, src, chapter]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as { type?: string; t?: number } | null;
      if (d?.type === "lectern:seek" && typeof d.t === "number") seek(d.t);
      if (d?.type === "lectern:toggle") toggle();
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [seek, toggle]);

  const copyLink = useCallback(async () => {
    const url = location.origin + watchUrl(module, id, video.current?.currentTime ?? t);
    try { await navigator.clipboard.writeText(url); flash("Link copied"); } catch { flash(url); }
  }, [module, id, t, flash]);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen?.().catch(() => {});
  };

  // Keyboard: space/k play · j/l ±10 s · ←/→ ±5 s · [ ] speed · c captions · s cuts · p pauses · n/b chapter · e next example · f fullscreen
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, select, textarea")) return;
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
      else if (k === "T") tightenHere(true);
      else if (k === "n" && src.chapters[chapterIdx + 1]) seek(src.chapters[chapterIdx + 1].start);
      else if (k === "b" && chapter) seek(t - chapter.start > 3 || chapterIdx === 0 ? chapter.start : src.chapters[chapterIdx - 1].start);
      else if (k === "e") { const nx = src.examples.find((x) => x.start > t + 1); if (nx) playExample(nx); }
      else if (k === "f") fullscreen();
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
      {!embed && <Header crumbs={[{ href: `/m/${module}`, label: module }, { href: watchUrl(module, id), label: src.label }]} />}
      <div className="player-body">
        <section className="stage">
          <div className="video-box" ref={box} onDoubleClick={fullscreen}>
            <video ref={video} src={mediaUrl(module, id)} preload="auto" playsInline onClick={toggle}
              onLoadedMetadata={onLoaded} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
            {prefs.subtitles && <Subtitles lines={lines} t={t} karaoke={prefs.karaoke} size={prefs.subtitleSize} />}
            {!playing && ready && <button className="big-play" onClick={toggle} aria-label="Play">▶</button>}
            {focus && (
              <div className="example-banner">
                <span><b>{focus.ref ?? "Example"}</b> {focus.label}</span>
                <button onClick={() => setFocus(null)} title="Keep playing past the end of this example">×</button>
              </div>
            )}
            {toast && <div className="toast">{toast}</div>}
          </div>
          <SeekBar src={src} tl={tl} t={t} onSeek={seek} />
          <div className="controls">
            <button onClick={toggle} className="play" aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
            <button onClick={() => nudge(-10)} title="Back 10 s (j)">↺10</button>
            <button onClick={() => nudge(10)} title="Forward 10 s (l)">10↻</button>
            <span className="clock" title={`Recording time ${fmt(t)} / ${fmt(src.duration)}`}>
              {fmt(vNow)} / {fmt(tl.virtualDuration)} <span className="muted">· {fmt(remaining)} left</span>
            </span>
            <span className="chapter-now">{chapter?.title}</span>
            <span className="spacer" />
            <SpeedMenu prefs={prefs} rate={rate} setPrefs={setPrefs} />
            <button className={prefs.subtitles ? "on" : ""} onClick={() => setPrefs({ subtitles: !prefs.subtitles })} title="Subtitles (c)">CC</button>
            <button className={prefs.edit.skipCuts ? "on" : ""} onClick={() => setPrefs({ edit: { ...prefs.edit, skipCuts: !prefs.edit.skipCuts } })} title="Skip cuts: off-topic, admin, breaks (s)">✂ Cuts</button>
            <button className={prefs.edit.skipPauses ? "on" : ""} onClick={() => setPrefs({ edit: { ...prefs.edit, skipPauses: !prefs.edit.skipPauses } })} title="Skip pauses (p)">⏭ Pauses</button>
            <button className={local.some((l) => t >= l.start && t < l.end) ? "on" : ""}
              onClick={() => tightenHere()} title="Still too slow here? Trim pauses harder in this chapter (t; shift+t undoes)">⏩ Tighten</button>
            <button onClick={copyLink} title="Copy a link to this moment (for your notes)">🔗</button>
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
                  {e.ref && <span className="ref">{e.ref}</span>} {e.label}
                  {e.summary && <span className="summary">{e.summary}</span>}
                </span>
              </button>
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
  const shown = terms.length ? paras.filter((p) => { const s = p.words.map((x) => x[2]).join(" ").toLowerCase(); return terms.every((x) => s.includes(x)); }) : paras;
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
  const kept = keptWpm(src.words, tl);
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
      <p className="small muted">Keys: space play · j/l ±10 s · ←/→ ±5 s · [ ] speed · c captions · s cuts · p pauses · t/T tighten/undo pauses here · n/b chapters · e next example · f fullscreen</p>
    </div>
  );
}
