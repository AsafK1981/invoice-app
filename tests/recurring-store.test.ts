import { describe, it, expect } from "vitest";
import { calculateNextDue } from "@/lib/recurring-store";

describe("calculateNextDue — weekly", () => {
  it("adds 7 days", () => {
    expect(calculateNextDue("2026-01-15", "weekly")).toBe("2026-01-22");
  });
  it("rolls across a month boundary", () => {
    expect(calculateNextDue("2026-01-31", "weekly")).toBe("2026-02-07");
  });
});

describe("calculateNextDue — monthly (end-of-month must not overflow)", () => {
  it("Jan 31 -> Feb 28 (does NOT spill to March)", () => {
    expect(calculateNextDue("2026-01-31", "monthly")).toBe("2026-02-28");
  });
  it("Jan 31 -> Feb 29 in a leap year", () => {
    expect(calculateNextDue("2028-01-31", "monthly")).toBe("2028-02-29");
  });
  it("Mar 31 -> Apr 30", () => {
    expect(calculateNextDue("2026-03-31", "monthly")).toBe("2026-04-30");
  });
  it("keeps a mid-month day as-is", () => {
    expect(calculateNextDue("2026-03-15", "monthly")).toBe("2026-04-15");
  });
  it("rolls December -> January of next year", () => {
    expect(calculateNextDue("2026-12-15", "monthly")).toBe("2027-01-15");
  });
  it("Dec 31 -> Jan 31 next year (31-day target keeps the 31st)", () => {
    expect(calculateNextDue("2026-12-31", "monthly")).toBe("2027-01-31");
  });
});
