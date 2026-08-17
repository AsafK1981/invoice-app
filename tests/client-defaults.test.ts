import { describe, it, expect } from "vitest";
import { getClientDefaults } from "@/lib/client-defaults";
import type { Client, InvoiceDocument } from "@/lib/types";

const C1: Client = { id: "c1", name: "Tim Teddy", createdAt: "2026-01-01" };

function makeDoc(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: "d-" + Math.random(),
    type: "receipt",
    number: 1,
    date: "2026-01-01",
    clientId: "c1",
    clientName: "Tim Teddy",
    status: "paid",
    items: [],
    subtotal: 100,
    vat: 0,
    total: 100,
    paymentMethod: "bank_transfer",
    ...overrides,
  };
}

describe("getClientDefaults", () => {
  it("returns empty defaults for missing client", () => {
    const d = getClientDefaults(null, [], []);
    expect(d).toEqual({ documentCount: 0 });
  });

  it("returns empty defaults when client has no documents", () => {
    const d = getClientDefaults(C1, [makeDoc({ clientId: "OTHER" })], [C1]);
    expect(d).toEqual({ documentCount: 0 });
  });

  it("counts only documents for the requested client", () => {
    const docs = [
      makeDoc({ clientId: "c1" }),
      makeDoc({ clientId: "c1" }),
      makeDoc({ clientId: "c2", clientName: "Someone Else" }),
    ];
    expect(getClientDefaults(C1, docs, [C1]).documentCount).toBe(2);
  });

  it("also counts unlinked documents (no clientId) that name this client", () => {
    // Asaf's father, 2026-08-17: doc #97 was typed free-text (client_id null,
    // name "גינדין אנה מוסך זהב"), doc #100 picked the saved client
    // "גינדין אנה  מוסך זהב" (double space). The hint said "1 מסמך"; the
    // documents list showed two.
    const anna: Client = { id: "anna", name: "גינדין אנה  מוסך זהב", taxId: "515199669", createdAt: "2026-05-17" };
    const docs = [
      makeDoc({ clientId: "", clientName: "גינדין אנה מוסך זהב", total: 36580 }),
      makeDoc({ clientId: "anna", clientName: "גינדין אנה  מוסך זהב", total: 36580 }),
    ];
    expect(getClientDefaults(anna, docs, [anna]).documentCount).toBe(2);
  });

  it("does not steal a document linked to a different client with the same name", () => {
    const docs = [makeDoc({ clientId: "c2", clientName: "Tim Teddy" })];
    expect(getClientDefaults(C1, docs, [C1]).documentCount).toBe(0);
  });

  it("excludes cancelled documents from count and averages", () => {
    const docs = [
      makeDoc({ clientId: "c1", total: 100 }),
      makeDoc({ clientId: "c1", total: 999, status: "cancelled" }),
    ];
    const d = getClientDefaults(C1, docs, [C1]);
    expect(d.documentCount).toBe(1);
    expect(d.averageTotal).toBe(100);
  });

  it("picks the most recent payment method (by date)", () => {
    const docs = [
      makeDoc({ clientId: "c1", date: "2026-01-01", paymentMethod: "cash" }),
      makeDoc({ clientId: "c1", date: "2026-03-15", paymentMethod: "bit" }),
      makeDoc({ clientId: "c1", date: "2026-02-10", paymentMethod: "credit_card" }),
    ];
    expect(getClientDefaults(C1, docs, [C1]).paymentMethod).toBe("bit");
  });

  it("picks the most recent non-empty subject (skips empty subjects on newer docs)", () => {
    const docs = [
      makeDoc({ clientId: "c1", date: "2026-03-01", subject: undefined }),
      makeDoc({ clientId: "c1", date: "2026-02-01", subject: "ייעוץ פברואר" }),
      makeDoc({ clientId: "c1", date: "2026-01-01", subject: "ייעוץ ינואר" }),
    ];
    expect(getClientDefaults(C1, docs, [C1]).recentSubject).toBe("ייעוץ פברואר");
  });

  it("computes average using absolute totals (so credit notes don't pull it negative)", () => {
    const docs = [
      makeDoc({ clientId: "c1", total: 1000 }),
      makeDoc({ clientId: "c1", total: -200 }), // credit note
    ];
    const d = getClientDefaults(C1, docs, [C1]);
    expect(d.averageTotal).toBe(600); // (1000 + 200) / 2
  });

  it("returns undefined for averageTotal when all totals are zero", () => {
    const docs = [makeDoc({ clientId: "c1", total: 0 })];
    expect(getClientDefaults(C1, docs, [C1]).averageTotal).toBeUndefined();
  });
});
