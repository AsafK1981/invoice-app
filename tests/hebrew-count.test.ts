import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hebrewCount } from "@/lib/format";

describe("hebrewCount", () => {
  it("says the singular as a phrase, never '1 מסמכים'", () => {
    expect(hebrewCount(1, "מסמך אחד", "מסמכים")).toBe("מסמך אחד");
    expect(hebrewCount(1, "הוצאה אחת", "הוצאות")).toBe("הוצאה אחת");
    expect(hebrewCount(1, "לקוח אחד", "לקוחות")).toBe("לקוח אחד");
  });

  it("uses the numeral and the plural for every other count", () => {
    expect(hebrewCount(0, "מסמך אחד", "מסמכים")).toBe("0 מסמכים");
    expect(hebrewCount(2, "הוצאה אחת", "הוצאות")).toBe("2 הוצאות");
    expect(hebrewCount(37, "לקוח אחד", "לקוחות")).toBe("37 לקוחות");
  });
});

// The screens that printed "1 הוצאות" / "1 לקוחות · 1 מסמכים" before 2026-09-15.
describe("count phrases on report screens", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  it.each([
    ["src/app/(app)/expenses/page.tsx", /\{filtered\.length\} הוצאות|`\$\{filtered\.length\} הוצאות`/],
    ["src/app/(app)/reports/expenses/page.tsx", /\$\{report\.rows\.length\} הוצאות/],
    ["src/app/(app)/reports/page.tsx", /\$\{aging\.rows\.length\} לקוחות|\{aging\.rows\.length - topDebtors\.length\} לקוחות/],
    ["src/components/aging-report.tsx", /\{rows\.length\} לקוחות/],
    ["src/components/income-tax-advances-report.tsx", /\$\{result\.docCount\} מסמכים/],
  ])("%s no longer glues a bare count to a plural noun", (file, bad) => {
    const src = read(file);
    expect(src).not.toMatch(bad);
    expect(src).toMatch(/hebrewCount\(/);
  });
});
