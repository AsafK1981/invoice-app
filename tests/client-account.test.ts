import { describe, it, expect } from "vitest";
import { computeAging, computeClientAccount } from "@/lib/aging";
import { buildStatsByClient } from "@/lib/client-stats";
import { portalTotals } from "@/lib/portal-totals";
import type { Client, InvoiceDocument } from "@/lib/types";

let seq = 0;
function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  seq += 1;
  return {
    id: `d${seq}`,
    type: "tax_invoice",
    number: seq,
    date: "2026-09-01",
    clientId: "c1",
    clientName: "לקוח א",
    status: "sent",
    items: [],
    subtotal: 0,
    vat: 0,
    total: 0,
    ...over,
  };
}

/**
 * Client card, client statement (כרטסת), /clients cards and the client
 * portal. Until 2026-09-15 they summed every issued document: an open quote
 * was money owed and a proforma converted into a tax invoice-receipt was
 * counted twice (billed 25,000 / paid 20,000 / balance 5,000).
 */
describe("computeClientAccount", () => {
  it("the audit case: quote + converted proforma + its invoice-receipt is 10,000 / 10,000 / 0", () => {
    const docs = [
      doc({ type: "quote", total: 5_000 }),
      doc({ id: "pf", type: "proforma", status: "paid", total: 10_000, convertedToId: "tir" }),
      doc({ id: "tir", type: "tax_invoice_receipt", status: "paid", total: 10_000 }),
    ];
    const account = computeClientAccount(docs);
    expect(account).toMatchObject({ billed: 10_000, paid: 10_000, balance: 0 });
    expect(account.rows.map((r) => r.doc.id)).toEqual(["tir"]);
  });

  it("an unconverted open proforma is billed and owed, same as the aging report", () => {
    const docs = [doc({ type: "proforma", total: 3_000 }), doc({ type: "quote", total: 9_000 })];
    expect(computeClientAccount(docs)).toMatchObject({ billed: 3_000, paid: 0, balance: 3_000 });
    expect(computeAging(docs, []).totals.grand).toBe(3_000);
  });

  it("a credit note against an open invoice reduces billed and the balance", () => {
    const docs = [
      doc({ id: "inv", total: 1_180 }),
      doc({ type: "credit_note", originalDocumentId: "inv", total: -472 }),
    ];
    expect(computeClientAccount(docs)).toMatchObject({ billed: 708, paid: 0, balance: 708 });
  });

  it("a refund of a paid invoice reduces billed and paid, leaving nothing owed", () => {
    const docs = [
      doc({ id: "paid", status: "paid", total: 10_000 }),
      doc({ type: "credit_note", originalDocumentId: "paid", total: -2_000 }),
      doc({ type: "credit_note", total: -500 }),
    ];
    expect(computeClientAccount(docs)).toMatchObject({ billed: 7_500, paid: 7_500, balance: 0 });
  });

  it("the balance always equals the aging open amount, even when over-credited", () => {
    const docs = [
      doc({ id: "a", total: 1_000 }),
      doc({ type: "credit_note", originalDocumentId: "a", total: -1_500 }),
      doc({ id: "b", total: 2_000, totalIls: 7_400, currency: "USD" }),
      doc({ type: "credit_note", status: "draft", originalDocumentId: "b", total: -2_000 }),
      doc({ status: "cancelled", total: 4_000 }),
    ];
    const account = computeClientAccount(docs);
    expect(account.balance).toBe(computeAging(docs, []).totals.grand);
    expect(account.balance).toBe(7_400);
    expect(account.billed).toBe(6_900);
  });
});

describe("buildStatsByClient (/clients cards)", () => {
  it("bills by the account rule but still counts every issued document", () => {
    const clients: Client[] = [{ id: "c1", name: "לקוח א", createdAt: "2026-01-01" }];
    const stats = buildStatsByClient(
      [
        doc({ type: "quote", total: 5_000, date: "2026-09-10" }),
        doc({ type: "proforma", status: "paid", total: 10_000, convertedToId: "x" }),
        doc({ type: "tax_invoice_receipt", status: "paid", total: 10_000 }),
        doc({ status: "draft", total: 99_999, date: "2026-12-01" }),
      ],
      clients,
    );
    expect(stats.get("c1")).toEqual({ docCount: 3, totalBilled: 10_000, lastDocDate: "2026-09-10" });
  });
});

describe("portalTotals (client portal)", () => {
  it("never shows an open quote as waiting for payment, and does not double a conversion", () => {
    const totals = portalTotals([
      { id: "q", type: "quote", status: "sent", total: 5_000 },
      { id: "pf", type: "proforma", status: "paid", total: 10_000, converted: true },
      { id: "tir", type: "tax_invoice_receipt", status: "paid", total: 10_000 },
      { id: "inv", type: "tax_invoice", status: "sent", total: 1_180, total_ils: 1_180 },
      { id: "cn", type: "credit_note", status: "sent", total: -180, original_document_id: "inv" },
    ]);
    expect(totals).toEqual({ paid: 10_000, open: 1_000 });
  });
});
