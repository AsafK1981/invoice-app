import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { decodeActivityCursor, encodeActivityCursor } from "@/lib/admin-activity-pagination";
const state = vi.hoisted(() => ({ rows: [] as any[], auth: true, admin: true, error: false, reads: [] as string[] }));
vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service"; });
vi.mock("@/lib/admin", () => ({ isAdminEmail: () => state.admin }));
vi.mock("@/lib/admin-access-log", () => ({ logAdminAccess: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: state.auth ? { id: "admin", email: "admin@example.com" } : null } }) },
  from(table: string) {
    state.reads.push(table);
    const filters: ((r: any) => boolean)[] = [], orders: string[] = []; let cap = Infinity;
    const micros = (s: string) => BigInt(Date.parse(s)) * BigInt(1000) + BigInt((s.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3));
    const q: any = {
      select(columns: string) { expect(columns).not.toMatch(/\*|client_name|subject|amount|total|file_name/); return q; },
      lte(_: string, at: string) { filters.push(r => micros(r.at) <= micros(at)); return q; },
      order(key: string) { orders.push(key); return q; }, limit(n: number) { cap = n; return q; },
      or(filter: string) {
        const match = filter.match(/^at.lt.(.*),and\(at.eq.(.*),event_id.lt.(.*)\)$/)!;
        filters.push(r => micros(r.at) < micros(match[1]) || (micros(r.at) === micros(match[2]) && r.event_id < match[3])); return q;
      },
      then(resolve: (value: any) => void) {
        const data = state.rows.filter(r => filters.every(f => f(r))).sort((a, b) => {
          for (const key of orders) { const av = key === "at" ? micros(a.at) : a[key], bv = key === "at" ? micros(b.at) : b[key]; if (av !== bv) return av < bv ? 1 : -1; } return 0;
        }).slice(0, cap);
        return Promise.resolve(resolve({ data, error: state.error ? { message: "private db error" } : null }));
      },
    }; return q;
  },
}) }));
import { GET } from "@/app/api/admin/activity/route";
const event = (id: string, at: string) => ({ event_id: "client.created:" + id, at, kind: "client.created", email: "owner@example.com", business_name: null, document_type: null, draft: null, document_count: 0, client_count: 0, expense_count: 0, product_count: 0 });
function get(cursor?: string, authorization = "Bearer test") { return GET(new NextRequest("http://localhost/api/admin/activity?limit=60" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { headers: { authorization } })); }
beforeEach(() => { state.rows = []; state.auth = true; state.admin = true; state.error = false; state.reads = []; });
describe("activity keyset API", () => {
  it("traverses >1000 simultaneous microsecond events and old dates without gaps or duplicates", async () => {
    state.rows = Array.from({ length: 1205 }, (_, i) => event(String(i).padStart(5, "0"), "2026-01-01T10:00:00.123456+00:00"));
    state.rows.push(event("older-micro", "2026-01-01T10:00:00.123455+00:00"), event("old", "2024-01-01T00:00:00Z"));
    const seen: string[] = []; let cursor: string | undefined;
    do {
      const result = await (await get(cursor)).json();
      expect(result.ok).toBe(true); seen.push(...result.events.map((e: any) => e.id));
      cursor = result.nextCursor ?? undefined;
      if (cursor) expect(decodeActivityCursor(cursor, "test-service")?.at).toBe("2026-01-01T10:00:00.123456+00:00");
    } while (cursor);
    expect(seen).toHaveLength(1207); expect(new Set(seen).size).toBe(1207);
    expect(seen.at(-2)).toBe("client.created:older-micro"); expect(seen.at(-1)).toBe("client.created:old");
    expect(new Set(state.reads)).toEqual(new Set(["admin_activity_events"]));
  });
  it("keeps the initial cutoff on later pages and projects only metadata", async () => {
    state.rows = Array.from({ length: 61 }, (_, i) => ({ ...event(String(i), "2024-01-01T00:00:00Z"), subject: "PRIVATE" }));
    const first = await (await get()).json();
    state.rows.push(event("new", "2099-01-01T00:00:00Z"));
    const second = await (await get(first.nextCursor)).json();
    expect(second.events).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect(JSON.stringify(first)).not.toContain("PRIVATE");
  });
  it("rejects malformed or tampered cursors before querying", async () => {
    expect((await get("broken")).status).toBe(400);
    const cursor = encodeActivityCursor({ at: "2024-01-01T00:00:00Z", cutoff: "2026-01-01T00:00:00Z", id: "client.created:abc" }, "wrong-secret");
    expect((await get(cursor)).status).toBe(400); expect(state.reads).toHaveLength(0);
  });
  it("preserves authentication, admin authorization and explicit retryable errors", async () => {
    expect((await get(undefined, "")).status).toBe(401);
    state.auth = false; expect((await get()).status).toBe(401);
    state.auth = true; state.admin = false; expect((await get()).status).toBe(404);
    state.admin = true; state.error = true; const response = await get(); expect(response.status).toBe(500); expect(await response.text()).not.toContain("private db error");
  });
});
