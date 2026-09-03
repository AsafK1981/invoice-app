import { describe, it, expect } from "vitest";
import {
  computeAdvance,
  periodTurnover,
  advanceDueDate,
  exemptDealerAnnualTurnover,
  exemptDeclarationDeadline,
  roundShekelHalfUp,
} from "@/lib/ita/income-tax-advances";
import type { InvoiceDocument } from "@/lib/types";

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: Math.random().toString(36).slice(2),
    type: "receipt",
    number: 1,
    date: "2026-05-10",
    clientId: "c1",
    clientName: "לקוח",
    status: "paid",
    items: [],
    subtotal: 1000,
    vat: 0,
    total: 1000,
    ...over,
  };
}

const may = { start: "2026-05-01", end: "2026-05-31" };

describe("periodTurnover", () => {
  it("sums paid, countable documents before VAT and nets credit notes", () => {
    const t = periodTurnover(
      [
        doc({ subtotal: 1000 }),
        doc({ type: "tax_invoice", subtotal: 5000, vat: 900, total: 5900 }),
        // The editor saves credit notes as "sent", never "paid"; they still reduce turnover.
        doc({ type: "credit_note", status: "sent", subtotal: -500, vat: -90, total: -590 }),
      ],
      may,
    );
    expect(t.turnover).toBe(5500);
    expect(t.docCount).toBe(3);
  });

  it("returns whole shekels and never a negative advance base", () => {
    const t = periodTurnover([doc({ subtotal: 1000.4 }), doc({ subtotal: 0.4 })], may);
    expect(t.turnover).toBe(1001);
    const a = computeAdvance([doc({ type: "credit_note", status: "sent", subtotal: -800 })], may, 5);
    expect(a.turnover).toBe(0);
    expect(a.advance).toBe(0);
  });

  it("ignores unpaid, quotes, converted sources and other periods", () => {
    const t = periodTurnover(
      [
        doc({ status: "sent" }),
        doc({ type: "quote" }),
        doc({ convertedToId: "x" }),
        doc({ date: "2026-06-01" }),
      ],
      may,
    );
    expect(t.turnover).toBe(0);
    expect(t.docCount).toBe(0);
  });

  it("collects withholding in shekels", () => {
    const t = periodTurnover(
      [
        doc({ withholdingAmount: 100 }),
        doc({ currency: "USD", exchangeRate: 3.5, subtotalIls: 3500, withholdingAmount: 50 }),
      ],
      may,
    );
    expect(t.turnover).toBe(4500);
    expect(t.withheld).toBe(275);
  });
});

describe("computeAdvance", () => {
  it("applies the rate half-up and offsets withholding", () => {
    const a = computeAdvance([doc({ subtotal: 12345 }), doc({ withholdingAmount: 100, subtotal: 1000 })], may, 4.5);
    expect(a.turnover).toBe(13345);
    expect(a.advance).toBe(601); // 600.525
    expect(a.offset).toBe(100);
    expect(a.due).toBe(501);
    expect(a.carriedToAnnual).toBe(0);
  });

  it("caps the offset at the advance and carries the rest to the annual return", () => {
    const a = computeAdvance([doc({ subtotal: 1000, withholdingAmount: 350 })], may, 5);
    expect(a.advance).toBe(50);
    expect(a.offset).toBe(50);
    expect(a.due).toBe(0);
    expect(a.carriedToAnnual).toBe(300);
  });

  it("treats a missing or negative rate as zero", () => {
    expect(computeAdvance([doc()], may, NaN).advance).toBe(0);
    expect(computeAdvance([doc()], may, -3).ratePercent).toBe(0);
  });

  it("rounds half-up, not banker's", () => {
    expect(roundShekelHalfUp(2.5)).toBe(3);
    expect(roundShekelHalfUp(2.49)).toBe(2);
    expect(roundShekelHalfUp(-2.5)).toBe(-3);
  });
});

describe("deadlines", () => {
  it("advance is due on the 15th of the following month, rolling the year", () => {
    expect(advanceDueDate("2026-05-31")).toBe("2026-06-15");
    expect(advanceDueDate("2026-12-31")).toBe("2027-01-15");
    expect(advanceDueDate("2026-02-28")).toBe("2026-03-15");
  });

  it("exempt-dealer declaration covers the calendar year, counts issued (not only paid) documents like the ceiling tracker, and is due 31 January", () => {
    const t = exemptDealerAnnualTurnover(
      [
        doc({ date: "2026-01-02" }),
        doc({ date: "2026-06-02", status: "sent", type: "tax_invoice", subtotal: 500, total: 500 }),
        doc({ date: "2026-07-02", status: "draft" }),
        doc({ date: "2027-01-01" }),
      ],
      2026,
    );
    expect(t.turnover).toBe(1500);
    expect(t.docCount).toBe(2);
    expect(exemptDeclarationDeadline(2026)).toBe("2027-01-31");
  });
});
