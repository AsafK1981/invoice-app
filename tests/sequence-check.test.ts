import { describe, it, expect } from "vitest";
import { buildSequenceRow, buildSequenceRows, totalMissing } from "../src/lib/sequence-check";
import type { DocumentType, InvoiceDocument } from "../src/lib/types";

/**
 * נספח ה' (א)(5) + the מחלקת ביקורת ממוחשבת guidance: the software has to name
 * the MISSING numbers, not just list the ones that exist. These tests pin that
 * output, including the year-boundary case a naive within-year scan misses.
 */
function doc(type: DocumentType, number: number, date: string): InvoiceDocument {
  return {
    id: `${type}-${number}`,
    type,
    number,
    date,
    clientId: "c1",
    clientName: "לקוח",
    status: "sent",
    items: [],
    subtotal: 100,
    vat: 0,
    total: 100,
  };
}

describe("buildSequenceRow", () => {
  it("returns null for a type with no documents that year", () => {
    expect(buildSequenceRow([doc("receipt", 1, "2025-05-01")], "receipt", 2026)).toBeNull();
    expect(buildSequenceRow([], "tax_invoice", 2026)).toBeNull();
  });

  it("reports first, last, count and an empty missing list for an unbroken run", () => {
    const docs = [
      doc("receipt", 1001, "2026-01-05"),
      doc("receipt", 1002, "2026-02-05"),
      doc("receipt", 1003, "2026-03-05"),
    ];
    const row = buildSequenceRow(docs, "receipt", 2026);
    expect(row).toEqual({
      type: "receipt",
      first: 1001,
      last: 1003,
      count: 3,
      missing: [],
      previousYearLast: null,
    });
  });

  it("names every missing number inside the year, not just how many", () => {
    const docs = [
      doc("tax_invoice", 201, "2026-01-05"),
      doc("tax_invoice", 204, "2026-02-05"),
      doc("tax_invoice", 205, "2026-03-05"),
      doc("tax_invoice", 208, "2026-04-05"),
    ];
    const row = buildSequenceRow(docs, "tax_invoice", 2026)!;
    expect(row.missing).toEqual([202, 203, 206, 207]);
    expect(row.count).toBe(4);
    expect(row.first).toBe(201);
    expect(row.last).toBe(208);
  });

  it("catches a gap that straddles the year boundary", () => {
    // Counters do not reset in January, so 11 and 12 were allocated and are
    // in neither year. A within-year scan of 2026 (13..14) sees nothing wrong.
    const docs = [
      doc("receipt", 9, "2025-11-01"),
      doc("receipt", 10, "2025-12-31"),
      doc("receipt", 13, "2026-01-02"),
      doc("receipt", 14, "2026-01-09"),
    ];
    const row = buildSequenceRow(docs, "receipt", 2026)!;
    expect(row.previousYearLast).toBe(10);
    expect(row.missing).toEqual([11, 12]);
  });

  it("does not invent a gap when the year simply continues the sequence", () => {
    const docs = [doc("receipt", 10, "2025-12-31"), doc("receipt", 11, "2026-01-02")];
    const row = buildSequenceRow(docs, "receipt", 2026)!;
    expect(row.previousYearLast).toBe(10);
    expect(row.missing).toEqual([]);
  });

  it("keeps each document type on its own sequence", () => {
    const docs = [
      doc("receipt", 1001, "2026-01-05"),
      doc("receipt", 1003, "2026-01-06"),
      doc("tax_invoice", 201, "2026-01-05"),
      doc("tax_invoice", 202, "2026-01-06"),
    ];
    const rows = buildSequenceRows(docs, 2026);
    expect(rows.map((r) => r.type).sort()).toEqual(["receipt", "tax_invoice"]);
    expect(rows.find((r) => r.type === "receipt")!.missing).toEqual([1002]);
    expect(rows.find((r) => r.type === "tax_invoice")!.missing).toEqual([]);
    expect(totalMissing(rows)).toBe(1);
  });

  it("counts a cancelled document as present - it keeps its number", () => {
    const cancelled = { ...doc("tax_invoice", 202, "2026-02-01"), status: "cancelled" as const };
    const docs = [doc("tax_invoice", 201, "2026-01-05"), cancelled, doc("tax_invoice", 203, "2026-03-01")];
    expect(buildSequenceRow(docs, "tax_invoice", 2026)!.missing).toEqual([]);
  });
});
