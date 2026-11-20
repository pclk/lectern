// Lectern server: serves the built web app, the library API, and the lecture videos with HTTP range support.
// Videos never leave the machine. By default it listens on 127.0.0.1 only; --lan also listens on the local
// network so an iPad can open links (http://<mac-name>.local:4747/...) next to padSync in Split View.
//
//   node server/main.ts [--port 4747] [--library ~/Lectern/library] [--lan] [--https [--cert f.pem --key f-key.pem]]
//
// --https serves over TLS so padSync (an https page) may embed it from an iPad: browsers block an http iframe in an
// https page ("mixed content"), except for localhost on the same machine. Make a certificate the iPad trusts with
// mkcert (see README): defaults are ~/Lectern/certs/lectern.pem and lectern-key.pem.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";
import { LibraryStore } from "./library.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(opt("port", process.env.LECTERN_PORT ?? "4747"));
const LIBRARY = opt("library", process.env.LECTERN_LIBRARY ?? path.join(os.homedir(), "Lectern", "library")).replace(/^~(?=\/)/, os.homedir());
const LAN = args.includes("--lan") || process.env.LECTERN_LAN === "1";
const HTTPS = args.includes("--https") || process.env.LECTERN_HTTPS === "1";
const CERT = opt("cert", path.join(os.homedir(), "Lectern", "certs", "lectern.pem")).replace(/^~(?=\/)/, os.homedir());
const KEY = opt("key", path.join(os.homedir(), "Lectern", "certs", "lectern-key.pem")).replace(/^~(?=\/)/, os.homedir());
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const store = new LibraryStore(LIBRARY);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
  ".mp4": "video/mp4", ".pdf": "application/pdf", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".zip": "application/zip",
};

function json(res: http.ServerResponse, code: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(data);
}

/** Static or ranged file response. Ranges are what let the browser seek inside a 2-hour video instantly. */
function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, cache = "no-cache") {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  const head = { "content-type": type, "accept-ranges": "bytes", "cache-control": cache, "last-modified": stat.mtime.toUTCString() };
  if (range) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    if (!range[1]) end = stat.size - 1;
    start = Math.max(0, start); end = Math.min(stat.size - 1, end);
    if (start > end || start >= stat.size) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...head, "content-range": `bytes ${start}-${end}/${stat.size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    // pipeline closes the file when the browser aborts a range request (it does on every seek)
    pipeline(fs.createReadStream(file, { start, end }), res, () => {});
    return;
  }
  res.writeHead(200, { ...head, "content-length": stat.size });
  if (req.method === "HEAD") return res.end();
  pipeline(fs.createReadStream(file), res, () => {});
}

const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "api" && parts[1] === "state" && parts.length === 2) {
      if (req.method === "GET") return json(res, 200, store.state());
      if (req.method !== "PUT") return json(res, 405, { error: "method not allowed" });
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => { body += c; if (body.length > 4_000_000) req.destroy(); });
      req.on("end", () => {
        try { json(res, 200, store.mergeState(JSON.parse(body))); } catch (e) { json(res, 400, { error: String(e) }); }
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" });

    if (parts[0] === "api") {
      if (parts[1] === "library") return json(res, 200, store.library());
      if (parts[1] === "source" && parts.length === 4) {
        const src = store.source(parts[2], parts[3]);
        return src ? json(res, 200, { ...src, tiers: store.tiers(parts[2], parts[3]) }) : json(res, 404, { error: "no such source" });
      }
      if (parts[1] === "examples" && parts.length === 3) return json(res, 200, store.examples(parts[2]));
      if (parts[1] === "search") return json(res, 200, store.search(url.searchParams.get("q") ?? ""));
      if (parts[1] === "health") return json(res, 200, { ok: true, library: store.root, modules: store.library().modules.length });
      return json(res, 404, { error: "unknown endpoint" });
    }
    if ((parts[0] === "media" || parts[0] === "packs") && parts.length === 3) {
      // ?q=540 asks for a lower-quality copy; without one, the full proxy is served instead
      const q = Number(url.searchParams.get("q"));
      const file = (parts[0] === "media" && Number.isInteger(q) && q > 0 && store.file(parts[1], "media", parts[2], q)) || store.file(parts[1], parts[0], parts[2]);
      return file ? sendFile(req, res, file, "private, max-age=3600") : json(res, 404, { error: "not found" });
    }
    // built web app; any other path is a client route (/watch/..., /m/...)
    const asset = path.join(DIST, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""));
    if (asset.startsWith(DIST) && fs.existsSync(asset) && fs.statSync(asset).isFile()) {
      return sendFile(req, res, asset, url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    }
    const index = path.join(DIST, "index.html");
    if (fs.existsSync(index)) return sendFile(req, res, index);
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("Lectern web app is not built yet: run `npm run build` (or use `npm run dev`).");
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: String(e) });
  }
};

if (HTTPS && !(fs.existsSync(CERT) && fs.existsSync(KEY))) {
  console.error(`--https needs a certificate: ${CERT} and ${KEY} not found (see README: "iPad").`);
  process.exit(1);
}
const server = HTTPS ? https.createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) }, handler) : http.createServer(handler);

/** The Mac's Bonjour name (what an iPad can resolve), else the host name. */
function bonjourName() {
  try { return execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim(); } catch { return os.hostname().replace(/\.local$/, ""); }
}

server.listen(PORT, LAN ? "0.0.0.0" : "127.0.0.1", () => {
  const scheme = HTTPS ? "https" : "http";
  console.log(`Lectern → ${scheme}://localhost:${PORT}  (library: ${store.root}, ${store.library().modules.length} modules)`);
  if (LAN) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i!.address);
    console.log(`  on your network: ${scheme}://${bonjourName()}.local:${PORT}${ips.length ? `  (or ${ips.map((ip) => `${scheme}://${ip}:${PORT}`).join(", ")})` : ""}`);
    console.log(`  set this as padSync's Lectern address on the iPad${HTTPS ? "" : "; padSync's https page can only embed it with --https"}`);
  }
});
