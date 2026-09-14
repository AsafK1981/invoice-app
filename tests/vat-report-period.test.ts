import { describe, it, expect } from "vitest";
import { DEFAULT_VAT_PERIOD_MODE, VAT_PERIOD_MODES, resolveVatPeriodMode, vatPeriodRange } from "@/lib/vat-report-period";

describe("VAT report period", () => {
  it("defaults to the last fully ended bi-monthly period and keeps the yearly view", () => {
    expect(DEFAULT_VAT_PERIOD_MODE).toBe("last_2m");
    expect(VAT_PERIOD_MODES[0]).toBe("last_2m");
    expect(VAT_PERIOD_MODES).toContain("this_year");
    expect(vatPeriodRange("last_2m", new Date(2026, 8, 14))).toMatchObject({ start: "2026-07-01", end: "2026-08-31" });
    expect(vatPeriodRange("last_2m", new Date(2026, 0, 5))).toMatchObject({ start: "2025-11-01", end: "2025-12-31" });
    expect(vatPeriodRange("last_month", new Date(2026, 8, 14))).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
    expect(vatPeriodRange("this_year", new Date(2026, 8, 14))).toMatchObject({ start: "2026-01-01", end: "2026-12-31" });
  });

  it("prefers the URL, then the stored choice, then the default", () => {
    expect(resolveVatPeriodMode("this_2m", "last_month")).toBe("this_2m");
    expect(resolveVatPeriodMode(null, "this_year")).toBe("this_year");
    expect(resolveVatPeriodMode("garbage", "garbage")).toBe("last_2m");
  });
});
