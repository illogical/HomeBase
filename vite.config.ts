import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Docker Desktop on Windows does not reliably forward native fs.watch/inotify
// events for a bind-mounted repository, so Vite's watcher must fall back to
// polling there. Guarded behind CHOKIDAR_USEPOLLING (set only in
// docker-compose.dev.yml) so the default local `npm run dev` path keeps
// using native events.
const usePolling = process.env.CHOKIDAR_USEPOLLING === "true";

export default defineConfig(({ mode }) => {
  // Loads .env/.env.local from the repo root (git-ignored) in addition to
  // process.env, without requiring a VITE_ prefix since this only runs in
  // config/node context, never bundled into client code.
  const env = loadEnv(mode, process.cwd(), "");
  const allowedHosts = env.VITE_DEV_ALLOWED_HOSTS
    ? env.VITE_DEV_ALLOWED_HOSTS.split(",").map((host) => host.trim())
    : undefined;

  return {
    root: "dashboard",
    plugins: [react()],
    build: {
      outDir: "../dist/dashboard",
      emptyOutDir: false,
      assetsDir: "assets",
      sourcemap: false,
    },
    server: {
      ...(allowedHosts ? { allowedHosts } : {}),
      ...(usePolling ? { watch: { usePolling: true } } : {}),
    },
  };
});
