import { describe, it, expect, vi, beforeEach } from "vitest";

// Same chainable supabase stand-in as tests/document-store-conversion.test.ts.
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
vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => builder({ method: "from", args: [table] }),
    rpc: vi.fn(),
  },
}));

import { updateDocumentNumber } from "@/lib/document-store";

const isStatusRead = (calls: Call[]) =>
  calls.some((c) => c.method === "select" && String(c.args[0]).includes("status"));
const isUpdate = (calls: Call[]) => calls.some((c) => c.method === "update");

beforeEach(() => {
  chains.length = 0;
  respond = () => ({ data: null, error: null });
  // The store broadcasts a change event on success; the node environment has
  // no real window.
  window.dispatchEvent = vi.fn();
});

describe("updateDocumentNumber immutability gate", () => {
  it("renumbers a draft", async () => {
    respond = (calls) => {
      if (isStatusRead(calls)) return { data: { type: "receipt", number: 5, status: "draft" }, error: null };
      return { data: [{ id: "doc-1", type: "receipt" }], error: null };
    };
    await expect(updateDocumentNumber("doc-1", 9)).resolves.toBeUndefined();
    expect(chains.some(isUpdate)).toBe(true);
  });

  it("refuses to renumber a document that was already issued", async () => {
    respond = (calls) => {
      if (isStatusRead(calls)) return { data: { type: "receipt", number: 5, status: "sent" }, error: null };
      return { data: [{ id: "doc-1" }], error: null };
    };
    await expect(updateDocumentNumber("doc-1", 9)).rejects.toThrow(/מסמך שהופק/);
    expect(chains.some(isUpdate)).toBe(false);
  });

  // The regression. The gate used to read `if (before && before.status !== "draft")`,
  // so a read that came back empty skipped the legal check entirely and went
  // straight to the UPDATE. Under RLS an empty read proves nothing - a request
  // that lost its token is answered with zero rows and no error - so this path
  // could renumber an ISSUED document, with only the DB trigger left to stop it.
  it("refuses when the status could not be read at all", async () => {
    respond = (calls) => {
      if (isStatusRead(calls)) return { data: null, error: null };
      return { data: [{ id: "doc-1" }], error: null };
    };
    await expect(updateDocumentNumber("doc-1", 9)).rejects.toThrow(/לא הצלחנו לקרוא את המסמך/);
    expect(chains.some(isUpdate)).toBe(false);
  });

  it("refuses when the status read failed", async () => {
    respond = (calls) => {
      if (isStatusRead(calls)) return { data: null, error: { message: "permission denied" } };
      return { data: [{ id: "doc-1" }], error: null };
    };
    await expect(updateDocumentNumber("doc-1", 9)).rejects.toThrow(/permission denied/);
    expect(chains.some(isUpdate)).toBe(false);
  });

  it("still rejects a non-positive number before touching the database", async () => {
    await expect(updateDocumentNumber("doc-1", 0)).rejects.toThrow(/מספר שלם חיובי/);
    expect(chains.length).toBe(0);
  });
});
