import { describe, it, expect } from "vitest";
import { projectAnnualTax, yearToDateTaxBase } from "@/lib/tax-projection";
import type { Expense, InvoiceDocument } from "@/lib/types";

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: "d",
    type: "tax_invoice_receipt",
    number: 1,
    date: "2026-03-01",
    clientName: "לקוח",
    status: "paid",
    items: [],
    subtotal: 10_000,
    vat: 1_800,
    total: 11_800,
    ...over,
  } as InvoiceDocument;
}

function expense(over: Partial<Expense> = {}): Expense {
  return { id: "e", date: "2026-03-10", category: "משרד", supplier: "ספק", amount: 1_180, vatAmount: 180, ...over };
}

describe("yearToDateTaxBase", () => {
  const documents = [
    doc({ subtotal: 10_000, vat: 1_800, total: 11_800 }),
    // A credit note: stored negative, saved "sent", never "paid".
    doc({ type: "credit_note", status: "sent", subtotal: -2_000, vat: -360, total: -2_360 }),
    // Not income: unpaid invoice, last year's receipt, a converted source.
    doc({ status: "sent" }),
    doc({ date: "2025-12-31" }),
    doc({ type: "tax_invoice", convertedToId: "x" }),
  ];
  const expenses = [expense(), expense({ date: "2025-06-01" })];

  // Before 2026-09-15 the page taxed the VAT-inclusive totals for every
  // business type and ignored the credit note: 11,800 income, 1,180 expenses.
  it("uses pre-VAT income and VAT-net expenses for an authorized dealer, net of credit notes", () => {
    expect(yearToDateTaxBase(documents, expenses, 2026, "authorized")).toEqual({ ytdIncome: 8_000, ytdExpenses: 1_000 });
    expect(yearToDateTaxBase(documents, expenses, 2026, "company")).toEqual({ ytdIncome: 8_000, ytdExpenses: 1_000 });
  });

  it("keeps gross amounts for an exempt dealer, who neither charges nor reclaims VAT", () => {
    const exemptDocs = [
      doc({ subtotal: 10_000, vat: 0, total: 10_000 }),
      doc({ type: "credit_note", status: "sent", subtotal: -2_000, vat: 0, total: -2_000 }),
    ];
    expect(yearToDateTaxBase(exemptDocs, [expense({ vatAmount: undefined })], 2026, "exempt")).toEqual({
      ytdIncome: 8_000,
      ytdExpenses: 1_180,
    });
  });

  it("prefers the ILS snapshot of a foreign-currency document", () => {
    const usd = doc({ currency: "USD", subtotal: 1_000, subtotalIls: 3_700, total: 1_180, totalIls: 4_366 });
    expect(yearToDateTaxBase([usd], [], 2026, "authorized").ytdIncome).toBe(3_700);
    expect(yearToDateTaxBase([usd], [], 2026, "exempt").ytdIncome).toBe(4_366);
  });
});

describe("monthly reserve", () => {
  // A steady earner: 20,000 profit a month, so the year-to-date figures are
  // exactly the elapsed share of 240,000.
  const DAYS_IN_YEAR = 365;
  function project(daysElapsed: number) {
    const share = daysElapsed / DAYS_IN_YEAR;
    return projectAnnualTax({
      ytdIncome: 240_000 * share,
      ytdExpenses: 0,
      daysElapsed,
      daysInYear: DAYS_IN_YEAR,
    });
  }

  // 1 September: 243 days gone, 122 left (~4 months). The old formula put
  // the whole year's tax on those four months (totalTax / 4.01 each), so a
  // user who had followed it all year reserved about 4x the tax.
  it("in September sets aside a twelfth of the year's tax, not a quarter of it", () => {
    const p = project(243);
    expect(p.totalTax).toBeGreaterThan(0);
    expect(p.remainingReserve).toBeCloseTo((p.totalTax * 122) / 365, 6);
    expect(p.monthlyReserve).toBeCloseTo(p.totalTax / 12, -1);
    expect(p.monthlyReserve).toBeLessThan(p.totalTax / 11);
    // Following it for the months left covers exactly the remaining share.
    expect(p.monthlyReserve * (122 / 30.4)).toBeCloseTo(p.remainingReserve, 6);
  });

  // 1 December: 31 days left. The old formula asked for ~98% of the whole
  // year's tax in that single month.
  it("in December asks for one month's share, not the whole year's tax", () => {
    const p = project(334);
    expect(p.remainingReserve).toBeCloseTo((p.totalTax * 31) / 365, 6);
    expect(p.monthlyReserve).toBeCloseTo(p.totalTax / 12, -1);
    expect(p.monthlyReserve).toBeLessThan(p.totalTax / 11);
  });

  it("is steady through the year for a steady earner, so twelve of them add up to the year's tax", () => {
    const march = project(59);
    const december = project(334);
    expect(march.totalTax).toBeCloseTo(december.totalTax, 6);
    expect(march.monthlyReserve).toBeCloseTo(december.monthlyReserve, 6);
    expect(march.monthlyReserve * 12).toBeCloseTo(march.totalTax, -2);
  });
});
