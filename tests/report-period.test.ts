import { describe, it, expect } from "vitest";
import {
  periodMode,
  periodMatches,
  periodMatchesMonth,
  periodChartMonths,
  periodLabel,
  periodStepLabel,
  shiftPeriod,
  switchMode,
  periodRange,
  previousEquivalentRange,
  makeRange,
  rangeBounds,
  addDays,
  daysInclusive,
} from "@/lib/report-period";

// A fixed "today" (Israel time is UTC+3 in August, so noon UTC is the same day).
const TODAY = new Date(Date.UTC(2026, 7, 31, 12));

describe("range period model", () => {
  it("detects the range mode and keeps the other modes as they were", () => {
    expect(periodMode("2026-01-05..2026-03-10")).toBe("range");
    expect(periodMode("2026-03")).toBe("month");
    expect(periodMode("2026-Q3")).toBe("quarter");
    expect(periodMode("2026")).toBe("year");
    expect(periodMode("all")).toBe("all");
  });

  it("builds a range and swaps ends given backwards", () => {
    expect(makeRange("2026-01-05", "2026-03-10")).toBe("2026-01-05..2026-03-10");
    expect(makeRange("2026-03-10", "2026-01-05")).toBe("2026-01-05..2026-03-10");
    expect(rangeBounds("2026-01-05..2026-03-10")).toEqual({ start: "2026-01-05", end: "2026-03-10" });
    expect(rangeBounds("2026-03")).toBeNull();
  });

  it("matches dates inclusively on both ends", () => {
    const p = "2026-01-05..2026-03-10";
    expect(periodMatches(p, "2026-01-04")).toBe(false);
    expect(periodMatches(p, "2026-01-05")).toBe(true);
    expect(periodMatches(p, "2026-03-10")).toBe(true);
    expect(periodMatches(p, "2026-03-11")).toBe(false);
    // A timestamp still matches on its date part.
    expect(periodMatches(p, "2026-02-01T10:00:00Z")).toBe(true);
  });

  it("treats a month as touched when the range overlaps it at all", () => {
    const p = "2026-01-20..2026-03-10";
    expect(periodMatchesMonth(p, "2025-12")).toBe(false);
    expect(periodMatchesMonth(p, "2026-01")).toBe(true);
    expect(periodMatchesMonth(p, "2026-03")).toBe(true);
    expect(periodMatchesMonth(p, "2026-04")).toBe(false);
    // Whole-month modes are unchanged: the month is in or out.
    expect(periodMatchesMonth("2026-Q1", "2026-03")).toBe(true);
    expect(periodMatchesMonth("2026-Q1", "2026-04")).toBe(false);
  });

  it("lays the chart out over the year, or over the spanned months across years", () => {
    expect(periodChartMonths("2026-01-20..2026-03-10")).toHaveLength(12);
    expect(periodChartMonths("2026-01-20..2026-03-10")[0]).toBe("2026-01");
    expect(periodChartMonths("2025-11-15..2026-02-03")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(periodChartMonths("2026-Q2")).toHaveLength(12);
    expect(periodChartMonths("all", TODAY)).toHaveLength(12);
  });

  it("labels the range as two Israeli dates", () => {
    expect(periodLabel("2026-01-05..2026-03-10")).toBe("05.01.2026 - 10.03.2026");
    expect(periodStepLabel("2026-01-05..2026-03-10")).toBe("05.01.2026 - 10.03.2026");
  });

  it("slides a range by its own length", () => {
    expect(daysInclusive("2026-01-01", "2026-01-01")).toBe(1);
    expect(daysInclusive("2026-01-05", "2026-03-10")).toBe(65);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftPeriod("2026-01-05..2026-03-10", -1)).toBe("2025-11-01..2026-01-04");
    expect(shiftPeriod("2025-11-01..2026-01-04", 1)).toBe("2026-01-05..2026-03-10");
  });

  it("clips a range still in progress to today, and compares it with an equally long window before it", () => {
    expect(periodRange("2026-08-10..2026-09-30", TODAY)).toEqual({ start: "2026-08-10", end: "2026-08-31" });
    // 22 days (10..31 Aug) -> the 22 days ending 9 Aug.
    expect(previousEquivalentRange("2026-08-10..2026-09-30", TODAY)).toEqual({ start: "2026-07-19", end: "2026-08-09" });
    // A finished range compares against its full length.
    expect(previousEquivalentRange("2026-01-05..2026-03-10", TODAY)).toEqual({ start: "2025-11-01", end: "2026-01-04" });
  });

  it("switches into a range from where the user is, and out of it to the range's start month", () => {
    // The year in progress becomes Jan 1 - today.
    expect(switchMode("2026", "range", TODAY)).toBe("2026-01-01..2026-08-31");
    // A finished month becomes exactly that month.
    expect(switchMode("2026-03", "range", TODAY)).toBe("2026-03-01..2026-03-31");
    // "all" has no dates to start from: the last 30 days.
    expect(switchMode("all", "range", TODAY)).toBe("2026-08-02..2026-08-31");
    // Back out: a range that does not hold today anchors on its first month.
    expect(switchMode("2026-01-05..2026-03-10", "month", TODAY)).toBe("2026-01");
    expect(switchMode("2026-01-05..2026-03-10", "quarter", TODAY)).toBe("2026-Q1");
    expect(switchMode("2026-01-05..2026-03-10", "year", TODAY)).toBe("2026");
    // One that holds today anchors on this month.
    expect(switchMode("2026-08-01..2026-09-30", "month", TODAY)).toBe("2026-08");
  });
});
