import { describe, it, expect } from "vitest";
import { buildAdminActivity, describeAdminActivity } from "@/lib/admin-activity";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";

/**
 * The operator activity feed is a privacy boundary as much as a feature: it
 * must show who did what kind of thing and when, and nothing that belongs to
 * the tenant's customers. These tests pin the merge rules and the shape of
 * every event.
 */

const businesses = [
  { id: "b1", user_id: "u1", name: "סטודיו דנה" },
  { id: "b2", user_id: "u2", name: "  " },
];
const users = [
  { id: "u1", email: "dana@example.com", last_sign_in_at: "2026-09-08T09:00:00Z" },
  { id: "u2", email: "yossi@example.com", last_sign_in_at: null },
  { id: "u3", email: "new@example.com", last_sign_in_at: "2026-09-08T10:30:00Z" },
];

describe("buildAdminActivity", () => {
  it("merges every source into one newest-first list and resolves the actor", () => {
    const events = buildAdminActivity({
      documents: [
        { id: "d1", business_id: "b1", type: "receipt", status: "paid", created_at: "2026-09-08T08:00:00Z", paid_at: "2026-09-08T08:00:03Z" },
      ],
      expenses: [{ id: "x1", business_id: "b2", created_at: "2026-09-08T08:30:00Z" }],
      clients: [{ id: "c1", business_id: "b1", created_at: "2026-09-08T07:00:00Z" }],
      businesses,
      users,
    });

    expect(events.map((e) => e.kind)).toEqual([
      "user.signed_in", // u3 10:30
      "user.signed_in", // u1 09:00
      "expense.created", // 08:30
      "document.created", // 08:00
      "client.created", // 07:00
    ]);
    const doc = events.find((e) => e.kind === "document.created")!;
    expect(doc).toMatchObject({
      id: "document.created:d1",
      email: "dana@example.com",
      businessName: "סטודיו דנה",
      documentType: "receipt",
      draft: false,
    });
    // A blank business name is null, not whitespace.
    expect(events.find((e) => e.kind === "expense.created")).toMatchObject({
      email: "yossi@example.com",
      businessName: null,
    });
    // A user with no business row still shows up by email.
    expect(events[0]).toMatchObject({ email: "new@example.com", businessName: null });
  });

  it("does not turn a receipt created paid into a separate paid event", () => {
    const events = buildAdminActivity({
      documents: [
        { id: "d1", business_id: "b1", type: "receipt", status: "paid", created_at: "2026-09-08T08:00:00Z", paid_at: "2026-09-08T08:00:03Z" },
        { id: "d2", business_id: "b1", type: "tax_invoice", status: "paid", created_at: "2026-09-01T08:00:00Z", paid_at: "2026-09-08T08:00:00Z", emailed_at: "2026-09-01T08:05:00Z" },
      ],
      expenses: [],
      clients: [],
      businesses,
      users: [],
    });
    const ids = events.map((e) => e.id);
    expect(ids).not.toContain("document.paid:d1");
    expect(ids).toContain("document.paid:d2");
    expect(ids).toContain("document.emailed:d2");
    expect(ids).toContain("document.created:d2");
  });

  it("dedupes a document that arrives from more than one query", () => {
    const row = { id: "d1", business_id: "b1", type: "quote", status: "draft", created_at: "2026-09-08T08:00:00Z", emailed_at: "2026-09-08T08:10:00Z" };
    const events = buildAdminActivity({
      documents: [row, row, { ...row }],
      expenses: [],
      clients: [],
      businesses,
      users: [],
      limit: 10,
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ kind: "document.created", draft: true });
  });

  it("caps at limit and skips rows with no usable timestamp", () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`,
      business_id: "b1",
      type: "receipt",
      status: "paid",
      created_at: `2026-09-08T08:${String(i).padStart(2, "0")}:00Z`,
    }));
    const events = buildAdminActivity({
      documents: [...docs, { id: "bad", business_id: "b1", type: "receipt", status: "paid", created_at: "not-a-date" }],
      expenses: [],
      clients: [],
      businesses,
      users: [],
      limit: 5,
    });
    expect(events).toHaveLength(5);
    expect(events[0].id).toBe("document.created:d19");
    expect(events.some((e) => e.id === "document.created:bad")).toBe(false);
  });

  it("orders by instant, not by string, across auth (Z) and table (+00:00) formats", () => {
    const events = buildAdminActivity({
      documents: [
        { id: "d1", business_id: "b1", type: "receipt", status: "paid", created_at: "2026-09-08T09:29:41.731415+00:00" },
      ],
      expenses: [],
      clients: [],
      businesses,
      users: [
        { id: "u1", email: "dana@example.com", last_sign_in_at: "2026-09-08T12:45:01.102966Z" },
        { id: "u3", email: "new@example.com", last_sign_in_at: "2026-09-08T08:00:00Z" },
      ],
    });
    expect(events.map((e) => e.id)).toEqual([
      "user.signed_in:u1",
      "document.created:d1",
      "user.signed_in:u3",
    ]);
  });

  it("never carries customer content on an event", () => {
    const events = buildAdminActivity({
      documents: [
        // Extra columns a careless SELECT might add must not leak through.
        { id: "d1", business_id: "b1", type: "receipt", status: "paid", created_at: "2026-09-08T08:00:00Z", client_name: "לקוח סודי", total: 1234 } as never,
      ],
      expenses: [],
      clients: [],
      businesses,
      users: [],
    });
    const keys = Object.keys(events[0]).sort();
    expect(keys).toEqual(["at", "businessName", "documentType", "draft", "email", "id", "kind"]);
  });
});

describe("describeAdminActivity", () => {
  const base = { id: "x", at: "2026-09-08T08:00:00Z", email: null, businessName: null };
  it("names the document type and distinguishes drafts", () => {
    expect(describeAdminActivity({ ...base, kind: "document.created", documentType: "tax_invoice" }, DOCUMENT_TYPE_LABELS)).toBe("מסמך חדש: חשבונית מס");
    expect(describeAdminActivity({ ...base, kind: "document.created", documentType: "quote", draft: true }, DOCUMENT_TYPE_LABELS)).toBe("טיוטה חדשה: הצעת מחיר");
    expect(describeAdminActivity({ ...base, kind: "document.emailed", documentType: "receipt" }, DOCUMENT_TYPE_LABELS)).toBe("נשלח במייל: קבלה");
    expect(describeAdminActivity({ ...base, kind: "document.paid", documentType: "proforma" }, DOCUMENT_TYPE_LABELS)).toBe("סומן כשולם: חשבון עסקה");
    expect(describeAdminActivity({ ...base, kind: "user.signed_in" }, DOCUMENT_TYPE_LABELS)).toBe("התחברות");
  });
});
