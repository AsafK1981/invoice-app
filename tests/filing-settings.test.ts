import { describe, it, expect } from "vitest";
import { DEFAULT_FILING_SETTINGS, mapFilingRow } from "@/lib/filing-settings";

describe("mapFilingRow: btl_monthly_advance", () => {
  it("keeps only a whole positive number; 0 means not entered", () => {
    expect(mapFilingRow({ btl_monthly_advance: 1024 }).settings.btlMonthlyAdvance).toBe(1024);
    for (const junk of [0, null, undefined, "abc", -5, 10.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(mapFilingRow({ btl_monthly_advance: junk }).settings.btlMonthlyAdvance, String(junk)).toBeUndefined();
    }
  });

  it("is not set by default", () => {
    expect(DEFAULT_FILING_SETTINGS.btlMonthlyAdvance).toBeUndefined();
    expect(mapFilingRow(null).settings.btlMonthlyAdvance).toBeUndefined();
  });
});
