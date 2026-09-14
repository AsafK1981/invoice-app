import { describe, it, expect } from "vitest";
import { buildInvoicePeriodFixModel } from "@/lib/invoice-period-fix-items";
import { invoiceReportPreflight } from "@/lib/invoice-report-preflight";
import type { InvoiceDocument } from "@/lib/types";

const doc = (extra: Partial<InvoiceDocument> = {}): InvoiceDocument => ({ id: "a", number: 101, type: "tax_invoice", status: "sent", date: "2026-08-05", clientId: "c", clientName: "לקוח", items: [], subtotal: 100, vat: 18, total: 118, ...extra });
const model = (docs: InvoiceDocument[], start = "2026-08-01") => buildInvoicePeriodFixModel(invoiceReportPreflight(docs, start, "2026-08-31"));

describe("buildInvoicePeriodFixModel", () => {
  it("shows findings that change the totals as visible actions with a support request", () => {
    const m = model([doc({ id: "usd", currency: "USD" })]);
    expect(m.blocking).toEqual([]);
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0]).toMatchObject({ code: "foreign_currency_missing_ils", labels: ["חשבונית מס 101"], control: { kind: "support", documentId: "usd", code: "foreign_currency_missing_ils", report: "invoices_period" } });
  });

  it("offers the inline customer-number field as a collapsed note", () => {
    const m = model([doc({ clientTaxId: "FOREIGN" })]);
    expect(m.actions).toEqual([]);
    expect(m.notes.map((i) => i.control)).toEqual([{ kind: "customer_tax_id", documentId: "a", current: "FOREIGN" }]);
  });

  it("links a missing client name, number or unreadable date to the document", () => {
    const m = model([doc({ clientName: " ", number: 0 }), doc({ id: "nodate", number: 5, date: "" })]);
    expect(m.notes.map((i) => [i.code, i.control])).toEqual([
      ["number_invalid", { kind: "open_document", documentId: "a" }],
      ["client_name_missing", { kind: "open_document", documentId: "a" }],
      ["date_invalid", { kind: "open_document", documentId: "nodate" }],
    ]);
  });

  it("an unusable period is the only blocking item", () => {
    const m = model([doc()], "");
    expect(m.blocking.map((i) => [i.code, i.control])).toEqual([["period_invalid", { kind: "none" }]]);
  });

  it("a clean period is ready", () => {
    expect(model([doc()])).toEqual({ blocking: [], actions: [], notes: [], periodOnly: false });
  });
});
