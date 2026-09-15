import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("aging report typography", () => {
  it("uses the app's tabular numbers, not a typewriter monospace font", () => {
    const src = readFileSync(path.resolve(__dirname, "../src/components/aging-report.tsx"), "utf8");
    expect(src).not.toMatch(/font-mono/);
    expect(src).toMatch(/tabular-nums/);
  });
});
