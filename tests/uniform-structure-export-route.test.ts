import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ taxId: "512345679", fail: false, authenticated: true, rates: [] as string[] }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "test", checkRate: ({ key }: { key: string }) => { state.rates.push(key); return { ok: true }; } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "owner" } : null }, error: null }) },
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, order: () => query, range: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
        data: table === "businesses" ? [{ id: "biz", name: "עסק", tax_id: state.taxId, business_type: "authorized", address: "רחוב" }] : [],
        count: 0, error: state.fail && table !== "businesses" ? { message: "query failed" } : null,
      })),
    };
    return query;
  },
}) }));
import { GET } from "@/app/api/uniform-structure/export/route";
const request = (query = "", authorized = true) => new NextRequest(`http://localhost/api/uniform-structure/export?year=2026${query}`, { headers: authorized ? { authorization: "Bearer synthetic" } : {} });

beforeEach(() => { state.taxId = "512345679"; state.fail = false; state.authenticated = true; state.rates = []; });
describe("uniform export endpoint enforcement", () => {
  it("requires bearer and verified user", async () => {
    expect((await GET(request("", false))).status).toBe(401);
    state.authenticated = false;
    expect((await GET(request())).status).toBe(401);
  });
  it("returns JSON preflight separately from a validated ZIP download", async () => {
    const check = await GET(request("&preflight=true"));
    expect(check.status).toBe(200); expect((await check.json()).ok).toBe(true);
    const download = await GET(request());
    expect(download.status).toBe(200); expect(download.headers.get("content-type")).toBe("application/zip");
    expect(state.rates[0]).toContain("preflight"); expect(state.rates[1]).toContain("download");
  });
  it("blocks direct download with 422 even without a prior preflight", async () => {
    state.taxId = "123";
    const check = await GET(request("&preflight=true"));
    expect(check.status).toBe(200); expect((await check.json()).ok).toBe(false);
    const download = await GET(request());
    expect(download.status).toBe(422); expect((await download.json()).issues.some((i: { level: string }) => i.level === "error")).toBe(true);
  });
  it("refuses to turn failed data requests into empty exports", async () => {
    state.fail = true;
    expect((await GET(request())).status).toBe(503);
  });
});
