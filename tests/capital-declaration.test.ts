import { describe, it, expect } from "vitest";
import { computeOpenReceivables } from "@/lib/capital-declaration";
import type { InvoiceDocument } from "@/lib/types";

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: Math.random().toString(36).slice(2),
    type: "tax_invoice",
    number: 1,
    date: "2026-06-15",
    clientId: "c1",
    clientName: "לקוח",
    status: "sent",
    items: [],
    subtotal: 100,
    vat: 0,
    total: 100,
    ...over,
  };
}

describe("computeOpenReceivables", () => {
  it("counts an open (sent) tax invoice as a receivable", () => {
    const r = computeOpenReceivables([doc({ total: 500 })], "2026-12-31");
    expect(r.total).toBe(500);
    expect(r.count).toBe(1);
  });

  it("excludes paid documents - they are no longer owed", () => {
    const r = computeOpenReceivables([doc({ status: "paid", total: 500 })], "2026-12-31");
    expect(r.total).toBe(0);
    expect(r.count).toBe(0);
  });

  it("excludes draft and cancelled documents", () => {
    const r = computeOpenReceivables(
      [doc({ status: "draft", total: 500 }), doc({ status: "cancelled", total: 500 })],
      "2026-12-31",
    );
    expect(r.total).toBe(0);
    expect(r.count).toBe(0);
  });

  it("excludes quotes and proformas - not legal invoices, no enforceable claim", () => {
    const r = computeOpenReceivables(
      [doc({ type: "quote", total: 500 }), doc({ type: "proforma", total: 500 })],
      "2026-12-31",
    );
    expect(r.total).toBe(0);
    expect(r.count).toBe(0);
  });

  it("excludes documents converted into a successor, to avoid double counting", () => {
    const r = computeOpenReceivables(
      [doc({ type: "proforma", total: 500, convertedToId: "abc" })],
      "2026-12-31",
    );
    expect(r.total).toBe(0);
    expect(r.count).toBe(0);
  });

  // Credit notes are STORED negative (receipt-editor applies sign = -1 to
  // subtotal/vat/total). An open (unpaid) credit note must net DOWN what is
  // owed, not get added back as if it were still positive - see
  // credit-notes-stored-negative.md.
  it("nets an open credit note against open receivables (stored negative)", () => {
    const r = computeOpenReceivables(
      [
        doc({ total: 1000 }),
        doc({ type: "credit_note", status: "sent", total: -300 }),
      ],
      "2026-12-31",
    );
    expect(r.total).toBe(700);
    expect(r.count).toBe(2);
  });

  it("excludes a paid credit note - already settled, no longer open", () => {
    const r = computeOpenReceivables(
      [
        doc({ total: 1000 }),
        doc({ type: "credit_note", status: "paid", total: -300 }),
      ],
      "2026-12-31",
    );
    expect(r.total).toBe(1000);
    expect(r.count).toBe(1);
  });

  it("excludes documents issued after the as-of date (inclusive cutoff)", () => {
    const r = computeOpenReceivables(
      [
        doc({ date: "2026-06-15", total: 100 }),
        doc({ date: "2026-06-16", total: 200 }),
      ],
      "2026-06-15",
    );
    expect(r.total).toBe(100);
    expect(r.count).toBe(1);
  });

  it("prefers totalIls so a foreign-currency invoice is not summed as shekels", () => {
    const r = computeOpenReceivables([doc({ total: 100, totalIls: 370 })], "2026-12-31");
    expect(r.total).toBe(370);
  });

  it("falls back to total when totalIls is unset (ILS documents)", () => {
    const r = computeOpenReceivables([doc({ total: 250 })], "2026-12-31");
    expect(r.total).toBe(250);
  });

  it("returns docs sorted oldest first", () => {
    const r = computeOpenReceivables(
      [doc({ date: "2026-06-20", number: 2 }), doc({ date: "2026-06-01", number: 1 })],
      "2026-12-31",
    );
    expect(r.docs.map((d) => d.number)).toEqual([1, 2]);
  });

  it("empty input", () => {
    const r = computeOpenReceivables([], "2026-12-31");
    expect(r).toEqual({ total: 0, count: 0, docs: [] });
  });
});
