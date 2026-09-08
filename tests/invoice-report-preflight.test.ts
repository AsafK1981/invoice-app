import { describe, expect, it } from "vitest";
import { invoiceReportPreflight } from "../src/lib/invoice-report-preflight";
import { mapFilingDocument, mapFilingExpense } from "../src/lib/filing-report-data";
import type { InvoiceDocument } from "../src/lib/types";

const doc = (extra: Partial<InvoiceDocument> = {}): InvoiceDocument => ({ id: "example", number: 101, type: "tax_invoice", status: "sent", date: "2026-08-05", clientId: "client", clientName: "לקוח בדיקה", items: [], subtotal: 100, vat: 18, total: 118, ...extra });
const check = (docs: InvoiceDocument[]) => invoiceReportPreflight(docs, "2026-08-01", "2026-08-31");

describe("accountant listing integrity", () => {
  it("accepts a legitimate anonymous invoice without imposing PCN ID requirements", () => expect(check([doc()])).toEqual([]));
  it("excludes drafts, cancelled documents, quotes and other periods", () => expect(check([doc({ status: "draft", total: NaN }), doc({ status: "cancelled", total: NaN }), doc({ type: "quote", total: NaN }), doc({ date: "2026-07-05", total: NaN })])).toEqual([]));
  it("does not silently discard an unassignable invalid date", () => expect(check([doc({ date: "2026-02-30" })])[0].level).toBe("error"));
  it("blocks invalid/reversed period dates", () => expect(invoiceReportPreflight([], "2026-08-31", "2026-08-01")[0].level).toBe("error"));
  it("blocks nonfinite amounts and mismatched totals with document links", () => {
    for (const invalid of [NaN, Infinity, 117]) expect(check([doc({ total: invalid })])).toContainEqual(expect.objectContaining({ level: "error", href: "/documents/example" }));
  });
  it("accepts stored rounding and negative credits", () => {
    expect(check([doc({ subtotal: 100.1, vat: 18.02, total: 118, rounding: -0.12 })])).toEqual([]);
    expect(check([doc({ type: "credit_note", subtotal: -100, vat: -18, total: -118 })])).toEqual([]);
  });
  it("blocks missing FX snapshots but accepts complete ILS amounts", () => {
    expect(check([doc({ currency: "USD" })]).some((i) => i.level === "error")).toBe(true);
    expect(check([doc({ currency: "USD", subtotalIls: 350, vatIls: 63, totalIls: 413 })])).toEqual([]);
  });
  it("does not confuse a credit with a separate invoice series", () => {
    expect(check([doc(), doc({ id: "credit", type: "credit_note", subtotal: -100, vat: -18, total: -118 })])).toEqual([]);
    expect(check([doc(), doc({ id: "duplicate" })]).some((i) => i.level === "error")).toBe(true);
  });
  it("warns about invalid customer IDs without treating foreign identification as forbidden", () => expect(check([doc({ clientTaxId: "FOREIGN-123" })])[0].level).toBe("warning"));
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
