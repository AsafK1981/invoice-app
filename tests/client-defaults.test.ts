import { describe, it, expect } from "vitest";
import { getClientDefaults } from "@/lib/client-defaults";
import type { InvoiceDocument } from "@/lib/types";

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
  it("returns empty defaults for missing client id", () => {
    const d = getClientDefaults("", []);
    expect(d).toEqual({ documentCount: 0 });
  });

  it("returns empty defaults when client has no documents", () => {
    const d = getClientDefaults("c1", [makeDoc({ clientId: "OTHER" })]);
    expect(d).toEqual({ documentCount: 0 });
  });

  it("counts only documents for the requested client", () => {
    const docs = [
      makeDoc({ clientId: "c1" }),
      makeDoc({ clientId: "c1" }),
      makeDoc({ clientId: "c2" }),
    ];
    expect(getClientDefaults("c1", docs).documentCount).toBe(2);
  });

  it("excludes cancelled documents from count and averages", () => {
    const docs = [
      makeDoc({ clientId: "c1", total: 100 }),
      makeDoc({ clientId: "c1", total: 999, status: "cancelled" }),
    ];
    const d = getClientDefaults("c1", docs);
    expect(d.documentCount).toBe(1);
    expect(d.averageTotal).toBe(100);
  });

  it("picks the most recent payment method (by date)", () => {
    const docs = [
      makeDoc({ clientId: "c1", date: "2026-01-01", paymentMethod: "cash" }),
      makeDoc({ clientId: "c1", date: "2026-03-15", paymentMethod: "bit" }),
      makeDoc({ clientId: "c1", date: "2026-02-10", paymentMethod: "credit_card" }),
    ];
    expect(getClientDefaults("c1", docs).paymentMethod).toBe("bit");
  });

  it("picks the most recent non-empty subject (skips empty subjects on newer docs)", () => {
    const docs = [
      makeDoc({ clientId: "c1", date: "2026-03-01", subject: undefined }),
      makeDoc({ clientId: "c1", date: "2026-02-01", subject: "ייעוץ פברואר" }),
      makeDoc({ clientId: "c1", date: "2026-01-01", subject: "ייעוץ ינואר" }),
    ];
    expect(getClientDefaults("c1", docs).recentSubject).toBe("ייעוץ פברואר");
  });

  it("computes average using absolute totals (so credit notes don't pull it negative)", () => {
    const docs = [
      makeDoc({ clientId: "c1", total: 1000 }),
      makeDoc({ clientId: "c1", total: -200 }), // credit note
    ];
    const d = getClientDefaults("c1", docs);
    expect(d.averageTotal).toBe(600); // (1000 + 200) / 2
  });

  it("returns undefined for averageTotal when all totals are zero", () => {
    const docs = [makeDoc({ clientId: "c1", total: 0 })];
    expect(getClientDefaults("c1", docs).averageTotal).toBeUndefined();
  });
});
