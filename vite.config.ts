import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Docker Desktop on Windows does not reliably forward native fs.watch/inotify
// events for a bind-mounted repository, so Vite's watcher must fall back to
// polling there. Guarded behind CHOKIDAR_USEPOLLING (set only in
// docker-compose.dev.yml) so the default local `npm run dev` path keeps
// using native events.
const usePolling = process.env.CHOKIDAR_USEPOLLING === "true";

export default defineConfig({
  root: "dashboard",
  plugins: [react()],
  build: {
    outDir: "../dist/dashboard",
    emptyOutDir: false,
    assetsDir: "assets",
    sourcemap: false,
  },
  server: usePolling ? { watch: { usePolling: true } } : undefined,
});
