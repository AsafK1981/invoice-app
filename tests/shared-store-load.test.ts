import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The shared document / expense / client stores. Until 2026-09-15 they
 * ignored the Supabase error (a failed load became [] with ready:true, so
 * the dashboard showed "בואו נתחיל" and every report showed zeros) and ran
 * one unpaginated select, which PostgREST caps at 1,000 rows.
 */

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  failAt: -1 as number,
  ranges: [] as [number, number][],
  orders: [] as string[],
}));

vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "business", onBusinessReady: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      let from = 0;
      let to = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: () => q,
        order: (column: string) => {
          db.orders.push(column);
          return q;
        },
        range: (a: number, b: number) => {
          from = a;
          to = b;
          db.ranges.push([a, b]);
          return q;
        },
        then(resolve: (v: unknown) => void) {
          const call = db.ranges.length - 1;
          if (call === db.failAt) return Promise.resolve(resolve({ data: null, error: { message: "boom" }, count: null }));
          // A real server never returns more than 1,000 rows per request.
          const page = db.rows.slice(from, Math.min(to + 1, from + 1000));
          return Promise.resolve(resolve({ data: page, error: null, count: db.rows.length }));
        },
      };
      return q;
    },
  },
}));

import { createSharedStore } from "@/lib/shared-store";
import { loadAllPages } from "@/lib/report-rows";
import { fetchDocuments } from "@/lib/document-store";
import { fetchExpenses } from "@/lib/expense-store";
import { fetchClients } from "@/lib/client-store";
import { failedStore } from "@/components/store-load-error";

beforeEach(() => {
  db.rows = [];
  db.failAt = -1;
  db.ranges = [];
  db.orders = [];
});

function makeDocs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `doc-${String(i).padStart(5, "0")}`,
    type: "receipt",
    number: i + 1,
    date: "2026-01-01",
    status: "paid",
    total: 100,
    document_items: [],
  }));
}

describe("shared store fetchers page past the 1,000-row cap", () => {
  it("returns every one of 1,234 documents, in pages", async () => {
    db.rows = makeDocs(1234);
    const docs = await fetchDocuments();
    expect(docs).toHaveLength(1234);
    expect(new Set(docs!.map((d) => d.id)).size).toBe(1234);
    expect(db.ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    // A total order, so pages never overlap: date, then the unique id.
    expect(db.orders).toContain("id");
  });

  it("throws on a failed page instead of returning a partial or empty list", async () => {
    db.rows = makeDocs(1234);
    db.failAt = 1;
    await expect(fetchDocuments()).rejects.toThrow("טעינת המסמכים נכשלה");
    db.ranges = [];
    db.failAt = 0;
    await expect(fetchExpenses()).rejects.toThrow("טעינת ההוצאות נכשלה");
    db.ranges = [];
    await expect(fetchClients()).rejects.toThrow("טעינת הלקוחות נכשלה");
  });

  it("returns an honest empty list when there really are no rows", async () => {
    expect(await fetchExpenses()).toEqual([]);
    expect(await fetchClients()).toEqual([]);
  });

  it("refuses a count that moved mid-load", async () => {
    const rows = makeDocs(700);
    await expect(
      loadAllPages(
        async (a, b) => ({ data: rows.slice(a, b + 1), error: null, count: 700 + (a > 0 ? 1 : 0) }),
        { failed: "f", changed: "changed", unverified: "u", incomplete: "i" },
      ),
    ).rejects.toThrow("changed");
  });
});

describe("createSharedStore error state", () => {
  it("a failed first load stays not-ready with an error, never ready with []", async () => {
    let fail = true;
    const store = createSharedStore<string[]>(async () => {
      if (fail) throw new Error("טעינת המסמכים נכשלה. נסו שוב.");
      return ["a"];
    }, []);
    await store.refetch();
    expect(store.getSnapshot()).toEqual({ data: [], ready: false, error: "טעינת המסמכים נכשלה. נסו שוב." });

    fail = false;
    await store.refetch();
    expect(store.getSnapshot()).toEqual({ data: ["a"], ready: true, error: null });
  });

  it("a failed refetch keeps the last good rows next to the error", async () => {
    let fail = false;
    const store = createSharedStore<string[]>(
      async () => {
        if (fail) throw new Error();
        return ["a", "b"];
      },
      [],
      undefined,
      "fallback message",
    );
    await store.refetch();
    fail = true;
    await store.refetch();
    expect(store.getSnapshot()).toEqual({ data: ["a", "b"], ready: true, error: "fallback message" });
  });

  it("failedStore picks the first store that failed", () => {
    const retry = () => {};
    expect(failedStore([{ error: null, retry }, { error: null, retry }])).toBeNull();
    expect(failedStore([{ error: null, retry }, { error: "x", retry }])?.error).toBe("x");
  });
});
