import { describe, expect, it } from "vitest";
import { INVOICE_LIST_TITLES, invoiceListAffectingCodes, invoiceReportPreflight } from "../src/lib/invoice-report-preflight";
import { mapFilingDocument, mapFilingExpense } from "../src/lib/filing-report-data";
import type { InvoiceDocument } from "../src/lib/types";

const doc = (extra: Partial<InvoiceDocument> = {}): InvoiceDocument => ({ id: "example", number: 101, type: "tax_invoice", status: "sent", date: "2026-08-05", clientId: "client", clientName: "לקוח בדיקה", items: [], subtotal: 100, vat: 18, total: 118, ...extra });
const check = (docs: InvoiceDocument[]) => invoiceReportPreflight(docs, "2026-08-01", "2026-08-31");

describe("accountant listing integrity", () => {
  it("accepts a legitimate anonymous invoice without imposing PCN ID requirements", () => expect(check([doc()])).toEqual([]));
  it("excludes drafts, cancelled documents, quotes and other periods", () => expect(check([doc({ status: "draft", total: NaN }), doc({ status: "cancelled", total: NaN }), doc({ type: "quote", total: NaN }), doc({ date: "2026-07-05", total: NaN })])).toEqual([]));
  it("reports a broken date only in a period its month overlaps, naming the month", () => {
    const broken = doc({ date: "2026-02-30" });
    expect(invoiceReportPreflight([broken], "2026-01-01", "2026-03-31")).toEqual([
      expect.objectContaining({ code: "date_invalid", level: "totals", documentId: "example", sourceLabel: "חשבונית מס 101", message: expect.stringContaining("2026-02") }),
    ]);
    expect(check([broken])).toEqual([]);
  });
  it("a date with no readable month is a note, never a totals finding in every period", () =>
    expect(check([doc({ date: "" })])).toEqual([expect.objectContaining({ code: "date_invalid", level: "note" })]));
  it("an invalid or reversed period is the only error", () =>
    expect(invoiceReportPreflight([], "2026-08-31", "2026-08-01")).toEqual([expect.objectContaining({ code: "period_invalid", level: "error" })]));
  it("nonfinite amounts and mismatched totals affect the totals", () => {
    for (const invalid of [NaN, Infinity]) expect(check([doc({ total: invalid })])).toContainEqual(expect.objectContaining({ code: "amount_invalid", level: "totals" }));
    expect(check([doc({ total: 117 })])).toContainEqual(expect.objectContaining({ code: "total_mismatch", level: "totals" }));
  });
  it("accepts stored rounding and negative credits", () => {
    expect(check([doc({ subtotal: 100.1, vat: 18.02, total: 118, rounding: -0.12 })])).toEqual([]);
    expect(check([doc({ type: "credit_note", subtotal: -100, vat: -18, total: -118 })])).toEqual([]);
  });
  it("missing FX snapshots affect the totals; complete ILS amounts are fine", () => {
    expect(check([doc({ currency: "USD" })])).toEqual([expect.objectContaining({ code: "foreign_currency_missing_ils", level: "totals" })]);
    expect(check([doc({ currency: "USD", subtotalIls: 350, vatIls: 63, totalIls: 413 })])).toEqual([]);
  });
  it("a duplicate number in one series affects the totals; a credit is a separate series", () => {
    expect(check([doc(), doc({ id: "credit", type: "credit_note", subtotal: -100, vat: -18, total: -118 })])).toEqual([]);
    expect(check([doc(), doc({ id: "duplicate" })])).toEqual([expect.objectContaining({ code: "duplicate_number", level: "totals", documentId: "duplicate" })]);
  });
  it("a foreign customer id is a note carrying the document's own number; an 8-digit Israeli number is fine", () => {
    expect(check([doc({ clientTaxId: "FOREIGN-123" })])).toEqual([expect.objectContaining({ code: "customer_number_not_israeli", level: "note", current: "FOREIGN-123" })]);
    expect(check([doc({ clientTaxId: "13333331" })])).toEqual([]);
  });
  it("lists only codes that change the totals or stop the report, once each", () => {
    const issues = check([doc({ currency: "USD" }), doc({ id: "b", currency: "USD", clientName: " " })]);
    expect(invoiceListAffectingCodes(issues)).toEqual(["foreign_currency_missing_ils", "duplicate_number"]);
  });
  it("has a title for every code", () => expect(Object.values(INVOICE_LIST_TITLES).every((t) => t.trim().length > 0)).toBe(true));
  it("preserves missing source amounts and FX snapshots before preflight", () => {
    const mapped = mapFilingDocument({ id: "example", type: "tax_invoice", status: "sent", date: "2026-08-01", currency: "USD", total: "bad", vat: null, subtotal: "", number: "101" });
    expect(Number.isNaN(mapped.total)).toBe(true);
    expect(Number.isNaN(mapped.vat)).toBe(true);
    expect(Number.isNaN(mapped.subtotal)).toBe(true);
    expect(mapped.totalIls).toBeUndefined();
    expect(mapped.subtotalIls).toBeUndefined();
  });
  it("preserves expense descriptions in the report dataset", () => expect(mapFilingExpense({ id: "expense", amount: 100, description: "תיאור בדיקה" }).description).toBe("תיאור בדיקה"));
});
