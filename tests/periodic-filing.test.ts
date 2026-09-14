import { describe, it, expect } from "vitest";
import {
  buildPeriodicFiling,
  defaultFilingPeriod,
  filingPeriodEnded,
  filingRange,
  isFilingPeriod,
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
    clientTaxId: "512345678",
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
    supplierTaxId: "512345678",
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
    expect(f.income.totals).toEqual({ count: 3, net: 2500, vat: 450, gross: 2950 });
    expect(f.expenses.rows).toHaveLength(2);
    expect(f.expenses.totals.vat).toBe(216);
    expect(f.dueDate).toBe("2026-09-15");
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
    expect(f.income.totals.gross).toBe(370);
  });
});

// A Business object is wide; the builder only needs three fields. Keep the
// test honest about that contract.
const _typeCheck: Pick<Business, "taxId" | "businessType" | "incomeTaxAdvanceRate"> = authorized;
void _typeCheck;
