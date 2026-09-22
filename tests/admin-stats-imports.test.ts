import { it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service"; });
const state = vi.hoisted(() => ({ error: false, queries: [] as { table: string; columns: string; filters: string[] }[] }));
vi.mock("@/lib/admin", () => ({ isAdminEmail: () => true }));
vi.mock("@/lib/admin-access-log", () => ({ logAdminAccess: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "admin" } } }), admin: { listUsers: async () => ({ data: { users: [] } }) } },
  from(table: string) {
    const query = { table, columns: "", filters: [] as string[] }; state.queries.push(query); let head = false;
    let offset = 0; let end = 999;
    const q: any = {
      select(columns: string, opts?: { head?: boolean }) { query.columns = columns; head = !!opts?.head; return q; },
      is(key: string, value: unknown) { query.filters.push(key + ":" + value); return q; },
      gte(key: string) { query.filters.push(key); return q; }, eq: () => q, in: () => q,
      lte: () => q, order: () => q,
      range(first: number, last: number) { offset = first; end = last; return q; },
      then(resolve: (value: unknown) => void) {
        const day = new Date().toISOString().slice(0, 10);
        if (table === "documents" && query.columns === "created_at") {
          const eligibleCount = query.filters.includes("import_batch_id:null") ? 1505 : 1813;
          const rows = Array.from({ length: eligibleCount }, () => ({ created_at: `${day}T00:00:00Z` }));
          return Promise.resolve(resolve({ data: rows.slice(offset, end + 1), count: eligibleCount, error: null }));
        }
        const data = table === "admin_document_creation_daily" ? [{ day, type: "receipt", document_count: 1505, document_count_30d: 1505, draft_count_30d: 2 }] : [];
        const count = head && table === "documents" ? query.filters.includes("import_batch_id:null") ? 1505 : 1813 : 0;
        return Promise.resolve(resolve({ data, count, error: state.error && table === "admin_document_creation_daily" ? { message: "failed" } : null }));
      },
    }; return q;
  },
}) }));
import { GET } from "@/app/api/admin/stats/route";
const request = () => new NextRequest("http://localhost/api/admin/stats", { headers: { authorization: "Bearer test" } });
it("excludes imports from recent creation metrics and uses full aggregate counts over1000", async () => {
  state.error = false; state.queries = [];
  const result = await (await GET(request())).json();
  expect(result.documents.last30d).toBe(1505);
  expect(result.documents.dailyChart.at(-1).count).toBe(1505); expect(result.documents.byType30d).toEqual([{ type: "receipt", count: 1505, drafts: 2 }]);
  const chart = state.queries.find(q => q.table === "documents" && q.columns === "created_at"); expect(chart?.filters).toContain("import_batch_id:null");
  // Exactly one read of `documents` may see imported rows: the per-owner one,
  // which has to see them to tell "produced in the app" from "migrated in".
  // Every OTHER read of created_at still filters them out at the database.
  const unfiltered = state.queries.filter(q => q.columns.includes("created_at") && !q.filters.includes("import_batch_id:null"));
  expect(unfiltered.map(q => q.columns)).toEqual(["business_id, created_at, import_batch_id"]);
});
it("does not silently display empty creation metrics when aggregation fails", async () => {
  state.error = true; expect((await GET(request())).status).toBe(500);
});
