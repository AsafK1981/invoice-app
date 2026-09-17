import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // `forks`, not `vmForks` (2026-09-16). Under vmForks a worker that ran one
    // test file handed its evaluated modules to the next file it ran: two
    // files that both import the dunning route shared one route instance, so
    // the second file's vi.mock of supabase, its fake Date and the
    // CANONICAL_ORIGIN it expected were silently the first file's. Whether two
    // such files landed in the same worker depended on scheduling, so the
    // pre-push run went red at random. Reproduce with
    // `npx vitest run tests/dunning-route-due-date.test.ts tests/dunning-route-pre-due.test.ts --no-file-parallelism --pool=vmForks`
    // (fails) versus the same with --pool=forks (passes); the whole suite also
    // passes on forks with --no-file-parallelism, the worst case for leaks.
    // An earlier note here said forks could not find its runner on Node 24 /
    // Vitest 4.1.5; that no longer reproduces (likely the shared node_modules
    // corruption of that period). If it comes back, fix node_modules rather
    // than returning to vmForks.
    pool: "forks",
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
    // tests/ is where most suites live; a unit test may also sit next to the
    // module it covers (src/lib/x.ts + src/lib/x.test.ts), which keeps a pure
    // helper and its cases in one place. Both patterns run in the same
    // command, so the pre-push hook cannot miss the co-located ones.
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
