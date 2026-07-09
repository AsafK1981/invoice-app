import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Vitest 4's worker-pool selection is environment-sensitive here: on the
    // current Node 24 / Vitest 4.1.5 / Vite 8 combo BOTH `threads` and `forks`
    // fail to locate the runner ("Vitest failed to find the runner") before any
    // test runs, while the VM-isolated `vmForks` pool works. (Earlier
    // environments needed `threads`, then `forks`.) Pin to `vmForks` so the
    // default `npm test` / `npx vitest run` works without a --pool flag.
    pool: "vmForks",
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
