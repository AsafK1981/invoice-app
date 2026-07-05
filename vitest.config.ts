import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Node 24 + Vitest 4 default `forks` pool fails to locate the runner on
    // this environment ("Vitest failed to find the runner") before any test
    // runs. Pin to `threads` so the default `npm test` / `npx vitest run`
    // works without a --pool flag.
    pool: "threads",
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
