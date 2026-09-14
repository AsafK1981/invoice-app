import { describe, it, expect } from "vitest";
import { UNIFORM_FIX_TITLES, uniformBlockingCodes, uniformCanDownload, type UniformIssue } from "@/lib/uniform-structure/issues";

describe("uniform issue codes", () => {
  it("has a plain Hebrew title for every code", () => {
    const titles = Object.entries(UNIFORM_FIX_TITLES);
    expect(titles.length).toBeGreaterThan(30);
    for (const [code, title] of titles) {
      expect(code).toMatch(/^[a-z0-9_]+$/);
      expect(title.trim().length).toBeGreaterThan(0);
      expect([...title].every((ch) => ch.charCodeAt(0) < 0x2010 || ch.charCodeAt(0) > 0x2015)).toBe(true);
    }
  });

  it("downloads only without errors and reports each blocking code once", () => {
    const issues: UniformIssue[] = [
      { code: "record_invalid", level: "error", message: "a" },
      { code: "record_invalid", level: "error", message: "b" },
      { code: "text_truncated", level: "warning", message: "c" },
    ];
    expect(uniformCanDownload(issues)).toBe(false);
    expect(uniformBlockingCodes(issues)).toEqual(["record_invalid"]);
    expect(uniformCanDownload(issues.filter((i) => i.level === "warning"))).toBe(true);
  });
});
