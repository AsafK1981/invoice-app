import { describe, it, expect } from "vitest";
import { computeClientAccount, computeAging } from "@/lib/aging";
import { countsAsIncome } from "@/lib/revenue";
import type { InvoiceDocument } from "@/lib/types";

function doc(over: Partial<InvoiceDocument>): InvoiceDocument {
  return { id: Math.random().toString(36).slice(2), type: "tax_invoice", number: 1, date: "2026-08-01", clientId: "c1", clientName: "A", status: "sent", items: [], subtotal: 1000, vat: 180, total: 1180, ...over };
}

describe("documents page header totals (all clients together)", () => {
  const quote = doc({ type: "quote", total: 5000, status: "sent" });
  const convertedQuote = doc({ id: "q2", type: "quote", total: 2000, status: "paid", convertedToId: "r2", clientId: "c2", clientName: "B" });
  const receipt = doc({ id: "r2", type: "receipt", total: 2000, status: "paid", clientId: "c2", clientName: "B" });
  const openInvoice = doc({ id: "i1", total: 1180, status: "sent" });
  const partialCredit = doc({ type: "credit_note", total: -180, status: "sent", originalDocumentId: "i1" });
  const unlinkedRefund = doc({ type: "credit_note", total: -300, status: "sent", clientId: "c3", clientName: "C" });
  const docs = [quote, convertedQuote, receipt, openInvoice, partialCredit, unlinkedRefund];

  it("outstanding equals the aging open total: no quotes, credits net their invoice, refunds do not inflate it", () => {
    const outstanding = computeClientAccount(docs).balance;
    expect(outstanding).toBe(1000);
    expect(outstanding).toBe(computeAging(docs, []).totals.grand);
  });

  it("paid counts the receipt once (not the converted quote) and subtracts credit notes", () => {
    const paid = docs.filter(countsAsIncome).reduce((s, d) => s + (d.totalIls ?? d.total), 0);
    expect(paid).toBe(2000 - 180 - 300);
  });
});
