import { describe, it, expect } from "vitest";
import { computeAging, isOpenReceivable } from "@/lib/aging";
import type { InvoiceDocument } from "@/lib/types";

let seq = 0;
function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  seq += 1;
  return {
    id: `d${seq}`,
    type: "tax_invoice",
    number: 100 + seq,
    date: "2026-09-01",
    clientId: "c1",
    clientName: "לקוח א",
    status: "sent",
    items: [],
    subtotal: 1_000,
    vat: 180,
    total: 1_180,
    ...over,
  };
}

/**
 * "פתוח לגבייה" on /reports and the full aging table. Until 2026-09-15 a sent
 * price quote counted as money owed, and a credit note issued against an
 * open invoice did not reduce it, so the KPI overstated receivables twice.
 */
describe("open receivables", () => {
  it("never counts a price quote, which is an offer and not a debt", () => {
    const quote = doc({ type: "quote", total: 5_000 });
    expect(isOpenReceivable(quote)).toBe(false);
    const { totals } = computeAging([quote, doc({ total: 1_180 })], []);
    expect(totals.grand).toBe(1_180);
    expect(totals.docCount).toBe(1);
  });

  it("keeps unpaid tax invoices and proformas, but not converted ones", () => {
    expect(isOpenReceivable(doc())).toBe(true);
    expect(isOpenReceivable(doc({ type: "proforma" }))).toBe(true);
    expect(isOpenReceivable(doc({ type: "proforma", convertedToId: "x" }))).toBe(false);
    expect(isOpenReceivable(doc({ status: "paid" }))).toBe(false);
  });

  it("nets a credit note (stored negative) against the invoice it names", () => {
    const invoice = doc({ id: "inv", total: 1_180 });
    const credit = doc({ type: "credit_note", originalDocumentId: "inv", total: -472 });
    const { rows, totals } = computeAging([invoice, credit], []);
    expect(totals.grand).toBe(708);
    expect(rows[0].openAmounts.inv).toBe(708);
    expect(totals.docCount).toBe(1);
  });

  it("drops an invoice that was credited in full", () => {
    const invoice = doc({ id: "inv2", total: 1_180 });
    const credit = doc({ type: "credit_note", originalDocumentId: "inv2", total: -1_180 });
    const { rows, totals } = computeAging([invoice, credit], []);
    expect(rows).toHaveLength(0);
    expect(totals.grand).toBe(0);
  });

  it("ignores draft or cancelled credit notes and ones that name no original", () => {
    const invoice = doc({ id: "inv3", total: 1_180 });
    const { totals } = computeAging(
      [
        invoice,
        doc({ type: "credit_note", status: "draft", originalDocumentId: "inv3", total: -500 }),
        doc({ type: "credit_note", status: "cancelled", originalDocumentId: "inv3", total: -500 }),
        doc({ type: "credit_note", total: -500 }),
      ],
      [],
    );
    expect(totals.grand).toBe(1_180);
  });

  it("uses the ILS snapshot on both sides", () => {
    const invoice = doc({ id: "usd", currency: "USD", total: 1_000, totalIls: 3_700 });
    const credit = doc({ type: "credit_note", originalDocumentId: "usd", total: -100, totalIls: -370 });
    expect(computeAging([invoice, credit], []).totals.grand).toBe(3_330);
  });
});
