import { describe, it, expect } from "vitest";
import { foreignIlsConsistent, journalRounding, uniformAmounts, uniformLineAmounts } from "@/lib/uniform-structure/amounts";
import type { InvoiceDocument } from "@/lib/types";

const item = (id: string, total: number, quantity = 1) => ({ id, description: "שירות", quantity, unitPrice: total / quantity, total });
function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return { id: "d", type: "tax_invoice", number: 1, date: "2026-01-15", status: "paid", clientId: "", clientName: "לקוח", subtotal: 100, vat: 18, total: 118, items: [item("a", 100)], ...over };
}

describe("uniform shekel amounts", () => {
  it("passes a shekel document through unchanged", () => {
    expect(uniformAmounts(doc({ discountAmount: 5, withholdingAmount: 2, rounding: 0.4, total: 118.4 }))).toEqual({
      foreign: false, currency: "ILS", rate: 1, subtotal: 100, vat: 18, total: 118.4, discount: 5, withholding: 2, roundingCap: 0.4,
    });
    expect(uniformLineAmounts(doc())).toEqual([{ unitPrice: 100, total: 100 }]);
  });

  it("uses the stored shekel amounts and converts discount and withholding with the rate", () => {
    expect(uniformAmounts(doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, vatIls: 66.6, totalIls: 436.6, discountAmount: 10 }))).toEqual({
      foreign: true, currency: "USD", rate: 3.7, subtotal: 370, vat: 66.6, total: 436.6, discount: 37, withholding: 0, roundingCap: 0.01,
    });
  });

  it("leaves missing shekel amounts as NaN so nothing is invented", () => {
    const a = uniformAmounts(doc({ currency: "EUR", exchangeRate: 4 }));
    expect([a.subtotal, a.vat, a.total].every(Number.isNaN)).toBe(true);
  });

  it("converts lines and lets the last line absorb the agorot", () => {
    const lines = uniformLineAmounts(doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, items: [item("a", 33.33), item("b", 33.33), item("c", 33.34)] }));
    expect(lines.map((l) => l.total)).toEqual([123.32, 123.32, 123.36]);
  });

  it("adds the converted discount back so the lines match 1221 + 1220", () => {
    const lines = uniformLineAmounts(doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, discountAmount: 10, items: [item("a", 60), item("b", 50)] }));
    expect(lines.map((l) => l.total)).toEqual([222, 185]);
  });

  it("caps the journal rounding at the stored rounding, at least one agora for foreign documents", () => {
    expect(journalRounding(uniformAmounts(doc({ rounding: 0.4, total: 118.4 })))).toBe(0.4);
    expect(journalRounding(uniformAmounts(doc({ type: "credit_note", subtotal: -100, vat: -18, rounding: -0.3, total: -118.3 })))).toBe(-0.3);
    expect(journalRounding(uniformAmounts(doc({ currency: "USD", exchangeRate: 3.5, rounding: 0.4, total: 118.4, subtotalIls: 350, vatIls: 63, totalIls: 415 })))).toBe(1.4);
    expect(journalRounding(uniformAmounts(doc({ currency: "USD", exchangeRate: 3.7, subtotalIls: 370, vatIls: 66.6, totalIls: 436.59 })))).toBe(-0.01);
    expect(journalRounding(uniformAmounts(doc({ subtotal: 100, vat: 18, total: 118.02 })))).toBe(0);
  });

  it("checks that foreign shekel snapshots match the rate and add up", () => {
    const ok = doc({ currency: "USD", exchangeRate: 3.6, subtotalIls: 360, vatIls: 64.8, totalIls: 424.8 });
    expect(foreignIlsConsistent(ok)).toBe(true);
    expect(foreignIlsConsistent({ ...ok, totalIls: 424.81, vatIls: 64.81 })).toBe(true);
    // native amounts stored as shekels
    expect(foreignIlsConsistent({ ...ok, subtotalIls: 100, vatIls: 18, totalIls: 118 })).toBe(false);
    // snapshots that do not add up
    expect(foreignIlsConsistent({ ...ok, vatIls: 60 })).toBe(false);
    // stored rounding converted with the rate is allowed
    expect(foreignIlsConsistent(doc({ currency: "USD", exchangeRate: 3.5, total: 118.4, rounding: 0.4, subtotalIls: 350, vatIls: 63, totalIls: 414.4 }))).toBe(true);
    expect(foreignIlsConsistent(doc())).toBe(true);
  });
});
