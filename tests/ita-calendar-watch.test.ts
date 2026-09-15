import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain .mjs helper without type declarations
import { coveredMonths, findNotice, findPostponements, parseNoticeTable, targetYear, tsSnippet, validateRows } from "../scripts/lib/ita-calendar.mjs";
import { OFFICIAL_DEADLINES } from "@/lib/ita/filing-calendar";

const notice2026 = readFileSync(join(__dirname, "fixtures", "ita-calendar-2026.txt"), "utf8");

describe("Tax Authority calendar watcher", () => {
  it("parses the real 2026 notice into exactly the table the app ships", () => {
    const { rows, missing } = parseNoticeTable(notice2026, 2026);
    expect(missing).toEqual([]);
    expect(rows).toEqual(OFFICIAL_DEADLINES);
    expect(validateRows(rows)).toEqual([]);
  });

  it("reads which months the app already covers from the source file", () => {
    const src = readFileSync(join(__dirname, "..", "src", "lib", "ita", "filing-calendar.ts"), "utf8");
    const months = coveredMonths(src);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-01");
  });

  it("looks for next year's notice from October", () => {
    expect(targetYear("2026-09-30")).toBe(2026);
    expect(targetYear("2026-10-01")).toBe(2027);
    expect(targetYear("2027-01-05")).toBe(2027);
  });

  it("finds the notice and postponements among gov.il search links", () => {
    const links: [string, string][] = [
      ["https://www.gov.il/he/Departments/publications/reports/pa271024-1", "קביעת מועדי הדיווח והתשלום - דוחות תקופתיים מע\"מ - שנת המס 2025"],
      ["https://www.gov.il/he/Departments/publications/reports/pa151025-2", "קביעת מועדי הדיווח והתשלום - דוחות תקופתיים מע\"מ - שנת המס 2026"],
      ["https://www.gov.il/he/Departments/publications/reports/pa-090818", "דחיית מועדי הדיווח והתשלום התקופתיים החלים בחודש ספטמבר 2018"],
    ];
    expect(findNotice(links, 2026)?.href).toContain("pa151025-2");
    expect(findNotice(links, 2027)).toBeNull();
    expect(findPostponements(links, 2018)).toHaveLength(1);
    expect(findPostponements(links, 2026)).toHaveLength(0);
  });

  it("flags a row that does not look like a real deadline", () => {
    expect(validateRows({ "2027-03": { periodic: "2027-05-15", withholding: "2027-04-16", detailed: "2027-04-23" } })).toHaveLength(2);
    expect(tsSnippet({ "2027-01": { periodic: "2027-02-15", withholding: "2027-02-16", detailed: "2027-02-23" } })).toBe(
      '  "2027-01": { periodic: "2027-02-15", withholding: "2027-02-16", detailed: "2027-02-23" },',
    );
  });
});
