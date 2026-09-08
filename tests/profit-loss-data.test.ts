import { beforeEach, describe, expect, it, vi } from "vitest";

type Response = { data: Record<string, unknown>[] | null; error: { message: string } | null; count: number | null };
type QueryCall = { table: string; columns?: string; options?: { count: string }; filter?: [string, string]; order?: [string, { ascending: boolean }]; range?: [number, number]; signal?: AbortSignal };
const mock = vi.hoisted(() => ({ responses: [] as Response[], calls: [] as QueryCall[], beforeResponse: undefined as (() => void) | undefined }));

vi.mock("../src/lib/supabase", () => ({ supabase: {
  from(table: string) {
    const call: QueryCall = { table };
    mock.calls.push(call);
    const query = {
      select(columns: string, options: { count: string }) { call.columns = columns; call.options = options; return query; },
      eq(field: string, value: string) { call.filter = [field, value]; return query; },
      order(field: string, options: { ascending: boolean }) { call.order = [field, options]; return query; },
      range(start: number, end: number) { call.range = [start, end]; return query; },
      abortSignal(signal: AbortSignal) { call.signal = signal; return query; },
      then(resolve: (response: Response) => unknown, reject: (error: unknown) => unknown) {
        mock.beforeResponse?.();
        const response = mock.responses.shift();
        if (!response) return Promise.reject(new Error("Unexpected page request")).then(resolve, reject);
        return Promise.resolve(response).then(resolve, reject);
      },
    };
    return query;
  },
} }));

import { loadProfitLossRows } from "../src/lib/profit-loss-data";

const page = (start: number, length: number, count: number): Response => ({ data: Array.from({ length }, (_, i) => ({ id: String(start + i) })), error: null, count });

beforeEach(() => { mock.calls = []; mock.responses = []; mock.beforeResponse = undefined; });

describe("complete and scoped profit-loss loading", () => {
  it("loads over 1000 rows with business scope and minimal columns on every page", async () => {
    mock.responses = [page(0, 500, 1201), page(500, 500, 1201), page(1000, 201, 1201)];
    expect(await loadProfitLossRows("documents", "business-one")).toHaveLength(1201);
    expect(mock.calls.map((call) => call.range)).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    for (const call of mock.calls) {
      expect(call.table).toBe("documents");
      expect(call.filter).toEqual(["business_id", "business-one"]);
      expect(call.options).toEqual({ count: "exact" });
      expect(call.order).toEqual(["id", { ascending: true }]);
      expect(call.columns).not.toContain("*");
      expect(call.columns).not.toContain("client_name");
    }
  });

  it("continues at actual row offsets when the server cap is below 500", async () => {
    mock.responses = [page(0, 200, 401), page(200, 200, 401), page(400, 1, 401)];
    expect(await loadProfitLossRows("expenses", "business-one")).toHaveLength(401);
    expect(mock.calls.map((call) => call.range)).toEqual([[0, 499], [200, 699], [400, 899]]);
  });

  it("rejects a later query failure instead of exposing partial data", async () => {
    mock.responses = [page(0, 500, 501), { data: null, error: { message: "Failed" }, count: null }];
    await expect(loadProfitLossRows("documents", "business-one")).rejects.toThrow();
  });

  it("accepts an empty result only when the exact count is zero", async () => {
    mock.responses = [page(0, 0, 0)];
    expect(await loadProfitLossRows("expenses", "business-one")).toEqual([]);
    mock.responses = [page(0, 0, 1)];
    await expect(loadProfitLossRows("expenses", "business-one")).rejects.toThrow();
  });

  it.each([
    ["count drift", page(500, 1, 502)],
    ["duplicate ids", page(0, 1, 501)],
    ["premature empty page", page(500, 0, 501)],
    ["missing exact count", { data: [{ id: "500" }], error: null, count: null }],
  ] satisfies [string, Response][])("rejects %s", async (_label, secondPage) => {
    mock.responses = [page(0, 500, 501), secondPage];
    await expect(loadProfitLossRows("documents", "business-one")).rejects.toThrow();
  });

  it("does not issue requests for an already aborted load", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadProfitLossRows("documents", "business-one", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.calls).toHaveLength(0);
  });

  it("propagates cancellation to the query and prevents subsequent pages", async () => {
    const controller = new AbortController();
    mock.responses = [page(0, 500, 501), page(500, 1, 501)];
    mock.beforeResponse = () => controller.abort();
    await expect(loadProfitLossRows("documents", "business-one", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].signal).toBe(controller.signal);
    expect(mock.responses).toHaveLength(1);
  });
});
