import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "dashboard",
  plugins: [react()],
  build: {
    outDir: "../dist/dashboard",
    emptyOutDir: false,
    assetsDir: "assets",
    sourcemap: false,
  },
});
