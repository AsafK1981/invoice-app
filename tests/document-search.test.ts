import { describe, it, expect } from "vitest";
import { matchDocument } from "@/lib/document-search";
import type { InvoiceDocument } from "@/lib/types";

function makeDoc(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: "d1",
    type: "quote",
    number: 1023,
    date: "2026-04-15",
    clientId: "c1",
    clientName: "טים טדי",
    subject: "ייעוץ אפריל",
    status: "sent",
    items: [
      { id: "i1", description: "שעות פיתוח", quantity: 10, unitPrice: 150, total: 1500 },
    ],
    subtotal: 1500,
    vat: 0,
    total: 1500,
    paymentMethod: "bank_transfer",
    notes: "תשלום תוך 30 יום",
    ...overrides,
  };
}

describe("matchDocument", () => {
  const doc = makeDoc();

  it("empty query matches everything", () => {
    expect(matchDocument(doc, "")).toBe(true);
    expect(matchDocument(doc, "   ")).toBe(true);
  });

  it("matches by document number with #", () => {
    expect(matchDocument(doc, "#1023")).toBe(true);
  });

  it("matches by document number without #", () => {
    expect(matchDocument(doc, "1023")).toBe(true);
  });

  it("matches client name (case-insensitive partial)", () => {
    expect(matchDocument(doc, "טים")).toBe(true);
    expect(matchDocument(doc, "טדי")).toBe(true);
  });

  it("matches subject text", () => {
    expect(matchDocument(doc, "ייעוץ")).toBe(true);
  });

  it("matches notes", () => {
    expect(matchDocument(doc, "30 יום")).toBe(true);
  });

  it("matches by total amount as raw number", () => {
    expect(matchDocument(doc, "1500")).toBe(true);
  });

  it("matches by item description", () => {
    expect(matchDocument(doc, "שעות פיתוח")).toBe(true);
  });

  it("matches Hebrew status label", () => {
    const paidDoc = makeDoc({ status: "paid" });
    expect(matchDocument(paidDoc, "שולם")).toBe(true);
  });

  it("matches Hebrew document type label (e.g. הצעת מחיר for quote)", () => {
    expect(matchDocument(doc, "הצעת מחיר")).toBe(true);
  });

  it("matches Hebrew document type label for proforma (חשבון עסקה)", () => {
    const proforma = makeDoc({ type: "proforma" });
    expect(matchDocument(proforma, "חשבון עסקה")).toBe(true);
  });

  it("matches payment method label", () => {
    expect(matchDocument(doc, "העברה בנקאית")).toBe(true);
  });

  it("multi-term AND: both terms must hit somewhere", () => {
    expect(matchDocument(doc, "טים 1500")).toBe(true);
    expect(matchDocument(doc, "טים אפריל")).toBe(true);
  });

  it("multi-term AND: returns false when one term doesn't match", () => {
    expect(matchDocument(doc, "טים 9999")).toBe(false);
    expect(matchDocument(doc, "נופר 1500")).toBe(false);
  });

  it("returns false when nothing matches", () => {
    expect(matchDocument(doc, "totallymadeup")).toBe(false);
  });

  it("handles credit note (negative amount): amount-based search uses absolute value", () => {
    const credit = makeDoc({ type: "credit_note", total: -200, subtotal: -200 });
    expect(matchDocument(credit, "200")).toBe(true);
  });

  it("handles document with no notes / no subject (defensive)", () => {
    const sparse = makeDoc({ notes: undefined, subject: undefined });
    expect(matchDocument(sparse, "1023")).toBe(true);
    expect(matchDocument(sparse, "totallymadeup")).toBe(false);
  });
});
