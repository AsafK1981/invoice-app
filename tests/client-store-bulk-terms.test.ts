// The bulk "set terms for clients without terms" action must be ONE scoped
// UPDATE of the payment_terms column: business-scoped, restricted to rows
// that still have no terms, error-checked, and counting the rows it really
// changed. A loop over clientStore.save would rewrite every column from a
// possibly stale object.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = {
  table: string;
  ops: [string, ...unknown[]][];
};

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  rows: 3,
  count: 7,
  error: null as null | { message: string },
  businessId: "biz-1" as string | null,
}));

vi.mock("@/lib/business-init", () => ({
  getBusinessId: () => state.businessId,
  onBusinessReady: vi.fn(),
}));
const audit = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/audit-log", () => ({
  logAudit: (args: unknown) => {
    audit.calls.push(args);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      state.calls.push(call);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      for (const op of ["update", "eq", "is", "select", "insert", "delete", "order", "range"]) {
        q[op] = (...args: unknown[]) => {
          call.ops.push([op, ...args]);
          return q;
        };
      }
      q.then = (resolve: (v: unknown) => void) =>
        Promise.resolve(
          resolve({
            data: state.error ? null : Array.from({ length: state.rows }, (_, i) => ({ id: `c${i}` })),
            count: state.error ? null : state.count,
            error: state.error,
          }),
        );
      return q;
    },
  },
}));

import {
  setPaymentTermsForClientsWithoutTerms,
  countClientsWithoutPaymentTerms,
} from "@/lib/client-store";

let dispatched: string[] = [];

beforeEach(() => {
  state.calls = [];
  state.rows = 3;
  state.count = 7;
  state.error = null;
  state.businessId = "biz-1";
  audit.calls = [];
  dispatched = [];
  window.dispatchEvent = vi.fn((e: Event) => {
    dispatched.push(e.type);
    return true;
  });
});

describe("setPaymentTermsForClientsWithoutTerms", () => {
  it("builds exactly the scoped single-column update", async () => {
    const n = await setPaymentTermsForClientsWithoutTerms("eom_30");
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toEqual({
      table: "clients",
      ops: [
        ["update", { payment_terms: "eom_30" }, { count: "exact" }],
        ["eq", "business_id", "biz-1"],
        ["is", "payment_terms", null],
      ],
    });
    // The server's count, not the returned rows (those cap at 1,000).
    expect(n).toBe(7);
    expect(audit.calls).toEqual([
      {
        action: "client.updated",
        targetType: "client",
        payload: { bulk: true, field: "payment_terms", terms: "eom_30", count: 7 },
      },
    ]);
  });

  it("reports the real count and tells every useClients consumer", async () => {
    state.count = 0;
    await expect(setPaymentTermsForClientsWithoutTerms("net_15")).resolves.toBe(0);
    expect(dispatched).toEqual(["invoice-app:clients-changed"]);
  });

  it("throws on a database error and dispatches nothing", async () => {
    state.error = { message: "denied" };
    await expect(setPaymentTermsForClientsWithoutTerms("eom")).rejects.toThrow("denied");
    expect(dispatched).toEqual([]);
    expect(audit.calls).toEqual([]);
  });

  it("refuses an unknown code before touching the database", async () => {
    // @ts-expect-error - a runtime value from outside the type system
    await expect(setPaymentTermsForClientsWithoutTerms("eom_120")).rejects.toThrow();
    expect(state.calls).toHaveLength(0);
  });

  it("refuses to run without an active business", async () => {
    state.businessId = null;
    await expect(setPaymentTermsForClientsWithoutTerms("eom")).rejects.toThrow();
    expect(state.calls).toHaveLength(0);
  });
});

describe("countClientsWithoutPaymentTerms", () => {
  it("counts over the whole business with a head-only query", async () => {
    await expect(countClientsWithoutPaymentTerms()).resolves.toBe(7);
    expect(state.calls[0]).toEqual({
      table: "clients",
      ops: [
        ["select", "id", { count: "exact", head: true }],
        ["eq", "business_id", "biz-1"],
        ["is", "payment_terms", null],
      ],
    });
  });

  it("throws on a failed read instead of reporting zero", async () => {
    state.error = { message: "nope" };
    await expect(countClientsWithoutPaymentTerms()).rejects.toThrow("nope");
  });
});
