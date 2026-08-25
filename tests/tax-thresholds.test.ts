import { describe, it, expect } from "vitest";
import {
  EXEMPT_CEILING_BY_YEAR,
  FALLBACK_EXEMPT_CEILING,
  getExemptCeiling,
  getLatestPublishedCeilingYear,
} from "@/lib/tax-thresholds";

/**
 * REGRESSION GUARD for the עוסק פטור ceiling.
 *
 * On 2026-08-25 the table still held 120_000 for 2026 - the 2025 figure
 * carried forward, next to a comment saying "verify each January" that nobody
 * ever acted on. The published 2026 ceiling is 122,833. The error ran in the
 * dangerous direction: this table drives the dashboard ceiling tracker and the
 * business-type picker, so a user turning over ₪121,000 was told they had
 * passed the ceiling while ₪1,833 of headroom remained.
 *
 * These tests cannot know next year's number, so they do not try to. They pin
 * the invariants the file itself claims but never enforced.
 */
describe("exempt ceiling table", () => {
  it("keeps the fallback equal to the newest published year", () => {
    // The file's own comment says the fallback "should match the most recently
    // published year". Nothing enforced it, so the fallback was free to drift
    // and quietly become the value shown whenever a year was missing.
    const newest = getLatestPublishedCeilingYear();
    expect(FALLBACK_EXEMPT_CEILING).toBe(EXEMPT_CEILING_BY_YEAR[newest]);
  });

  it("never returns zero or a negative ceiling", () => {
    // A ₪0 ceiling would render a progress bar that reads 100% used on the
    // first document issued, which is worse than showing nothing.
    for (const year of [2023, 2024, 2025, 2026, 2027, 2099]) {
      expect(getExemptCeiling(year)).toBeGreaterThan(0);
    }
  });

  it("never lowers the ceiling from one year to the next", () => {
    // The ceiling is index-linked; it has held or risen every year. A drop
    // means someone mistyped, and understating it wrongly pushes users toward
    // עוסק מורשה. It may legitimately stay flat, so equality passes.
    const years = Object.keys(EXEMPT_CEILING_BY_YEAR).map(Number).sort((a, b) => a - b);
    for (let i = 1; i < years.length; i++) {
      expect(EXEMPT_CEILING_BY_YEAR[years[i]]).toBeGreaterThanOrEqual(
        EXEMPT_CEILING_BY_YEAR[years[i - 1]],
      );
    }
  });

  it("holds the confirmed 2025 and 2026 figures", () => {
    // Both verified against כל-זכות's עוסק פטור entry on 2026-08-25. If a
    // future correction changes these, update the source note in
    // src/lib/tax-thresholds.ts in the same commit.
    expect(EXEMPT_CEILING_BY_YEAR[2025]).toBe(120_000);
    expect(EXEMPT_CEILING_BY_YEAR[2026]).toBe(122_833);
  });
});
