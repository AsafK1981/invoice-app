import { describe, it, expect } from "vitest";
import { FILING_COLUMNS, mapFilingDocument, mapFilingExpense } from "@/lib/filing-rows";

describe("filing rows", () => {
  it("selects and maps the import batch so imported documents can be routed to support", () => {
    expect(FILING_COLUMNS.documents.split(",")).toContain("import_batch_id");
    const doc = mapFilingDocument({ id: "d", type: "tax_invoice", status: "sent", date: "2026-08-01", number: "7", subtotal: 100, vat: 18, total: 118, import_batch_id: "batch-1" });
    expect(doc.importBatchId).toBe("batch-1");
    expect(mapFilingDocument({ id: "d", type: "tax_invoice", status: "sent", date: "2026-08-01", number: "7", subtotal: 100, vat: 18, total: 118, import_batch_id: null }).importBatchId).toBeUndefined();
  });

  it("keeps missing shekel amounts undefined", () => {
    const doc = mapFilingDocument({ id: "d", type: "tax_invoice", status: "sent", date: "2026-08-01", number: "7", subtotal: 100, vat: 18, total: 118, currency: "USD", subtotal_ils: null, vat_ils: null, total_ils: null });
    expect([doc.subtotalIls, doc.vatIls, doc.totalIls]).toEqual([undefined, undefined, undefined]);
  });

  it("maps expense filing fields", () => {
    expect(mapFilingExpense({ id: "e", amount: 118, vat_amount: 18, supplier_tax_id: "513333336", reference: "A-1", allocation_number: "" })).toMatchObject({ supplierTaxId: "513333336", reference: "A-1", vatAmount: 18 });
  });
});
