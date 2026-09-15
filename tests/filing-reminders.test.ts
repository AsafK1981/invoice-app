import { describe, it, expect } from "vitest";
import { planFilingReminders } from "@/lib/filing-reminders";
import { DEFAULT_FILING_SETTINGS, mapFilingRow } from "@/lib/filing-settings";

const base = { businessType: "authorized" as const, settings: DEFAULT_FILING_SETTINGS, filed: {}, reminded: {} };

describe("planFilingReminders", () => {
  it("reminds about deadlines inside the window, once each", () => {
    // 21.9.2026, 3 days before: the July-August VAT report and advances are due 24.9.
    const plan = planFilingReminders({ ...base, today: "2026-09-21" });
    expect(plan.map((p) => p.occurrence.key)).toEqual(["income_tax_advance:2026-B4", "vat_periodic:2026-B4"]);
    expect(plan[1].title).toBe("דוח מע״מ תקופתי · יולי-אוגוסט 2026: בעוד 3 ימים");
    expect(plan[1].body).toContain("24.09.2026");
  });

  it("stays quiet before the window opens", () => {
    expect(planFilingReminders({ ...base, today: "2026-09-20" }).map((p) => p.occurrence.key)).toEqual([]);
  });

  it("skips what was already reminded or marked as filed", () => {
    const plan = planFilingReminders({
      ...base,
      today: "2026-09-21",
      reminded: { "income_tax_advance:2026-B4": "2026-09-21T06:00:00Z" },
      filed: { "vat_periodic:2026-B4": "2026-09-20T10:00:00Z" },
    });
    expect(plan).toEqual([]);
  });

  it("still reminds on the deadline day itself, never after it", () => {
    expect(planFilingReminders({ ...base, today: "2026-09-24" }).map((p) => p.occurrence.key)).toEqual(["income_tax_advance:2026-B4", "vat_periodic:2026-B4"]);
    expect(planFilingReminders({ ...base, today: "2026-09-25" })).toEqual([]);
  });

  it("sends nothing when reminders are off, and honours a wider window", () => {
    expect(planFilingReminders({ ...base, settings: { ...DEFAULT_FILING_SETTINGS, remindersEnabled: false }, today: "2026-09-21" })).toEqual([]);
    const wide = planFilingReminders({ ...base, settings: { ...DEFAULT_FILING_SETTINGS, reminderDaysBefore: 10 }, today: "2026-09-14" });
    expect(wide.map((p) => p.occurrence.key)).toContain("btl_advance:2026-08");
    expect(wide.map((p) => p.occurrence.key)).toContain("vat_periodic:2026-B4");
  });

  it("mentions the online date only when it is later than the deadline", () => {
    // November 2026 monthly: due 16.11 by the table, online until 19.11.
    const plan = planFilingReminders({ ...base, settings: { ...DEFAULT_FILING_SETTINGS, vatCadence: "monthly" }, today: "2026-11-15" });
    const vat = plan.find((p) => p.occurrence.id === "vat_periodic")!;
    expect(vat.body).toContain("16.11.2026");
    expect(vat.body).toContain("19.11.2026");
  });
});

describe("mapFilingRow", () => {
  it("falls back to defaults for a missing row or junk values", () => {
    expect(mapFilingRow(null).settings).toEqual(DEFAULT_FILING_SETTINGS);
    const junk = mapFilingRow({ vat_cadence: "weekly", reminder_days_before: 99, filed: ["x"], reminders_enabled: null });
    expect(junk.settings.vatCadence).toBe("bimonthly");
    expect(junk.settings.reminderDaysBefore).toBe(3);
    expect(junk.settings.remindersEnabled).toBe(true);
    expect(junk.filed).toEqual({});
  });

  it("reads a stored row", () => {
    const s = mapFilingRow({ vat_cadence: "monthly", advance_cadence: "monthly", detailed_reporter: true, has_employees: true, reminders_enabled: false, reminder_days_before: 7, filed: { "vat_periodic:2026-08": "2026-09-10T00:00:00Z", bad: 5 } });
    expect(s.settings).toEqual({ vatCadence: "monthly", advanceCadence: "monthly", detailedReporter: true, hasEmployees: true, remindersEnabled: false, reminderDaysBefore: 7 });
    expect(s.filed).toEqual({ "vat_periodic:2026-08": "2026-09-10T00:00:00Z" });
  });
});
