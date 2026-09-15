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
  // subtotal/vat/total), are saved "sent" and never become "paid". Until
  // 2026-09-15 every credit note ever issued stayed "open" here.
  it("nets a credit note (stored negative) only against the open invoice it names", () => {
    const r = computeOpenReceivables(
      [
        doc({ id: "inv", total: 1000 }),
        doc({ type: "credit_note", status: "sent", total: -300, originalDocumentId: "inv" }),
      ],
      "2026-12-31",
    );
    expect(r.total).toBe(700);
    expect(r.count).toBe(1);
    expect(r.openAmounts.inv).toBe(700);
  });

  it("a refund of a paid invoice is not a negative receivable (audit case: 10,000 paid + -2,000 gave -2,000)", () => {
    const r = computeOpenReceivables(
      [
        doc({ id: "paid", status: "paid", paidAt: "2026-03-01T10:00:00.000Z", total: 10000, date: "2026-02-01" }),
        doc({ type: "credit_note", status: "sent", total: -2000, originalDocumentId: "paid", date: "2026-04-01" }),
        doc({ type: "credit_note", status: "sent", total: -500 }),
      ],
      "2026-12-31",
    );
    expect(r).toEqual({ total: 0, count: 0, docs: [], openAmounts: {} });
  });

  it("a credit note never takes an invoice below zero, and one issued after the as-of date is ignored", () => {
    const r = computeOpenReceivables(
      [
        doc({ id: "a", total: 1000 }),
        doc({ type: "credit_note", total: -1500, originalDocumentId: "a" }),
        doc({ id: "b", total: 800 }),
        doc({ type: "credit_note", total: -800, originalDocumentId: "b", date: "2027-01-05" }),
      ],
      "2026-12-31",
    );
    expect(r.total).toBe(800);
    expect(r.docs.map((d) => d.id)).toEqual(["b"]);
  });

  it("an invoice issued in December and paid in January was a receivable on 31.12", () => {
    const invoice = doc({ date: "2025-12-10", status: "paid", paidAt: "2026-01-12T09:00:00.000Z", total: 4000 });
    expect(computeOpenReceivables([invoice], "2025-12-31").total).toBe(4000);
    expect(computeOpenReceivables([invoice], "2026-01-31").total).toBe(0);
  });

  it("judges the payment day in Israel time (23:30 UTC on 31.12 is already 1.1 in Israel)", () => {
    const invoice = doc({ date: "2025-12-10", status: "paid", paidAt: "2025-12-31T23:30:00.000Z", total: 900 });
    expect(computeOpenReceivables([invoice], "2025-12-31").total).toBe(900);
    const paidSameDay = doc({ date: "2025-12-10", status: "paid", paidAt: "2025-12-31T10:00:00.000Z", total: 900 });
    expect(computeOpenReceivables([paidSameDay], "2025-12-31").total).toBe(0);
  });

  it("a document converted into its receipt after the as-of date was still open then", () => {
    const invoice = doc({ date: "2025-11-01", status: "paid", convertedToId: "rcpt", paidAt: "2026-02-01T08:00:00.000Z", total: 1500 });
    const receipt = doc({ id: "rcpt", type: "receipt", date: "2026-02-01", status: "paid", paidAt: "2026-02-01T08:00:00.000Z", total: 1500 });
    expect(computeOpenReceivables([invoice, receipt], "2025-12-31").total).toBe(1500);
    expect(computeOpenReceivables([invoice, receipt], "2026-12-31").total).toBe(0);
  });

  it("treats a paid document with no paidAt (old data) as paid before the as-of date", () => {
    const r = computeOpenReceivables([doc({ date: "2024-05-01", status: "paid", total: 700 })], "2024-12-31");
    expect(r.total).toBe(0);
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
    expect(r).toEqual({ total: 0, count: 0, docs: [], openAmounts: {} });
  });
});
