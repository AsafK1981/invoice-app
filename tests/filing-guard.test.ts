import { describe, it, expect } from "vitest";
import { countAffectedBusinesses, formatGuardPush, formatGuardTable, newOrGrownCodes } from "@/lib/filing-guard";

describe("filing guard", () => {
  it("counts each code once per business", () => {
    expect(countAffectedBusinesses([["a", "b", "a"], ["a"], []])).toEqual({ a: 2, b: 1 });
  });

  it("reports only codes that are new or grew", () => {
    expect(newOrGrownCodes({ a: 2, b: 1 }, { a: 2, b: 3, c: 1 })).toEqual([
      { code: "b", before: 1, after: 3 },
      { code: "c", before: 0, after: 1 },
    ]);
    expect(newOrGrownCodes({ a: 2 }, { a: 1 })).toEqual([]);
  });

  it("prints codes and counts only, with plain hyphens", () => {
    expect(formatGuardTable({ b: 1, a: 2 })).toBe("code\tbusinessesAffected\na\t2\nb\t1");
    expect(formatGuardTable({})).toBe("code\tbusinessesAffected\n(none)");
    const text = formatGuardPush([{ code: "supplier_number_invalid", before: 0, after: 2 }], "יולי-אוגוסט 2026");
    expect(text).toContain("supplier_number_invalid: 0 -> 2");
    expect([...text].every((ch) => ch.charCodeAt(0) < 0x2010 || ch.charCodeAt(0) > 0x2015)).toBe(true);
  });
});
