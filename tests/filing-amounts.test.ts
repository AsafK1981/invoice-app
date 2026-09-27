import { describe, it, expect } from "vitest";
import { periodOfOccurrence, resolveReminderAmount } from "@/lib/filing-amounts";
import { DEFAULT_FILING_SETTINGS } from "@/lib/filing-settings";
import { buildPeriodicFiling } from "@/lib/periodic-filing";
import { formatCurrencyWhole } from "@/lib/format";
import type { ObligationOccurrence } from "@/lib/ita/filing-calendar";
import type { Expense, InvoiceDocument } from "@/lib/types";

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: Math.random().toString(36).slice(2),
    type: "tax_invoice",
    number: 1,
    date: "2026-07-10",
    clientId: "c1",
    clientName: "לקוח",
    clientTaxId: "513333336",
    status: "paid",
    items: [],
    subtotal: 1000,
    vat: 180,
    total: 1180,
    ...over,
  };
}

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: Math.random().toString(36).slice(2),
    date: "2026-07-05",
    category: "משרד",
    supplier: "ספק",
    amount: 236,
    vatAmount: 36,
    supplierTaxId: "513333336",
    reference: "77",
    ...over,
  };
}

function occ(key: string): ObligationOccurrence {
  const id = key.split(":")[0] as ObligationOccurrence["id"];
  return { key, id, authority: "vat", date: "2026-09-24", official: true, periodLabel: "יולי-אוגוסט 2026" };
}

const authorized = { taxId: "513333336", businessType: "authorized" as const, incomeTaxAdvanceRate: 5 };
const today = new Date("2026-09-21T12:00:00Z");
const base = { business: authorized, settings: DEFAULT_FILING_SETTINGS, documents: [] as InvoiceDocument[], expenses: [] as Expense[], today };

describe("periodOfOccurrence", () => {
  it("reads the period of the three amount obligations", () => {
    expect(periodOfOccurrence(occ("vat_periodic:2026-B4"))).toBe("2026-B4");
    expect(periodOfOccurrence(occ("income_tax_advance:2026-08"))).toBe("2026-08");
    expect(periodOfOccurrence(occ("btl_advance:2026-08"))).toBe("2026-08");
  });

  it("is null for every other obligation", () => {
    expect(periodOfOccurrence(occ("annual_report:2026"))).toBeNull();
    expect(periodOfOccurrence(occ("vat_detailed:2026-B4"))).toBeNull();
    expect(periodOfOccurrence(occ("withholding:2026-08"))).toBeNull();
    expect(periodOfOccurrence(occ("pension_deposit:2026"))).toBeNull();
    expect(periodOfOccurrence(occ("exempt_declaration:2026"))).toBeNull();
  });
});

describe("resolveReminderAmount: VAT", () => {
  const vat = occ("vat_periodic:2026-B4");

  it("pays the net due, the same figure the periodic report shows", () => {
    const documents = [doc({ date: "2026-07-10" }), doc({ date: "2026-08-20", number: 2, subtotal: 2000, vat: 360, total: 2360 })];
    const expenses = [expense()];
    const a = resolveReminderAmount({ ...base, occurrence: vat, documents, expenses });
    const report = buildPeriodicFiling({ business: authorized, documents, expenses, period: "2026-B4", today })!;
    expect(report.pcn!.blockers).toEqual([]);
    expect(a).toEqual({ status: "pay", amount: report.vat!.netDue, source: "vat" });
    expect(a).toEqual({ status: "pay", amount: 504, source: "vat" }); // 540 output - 36 input
  });

  it("a period with more input VAT than output is a refund, as a positive amount", () => {
    const a = resolveReminderAmount({ ...base, occurrence: vat, documents: [doc()], expenses: [expense({ amount: 1180, vatAmount: 180 }), expense({ amount: 590, vatAmount: 90, reference: "78" })] });
    expect(a).toEqual({ status: "refund", amount: 90, source: "vat" });
  });

  it("an empty period is a zero report", () => {
    expect(resolveReminderAmount({ ...base, occurrence: vat })).toEqual({ status: "zero", source: "vat" });
  });

  it("an error-level data warning also gives no figure, like the report's blocking checks", () => {
    // A sale with a bad customer tax id is an error-level PCN warning, not a blocker.
    const documents = [doc({ clientTaxId: "123456789" })];
    const report = buildPeriodicFiling({ business: authorized, documents, expenses: [], period: "2026-B4", today })!;
    expect(report.pcn!.blockers).toEqual([]);
    expect(report.pcn!.warnings.some((w) => w.level === "error")).toBe(true);
    expect(resolveReminderAmount({ ...base, occurrence: vat, documents })).toEqual({ status: "missing", source: "vat", reason: "blocked" });
  });

  it("a period that cannot be read is unavailable, not the owner's data", () => {
    expect(resolveReminderAmount({ ...base, occurrence: { ...vat, key: "vat_periodic:2026-Q3" } })).toEqual({ status: "missing", source: "vat", reason: "unavailable" });
    expect(resolveReminderAmount({ ...base, occurrence: { ...vat, key: "vat_periodic" } })).toEqual({ status: "missing", source: "vat", reason: "unavailable" });
  });

  it("a report that throws is unavailable", () => {
    const throwing = [doc()];
    Object.defineProperty(throwing[0], "date", { get() { throw new Error("boom"); } });
    expect(resolveReminderAmount({ ...base, occurrence: vat, documents: throwing })).toEqual({ status: "missing", source: "vat", reason: "unavailable" });
  });

  it("a report with blockers gives no figure", () => {
    const a = resolveReminderAmount({ ...base, business: { ...authorized, taxId: "12" }, occurrence: vat, documents: [doc()] });
    expect(a).toEqual({ status: "missing", source: "vat", reason: "blocked" });
  });
});

describe("resolveReminderAmount: income-tax advance", () => {
  const adv = occ("income_tax_advance:2026-B4");

  it("with no rate set there is no figure", () => {
    for (const rate of [undefined, 0, -1, NaN]) {
      const a = resolveReminderAmount({ ...base, business: { ...authorized, incomeTaxAdvanceRate: rate }, occurrence: adv, documents: [doc()] });
      expect(a).toEqual({ status: "missing", source: "advance", reason: "no_rate" });
    }
  });

  it("pays turnover × rate and explains it", () => {
    const a = resolveReminderAmount({ ...base, occurrence: adv, documents: [doc({ subtotal: 10000, vat: 1800, total: 11800 })] });
    expect(a).toEqual({ status: "pay", amount: 500, source: "advance", detail: `מחזור ${formatCurrencyWhole(10000)} × 5%` });
  });

  it("names the withholding offset when there is one", () => {
    const a = resolveReminderAmount({ ...base, occurrence: adv, documents: [doc({ subtotal: 10000, vat: 1800, total: 11800, withholdingAmount: 100 })] });
    expect(a).toEqual({
      status: "pay",
      amount: 400,
      source: "advance",
      detail: `מחזור ${formatCurrencyWhole(10000)} × 5% פחות ניכוי במקור ${formatCurrencyWhole(100)}`,
    });
  });

  it("an advance covered in full by withholding at source is zero, and says so", () => {
    const a = resolveReminderAmount({ ...base, occurrence: adv, documents: [doc({ subtotal: 10000, vat: 1800, total: 11800, withholdingAmount: 800 })] });
    expect(a).toEqual({ status: "zero", source: "advance", amount: 500, offsetInFull: true });
  });

  it("no turnover means no advance", () => {
    expect(resolveReminderAmount({ ...base, occurrence: adv })).toEqual({ status: "zero", source: "advance" });
  });
});

describe("resolveReminderAmount: Bituach Leumi and the rest", () => {
  const btl = occ("btl_advance:2026-08");

  it("needs the amount from the booklet", () => {
    expect(resolveReminderAmount({ ...base, occurrence: btl })).toEqual({ status: "missing", source: "btl", reason: "no_btl_amount" });
  });

  it("treats 0 as not entered", () => {
    expect(resolveReminderAmount({ ...base, settings: { ...DEFAULT_FILING_SETTINGS, btlMonthlyAdvance: 0 }, occurrence: btl })).toEqual({ status: "missing", source: "btl", reason: "no_btl_amount" });
  });

  it("pays the stored amount", () => {
    expect(resolveReminderAmount({ ...base, settings: { ...DEFAULT_FILING_SETTINGS, btlMonthlyAdvance: 1024 }, occurrence: btl })).toEqual({ status: "pay", amount: 1024, source: "btl" });
  });

  it("has no amount concept for the other obligations", () => {
    for (const key of ["annual_report:2026", "withholding:2026-08", "vat_detailed:2026-B4", "exempt_declaration:2026"]) {
      expect(resolveReminderAmount({ ...base, occurrence: occ(key), documents: [doc()] }), key).toBeNull();
    }
  });
});

describe("resolveReminderAmount: mandatory pension", () => {
  const pension = occ("pension_deposit:2026");

  it("pays the mandatory minimum on the year's taxable profit so far", () => {
    // 120,000 pre-VAT income this year, 20,000 net expenses; last year's sale does not count.
    const documents = [doc({ subtotal: 140_000, vat: 25_200, total: 165_200 }), doc({ date: "2025-12-20", number: 2, subtotal: 50_000, vat: 9_000, total: 59_000 })];
    const expenses = [expense({ amount: 23_600, vatAmount: 3_600 })];
    const a = resolveReminderAmount({ ...base, occurrence: pension, documents, expenses });
    expect(a).toEqual({ status: "pay", amount: 8_368, source: "pension", detail: formatCurrencyWhole(120_000) });
  });

  it("uses gross amounts for an exempt dealer, like the tax projection", () => {
    const exempt = { ...authorized, businessType: "exempt" as const };
    const a = resolveReminderAmount({ ...base, business: exempt, occurrence: pension, documents: [doc({ subtotal: 50_000, vat: 0, total: 50_000 })] });
    expect(a).toEqual({ status: "pay", amount: 2_225, source: "pension", detail: formatCurrencyWhole(50_000) });
  });

  it("no profit, or a loss, means nothing to deposit", () => {
    expect(resolveReminderAmount({ ...base, occurrence: pension })).toEqual({ status: "zero", source: "pension" });
    expect(resolveReminderAmount({ ...base, occurrence: pension, documents: [doc()], expenses: [expense({ amount: 5_900, vatAmount: 900 })] })).toEqual({ status: "zero", source: "pension" });
  });
});
