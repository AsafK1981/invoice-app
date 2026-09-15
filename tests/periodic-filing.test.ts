import { describe, it, expect } from "vitest";
import {
  buildPeriodicFiling,
  defaultFilingPeriod,
  filingDeadlines,
  filingPeriodEnded,
  filingRange,
  isFilingPeriod,
  shiftFilingPeriod,
  switchFilingMode,
  vatReportModeFor,
} from "@/lib/periodic-filing";
import { buildPcn874 } from "@/lib/ita/pcn874";
import { computeAdvance } from "@/lib/ita/income-tax-advances";
import type { Business, Expense, InvoiceDocument } from "@/lib/types";

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

const authorized = { taxId: "123456789", businessType: "authorized" as const, incomeTaxAdvanceRate: 5 };
const exempt = { taxId: "123456789", businessType: "exempt" as const, incomeTaxAdvanceRate: 5 };
const july = new Date(2026, 8, 14); // 14 Sep 2026

describe("filing periods", () => {
  it("only a month or a bi-month can be filed", () => {
    expect(isFilingPeriod("2026-07")).toBe(true);
    expect(isFilingPeriod("2026-B4")).toBe(true);
    expect(isFilingPeriod("2026-Q3")).toBe(false);
    expect(isFilingPeriod("2026")).toBe(false);
    expect(isFilingPeriod("all")).toBe(false);
    expect(filingRange("2026-Q3")).toBeNull();
  });

  it("uses the natural end of the period, never clipped to today", () => {
    expect(filingRange("2026-B4")).toEqual({ start: "2026-07-01", end: "2026-08-31", label: "יול׳-אוג׳ 2026" });
    expect(filingRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28", label: "פברואר 2026" });
    expect(filingRange("2026-B6")?.end).toBe("2026-12-31");
  });

  it("knows whether the period has ended", () => {
    expect(filingPeriodEnded("2026-B4", july)).toBe(true);
    expect(filingPeriodEnded("2026-B5", july)).toBe(false);
    expect(filingPeriodEnded("2026-09", july)).toBe(false);
    expect(filingPeriodEnded("2026-08", july)).toBe(true);
  });

  it("opens on the last bi-month that has fully ended, wrapping the year", () => {
    expect(defaultFilingPeriod(new Date(2026, 8, 14))).toBe("2026-B4");
    expect(defaultFilingPeriod(new Date(2026, 0, 3))).toBe("2025-B6");
    expect(defaultFilingPeriod(new Date(2026, 2, 1))).toBe("2026-B1");
  });
});

describe("buildPeriodicFiling", () => {
  const documents = [
    doc({ date: "2026-07-10", number: 1, subtotal: 1000, vat: 180, total: 1180 }),
    doc({ date: "2026-08-20", number: 2, subtotal: 2000, vat: 360, total: 2360, status: "sent" }),
    doc({ date: "2026-08-25", number: 3, type: "credit_note", status: "sent", subtotal: -500, vat: -90, total: -590 }),
    doc({ date: "2026-08-26", number: 4, type: "quote", status: "sent" }),
    doc({ date: "2026-08-27", number: 5, status: "draft" }),
    doc({ date: "2026-09-02", number: 6 }),
  ];
  const expenses = [
    expense({ date: "2026-07-05", amount: 236, vatAmount: 36 }),
    expense({ date: "2026-08-15", amount: 1180, vatAmount: 180, isEquipment: true }),
    expense({ date: "2026-09-01", amount: 118, vatAmount: 18 }),
  ];

  it("returns null for a period that cannot be filed", () => {
    expect(buildPeriodicFiling({ business: authorized, documents, expenses, period: "2026-Q3" })).toBeNull();
  });

  it("lists the period's income and expenses, skipping drafts, quotes and other periods", () => {
    const f = buildPeriodicFiling({ business: authorized, documents, expenses, period: "2026-B4", today: july })!;
    expect(f.range.label).toBe("יול׳-אוג׳ 2026");
    expect(f.ended).toBe(true);
    expect(f.income.rows.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(f.income.vat).toEqual({ count: 3, net: 2500, vat: 450, gross: 2950 });
    expect(f.income.turnover).toEqual({ count: 2, net: 500, vat: 90, gross: 590 });
    expect(f.expenses.rows).toHaveLength(2);
    expect(f.expenses.totals.vat).toBe(216);
    expect(f.deadlines).toEqual({ regular: "2026-09-15", online: "2026-09-19", detailed: "2026-09-23" });
  });

  it("marks which rows feed the VAT return and which feed the advance", () => {
    const f = buildPeriodicFiling({ business: authorized, documents, expenses, period: "2026-B4", today: july })!;
    const byNumber = Object.fromEntries(f.income.rows.map((r) => [r.number, r]));
    expect(byNumber[1]).toMatchObject({ inVat: true, inTurnover: true });
    // Issued but unpaid: in the VAT return (issue basis), not in the advance (cash basis).
    expect(byNumber[2]).toMatchObject({ inVat: true, inTurnover: false });
    // A credit note counts by issue in both.
    expect(byNumber[3]).toMatchObject({ inVat: true, inTurnover: true });
  });

  it("takes the six VAT figures from the PCN874 generator and the advance from its module", () => {
    const f = buildPeriodicFiling({ business: authorized, documents, expenses, period: "2026-B4", today: july })!;
    const pcn = buildPcn874({ business: authorized, documents, expenses, range: { start: "2026-07-01", end: "2026-08-31" } });
    expect(f.vat).toEqual(pcn.figures);
    expect(f.vatFigures.map((x) => x.value)).toEqual([
      pcn.figures.taxableSales,
      pcn.figures.outputVat,
      pcn.figures.zeroOrExemptSales,
      pcn.figures.equipmentInputVat,
      pcn.figures.otherInputVat,
      Math.abs(pcn.figures.netDue),
    ]);
    const adv = computeAdvance(documents, { start: "2026-07-01", end: "2026-08-31" }, 5);
    expect(f.advance).toEqual(adv);
    expect(f.advanceFigures.find((x) => x.key === "turnover")?.value).toBe(500); // 1000 paid - 500 credit
    expect(f.advanceFigures.find((x) => x.key === "rate")?.display).toBe("5%");
  });

  it("an עוסק פטור gets no VAT figures but still gets the advance and both lists", () => {
    const f = buildPeriodicFiling({ business: exempt, documents, expenses, period: "2026-07", today: july })!;
    expect(f.filesVat).toBe(false);
    expect(f.vat).toBeNull();
    expect(f.vatFigures).toEqual([]);
    expect(f.advanceFigures).toHaveLength(5);
    expect(f.income.rows).toHaveLength(1);
    expect(f.expenses.rows).toHaveLength(1);
  });

  it("with no advance rate set, the advance is zero but the turnover still shows", () => {
    const f = buildPeriodicFiling({ business: { ...authorized, incomeTaxAdvanceRate: undefined }, documents, expenses, period: "2026-07" })!;
    expect(f.advance.ratePercent).toBe(0);
    expect(f.advance.turnover).toBe(1000);
    expect(f.advance.due).toBe(0);
  });

  it("uses the shekel snapshot of a foreign-currency document", () => {
    const usd = doc({ date: "2026-07-12", number: 9, currency: "USD", exchangeRate: 3.7, subtotal: 100, vat: 0, total: 100, subtotalIls: 370, vatIls: 0, totalIls: 370, zeroRated: true });
    const f = buildPeriodicFiling({ business: authorized, documents: [usd], expenses: [], period: "2026-07" })!;
    expect(f.income.rows[0].gross).toBe(370);
    expect(f.income.vat.gross).toBe(370);
  });
  // ---- council findings, 2026-09-15 ----

  it("an invoice converted into a receipt stays in the VAT rows; the receipt carries the turnover", () => {
    const invoice = doc({ id: "inv", date: "2026-07-10", number: 11, status: "paid", convertedToId: "rcp", subtotal: 1000, vat: 180, total: 1180 });
    const receipt = doc({ id: "rcp", date: "2026-07-20", number: 12, type: "receipt", status: "paid", subtotal: 1180, vat: 0, total: 1180 });
    const f = buildPeriodicFiling({ business: authorized, documents: [invoice, receipt], expenses: [], period: "2026-07", today: july })!;
    expect(f.income.rows.map((r) => [r.number, r.inVat, r.inTurnover])).toEqual([[11, true, false], [12, false, true]]);
    // The VAT rows add up to the VAT card, whatever the receipt carries.
    expect(f.income.vat.vat).toBe(f.vat!.outputVat);
    expect(f.income.vat.net).toBe(f.vat!.taxableSales);
  });

  it("a receipt that carries VAT never leaks into the VAT totals", () => {
    const receipt = doc({ date: "2026-07-20", number: 12, type: "receipt", status: "paid", subtotal: 1000, vat: 180, total: 1180 });
    const f = buildPeriodicFiling({ business: authorized, documents: [receipt], expenses: [], period: "2026-07", today: july })!;
    expect(f.vat!.outputVat).toBe(0);
    expect(f.income.vat).toEqual({ count: 0, net: 0, vat: 0, gross: 0 });
    expect(f.income.rows[0]).toMatchObject({ inVat: false, inTurnover: true });
  });

  it("input VAT left out for a missing allocation number is reported, not silently different", () => {
    const big = expense({ date: "2026-07-15", amount: 11800, vatAmount: 1800, isEquipment: true, allocationNumber: "" });
    const f = buildPeriodicFiling({ business: authorized, documents: [], expenses: [big], period: "2026-07", today: july })!;
    expect(f.vat!.equipmentInputVat).toBe(0);
    expect(f.excludedInputVat).toBe(1800);
    expect(f.pcn!.warnings.some((w) => w.code === "supplier_allocation_missing")).toBe(true);
    // The expense table still shows what was typed.
    expect(f.expenses.totals.equipmentVat).toBe(1800);
    const withAllocation = buildPeriodicFiling({ business: authorized, documents: [], expenses: [{ ...big, allocationNumber: "123456789" }], period: "2026-07", today: july })!;
    expect(withAllocation.vat!.equipmentInputVat).toBe(1800);
    expect(withAllocation.excludedInputVat).toBe(0);
  });

  it("keeps the PCN874 checks so a foreign-currency document without shekel amounts is flagged", () => {
    const usd = doc({ date: "2026-07-12", number: 9, currency: "USD", exchangeRate: 3.7, subtotal: 1000, vat: 180, total: 1180 });
    const f = buildPeriodicFiling({ business: authorized, documents: [usd], expenses: [], period: "2026-07", today: july })!;
    expect(f.pcn!.warnings.some((w) => w.level === "error" && w.code === "foreign_currency_missing_ils")).toBe(true);
  });

  it("counts expenses whose category says ציוד but are not marked as equipment", () => {
    const f = buildPeriodicFiling({
      business: authorized,
      documents: [],
      expenses: [expense({ category: "ציוד", isEquipment: false }), expense({ category: "ציוד", isEquipment: true }), expense({ category: "משרד" })],
      period: "2026-07",
      today: july,
    })!;
    expect(f.equipmentCategoryUnmarked).toBe(1);
    expect(buildPeriodicFiling({ business: exempt, documents: [], expenses: [expense({ category: "ציוד" })], period: "2026-07" })!.equipmentCategoryUnmarked).toBe(0);
  });
});

describe("filing period helpers", () => {
  it("refuses anything that is not a real month or bi-month", () => {
    for (const bad of ["abc", "2026-13", "2026-00", "2026-B7", "2026-B0", "2026-7", "2026-Q3", "2026", "all", "2026-01-01..2026-02-01", ""]) {
      expect(isFilingPeriod(bad), bad).toBe(false);
      expect(filingRange(bad), bad).toBeNull();
    }
  });

  it("switching to month from an ended bi-month lands on its last ended month", () => {
    expect(switchFilingMode("2026-B4", "month", july)).toBe("2026-08");
    // Current bi-month in mid-September: nothing ended yet, so its first month.
    expect(switchFilingMode("2026-B5", "month", july)).toBe("2026-09");
    // Sep-Oct during November: October.
    expect(switchFilingMode("2026-B5", "month", new Date(2026, 10, 3))).toBe("2026-10");
    expect(switchFilingMode("2026-08", "bimonth", july)).toBe("2026-B4");
    expect(switchFilingMode("2026-07", "bimonth", july)).toBe("2026-B4");
    expect(switchFilingMode("2026-08", "month", july)).toBe("2026-08");
  });

  it("steps across year boundaries", () => {
    expect(shiftFilingPeriod("2026-B1", -1)).toBe("2025-B6");
    expect(shiftFilingPeriod("2025-B6", 1)).toBe("2026-B1");
    expect(shiftFilingPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftFilingPeriod("2025-12", 1)).toBe("2026-01");
  });

  it("links to /reports/vat only when that report can show the same period", () => {
    expect(vatReportModeFor("2026-B4", july)).toBe("last_2m");
    expect(vatReportModeFor("2026-B5", july)).toBe("this_2m");
    expect(vatReportModeFor("2026-08", july)).toBe("last_month");
    expect(vatReportModeFor("2026-09", july)).toBe("this_month");
    expect(vatReportModeFor("2026-07", july)).toBeNull();
    expect(vatReportModeFor("2026-B3", july)).toBeNull();
    expect(vatReportModeFor("2025-B6", new Date(2026, 0, 10))).toBe("last_2m");
    expect(vatReportModeFor("2025-12", new Date(2026, 0, 10))).toBe("last_month");
  });

  it("deadlines roll into the next year after December", () => {
    expect(filingDeadlines("2026-12-31")).toEqual({ regular: "2027-01-15", online: "2027-01-19", detailed: "2027-01-23" });
  });
});

// A Business object is wide; the builder only needs three fields. Keep the
// test honest about that contract.
const _typeCheck: Pick<Business, "taxId" | "businessType" | "incomeTaxAdvanceRate"> = authorized;
void _typeCheck;
