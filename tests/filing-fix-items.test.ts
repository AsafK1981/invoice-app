import { describe, it, expect } from "vitest";
import { buildPcn874 } from "@/lib/ita/pcn874";
import { buildFilingFixModel, createFixCollector, splitFixTiers } from "@/lib/filing-fix-items";
import type { Expense, InvoiceDocument } from "@/lib/types";

const business = { taxId: "512345679", businessType: "authorized" as const };
const range = { start: "2026-01-01", end: "2026-02-28" };
const generatedOn = new Date("2026-03-10T09:00:00+02:00");

function doc(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return { id: over.id ?? Math.random().toString(36).slice(2), type: "tax_invoice", number: 1001, date: "2026-01-15", clientId: "c1", clientName: "לקוח בע״מ", clientTaxId: "515555555", status: "paid", items: [], subtotal: 10000, vat: 1800, total: 11800, allocationNumber: "123456789", ...over };
}
function expense(over: Partial<Expense> = {}): Expense {
  return { id: over.id ?? Math.random().toString(36).slice(2), date: "2026-01-20", category: "תוכנה", supplier: "ספק", amount: 1180, vatAmount: 180, supplierTaxId: "513333336", reference: "A-7788", ...over };
}
function model(documents: InvoiceDocument[], expenses: Expense[], taxId = business.taxId, r = range) {
  const result = buildPcn874({ business: { ...business, taxId }, documents, expenses, range: r, generatedOn });
  return buildFilingFixModel(result, { business: { taxId }, documents, expenses });
}

describe("buildFilingFixModel", () => {
  it("groups a supplier's invalid number into one item that saves to every expense", () => {
    const m = model([doc()], [
      expense({ id: "e1", supplier: "קנן-סנטר", supplierTaxId: "513333337", reference: "INV-1", amount: 2360, vatAmount: 360 }),
      expense({ id: "e2", supplier: "קנן-סנטר", supplierTaxId: "513333337", reference: "INV-2", amount: 2360, vatAmount: 360, date: "2026-02-03" }),
    ]);
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0].title).toBe("מספר העוסק של קנן-סנטר לא תקין (2 הוצאות)");
    expect(m.blocking[0].control).toEqual({ kind: "supplier_tax_id", expenseIds: ["e1", "e2"], current: "513333337" });
    expect(m.blocking.some((i) => i.code === "file_structure")).toBe(false);
    expect(m.periodOnly).toBe(false);
  });

  it("groups by supplier name when there is no number", () => {
    const m = model([doc()], [
      expense({ id: "e3", supplier: "קנן-סנטר", supplierTaxId: undefined, reference: "INV-3", amount: 2360, vatAmount: 360 }),
      expense({ id: "e4", supplier: " קנן-סנטר ", supplierTaxId: undefined, reference: "INV-4", amount: 2360, vatAmount: 360, date: "2026-02-04" }),
    ]);
    expect(m.blocking.map((i) => i.title)).toEqual(["חסר מספר עוסק ל-קנן-סנטר (2 הוצאות)"]);
  });

  it("offers one customer-number fix per issued sale, merging both findings", () => {
    const m = model([doc({ id: "d", clientTaxId: "515555554" })], []);
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0].control).toEqual({ kind: "customer_tax_id", documentId: "d", current: "515555554" });
    expect(m.blocking[0].messages).toHaveLength(2);
  });

  it("routes an invalid dealer number to the business-number control", () => {
    const m = model([doc()], [], "1234");
    expect(m.blocking.map((i) => i.control)).toEqual([{ kind: "business_tax_id", current: "1234" }]);
  });

  it("shows a supplier invoice without allocation as a non-blocking action with the excluded VAT", () => {
    const m = model([doc()], [expense({ id: "big", amount: 14160, vatAmount: 2160 })]);
    expect(m.blocking).toEqual([]);
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0]).toMatchObject({ code: "supplier_allocation_missing", excludedVat: 2160, control: { kind: "expense_allocation", expenseId: "big", current: "" } });
  });

  it("asks for the supplier invoice number of a digitless reference in a refund period", () => {
    const m = model(
      [doc({ subtotal: 100, vat: 18, total: 118 })],
      [expense({ id: "big", amount: 5900, vatAmount: 900 }), expense({ id: "r", reference: "חשבונית", amount: 118, vatAmount: 18 })],
    );
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0]).toMatchObject({ title: "חסר מספר חשבונית של הספק", control: { kind: "supplier_reference", expenseId: "r" } });
  });

  it("Layer 4: an in-app document gets a credit note, an imported or unconverted one goes to support", () => {
    const neg = { id: "neg", subtotal: -100, vat: 18, total: -82 };
    expect(model([doc(neg)], []).blocking.map((i) => i.control)).toEqual([{ kind: "credit_note", documentId: "neg" }]);
    expect(model([doc({ ...neg, importBatchId: "batch" })], []).blocking.map((i) => i.control)).toEqual([{ kind: "support", documentId: "neg", code: "sign_mismatch" }]);
    expect(model([doc({ id: "usd", currency: "USD" })], []).blocking.map((i) => i.control)).toEqual([{ kind: "support", documentId: "usd", code: "foreign_currency_missing_ils" }]);
  });

  it("puts non-blocking notes in their own collapsed list", () => {
    const m = model([doc({ id: "a" }), doc({ id: "b" })], []);
    expect(m.blocking).toEqual([]);
    expect(m.notes.map((i) => [i.code, i.control.kind])).toEqual([["possible_duplicate", "open_document"]]);
  });

  it("a period that cannot be a PCN874 file shows one friendly period item instead of a blocker list", () => {
    const year = { start: "2026-01-01", end: "2026-12-31" };
    const m = buildFilingFixModel(
      buildPcn874({ business, documents: [doc({ clientTaxId: "515555554" })], expenses: [expense({ supplierTaxId: "1", amount: 2360, vatAmount: 360 })], range: year, generatedOn: new Date("2027-01-05T12:00:00+02:00") }),
      { business, documents: [], expenses: [] },
    );
    expect(m.periodOnly).toBe(true);
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0]).toMatchObject({ code: "period_length", control: { kind: "period" } });
    expect(m.actions).toEqual([]);
    expect(m.notes).toEqual([]);
  });
});

describe("createFixCollector", () => {
  it("merges findings under one key, escalates to blocking and keeps messages and labels unique", () => {
    const c = createFixCollector((code) => `title:${code}`);
    c.put("k", "note", "client_name_missing", { kind: "none" }, "a", "L1");
    c.put("k", "blocking", "period_invalid", { kind: "none" }, "b", "L1");
    c.put("k", "note", "client_name_missing", { kind: "none" }, "a", "L2");
    const [item] = c.items();
    expect(item).toMatchObject({ tier: "blocking", code: "client_name_missing", title: "title:client_name_missing", messages: ["a", "b"], labels: ["L1", "L2"] });
    expect(splitFixTiers(c.items())).toEqual({ blocking: [item], actions: [], notes: [], periodOnly: false });
  });
});
