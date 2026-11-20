import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { exampleTitle, fmt } from "../shared/edl.ts";
import type { ExampleHit, Module, SearchHit, SourceSummary } from "../shared/types.ts";
import { api, useLoad, watchUrl } from "./api.ts";
import { Link } from "./main.tsx";
import { RATING_LABEL, resume, usePrefs, useRatings, useResume } from "./prefs.ts";

const KIND_LABEL: Record<string, string> = {
  "problem-set": "Problem set", tutorial: "Tutorial", quiz: "Quiz", midterm: "Midterm", "past-paper": "Past paper",
  "slide-example": "Slide", "notes-example": "Notes", "lecture-example": "Lecture", poll: "Poll", derivation: "Derivation",
};

export function Header({ crumbs = [] }: { crumbs?: { href: string; label: string }[] }) {
  return (
    <header className="top">
      <Link href="/" className="brand"><img src="/icon.svg" alt="" width={22} height={22} /> Lectern</Link>
      {crumbs.map((c) => <span key={c.href} className="crumb">/ <Link href={c.href}>{c.label}</Link></span>)}
      <span className="spacer" />
      <span className="local" title="Videos are served from this computer only">● local</span>
    </header>
  );
}

function SearchBox() {
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  useEffect(() => {
    if (dq.length < 3) { setHits(null); return; }
    let live = true;
    const t = setTimeout(() => api.search(dq).then((h) => live && setHits(h), () => live && setHits([])), 200);
    return () => { live = false; clearTimeout(t); };
  }, [dq]);
  return (
    <section className="search">
      <input type="search" placeholder="Search everything that was said in every lecture…" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits && (
        <ul className="hits">
          {hits.length === 0 && <li className="muted">No matches.</li>}
          {hits.map((h, i) => (
            <li key={i}>
              <Link href={watchUrl(h.module, h.source, h.start)}>
                <span className="hit-src">{h.module} · {h.sourceTitle} · {fmt(h.start)}</span>
                <span className="hit-text">{highlight(h.text, dq)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function highlight(text: string, q: string) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return text.split(/(\s+)/).map((w, i) => terms.some((t) => w.toLowerCase().includes(t)) ? <mark key={i}>{w}</mark> : w);
}

export function Home() {
  const lib = useLoad(api.library, []);
  useEffect(() => { document.title = "Lectern"; }, []);
  return (
    <div className="page">
      <Header />
      <main className="wrap">
        <SearchBox />
        {lib.error && <p className="error">Couldn't load the library: {lib.error}</p>}
        {lib.data?.modules.length === 0 && <EmptyLibrary />}
        <div className="modules">
          {lib.data?.modules.map((m) => <ModuleCard key={m.code} m={m} />)}
        </div>
        <footer className="get-skill">
          <a className="btn" href="/downloads/lecture-exam-prep.zip" download>⬇ Claude skill: lecture-exam-prep</a>
          <span className="muted small">Builds this library from a course folder: transcribes, reviews cuts, indexes chapters and worked examples, makes the annotation packs. Unzip into <code>~/.claude/skills/</code>.</span>
        </footer>
      </main>
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="empty">
      <h2>No lectures yet</h2>
      <p>Lectern plays the library written by the <code>lecture-exam-prep</code> pipeline. From its work directory run</p>
      <pre>python make_proxies.py ~/Lectern/library{"\n"}python export_lectern.py ~/Lectern/library</pre>
      <p>or start the server with <code>--library &lt;dir&gt;</code>.</p>
    </div>
  );
}

function ModuleCard({ m }: { m: Module }) {
  const r = useResume();
  const [prefs] = usePrefs();
  // condensedMinutes is at 250 wpm; scale to your speech target, minus what's been watched
  const scale = prefs.rateMode === "auto" ? 250 / prefs.targetWpm : 1;
  const left = m.sources.reduce((a, s) => {
    const at = r[`${m.code}/${s.id}`];
    return a + (at?.done ? 0 : s.condensedMinutes * (1 - Math.min(1, (at?.t ?? 0) / s.duration)));
  }, 0) * scale;
  const total = m.sources.reduce((a, s) => a + s.condensedMinutes, 0);
  const done = m.sources.filter((s) => r[`${m.code}/${s.id}`]?.done).length;
  const next = m.sources.find((s) => !r[`${m.code}/${s.id}`]?.done);
  return (
    <article className="card">
      <Link href={`/m/${m.code}`} className="card-head">
        <h2>{m.code}</h2>
        <p>{m.title}</p>
      </Link>
      <div className="meter"><div style={{ width: `${(done / Math.max(1, m.sources.length)) * 100}%` }} /></div>
      <p className="muted"><b>≈ {Math.floor(left / 60)} h {Math.round(left % 60)} min left</b>{prefs.rateMode === "auto" ? ` at ${prefs.targetWpm} wpm` : ""} · {done}/{m.sources.length} recordings watched · {Math.round(total / 6) / 10} h condensed · {m.sources.reduce((a, s) => a + s.exampleCount, 0)} worked examples</p>
      {next && <Link className="btn primary" href={continueHref(m.code, next)}>▶ {r[`${m.code}/${next.id}`] ? "Continue" : "Start"}: {next.title}</Link>}
    </article>
  );
}

function continueHref(m: string, s: SourceSummary) {
  const at = resume.get(`${m}/${s.id}`);
  return watchUrl(m, s.id, at && !at.done ? at.t : undefined);
}

export function ModulePage({ code }: { code: string }) {
  const lib = useLoad(api.library, []);
  const ex = useLoad(() => api.examples(code), [code]);
  const m = lib.data?.modules.find((x) => x.code === code);
  const [tab, setTab] = useState<"lectures" | "examples">(() => (location.hash === "#examples" ? "examples" : "lectures"));
  useEffect(() => { document.title = `${code} · Lectern`; }, [code]);
  if (lib.data && !m) return <div className="page"><Header /><main className="wrap"><p className="error">No module {code}.</p></main></div>;
  return (
    <div className="page">
      <Header crumbs={[{ href: `/m/${code}`, label: code }]} />
      <main className="wrap">
        {m && (
          <>
            <h1>{m.code} <span className="muted">{m.title}</span></h1>
            {m.packs.length > 0 && (
              <div className="packs">
                {m.packs.map((p) => <a key={p.file} className="btn" href={`/packs/${m.code}/${p.file}`} target="_blank" rel="noreferrer">📄 {p.title}</a>)}
              </div>
            )}
            <nav className="tabs">
              <button className={tab === "lectures" ? "on" : ""} onClick={() => { setTab("lectures"); history.replaceState(null, "", "#"); }}>Recordings ({m.sources.length})</button>
              <button className={tab === "examples" ? "on" : ""} onClick={() => { setTab("examples"); history.replaceState(null, "", "#examples"); }}>Worked examples ({ex.data?.length ?? "…"})</button>
            </nav>
            {tab === "lectures" ? <><ModuleActions m={m} /><SourceList m={m} /></> : <ExampleIndex hits={ex.data} />}
          </>
        )}
      </main>
    </div>
  );
}

function ModuleActions({ m }: { m: Module }) {
  const keys = m.sources.map((s) => `${m.code}/${s.id}`);
  const r = useResume();
  const done = keys.filter((k) => r[k]?.done).length;
  return (
    <div className="row module-actions">
      <span className="muted small">{done}/{keys.length} watched</span>
      <span className="spacer" />
      <button className="btn" onClick={() => resume.mark(keys, true)} disabled={done === keys.length}>✓ Mark all watched</button>
      <button className="btn" onClick={() => resume.mark(keys, false)} disabled={done === 0}>○ Mark all unwatched</button>
      <button className="btn" onClick={() => { if (confirm(`Forget every position and watched mark in ${m.code}?`)) resume.reset(keys); }}>↺ Reset progress</button>
    </div>
  );
}

function SourceList({ m }: { m: Module }) {
  const r = useResume();
  return (
    <ol className="sources">
      {m.sources.map((s) => {
        const k = `${m.code}/${s.id}`;
        const at = r[k];
        return (
          <li key={s.id} className={at?.done ? "done" : ""}>
            <span className="row-actions">
              <button title={at?.done ? "Watched: mark unwatched" : "Mark watched"} className={at?.done ? "on" : ""} onClick={() => resume.mark([k], !at?.done)}>{at?.done ? "✓" : "○"}</button>
              {at && <button title="Reset progress (forget position and watched mark)" onClick={() => resume.reset([k])}>↺</button>}
            </span>
            <Link href={continueHref(m.code, s)}>
              <span className="label">{s.label}</span>
              <span className="title">{s.title}</span>
              <span className="meta">
                {fmt(s.duration)} → <b>{Math.round(s.condensedMinutes)} min</b>
                {s.indexed ? ` · ${s.chapterCount} chapters · ${s.exampleCount} examples` : " · not indexed yet"}
                {at && !at.done && ` · resume ${fmt(at.t)}`}{at?.done && " · ✓ watched"}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function ExampleIndex({ hits }: { hits?: ExampleHit[] }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [rating, setRating] = useState("");
  const rated = useRatings();
  const kinds = useMemo(() => [...new Set(hits?.map((h) => h.kind))].sort(), [hits]);
  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const ok = (h: ExampleHit) => {
      const r = rated[`${h.module}/${h.source}/${h.id}`];
      return !rating || (rating === "todo" ? r === "redo" || r === "shaky" : rating === "none" ? !r : r === rating);
    };
    return (hits ?? []).filter((h) => (!kind || h.kind === kind) && ok(h) &&
      terms.every((t) => `${h.label} ${h.ref ?? ""} ${h.summary ?? ""} ${h.sourceLabel}`.toLowerCase().includes(t)));
  }, [hits, q, kind, rating, rated]);
  if (!hits) return <p className="muted">Loading…</p>;
  return (
    <section>
      <div className="filters">
        <input type="search" placeholder='Find a question, e.g. "PS05 Q2", "washer", "wildcard"' value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}
        </select>
        <select value={rating} onChange={(e) => setRating(e.target.value)} title="How it went when you watched it">
          <option value="">Any rating</option>
          <option value="todo">Redo + Shaky</option>
          <option value="none">Not rated yet</option>
          <option value="redo">{RATING_LABEL.redo}</option>
          <option value="shaky">{RATING_LABEL.shaky}</option>
          <option value="got">{RATING_LABEL.got}</option>
        </select>
      </div>
      <ul className="examples">
        {shown.map((h) => (
          <li key={`${h.source}/${h.id}`}>
            <Link href={watchUrl(h.module, h.source, h.start, h.id)}>
              <span className="row">
                <span className="ref">{h.ref ?? KIND_LABEL[h.kind] ?? h.kind}</span>
                {rated[`${h.module}/${h.source}/${h.id}`] && <span className={`badge r-${rated[`${h.module}/${h.source}/${h.id}`]}`}>{RATING_LABEL[rated[`${h.module}/${h.source}/${h.id}`]]}</span>}
              </span>
              <span className="title">{exampleTitle(h)}</span>
              {h.summary && <span className="summary">{h.summary}</span>}
              <span className="meta">{h.sourceLabel} · {fmt(h.start)} · {Math.max(1, Math.round((h.end - h.start) / 60))} min</span>
            </Link>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">No examples match.</li>}
      </ul>
    </section>
  );
}
