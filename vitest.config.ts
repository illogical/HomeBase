import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    },
    environment: "node",
    setupFiles: ["dashboard/test/setup.ts"],
    restoreMocks: true
  }
});
