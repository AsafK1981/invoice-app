import { describe, it, expect } from "vitest";
import { reversedConversion } from "@/lib/conversion-reversal";
import { computeClientAccount } from "@/lib/aging";
import type { InvoiceDocument } from "@/lib/types";

// The locked source of a fully credited conversion. These tests also pin the
// reason the source is NOT reopened: the last case measures what reopening
// would do to the balance the customer sees in the portal.

const base = {
  businessId: "biz-1",
  clientId: "client-1",
  clientName: "לקוח",
  items: [],
  subtotal: 1000,
  vat: 0,
  currency: "ILS",
  language: "he" as const,
};

const d = (over: Partial<InvoiceDocument>) => ({ ...base, ...over }) as InvoiceDocument;

const proforma = d({
  id: "A",
  type: "proforma",
  number: 201,
  date: "2026-03-01",
  status: "paid",
  total: 1000,
  totalIls: 1000,
  convertedToId: "B",
});
const successor = d({
  id: "B",
  type: "tax_invoice_receipt",
  number: 1001,
  date: "2026-03-02",
  status: "paid",
  total: 1000,
  totalIls: 1000,
});
const credit = (over: Partial<InvoiceDocument>) =>
  d({
    id: "C",
    type: "credit_note",
    number: 3001,
    date: "2026-03-10",
    status: "sent",
    total: -1000,
    totalIls: -1000,
    originalDocumentId: "B",
    ...over,
  });

describe("reversedConversion", () => {
  it("reports the reversal when the successor is credited in full", () => {
    const found = reversedConversion(proforma, [proforma, successor, credit({})]);
    expect(found).not.toBeNull();
    expect(found!.successor.id).toBe("B");
    expect(found!.credited).toBe(1000);
    expect(found!.total).toBe(1000);
    expect(found!.credits.map((c) => c.id)).toEqual(["C"]);
  });

  it("adds several credit notes up", () => {
    const docs = [
      proforma,
      successor,
      credit({ id: "C1", total: -400, totalIls: -400 }),
      credit({ id: "C2", total: -600, totalIls: -600, date: "2026-03-12" }),
    ];
    const found = reversedConversion(proforma, docs);
    expect(found!.credited).toBe(1000);
    // Newest first.
    expect(found!.credits.map((c) => c.id)).toEqual(["C2", "C1"]);
  });

  it("stays silent on a partial credit", () => {
    const docs = [proforma, successor, credit({ total: -400, totalIls: -400 })];
    expect(reversedConversion(proforma, docs)).toBeNull();
  });

  it("allows a one agora shortfall, since a later credit note carries its own rate", () => {
    const docs = [proforma, successor, credit({ total: -999.99, totalIls: -999.99 })];
    expect(reversedConversion(proforma, docs)).not.toBeNull();
  });

  it("ignores draft and cancelled credit notes", () => {
    for (const status of ["draft", "cancelled"] as const) {
      const docs = [proforma, successor, credit({ status })];
      expect(reversedConversion(proforma, docs)).toBeNull();
    }
  });

  it("reports nothing for a document that was never converted", () => {
    const docs = [{ ...proforma, convertedToId: undefined } as InvoiceDocument, successor, credit({})];
    expect(reversedConversion(docs[0], docs)).toBeNull();
  });

  it("reports nothing when the successor is not loaded", () => {
    expect(reversedConversion(proforma, [proforma, credit({})])).toBeNull();
  });

  it("documents why the source is not reopened: it would invent a debt", () => {
    const docs = [proforma, successor, credit({})];
    // As shipped: the source stays converted and the customer owes nothing.
    expect(computeClientAccount(docs).balance).toBe(0);

    // What releasing it back to "sent" would have produced. Credit notes are
    // keyed to the successor, so nothing nets the reopened source.
    const released = [
      { ...proforma, status: "sent", convertedToId: undefined } as InvoiceDocument,
      successor,
      credit({}),
    ];
    expect(computeClientAccount(released).balance).toBe(1000);
  });
});
