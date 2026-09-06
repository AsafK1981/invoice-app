import { describe, it, expect } from "vitest";
import { forecastCashFlow, type ForecastInputs } from "@/lib/cash-flow-forecast";
import type { InvoiceDocument, Expense } from "@/lib/types";

const TODAY = "2026-09-06";

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: over.id ?? "d1",
    type: "tax_invoice",
    number: 1,
    date: "2026-09-01",
    clientId: "c1",
    clientName: "לקוח",
    status: "sent",
    items: [],
    subtotal: 1000,
    vat: 0,
    total: 1000,
    ...over,
  };
}

function run(over: Partial<ForecastInputs> = {}): ReturnType<typeof forecastCashFlow> {
  return forecastCashFlow({
    documents: [],
    expenses: [],
    business: { businessType: "exempt" },
    today: TODAY,
    ...over,
  });
}

describe("QA throwaway: credit note stored negative", () => {
  it("decreases inflow and never doubles the reversal", () => {
    const invoice = doc({ id: "inv", total: 5900 });
    const creditNote = doc({
      id: "cn",
      type: "credit_note",
      date: "2026-09-02",
      originalDocumentId: "inv",
      subtotal: -2000,
      vat: -360,
      total: -2360,
    });
    const result = run({ documents: [invoice, creditNote] });
    // 5900 - 2360 = 3540, applied exactly once (not 5900 - 2*2360 = 1180).
    expect(result.totals.inflow).toBe(3540);
  });

  it("fully credited invoice contributes exactly 0, not a negative inflow", () => {
    const invoice = doc({ id: "inv2", total: 5900 });
    const creditNote = doc({
      id: "cn2",
      type: "credit_note",
      date: "2026-09-02",
      originalDocumentId: "inv2",
      total: -5900,
    });
    const result = run({ documents: [invoice, creditNote] });
    expect(result.totals.inflow).toBe(0);
  });
});

describe("QA throwaway: VAT never negative", () => {
  it("floors a would-be-negative VAT period at 0 (not a negative outflow)", () => {
    const invoice = doc({ id: "inv3", type: "tax_invoice", date: "2026-07-15", subtotal: 5000, vat: 900, total: 5900 });
    const expense: Expense = {
      id: "e1",
      date: "2026-08-04",
      category: "ציוד",
      supplier: "ספק",
      amount: 12000,
      vatAmount: 5000, // input VAT far exceeds output VAT of 900
    };
    const result = run({ documents: [invoice], expenses: [expense], business: { businessType: "authorized" } });
    const vatLines = result.months.flatMap((m) => m.lines.filter((l) => l.kind === "vat"));
    expect(vatLines).toHaveLength(0);
    // No month's outflow goes negative because of this.
    expect(result.months.every((m) => m.outflow >= 0)).toBe(true);
  });
});
