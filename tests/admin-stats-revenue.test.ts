import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type PaidDoc = {
  subtotal: number | null;
  subtotal_ils: number | null;
  type: string;
  status: string;
  converted_to_id: string | null;
  business_id: string;
  import_batch_id: string | null;
};

const state = vi.hoisted(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-key";
  return {
    paidDocs: [] as PaidDoc[],
    businesses: [] as Array<{ id: string; user_id: string }>,
    users: [] as Array<{ id: string; created_at: string; email: string }>,
    paidOffsets: [] as number[],
  };
});

vi.mock("@/lib/admin", () => ({ isAdminEmail: () => true }));
vi.mock("@/lib/admin-access-log", () => ({ logAdminAccess: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "synthetic-admin", email: "admin@example.test" } },
        error: null,
      }),
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({
          data: {
            users: state.users.slice((page - 1) * perPage, page * perPage),
            total: state.users.length,
          },
          error: null,
        }),
      },
    },
    from: (table: string) => {
      let columns = "";
      let offset = 0;
      let last = 999;
      let head = false;
      const query = {
        select: (value: string, options?: { head?: boolean }) => {
          columns = value;
          head = options?.head ?? false;
          return query;
        },
        lte: () => query,
        gte: () => query,
        eq: () => query,
        in: () => query,
        is: () => query,
        order: () => query,
        range: (first: number, end: number) => { offset = first; last = end; return query; },
        then: (resolve: (result: unknown) => unknown) => {
          const page = <T,>(rows: T[]) => rows.slice(offset, last + 1);
          if (table === "documents" && columns.includes("import_batch_id")) {
            state.paidOffsets.push(offset);
            return Promise.resolve(resolve({ data: page(state.paidDocs), error: null }));
          }
          if (table === "businesses" && columns === "id, user_id") {
            return Promise.resolve(resolve({ data: page(state.businesses), error: null }));
          }
          return Promise.resolve(resolve({ data: head ? null : [], count: 0, error: null }));
        },
      };
      return query;
    },
  }),
}));

import { GET } from "@/app/api/admin/stats/route";

const request = () =>
  new NextRequest("http://localhost/api/admin/stats", {
    headers: { authorization: "Bearer synthetic" },
  });

const doc = (over: Partial<PaidDoc>): PaidDoc => ({
  subtotal: 100, subtotal_ils: null, type: "tax_invoice_receipt", status: "paid",
  converted_to_id: null, business_id: "real-biz", import_batch_id: null, ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
  state.paidDocs = [];
  state.paidOffsets = [];
  state.businesses = [
    { id: "real-biz", user_id: "real-user" },
    { id: "qa-biz", user_id: "qa-user" },
  ];
  state.users = [
    { id: "real-user", created_at: "2026-01-01T00:00:00Z", email: "real@example.test" },
    { id: "qa-user", created_at: "2026-01-01T00:00:00Z", email: "qa@app.internal" },
  ];
});

async function revenue() {
  const response = await GET(request());
  expect(response.status).toBe(200);
  return (await response.json()).revenue as { inAppTurnover: number; importedTurnover: number };
}
const inApp = async () => (await revenue()).inAppTurnover;

describe("admin turnover", () => {
  it("counts a converted document once, not once per leg", async () => {
    // A tax invoice converted into a receipt: BOTH rows are status=paid.
    // Summing both was part of why the card read 928,406.78.
    state.paidDocs = [
      doc({ type: "tax_invoice", subtotal: 5000, converted_to_id: "receipt-1" }),
      doc({ type: "receipt", subtotal: 5000 }),
    ];
    expect(await inApp()).toBe(5000);
  });

  it("ignores documents that are not revenue types", async () => {
    state.paidDocs = [
      doc({ type: "receipt", subtotal: 1000 }),
      doc({ type: "proforma", subtotal: 18600, converted_to_id: "receipt-9" }),
      doc({ type: "quote", subtotal: 7000 }),
    ];
    expect(await inApp()).toBe(1000);
  });

  it("sums before VAT, never the VAT-inclusive total", async () => {
    // subtotal is the net; the route must not read total at all.
    state.paidDocs = [doc({ type: "tax_invoice_receipt", subtotal: 1000 })];
    expect(await inApp()).toBe(1000);
  });

  it("subtracts a credit note once, including one saved as sent", async () => {
    state.paidDocs = [
      doc({ type: "receipt", subtotal: 1000 }),
      doc({ type: "credit_note", subtotal: -250, status: "sent" }),
    ];
    expect(await inApp()).toBe(750);
  });

  it("does not count a sent (unpaid) invoice", async () => {
    state.paidDocs = [
      doc({ type: "receipt", subtotal: 1000 }),
      doc({ type: "tax_invoice", subtotal: 4000, status: "sent" }),
    ];
    expect(await inApp()).toBe(1000);
  });

  it("puts imported history in its own bucket", async () => {
    state.paidDocs = [
      doc({ type: "receipt", subtotal: 1000 }),
      doc({ type: "receipt", subtotal: 397050, import_batch_id: "batch-1" }),
    ];
    expect(await revenue()).toEqual({ inAppTurnover: 1000, importedTurnover: 397050 });
  });

  it("excludes tenants owned by internal (.internal) QA accounts", async () => {
    state.paidDocs = [
      doc({ type: "receipt", subtotal: 1000 }),
      doc({ type: "receipt", subtotal: 39600, business_id: "qa-biz" }),
    ];
    expect(await inApp()).toBe(1000);
  });

  it("prefers subtotal_ils so foreign currency is not summed at face value", async () => {
    state.paidDocs = [doc({ type: "receipt", subtotal: 100, subtotal_ils: 370 })];
    expect(await inApp()).toBe(370);
  });

  it("pages past the 1000-row PostgREST cap instead of silently truncating", async () => {
    state.paidDocs = Array.from({ length: 1002 }, () => doc({ type: "receipt", subtotal: 10 }));
    expect(await inApp()).toBe(10020);
    expect(state.paidOffsets).toEqual([0, 1000]);
  });
});
