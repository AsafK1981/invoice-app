import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, any>;
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, selects: [] as { table: string; columns: string }[], failDocChunk: 0, docChunks: 0, rpcs: [] as { fn: string; args: Record<string, unknown> }[] }));
vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service"; });
vi.mock("@/lib/admin", () => ({ isAdminEmail: () => true }));
vi.mock("@/lib/admin-access-log", () => ({ logAdminAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRate: () => ({ ok: true }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "admin", email: "admin@example.com" } } }), admin: { listUsers: async () => ({ data: { users: [] } }) } },
  // bump_document_counter: one atomic GREATEST upsert, see src/lib/document-counters.ts.
  rpc: async (fn: string, args: Record<string, unknown>) => { state.rpcs.push({ fn, args }); return { error: null }; },
  from(table: string) {
    let rows: Row[] | null = null, columns = "*", cap = Infinity, sort = "", ascending = false, single = false;
    const filters: ((r: Row) => boolean)[] = [];
    const q: any = {
      select(c: string) { columns = c; state.selects.push({ table, columns: c }); return q; },
      insert(input: Row | Row[]) { rows = Array.isArray(input) ? input : [input]; return q; },
      update() { return q; },
      eq(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
      is(k: string, v: unknown) { filters.push(r => (r[k] ?? null) === v); return q; },
      not(k: string) { filters.push(r => r[k] != null); return q; },
      // Used by bumpDocumentCounter's conditional UPDATE (src/lib/document-counters.ts).
      lt(k: string, v: any) { filters.push(r => r[k] < v); return q; },
      order(k: string, opts: { ascending: boolean }) { sort = k; ascending = opts.ascending; return q; },
      limit(n: number) { cap = n; return q; },
      maybeSingle() { single = true; return q; },
      then(resolve: (v: any) => void) {
        if (rows) {
          if (table === "documents" && ++state.docChunks === state.failDocChunk) return Promise.resolve(resolve({ data: null, error: { message: "synthetic duplicate" } }));
          rows = rows.map((r, i) => ({ id: r.id ?? crypto.randomUUID(), created_at: "2026-09-13T10:00:00Z", ...r }));
          (state.tables[table] ??= []).push(...rows);
        }
        const selected = (rows ?? state.tables[table] ?? []).filter(r => filters.every(f => f(r))).sort((a, b) => sort ? String(a[sort]).localeCompare(String(b[sort])) * (ascending ? 1 : -1) : 0).slice(0, cap).map(r => columns === "*" ? r : Object.fromEntries(columns.split(",").map(k => [k.trim(), r[k.trim()]])));
        return Promise.resolve(resolve({ data: single ? selected[0] ?? null : selected, error: null }));
      },
    }; return q;
  },
}) }));
import { POST } from "@/app/api/admin/import-for-user/route";
const target = "11111111-1111-4111-8111-111111111111";
function post(entityType: string, rows: Row[]) { return POST(new NextRequest("http://localhost/api/admin/import-for-user", { method: "POST", headers: { authorization: "Bearer test", "Content-Type": "application/json" }, body: JSON.stringify({ targetUserId: target, entityType, rows }) })); }
beforeEach(() => { state.tables = { businesses: [{ id: "b1", user_id: target, name: "Test" }] }; state.selects = []; state.failDocChunk = 0; state.docChunks = 0; });
describe("import route batch provenance", () => {
  it("stamps one batch across >400 documents and new clients, preserving reused clients", async () => {
    state.tables.clients = [{ id: "existing", business_id: "b1", name: "Existing" }];
    const response = await post("documents", Array.from({ length: 450 }, (_, i) => ({ "מספר": String(i + 1), "שם לקוח": i % 2 ? "Existing" : "New", "סהכ": "100", "תאריך": "2026-09-01" })));
    expect((await response.json()).imported).toBe(450);
    const ids = new Set(state.tables.documents.map(r => r.import_batch_id));
    expect(ids.size).toBe(1); expect([...ids][0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.tables.clients[0].import_batch_id).toBeUndefined();
    expect(state.tables.clients[1].import_batch_id).toBe([...ids][0]);
  });
  it("keeps only committed chunks in the batch and records a client-only batch when all docs fail", async () => {
    state.failDocChunk = 2;
    const result = await (await post("documents", Array.from({ length: 201 }, (_, i) => ({ "מספר": String(i + 1), "שם לקוח": "New", "סהכ": "100" })))).json();
    expect(result.imported).toBe(200); expect(result.errors).toHaveLength(1); expect(state.tables.documents).toHaveLength(200);
    state.docChunks = 0; state.failDocChunk = 1;
    const failed = await (await post("documents", [{ "מספר": "999", "שם לקוח": "Client only", "סהכ": "100" }])).json();
    expect(failed.imported).toBe(0);
    expect(state.tables.clients.at(-1)!.import_batch_id).toBeTruthy();
    expect(state.tables.clients.at(-1)!.import_batch_id).not.toBe(state.tables.documents[0].import_batch_id);
  });
  it.each([['clients', { name: 'Client' }], ['products', { name: 'Product', price: '10' }], ['expenses', { supplier: 'Supplier', amount: '10' }]])("tags %s inserts", async (entity, row) => {
    expect((await (await post(entity, [row])).json()).imported).toBe(1);
    expect(state.tables[entity][0].import_batch_id).toBeTruthy();
  });
});

describe("admin client import: payment terms", () => {
  it("stores recognised terms, counts unrecognised ones and leaves the rest without terms", async () => {
    state.tables.clients = [];
    const body = await (await post("clients", [
      { "שם": "A", "תנאי תשלום": "שוטף + 30" },
      { "שם": "B", "תנאי תשלום": "30" },
      { "שם": "C" },
      { name: "D", payment_terms: "net 45" },
    ])).json();
    expect(body.imported).toBe(4);
    expect(body.termsUnrecognized).toBe(1);
    const terms = Object.fromEntries(state.tables.clients.map((c) => [c.name, c.payment_terms]));
    expect(terms).toEqual({ A: "eom_30", B: null, C: null, D: "net_45" });
  });

  it("reports no unrecognised count when every stated term was read", async () => {
    state.tables.clients = [];
    const body = await (await post("clients", [{ "שם": "E", "תנאי תשלום": "מיידי" }])).json();
    expect(body.termsUnrecognized).toBeUndefined();
    expect(state.tables.clients[0].payment_terms).toBe("immediate");
  });
});
