import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev`: Vite serves the app on 4747 and proxies the API/media to the Node server on 4748, so links
// written for the production port (http://localhost:4747/watch/...) work in development too.
export default defineConfig({
  root: "web",
  publicDir: "../public",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:4748", "/media": "http://127.0.0.1:4748", "/packs": "http://127.0.0.1:4748" },
  },
});
