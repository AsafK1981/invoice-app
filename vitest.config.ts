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
    // Vitest's default is 5s per test, which this repo kept implicitly. That
    // is enough when the machine is idle (the whole suite runs in ~20s) but
    // not when several agents build and test at once: the pre-push run has
    // failed with 5s timeouts on pure-computation tests (xlsx round trips,
    // report builders) that pass in well under a second on their own. A
    // randomly red hook is worse than a slow one, because it is what tempts
    // someone into --no-verify. Nothing here should ever approach 20s, so a
    // test that does hit this ceiling is a real hang worth looking at.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
