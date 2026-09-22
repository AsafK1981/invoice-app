import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-key";
  return {
    authenticated: true,
    admin: true,
    documents: [] as Array<{ created_at: string; import_batch_id?: string | null }>,
    users: [] as Array<{ id: string; created_at: string; email: string }>,
    documentOffsets: [] as number[],
    userPages: [] as number[],
    documentSelects: [] as string[],
    failDocumentsAfter: Number.POSITIVE_INFINITY,
    failUsersPage: Number.POSITIVE_INFINITY,
    documentPageLimit: 1000,
    log: vi.fn(),
    getUser: vi.fn(),
  };
});

vi.mock("@/lib/admin", () => ({ isAdminEmail: () => state.admin }));
vi.mock("@/lib/admin-access-log", () => ({ logAdminAccess: state.log }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => {
        state.getUser();
        return {
          data: { user: state.authenticated ? { id: "synthetic-admin", email: "admin@example.test" } : null },
          error: null,
        };
      },
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
          state.userPages.push(page);
          if (page >= state.failUsersPage) return { data: null, error: { message: "synthetic page failure" } };
          return { data: { users: state.users.slice((page - 1) * perPage, page * perPage), total: state.users.length }, error: null };
        },
      },
    },
    from: (table: string) => {
      let columns = "";
      let offset = 0;
      let last = 999;
      let ceiling = "9999";
      let head = false;
      let excludeImports = false;
      const query = {
        select: (value: string, options?: { head?: boolean }) => {
          columns = value;
          head = options?.head ?? false;
          return query;
        },
        lte: (_column: string, value: string) => { ceiling = value; return query; },
        is: (column: string, value: unknown) => {
          if (column === "import_batch_id" && value === null) excludeImports = true;
          return query;
        },
        gte: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        range: (first: number, end: number) => { offset = first; last = end; return query; },
        then: (resolve: (result: unknown) => unknown) => {
          if (table === "documents" && columns === "created_at" && !head) {
            state.documentOffsets.push(offset);
            state.documentSelects.push(columns);
            if (offset >= state.failDocumentsAfter) {
              return Promise.resolve(resolve({ data: null, error: { message: "synthetic page failure" } }));
            }
            const eligible = state.documents.filter((row) => row.created_at <= ceiling && (!excludeImports || row.import_batch_id == null));
            const data = eligible.slice(offset, Math.min(last + 1, offset + state.documentPageLimit));
            return Promise.resolve(resolve({ data, count: eligible.length, error: null }));
          }
          return Promise.resolve(resolve({ data: head ? null : [], count: 0, error: null }));
        },
      };
      return query;
    },
  }),
}));

import { GET } from "@/app/api/admin/stats/route";

function request(authorized = true) {
  return new NextRequest("http://localhost/api/admin/stats", {
    headers: authorized ? { authorization: "Bearer synthetic" } : {},
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
  state.authenticated = true;
  state.admin = true;
  state.documents = [];
  state.users = [];
  state.documentOffsets = [];
  state.userPages = [];
  state.documentSelects = [];
  state.failDocumentsAfter = Number.POSITIVE_INFINITY;
  state.failUsersPage = Number.POSITIVE_INFINITY;
  state.documentPageLimit = 1000;
  state.log.mockClear();
  state.getUser.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("admin chart history API", () => {
  it("excludes imported document timestamps from all-history creation charts", async () => {
    state.documents = [
      { created_at: "2025-01-01T12:00:00Z", import_batch_id: "imported-batch" },
      { created_at: "2026-09-12T12:00:00Z", import_batch_id: null },
      { created_at: "2026-09-13T10:00:00Z", import_batch_id: "imported-batch" },
    ];
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.documents.dailyChart).toEqual([{ date: "2026-09-12", count: 1 }]);
  });

  it("rejects missing bearer, unverified sessions and non-admins before reading history", async () => {
    expect((await GET(request(false))).status).toBe(401);
    expect(state.getUser).not.toHaveBeenCalled();
    state.authenticated = false;
    expect((await GET(request())).status).toBe(401);
    state.authenticated = true;
    state.admin = false;
    expect((await GET(request())).status).toBe(404);
    expect(state.userPages).toEqual([]);
    expect(state.documentOffsets).toEqual([]);
    expect(state.log).not.toHaveBeenCalled();
  });

  it("includes records past page 1000 and returns only date/count chart aggregates", async () => {
    state.documents = Array.from({ length: 1003 }, (_, index) => ({
      created_at: index < 1000 ? "2026-01-01T12:00:00Z" : "2026-09-12T22:30:00Z",
    }));
    state.users = Array.from({ length: 1002 }, (_, index) => ({
      id: `synthetic-${index}`, email: `synthetic-${index}@example.test`,
      created_at: index < 1000 ? "2026-01-01T12:00:00Z" : "2026-09-12T22:30:00Z",
    }));
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.documents.dailyChart).toEqual([
      { date: "2026-01-01", count: 1000 }, { date: "2026-09-13", count: 3 },
    ]);
    expect(body.users.dailyChart).toEqual([
      { date: "2026-01-01", count: 1000 }, { date: "2026-09-13", count: 2 },
    ]);
    expect(body.people.registered).toBe(1002);
    expect(state.documentOffsets).toContain(1000);
    expect(state.userPages).toContain(2);
    expect(state.documentSelects.every((value) => value === "created_at")).toBe(true);
    expect(state.log).toHaveBeenCalledTimes(1);
  });

  it("continues after short document pages and excludes events after the snapshot", async () => {
    state.documentPageLimit = 2;
    state.documents = Array.from({ length: 5 }, () => ({ created_at: "2026-09-13T10:00:00Z" }));
    state.documents.push({ created_at: "2026-09-14T10:00:00Z" });
    const body = await (await GET(request())).json();
    expect(body.documents.dailyChart).toEqual([{ date: "2026-09-13", count: 5 }]);
    expect(state.documentOffsets).toEqual([0, 2, 4]);
  });

  it.each(["documents", "users"])("does not return partial charts if the second %s page fails", async (kind) => {
    if (kind === "documents") {
      state.documents = Array.from({ length: 1001 }, () => ({ created_at: "2026-09-01T12:00:00Z" }));
      state.failDocumentsAfter = 1000;
    } else {
      state.users = Array.from({ length: 1001 }, (_, index) => ({
        id: `synthetic-${index}`, email: `synthetic-${index}@example.test`, created_at: "2026-09-01T12:00:00Z",
      }));
      state.failUsersPage = 2;
    }
    const response = await GET(request());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.documents).toBeUndefined();
    expect(body.users).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("synthetic page failure");
  });
});
