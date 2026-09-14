import { describe, it, expect } from "vitest";
import { buildUniformFixModel } from "@/lib/uniform-fix-items";
import { validateUniformInput } from "@/lib/uniform-structure/preflight";
import type { UniformIssue } from "@/lib/uniform-structure/issues";

const base = { business: { id: "biz", name: "עסק", taxId: "512345679", businessType: "authorized" as const, address: "" }, clients: [], expenses: [], documents: [], taxYear: 2026, fromDate: "2026-01-01", toDate: "2026-12-31" };

describe("buildUniformFixModel", () => {
  it("routes an invalid business number to the inline business-number field", () => {
    const m = buildUniformFixModel(validateUniformInput({ ...base, business: { ...base.business, taxId: "51234567X" } }));
    expect(m.blocking.map((i) => [i.code, i.control])).toEqual([["dealer_number_invalid", { kind: "business_tax_id", current: "51234567X" }]]);
  });

  it("fixes an expense date inline", () => {
    const m = buildUniformFixModel([{ code: "date_invalid", level: "error", message: "m", source: "expense", sourceId: "e1", sourceLabel: "ספק", current: "2026-02-30" }]);
    expect(m.blocking[0].control).toEqual({ kind: "expense_date", expenseId: "e1", current: "2026-02-30" });
  });

  it("sends one support request per locked document, with every message", () => {
    const issues: UniformIssue[] = [
      { code: "total_mismatch", level: "error", message: "a", source: "document", sourceId: "d1", sourceLabel: "מסמך 7" },
      { code: "items_mismatch", level: "error", message: "b", source: "document", sourceId: "d1", sourceLabel: "מסמך 7" },
    ];
    const m = buildUniformFixModel(issues);
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0]).toMatchObject({ messages: ["a", "b"], labels: ["מסמך 7"], control: { kind: "support", documentId: "d1", code: "total_mismatch", report: "uniform" } });
  });

  it("shows a built-file problem once, however many records hit it", () => {
    const issues: UniformIssue[] = [1, 2, 3].map((n) => ({ code: "record_invalid", level: "error", message: `רשומה ${n}` }));
    const m = buildUniformFixModel(issues);
    expect(m.blocking).toHaveLength(1);
    expect(m.blocking[0].control).toEqual({ kind: "support", code: "record_invalid", report: "uniform" });
  });

  it("keeps foreign ids and other notes collapsed, with the right controls", () => {
    const m = buildUniformFixModel([
      { code: "customer_number_not_israeli", level: "warning", message: "m", source: "document", sourceId: "d1", current: "DE1" },
      { code: "client_number_not_israeli", level: "warning", message: "m", source: "client", sourceId: "c1" },
      { code: "customer_number_from_client", level: "warning", message: "m", source: "document", sourceId: "d2", current: "" },
      { code: "software_registration_missing", level: "warning", message: "m" },
    ]);
    expect(m.blocking).toEqual([]);
    expect(m.notes.map((i) => i.control)).toEqual([
      { kind: "customer_tax_id", documentId: "d1", current: "DE1" },
      { kind: "open_client", clientId: "c1" },
      { kind: "customer_tax_id", documentId: "d2", current: "" },
      { kind: "none" },
    ]);
  });

  it("an empty list is ready", () => {
    expect(buildUniformFixModel([])).toEqual({ blocking: [], actions: [], notes: [], periodOnly: false });
  });
});
