// The page embedding Lectern (padSync's Lecture tab). Messages are only taken from it (or from the window that
// opened this one), and replies go to its origin when the browser tells us what that is.
export const host: Window | null = window.parent !== window ? window.parent : window.opener ?? null;

const hostOrigin = (() => {
  const a = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (a?.length) return a[0];
  try { return document.referrer ? new URL(document.referrer).origin : "*"; } catch { return "*"; }
})();

export const fromHost = (e: MessageEvent) => host != null && e.source === host;

export function tellHost(msg: Record<string, unknown>) {
  try { host?.postMessage({ v: 1, ...msg }, hostOrigin); } catch { /* host gone */ }
}
