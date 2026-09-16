import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "", onBusinessReady: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
import { DocumentBody } from "@/components/document-body";
import { dueDateRpcArg, mapDocRow } from "@/lib/document-store";
import { resolveEditorDueDate } from "@/lib/payment-terms";
import { buildUniformStructure } from "@/lib/uniform-structure/builder";
import { generateSampleDataset } from "@/lib/uniform-structure/sample-data";
import { allowsDueDate, DUE_DATE_DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type Business, type DocumentType } from "@/lib/types";

/**
 * "לתשלום עד" is an optional information field on a tax invoice or a pro
 * forma. These tests pin the three promises the feature makes: only those two
 * types ever carry it, the value survives the trip to the database and back,
 * and nothing at all is printed when it is absent.
 */

const ALL_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[];

describe("which documents may state a due date", () => {
  it("is exactly the tax invoice and the pro forma", () => {
    expect([...DUE_DATE_DOCUMENT_TYPES].sort()).toEqual(["proforma", "tax_invoice"]);
    expect(ALL_TYPES.filter(allowsDueDate).sort()).toEqual(["proforma", "tax_invoice"]);
  });

  it.each(["receipt", "tax_invoice_receipt", "credit_note", "quote"] as const)(
    "never lets a %s carry one to the database",
    (type) => {
      expect(dueDateRpcArg({ type, dueDate: "2026-10-31" })).toEqual({});
    },
  );

  it.each(["tax_invoice", "proforma"] as const)("sends a set due date for a %s", (type) => {
    expect(dueDateRpcArg({ type, dueDate: "2026-10-31" })).toEqual({ p_due_date: "2026-10-31" });
  });

  it("sends nothing when no due date is set, so the call never needs the new parameter", () => {
    expect(dueDateRpcArg({ type: "tax_invoice" })).toEqual({});
    expect(dueDateRpcArg({ type: "tax_invoice", dueDate: "" })).toEqual({});
    expect(dueDateRpcArg({ type: "tax_invoice", dueDate: "  " })).toEqual({});
  });
});

describe("the store round-trip", () => {
  const row = { id: "d", type: "tax_invoice", number: 7, date: "2026-09-16", status: "sent", subtotal: 100, vat: 18, total: 118 };

  it("reads due_date into dueDate and writes the same value back", () => {
    const doc = mapDocRow({ ...row, due_date: "2026-11-14" }, []);
    expect(doc.dueDate).toBe("2026-11-14");
    expect(dueDateRpcArg(doc)).toEqual({ p_due_date: "2026-11-14" });
  });

  it("reads a NULL (or pre-migration missing) column as no due date", () => {
    expect(mapDocRow({ ...row, due_date: null }, []).dueDate).toBeUndefined();
    expect(mapDocRow(row, []).dueDate).toBeUndefined();
  });
});

describe("the editor's automatic due date", () => {
  it("fills from the client's agreed terms and follows the document date", () => {
    expect(resolveEditorDueDate({ current: "", source: null, issueDate: "2026-09-16", clientTerms: "eom_30" }))
      .toEqual({ dueDate: "2026-10-30", source: "terms" });
    expect(resolveEditorDueDate({ current: "2026-10-30", source: "terms", issueDate: "2026-10-02", clientTerms: "eom_30" }))
      .toEqual({ dueDate: "2026-11-30", source: "terms" });
  });

  it("leaves the field empty for a client without terms, and clears a value the old client's terms put there", () => {
    expect(resolveEditorDueDate({ current: "", source: null, issueDate: "2026-09-16" }))
      .toEqual({ dueDate: "", source: null });
    expect(resolveEditorDueDate({ current: "2026-10-30", source: "terms", issueDate: "2026-09-16" }))
      .toEqual({ dueDate: "", source: null });
  });

  it("never overwrites a hand-typed or hand-cleared value", () => {
    expect(resolveEditorDueDate({ current: "2026-12-01", source: "manual", issueDate: "2026-09-16", clientTerms: "eom_30" }))
      .toEqual({ dueDate: "2026-12-01", source: "manual" });
    expect(resolveEditorDueDate({ current: "", source: "manual", issueDate: "2026-09-16", clientTerms: "eom_30" }))
      .toEqual({ dueDate: "", source: "manual" });
  });

  it("keeps the statutory שוטף + 45 suggestion in step with the date, until agreed terms appear", () => {
    expect(resolveEditorDueDate({ current: "2026-11-14", source: "statutory", issueDate: "2026-10-05" }))
      .toEqual({ dueDate: "2026-12-15", source: "statutory" });
    expect(resolveEditorDueDate({ current: "2026-11-14", source: "statutory", issueDate: "2026-09-16", clientTerms: "net_30" }))
      .toEqual({ dueDate: "2026-10-16", source: "terms" });
  });

  it("does not count from a half-typed document date", () => {
    expect(resolveEditorDueDate({ current: "2026-10-30", source: "terms", issueDate: "", clientTerms: "eom_30" }))
      .toEqual({ dueDate: "2026-10-30", source: "terms" });
  });
});

describe("the printed line", () => {
  const business: Business = { id: "b", name: "סטודיו לדוגמה", businessType: "exempt", taxId: "000000018", address: "רחוב לדוגמה" };
  const render = (documentType: DocumentType, dueDate?: string, language: "he" | "en" = "he") =>
    renderToStaticMarkup(createElement(DocumentBody, {
      business, client: null, documentType, number: 12, date: "2026-09-16", dueDate,
      items: [], subtotal: 100, vat: 0, vatRate: 0, total: 100, language,
    }));

  it("prints the label and the app's date format when set", () => {
    const html = render("tax_invoice", "2026-10-31");
    expect(html).toContain('<div class="doc-date doc-tab">לתשלום עד 31.10.2026</div>');
    expect(render("proforma", "2026-10-31", "en")).toContain('<div class="doc-date doc-tab">Payment due by 31 Oct 2026</div>');
  });

  it("prints nothing at all when absent: no label, no empty line", () => {
    for (const type of ALL_TYPES) {
      const html = render(type);
      expect(html).not.toContain("לתשלום עד");
      expect(html.match(/class="doc-date doc-tab"/g)).toHaveLength(1);
    }
  });

  it.each(["receipt", "tax_invoice_receipt", "credit_note", "quote"] as const)(
    "never prints one on a %s, even if a value slipped through",
    (type) => {
      expect(render(type, "2026-10-31")).not.toContain("לתשלום עד");
    },
  );
});

describe("the uniform structure export (מבנה אחיד)", () => {
  it("is byte-identical whether or not the documents carry a due date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T09:00:00Z"));
    try {
      const business: Business = { id: "b", name: "עסק לדוגמה", businessType: "authorized", taxId: "512345679", address: "רחוב" };
      const data = generateSampleDataset({ business, taxYear: 2026, targetRecords: 600 });
      const input = { business, clients: data.clients, expenses: data.expenses, taxYear: 2026, fromDate: "2026-01-01", toDate: "2026-12-31" };
      const withDue = data.documents.map((d) => (allowsDueDate(d.type) ? { ...d, dueDate: "2026-12-31" } : d));
      expect(withDue.some((d) => d.dueDate)).toBe(true);
      const before = buildUniformStructure({ ...input, documents: data.documents });
      const after = buildUniformStructure({ ...input, documents: withDue });
      expect(after.bkmvdata.equals(before.bkmvdata)).toBe(true);
      expect(after.ini.equals(before.ini)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
