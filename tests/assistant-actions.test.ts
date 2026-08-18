import { describe, it, expect, beforeEach } from "vitest";
import { runActionTool, ACTION_TOOLS, ACTION_TOOL_NAMES } from "@/lib/assistant-actions";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * REGRESSION GUARD for the assistant's write tools.
 *
 * What these pin:
 * - every write is scoped to the caller's business_id (the model can name any
 *   id it likes; a row from another business is "not found", never touched);
 * - deletes never execute server-side - they only hand back a pendingDelete;
 * - duplicates by name are refused, not created;
 * - malformed input (bad ids, missing amount) is rejected before any query.
 *
 * The fake below records the query chain each call builds and answers from an
 * in-memory table, which is enough to assert the filters and the writes.
 */

const BIZ = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Row = Record<string, unknown>;

class FakeDb {
  tables: Record<string, Row[]> = { expenses: [], clients: [], products: [], documents: [], audit_log: [] };
  writes: { table: string; op: string; payload: Row; filters: Row }[] = [];

  from(table: string) {
    const db = this;
    const filters: Row = {};
    let op: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    let updateFilters: Row = {};
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: () => builder,
      order: chain,
      limit: chain,
      ilike: chain,
      or: chain,
      gte: chain,
      lte: chain,
      eq: (col: string, val: unknown) => {
        if (op === "update") updateFilters[col] = val;
        else filters[col] = val;
        return builder;
      },
      insert: (row: Row) => {
        op = "insert";
        payload = row;
        db.tables[table].push(row);
        db.writes.push({ table, op, payload: row, filters: {} });
        return { then: (r: (v: { error: null }) => void) => r({ error: null }) };
      },
      update: (patch: Row) => {
        op = "update";
        payload = patch;
        updateFilters = {};
        return builder;
      },
      maybeSingle: async () => {
        const rows = db.tables[table].filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
        return { data: rows[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        if (op === "update") {
          const rows = db.tables[table].filter((r) => Object.entries(updateFilters).every(([k, v]) => r[k] === v));
          for (const r of rows) Object.assign(r, payload);
          db.writes.push({ table, op, payload, filters: { ...updateFilters } });
          resolve({ data: rows.map((r) => ({ id: r.id })), error: null });
          return;
        }
        const rows = db.tables[table].filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
        resolve({ data: rows, error: null });
      },
    });
    return builder;
  }
}

const asData = (p: unknown) => `DATA:${JSON.stringify(p)}`;
let db: FakeDb;
const run = (name: string, input: Record<string, unknown>) =>
  runActionTool(db as unknown as SupabaseClient, BIZ, name, input, asData);

beforeEach(() => {
  db = new FakeDb();
});

describe("tool registry", () => {
  it("exposes every action tool by name and no delete executes without a click", () => {
    for (const t of ACTION_TOOLS) expect(ACTION_TOOL_NAMES.has(t.name)).toBe(true);
    expect(ACTION_TOOL_NAMES.has("search_documents")).toBe(false);
  });

  it("returns null for a tool it does not own so the route falls through", async () => {
    expect(await run("search_documents", {})).toBeNull();
  });
});

describe("add_expense", () => {
  it("inserts a business-scoped row, defaults date/category, and audits", async () => {
    const r = await run("add_expense", { supplier: "סופר-פארם", amount: 120 });
    expect(r?.action?.kind).toBe("created");
    expect(r?.action?.entity).toBe("expense");
    const row = db.tables.expenses[0];
    expect(row.business_id).toBe(BIZ);
    expect(row.supplier).toBe("סופר-פארם");
    expect(row.amount).toBe(120);
    expect(row.category).toBe("אחר");
    expect(row.vat_amount).toBe(0);
    expect(String(row.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const audit = db.tables.audit_log[0];
    expect(audit.action).toBe("expense.created");
    expect(audit.business_id).toBe(BIZ);
    expect((audit.payload as Row).via).toBe("assistant");
  });

  it("refuses without a supplier or a positive amount, and writes nothing", async () => {
    expect((await run("add_expense", { amount: 50 }))?.content).toMatch(/ספק/);
    expect((await run("add_expense", { supplier: "זום", amount: 0 }))?.content).toMatch(/סכום/);
    expect((await run("add_expense", { supplier: "זום", amount: "abc" }))?.content).toMatch(/סכום/);
    expect(db.tables.expenses).toHaveLength(0);
  });

  it("accepts a numeric string amount and ignores a VAT larger than the amount", async () => {
    await run("add_expense", { supplier: "זום", amount: "89.90", vatAmount: 500, date: "2026-08-01" });
    const row = db.tables.expenses[0];
    expect(row.amount).toBeCloseTo(89.9);
    expect(row.vat_amount).toBe(0);
    expect(row.date).toBe("2026-08-01");
  });
});

describe("update_expense / delete_expense", () => {
  beforeEach(() => {
    db.tables.expenses.push(
      { id: ID_A, business_id: BIZ, supplier: "זום", amount: 89, category: "תוכנה", date: "2026-08-01" },
      { id: ID_B, business_id: OTHER, supplier: "אחר", amount: 10, category: "אחר", date: "2026-08-01" },
    );
  });

  it("updates only the given fields on the caller's own row", async () => {
    const r = await run("update_expense", { id: ID_A, amount: 99 });
    expect(r?.action?.kind).toBe("updated");
    expect(db.tables.expenses[0].amount).toBe(99);
    expect(db.tables.expenses[0].supplier).toBe("זום");
    const w = db.writes.find((x) => x.op === "update");
    expect(w?.filters.business_id).toBe(BIZ);
    expect(w?.filters.id).toBe(ID_A);
  });

  it("cannot reach another business's row by id", async () => {
    const r = await run("update_expense", { id: ID_B, amount: 1 });
    expect(r?.content).toMatch(/לא נמצאה/);
    expect(db.tables.expenses[1].amount).toBe(10);
  });

  it("rejects a malformed id before touching the DB", async () => {
    const r = await run("update_expense", { id: "1 OR 1=1", amount: 1 });
    expect(r?.content).toMatch(/לא תקין/);
    expect(db.writes).toHaveLength(0);
  });

  it("delete only returns a pendingDelete - the row stays", async () => {
    const r = await run("delete_expense", { id: ID_A });
    expect(r?.pendingDelete).toEqual({ entity: "expense", id: ID_A, label: expect.stringContaining("זום") });
    expect(db.tables.expenses).toHaveLength(2);
    expect(db.writes).toHaveLength(0);
  });
});

describe("clients", () => {
  it("adds a client and refuses a duplicate by normalized name", async () => {
    const first = await run("add_client", { name: "  דני   כהן ", email: "d@x.co" });
    expect(first?.action?.entity).toBe("client");
    expect(first?.action?.href).toBe(`/clients/${db.tables.clients[0].id}`);
    expect(db.tables.clients[0].name).toBe("דני   כהן");
    const dup = await run("add_client", { name: "דני כהן" });
    expect(dup?.action).toBeUndefined();
    expect(JSON.parse(dup!.content).done).toBe(false);
    expect(db.tables.clients).toHaveLength(1);
  });

  it("applies non-contact fields immediately and clears one passed as empty string", async () => {
    db.tables.clients.push({ id: ID_A, business_id: BIZ, name: "דני", email: "old@x.co", notes: "x" });
    const r = await run("update_client", { id: ID_A, address: "תל אביב", notes: "" });
    expect(r?.action?.kind).toBe("updated");
    expect(db.tables.clients[0].address).toBe("תל אביב");
    expect(db.tables.clients[0].notes).toBeNull();
  });

  it("email / phone changes are NOT applied - they come back as a pendingUpdate with old and new", async () => {
    // Asaf 2026-08-18: contact fields decide where the next invoice goes, so a
    // sentence (or injected text) must not move them without a click.
    db.tables.clients.push({ id: ID_A, business_id: BIZ, name: "דני", email: "old@x.co", phone: null });
    const r = await run("update_client", { id: ID_A, email: "new@x.co", phone: "050", address: "חיפה" });
    expect(r?.action).toBeUndefined();
    expect(JSON.parse(r!.content).pending).toBe(true);
    expect(r?.pendingUpdate).toEqual({
      entity: "client",
      id: ID_A,
      label: "דני",
      changes: [
        { field: "מייל", from: "old@x.co", to: "new@x.co" },
        { field: "טלפון", from: "(ריק)", to: "050" },
      ],
      patch: { email: "new@x.co", phone: "050", address: "חיפה" },
    });
    // Nothing touched the row - not even the address sent in the same request.
    expect(db.tables.clients[0].email).toBe("old@x.co");
    expect(db.tables.clients[0].address).toBeUndefined();
    expect(db.writes).toHaveLength(0);
  });

  it("re-sending the same email is not a change and applies immediately", async () => {
    db.tables.clients.push({ id: ID_A, business_id: BIZ, name: "דני", email: "same@x.co" });
    const r = await run("update_client", { id: ID_A, email: "same@x.co", name: "דני כהן" });
    expect(r?.action?.kind).toBe("updated");
    expect(db.tables.clients[0].name).toBe("דני כהן");
  });

  it("delete is pending only", async () => {
    db.tables.clients.push({ id: ID_A, business_id: BIZ, name: "דני" });
    const r = await run("delete_client", { id: ID_A });
    expect(r?.pendingDelete?.entity).toBe("client");
    expect(db.tables.clients).toHaveLength(1);
  });
});

describe("products", () => {
  it("adds with default unit, refuses duplicates, updates price", async () => {
    const r = await run("add_product", { name: "שעת ייעוץ", price: 350 });
    expect(r?.action?.entity).toBe("product");
    expect(db.tables.products[0].unit).toBe("יחידה");
    const dup = await run("add_product", { name: "שעת ייעוץ", price: 400 });
    expect(JSON.parse(dup!.content).done).toBe(false);
    expect(db.tables.products).toHaveLength(1);
    const id = db.tables.products[0].id as string;
    await run("update_product", { id, price: 400 });
    expect(db.tables.products[0].price).toBe(400);
  });

  it("requires a price", async () => {
    expect((await run("add_product", { name: "X" }))?.content).toMatch(/מחיר/);
    expect(db.tables.products).toHaveLength(0);
  });
});

describe("dedup is per business", () => {
  it("a same-named client or product in another business does not block creation", async () => {
    db.tables.clients.push({ id: ID_B, business_id: OTHER, name: "דני כהן" });
    db.tables.products.push({ id: ID_B, business_id: OTHER, name: "שעת ייעוץ", price: 1, unit: "שעה" });
    expect((await run("add_client", { name: "דני כהן" }))?.action?.kind).toBe("created");
    expect((await run("add_product", { name: "שעת ייעוץ", price: 350 }))?.action?.kind).toBe("created");
    expect(db.tables.clients.filter((c) => c.business_id === BIZ)).toHaveLength(1);
    expect(db.tables.products.filter((c) => c.business_id === BIZ)).toHaveLength(1);
  });
});

describe("list tools", () => {
  it("list_expenses / list_products return only the caller's rows, wrapped as data", async () => {
    db.tables.expenses.push(
      { id: ID_A, business_id: BIZ, supplier: "זום", amount: "89", vat_amount: null, category: "תוכנה", date: "2026-08-01" },
      { id: ID_B, business_id: OTHER, supplier: "אחר", amount: 10, category: "אחר", date: "2026-08-01" },
    );
    db.tables.products.push({ id: ID_A, business_id: BIZ, name: "שעת ייעוץ", price: 350, unit: "שעה" });
    const e = await run("list_expenses", { search: "זום" });
    expect(e?.content.startsWith("DATA:")).toBe(true);
    const parsed = JSON.parse(e!.content.slice(5));
    expect(parsed.count).toBe(1);
    expect(parsed.expenses[0]).toMatchObject({ id: ID_A, supplier: "זום", amount: 89, vatAmount: 0 });
    const pr = await run("list_products", {});
    expect(JSON.parse(pr!.content.slice(5)).products).toHaveLength(1);
    expect((await run("list_expenses", { dateFrom: "2027-01-01" }))?.content).toMatch(/DATA|לא נמצאו/);
  });
});

describe("set_document_status", () => {
  it("marks a sent document paid with paid_at, and audits like the app button", async () => {
    db.tables.documents.push({ id: ID_A, business_id: BIZ, type: "receipt", number: 7, client_name: "דני", status: "sent" });
    const r = await run("set_document_status", { id: ID_A, status: "paid" });
    expect(r?.action?.entity).toBe("document");
    expect(db.tables.documents[0].status).toBe("paid");
    expect(typeof db.tables.documents[0].paid_at).toBe("string");
    const audit = db.tables.audit_log[0];
    expect(audit.action).toBe("document.status_changed");
    expect((audit.payload as Row).to).toBe("שולם");
  });

  it("refuses drafts, cancelled docs, unknown statuses and other businesses", async () => {
    db.tables.documents.push(
      { id: ID_A, business_id: BIZ, type: "receipt", number: 1, client_name: "א", status: "draft" },
      { id: ID_B, business_id: OTHER, type: "receipt", number: 2, client_name: "ב", status: "sent" },
    );
    expect((await run("set_document_status", { id: ID_A, status: "paid" }))?.content).toMatch(/אי אפשר/);
    expect((await run("set_document_status", { id: ID_B, status: "paid" }))?.content).toMatch(/לא נמצא/);
    expect((await run("set_document_status", { id: ID_A, status: "cancelled" }))?.content).toMatch(/לא נתמך/);
    expect(db.tables.documents[0].status).toBe("draft");
    expect(db.tables.documents[1].status).toBe("sent");
  });
});
