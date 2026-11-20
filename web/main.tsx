import { StrictMode, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Home, ModulePage } from "./Library.tsx";
import { Player } from "./Player.tsx";
import "./styles.css";

// Embedded (padSync's Lecture tab) is decided once: links inside Lectern don't carry ?embed=1, and a framed page
// stays framed however it navigates.
const EMBED = new URLSearchParams(location.search).get("embed") === "1" || window.self !== window.top;

// Routes: /  ·  /m/<module>  ·  /watch/<module>/<source>?t=<sec>&e=<example>&embed=1
export function navigate(href: string, replace = false) {
  if (replace) history.replaceState(null, "", href); else history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Link({ href, children, className, title }: { href: string; children: ReactNode; className?: string; title?: string }) {
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={onClick} className={className} title={title}>{children}</a>;
}

function App() {
  const [loc, setLoc] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const on = () => setLoc(location.pathname + location.search);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  // a host page (padSync's lecture panel) can drive the player: {type: "lectern:open", url: "/watch/..."}
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type === "lectern:open" && typeof d.url === "string" && d.url.startsWith("/")) navigate(d.url);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  const url = new URL(loc, location.origin);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const embed = EMBED || url.searchParams.get("embed") === "1";
  useEffect(() => { document.documentElement.classList.toggle("embed", embed); }, [embed]);

  if (parts[0] === "watch" && parts.length === 3) {
    const t = url.searchParams.get("t");
    return <Player key={`${parts[1]}/${parts[2]}`} module={parts[1]} id={parts[2]} embed={embed}
      startAt={t != null && Number.isFinite(Number(t)) ? Number(t) : undefined} example={url.searchParams.get("e") ?? undefined} />;
  }
  if (parts[0] === "m" && parts[1]) return <ModulePage code={parts[1]} />;
  return <Home />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
