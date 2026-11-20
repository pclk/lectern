import { useEffect, useState } from "react";
import type { ExampleHit, Library, SearchHit, Source } from "../shared/types.ts";

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${(await r.json().catch(() => ({}))).error ?? r.statusText}`);
  return r.json() as Promise<T>;
}

export const api = {
  library: () => get<Library>("/api/library"),
  source: (m: string, id: string) => get<Source>(`/api/source/${encodeURIComponent(m)}/${encodeURIComponent(id)}`),
  examples: (m: string) => get<ExampleHit[]>(`/api/examples/${encodeURIComponent(m)}`),
  search: (q: string) => get<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
};

export const mediaUrl = (m: string, id: string) => `/media/${encodeURIComponent(m)}/${encodeURIComponent(id)}.mp4`;

export function watchUrl(m: string, id: string, t?: number, example?: string) {
  const q = new URLSearchParams();
  if (t != null) q.set("t", String(Math.floor(t)));
  if (example) q.set("e", example);
  const s = q.toString();
  return `/watch/${encodeURIComponent(m)}/${encodeURIComponent(id)}${s ? `?${s}` : ""}`;
}

export type Loaded<T> = { data: T; error?: undefined } | { data?: undefined; error: string } | { data?: undefined; error?: undefined };

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({});
  useEffect(() => {
    let live = true;
    setState({});
    load().then((data) => live && setState({ data }), (e: Error) => live && setState({ error: e.message }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
