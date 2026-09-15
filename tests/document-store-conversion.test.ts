import { describe, it, expect, vi, beforeEach } from "vitest";

// A tiny chainable stand-in for supabase-js: every call is recorded, and the
// awaited result of a chain is decided by `respond` from what was called.
type Call = { method: string; args: unknown[] };
const chains: Call[][] = [];
let respond: (calls: Call[]) => { data: unknown; error: unknown } = () => ({ data: null, error: null });

function builder(first: Call) {
  const calls: Call[] = [first];
  chains.push(calls);
  const proxy: Record<string, unknown> = {};
  for (const m of ["select", "update", "eq", "is", "order", "maybeSingle", "insert"]) {
    proxy[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return proxy;
    };
  }
  proxy.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(respond(calls)).then(resolve, reject);
  return proxy;
}

vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "biz-1", onBusinessReady: vi.fn() }));
const logAudit = vi.fn();
vi.mock("@/lib/audit-log", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: (table: string) => builder({ method: "from", args: [table] }), rpc: vi.fn() },
}));

import { cancelDocument, getConversionSourceState } from "@/lib/document-store";

const has = (calls: Call[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

beforeEach(() => {
  chains.length = 0;
  logAudit.mockReset();
  vi.stubGlobal("window", { ...globalThis.window, dispatchEvent: vi.fn() });
});

describe("D. cancelling a converted receipt releases its source", () => {
  it("resets the source to sent, clears converted_to_id and paid_at, and audits it", async () => {
    respond = (calls) => {
      if (has(calls, "maybeSingle")) {
        return {
          data: { type: "receipt", number: 7, client_name: "לקוח", client_id: "c1", status: "paid", emailed_at: null, original_issued_at: null },
          error: null,
        };
      }
      if (calls.some((c) => c.method === "update")) return { data: [{ id: "x" }], error: null };
      if (has(calls, "eq", "converted_to_id", "rcpt-1")) {
        return { data: [{ id: "q-1", type: "quote", number: 12, client_name: "לקוח", client_id: "c1", status: "paid" }], error: null };
      }
      return { data: null, error: null };
    };

    await cancelDocument("rcpt-1", { vatRegistered: false, affirmedNotReported: true });

    const release = chains.find((c) => has(c, "update", { converted_to_id: null, status: "sent", paid_at: null }));
    expect(release).toBeDefined();
    expect(has(release!, "eq", "id", "q-1")).toBe(true);
    // Race-safe: only while the source still points at this receipt.
    expect(has(release!, "eq", "converted_to_id", "rcpt-1")).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.conversion_unlinked", targetId: "q-1" }),
    );
  });

  it("does nothing more when the cancelled document was not a conversion", async () => {
    respond = (calls) => {
      if (has(calls, "maybeSingle")) {
        return {
          data: { type: "receipt", number: 8, client_name: "לקוח", client_id: null, status: "paid", emailed_at: null, original_issued_at: null },
          error: null,
        };
      }
      if (calls.some((c) => c.method === "update")) return { data: [{ id: "x" }], error: null };
      return { data: [], error: null };
    };
    await cancelDocument("rcpt-2", { vatRegistered: false, affirmedNotReported: true });
    expect(chains.filter((c) => c.some((x) => x.method === "update"))).toHaveLength(1);
    expect(logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "document.conversion_unlinked" }));
  });

  it("reports a failed release instead of pretending the source was freed", async () => {
    respond = (calls) => {
      if (has(calls, "maybeSingle")) {
        return {
          data: { type: "receipt", number: 9, client_name: "לקוח", client_id: null, status: "paid", emailed_at: null, original_issued_at: null },
          error: null,
        };
      }
      if (has(calls, "update", { converted_to_id: null, status: "sent", paid_at: null })) return { data: [], error: null };
      if (calls.some((c) => c.method === "update")) return { data: [{ id: "x" }], error: null };
      return { data: [{ id: "inv-1", type: "tax_invoice", number: 3, client_name: "לקוח", client_id: null, status: "paid" }], error: null };
    };
    await expect(cancelDocument("rcpt-3", { vatRegistered: true, affirmedNotReported: true })).rejects.toThrow(
      /חשבונית מס #3/,
    );
  });
});

describe("B. fresh conversion state read before issuing", () => {
  it("returns the source's status and converted_to_id", async () => {
    respond = () => ({ data: { type: "quote", number: 4, status: "paid", converted_to_id: "r-1" }, error: null });
    await expect(getConversionSourceState("q-4")).resolves.toEqual({
      type: "quote",
      number: 4,
      status: "paid",
      converted_to_id: "r-1",
    });
  });
});
