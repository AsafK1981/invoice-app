import { describe, it, expect } from "vitest";
import { buildAdminActivity, describeAdminActivity, type ActivityImportRow } from "@/lib/admin-activity";

const at = "2026-09-13T10:00:00Z";
const batch: ActivityImportRow = { business_id: "b1", import_batch_id: "batch", first_created_at: at, last_created_at: at, document_count: 450, client_count: 90, expense_count: 0, product_count: 0 };
const base = { documents: [], clients: [], expenses: [], users: [], businesses: [{ id: "b1", user_id: "u1" }, { id: "b2", user_id: "u2" }] };
describe("import activity", () => {
  it("uses aggregate counts above the source cap and stable business-scoped IDs", () => {
    const events = buildAdminActivity({ ...base, imports: [batch, { ...batch, business_id: "b2" }, { ...batch, import_batch_id: "second" }] });
    expect(new Set(events.map(e => e.id)).size).toBe(3);
    expect(describeAdminActivity(events[0], {})).toBe("ייבוא: 450 מסמכים · 90 לקוחות");
    const updated = buildAdminActivity({ ...base, imports: [{ ...batch, last_created_at: "2026-09-13T10:05:00Z", document_count: 460 }] });
    expect(updated[0].id).toBe(events[0].id);
  });
  it("suppresses imported creation and historical payments, keeps subsequent actions and manual creation", () => {
    const imported = { id: "doc", business_id: "b1", type: "receipt", status: "paid", created_at: at, import_batch_id: "batch", paid_at: "2024-01-01T00:00:00Z", emailed_at: "2026-09-13T11:00:00Z" };
    const events = buildAdminActivity({ ...base, imports: [batch], documents: [imported, imported, { ...imported, id: "paid-later", paid_at: "2026-09-13T12:00:00Z", emailed_at: null }, { ...imported, id: "manual", import_batch_id: null, paid_at: null, emailed_at: null }], clients: [{ id: "client", business_id: "b1", created_at: at, import_batch_id: "batch" }], expenses: [{ id: "expense", business_id: "b1", created_at: at, import_batch_id: "batch" }] });
    expect(events.map(e => e.id)).toEqual(["document.paid:paid-later", "document.emailed:doc", "document.created:manual", "data.imported:b1:batch"]);
  });
  it("shows successful client-only imports and inflects every singular correctly", () => {
    const event = buildAdminActivity({ ...base, imports: [{ ...batch, document_count: 0, client_count: 1 }] })[0];
    expect(describeAdminActivity(event, {})).toBe("ייבוא: לקוח אחד");
    expect(describeAdminActivity({ ...event, importCounts: { documents: 1, clients: 1, expenses: 1, products: 1 } }, {})).toBe("ייבוא: מסמך אחד · לקוח אחד · הוצאה אחת · מוצר אחד");
  });
  it("does not leak payload fields from source rows", () => {
    const input = { ...batch, client_name: "PRIVATE", total: 100, file_name: "SECRET", subject: "SECRET" };
    const event = buildAdminActivity({ ...base, imports: [input] })[0];
    expect(Object.keys(event).sort()).toEqual(["at", "businessName", "email", "id", "importCounts", "kind"]);
    expect(JSON.stringify(event)).not.toContain("PRIVATE");
    expect(JSON.stringify(event)).not.toContain("SECRET");
  });
});
