import { describe, it, expect } from "vitest";
import { planFilingReminders, reminderText } from "@/lib/filing-reminders";
import { formatCurrencyWhole, formatDate } from "@/lib/format";
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

describe("reminderText", () => {
  const plan = planFilingReminders({ ...base, today: "2026-09-21" });
  const vat = plan.find((p) => p.occurrence.id === "vat_periodic")!.occurrence;
  const adv = plan.find((p) => p.occurrence.id === "income_tax_advance")!.occurrence;
  const wide = planFilingReminders({ ...base, settings: { ...DEFAULT_FILING_SETTINGS, reminderDaysBefore: 10 }, today: "2026-09-14" });
  const btl = wide.find((p) => p.occurrence.id === "btl_advance")!.occurrence;
  const monthly = planFilingReminders({ ...base, settings: { ...DEFAULT_FILING_SETTINGS, vatCadence: "monthly" }, today: "2026-11-15" });
  const vatOnline = monthly.find((p) => p.occurrence.id === "vat_periodic")!.occurrence;
  const online = " בדיווח ותשלום באתר אפשר עד 19.11.2026.";
  const plain = (o: typeof vat) => planFilingReminders({ ...base, settings: { ...DEFAULT_FILING_SETTINGS, reminderDaysBefore: 14 }, today: "2026-09-14" }).find((p) => p.occurrence.key === o.key)!.body;

  it("with no amount, is exactly the planned text", () => {
    for (const item of plan) {
      const t = reminderText(item.occurrence, "2026-09-21", null);
      expect(t.title).toBe(item.title);
      expect(t.body).toBe(item.body);
    }
    for (const item of monthly) {
      const t = reminderText(item.occurrence, "2026-11-15", null);
      expect(t.title).toBe(item.title);
      expect(t.body).toBe(item.body);
    }
  });

  it("keeps the title whatever the amount", () => {
    const t = reminderText(vat, "2026-09-21", { status: "pay", amount: 504, source: "vat" });
    expect(t.title).toBe("דוח מע״מ תקופתי · יולי-אוגוסט 2026: בעוד 3 ימים");
  });

  it("links VAT and the advance to the periodic report of their period, the rest to the calendar", () => {
    expect(reminderText(vat, "2026-09-21", null).href).toBe("/reports/periodic?period=2026-B4");
    expect(reminderText(adv, "2026-09-21", null).href).toBe("/reports/periodic?period=2026-B4");
    expect(reminderText(vatOnline, "2026-11-15", null).href).toBe("/reports/periodic?period=2026-10");
    expect(reminderText(btl, "2026-09-14", null).href).toBe("/obligations");
    const annual = { key: "annual_report:2025", id: "annual_report" as const, authority: "tax" as const, date: "2026-04-30", official: false, periodLabel: "שנת המס 2025" };
    expect(reminderText(annual, "2026-04-27", null).href).toBe("/obligations");
  });

  it("VAT to pay, refund and zero report", () => {
    expect(reminderText(vat, "2026-09-21", { status: "pay", amount: 504, source: "vat" }).body).toBe(`לתשלום ${formatCurrencyWhole(504)} עד 24.09.2026, לפי המסמכים וההוצאות באפליקציה.`);
    expect(reminderText(vatOnline, "2026-11-15", { status: "pay", amount: 504, source: "vat" }).body).toBe(`לתשלום ${formatCurrencyWhole(504)} עד 16.11.2026, לפי המסמכים וההוצאות באפליקציה.${online}`);
    expect(reminderText(vat, "2026-09-21", { status: "refund", amount: 90, source: "vat" }).body).toBe(`החזר של ${formatCurrencyWhole(90)} מגיע לך לפי הדוח. המועד האחרון להגשה הוא 24.09.2026.`);
    expect(reminderText(vat, "2026-09-21", { status: "zero", source: "vat" }).body).toBe("אין מה לשלם הפעם, אבל צריך להגיש דוח אפס עד 24.09.2026.");
  });

  it("advance to pay with its explanation, and no advance", () => {
    expect(reminderText(adv, "2026-09-21", { status: "pay", amount: 500, source: "advance", detail: "פירוט" }).body).toBe(`מקדמה של ${formatCurrencyWhole(500)} לתשלום עד 24.09.2026 (פירוט).`);
    expect(reminderText(adv, "2026-09-21", { status: "zero", source: "advance" }).body).toBe("לא יצאה מקדמה לתקופה הזו (אין מחזור). המועד להגשה הוא 24.09.2026.");
    expect(reminderText(adv, "2026-09-21", { status: "zero", source: "advance", amount: 500, offsetInFull: true }).body).toBe(
      `המקדמה לתקופה הזו (${formatCurrencyWhole(500)}) מכוסה במלואה בניכוי במקור, אין מה לשלם. המועד להגשה הוא 24.09.2026.`,
    );
  });

  it("Bituach Leumi advance from the stored amount", () => {
    expect(reminderText(btl, "2026-09-14", { status: "pay", amount: 1024, source: "btl" }).body).toBe(`${formatCurrencyWhole(1024)} לתשלום עד ${formatDate(btl.date)}, לפי הסכום שהזנת בלוח חובות ההגשה.`);
  });

  it("a missing figure keeps the plain text and says how to get it", () => {
    expect(reminderText(adv, "2026-09-21", { status: "missing", source: "advance", reason: "no_rate" }).body).toBe(`${plain(adv)} כדי לקבל את הסכום בתזכורת, הזן את שיעור המקדמות בדוח המקדמות.`);
    expect(reminderText(btl, "2026-09-14", { status: "missing", source: "btl", reason: "no_btl_amount" }).body).toBe(`${plain(btl)} כדי לקבל את הסכום בתזכורת, הזן את מקדמת ביטוח לאומי החודשית בהגדרות הלוח.`);
    expect(reminderText(vat, "2026-09-21", { status: "missing", source: "vat", reason: "blocked" }).body).toBe(`${plain(vat)} הסכום לא חושב כי בדוח התקופתי יש נתונים שצריך לתקן.`);
  });

  it("an unavailable figure is the plain text with no hint", () => {
    expect(reminderText(vat, "2026-09-21", { status: "missing", source: "vat", reason: "unavailable" }).body).toBe(plain(vat));
    expect(reminderText(adv, "2026-09-21", { status: "missing", source: "advance", reason: "unavailable" }).body).toBe(plain(adv));
  });

  it("never uses a long dash", () => {
    const long = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
    const amounts = [null, { status: "pay", amount: 1, source: "vat" }, { status: "refund", amount: 1, source: "vat" }, { status: "zero", source: "advance" }, { status: "missing", source: "btl", reason: "no_btl_amount" }] as const;
    for (const a of amounts) {
      const t = reminderText(vatOnline, "2026-11-15", a);
      expect(`${t.title}${t.body}`).not.toMatch(long);
    }
  });
});
