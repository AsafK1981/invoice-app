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
const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => builder({ method: "from", args: [table] }),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));

import {
  ConversionBlockedError,
  cancelDocument,
  createDocument,
  getConversionSourceState,
  parseCancelResult,
} from "@/lib/document-store";
import type { InvoiceDocument } from "@/lib/types";

const has = (calls: Call[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

const snapRow = (over: Record<string, unknown> = {}) => ({
  type: "receipt",
  number: 7,
  client_name: "לקוח",
  client_id: "c1",
  status: "paid",
  emailed_at: null,
  original_issued_at: null,
  ...over,
});

const snapshotIs = (row: Record<string, unknown>) => (calls: Call[]) =>
  has(calls, "maybeSingle") ? { data: row, error: null } : { data: null, error: null };

const anyDirectUpdate = () => chains.some((c) => c.some((x) => x.method === "update"));

beforeEach(() => {
  chains.length = 0;
  logAudit.mockReset();
  rpc.mockReset();
  respond = () => ({ data: null, error: null });
  vi.stubGlobal("window", { ...globalThis.window, dispatchEvent: vi.fn() });
});

describe("B. cancel is one database transaction", () => {
  it("cancels and releases through cancel_document_atomic, never with direct updates", async () => {
    respond = snapshotIs(snapRow());
    rpc.mockResolvedValue({
      data: {
        already_cancelled: false,
        released: [
          { id: "q-1", type: "quote", number: 12, client_name: "לקוח", client_id: "c1", from_status: "paid", to_status: "sent" },
        ],
      },
      error: null,
    });

    await expect(cancelDocument("rcpt-1", { vatRegistered: false, affirmedNotReported: true })).resolves.toEqual({
      alreadyCancelled: false,
      releasedCount: 1,
    });

    expect(rpc).toHaveBeenCalledWith("cancel_document_atomic", { p_document_id: "rcpt-1" });
    expect(anyDirectUpdate()).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "document.cancelled", targetId: "rcpt-1" }));
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document.conversion_unlinked",
        targetId: "q-1",
        payload: expect.objectContaining({ cancelledDocumentId: "rcpt-1" }),
      }),
    );
  });

  it("audits only the cancel when the document was not a conversion", async () => {
    respond = snapshotIs(snapRow({ number: 8 }));
    rpc.mockResolvedValue({ data: { already_cancelled: false, released: [] }, error: null });
    await cancelDocument("rcpt-2", { vatRegistered: false, affirmedNotReported: true });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "document.conversion_unlinked" }));
  });

  it("retrying on an already-cancelled document re-runs only the release, without a second cancel audit", async () => {
    // Delivered + VAT registered would route a LIVE document to a credit note;
    // an already-cancelled one skips that check and only releases.
    respond = snapshotIs(snapRow({ status: "cancelled", emailed_at: "2026-09-01T00:00:00Z" }));
    rpc.mockResolvedValue({
      data: {
        already_cancelled: true,
        released: [
          { id: "inv-1", type: "tax_invoice", number: 3, client_name: "לקוח", client_id: null, from_status: "paid", to_status: "sent" },
        ],
      },
      error: null,
    });
    await cancelDocument("rcpt-3", { vatRegistered: true, affirmedNotReported: true });
    expect(rpc).toHaveBeenCalledWith("cancel_document_atomic", { p_document_id: "rcpt-3" });
    expect(logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "document.cancelled" }));
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.conversion_unlinked", targetId: "inv-1" }),
    );
  });

  it("reports a failed call as nothing changed and retryable, with no audit", async () => {
    respond = snapshotIs(snapRow());
    rpc.mockResolvedValue({ data: null, error: { message: "canceling statement due to lock timeout" } });
    await expect(cancelDocument("rcpt-4", { vatRegistered: false, affirmedNotReported: true })).rejects.toThrow(
      /לא בוצע שום שינוי, אפשר לנסות שוב/,
    );
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("maps a not-found refusal to the permission message", async () => {
    respond = snapshotIs(snapRow());
    rpc.mockResolvedValue({ data: null, error: { message: "cancel_document_not_found" } });
    await expect(cancelDocument("rcpt-5", { vatRegistered: false })).rejects.toThrow(/אין הרשאה/);
  });

  it("still refuses a delivered VAT document before calling the database", async () => {
    respond = snapshotIs(snapRow({ type: "tax_invoice_receipt", emailed_at: "2026-09-01T00:00:00Z" }));
    await expect(cancelDocument("tir-1", { vatRegistered: true, affirmedNotReported: true })).rejects.toThrow(
      /23א\(2\)/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("parseCancelResult rejects a malformed reply and ignores junk rows", () => {
    expect(() => parseCancelResult(null)).toThrow();
    expect(parseCancelResult({ already_cancelled: true, released: [null, { id: 5 }, { id: "a" }] })).toEqual({
      alreadyCancelled: true,
      released: [{ id: "a" }],
    });
  });
});

const draft = (): Omit<InvoiceDocument, "number"> =>
  ({
    id: "new-1",
    type: "tax_invoice_receipt",
    date: "2026-09-15",
    clientName: "לקוח",
    status: "paid",
    items: [{ id: "i1", description: "שירות", quantity: 1, unitPrice: 1000, total: 1000 }],
    subtotal: 1000,
    vat: 180,
    total: 1180,
  }) as Omit<InvoiceDocument, "number">;

describe("A. convert is created and linked atomically", () => {
  it("passes the source id to create_document_atomic and does no client-side link", async () => {
    rpc.mockResolvedValue({ data: { id: "new-1", number: 201 }, error: null });
    await expect(createDocument(draft(), { convertSourceId: "q-1" })).resolves.toEqual({ id: "new-1", number: 201 });
    expect(rpc).toHaveBeenCalledWith(
      "create_document_atomic",
      expect.objectContaining({ p_source_document_id: "q-1", p_id: "new-1" }),
    );
    expect(anyDirectUpdate()).toBe(false);
  });

  it("omits the parameter entirely on a plain create", async () => {
    rpc.mockResolvedValue({ data: { id: "new-1", number: 202 }, error: null });
    await createDocument(draft());
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect("p_source_document_id" in args).toBe(false);
  });

  it("turns the losing tab's refusal into a ConversionBlockedError carrying the winner's id", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "convert_source_already_converted", hint: "rcpt-9" },
    });
    const err = await createDocument(draft(), { convertSourceId: "q-1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConversionBlockedError);
    expect((err as ConversionBlockedError).block).toEqual({ kind: "already_converted", convertedToId: "rcpt-9" });
    expect((err as Error).message).toContain("אי אפשר להמיר אותו שוב");
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("maps a cancelled source and a refused type pair to Hebrew errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "convert_source_cancelled" } });
    const cancelled = await createDocument(draft(), { convertSourceId: "q-2" }).catch((e: unknown) => e);
    expect((cancelled as ConversionBlockedError).block).toEqual({ kind: "cancelled" });

    rpc.mockResolvedValueOnce({ data: null, error: { message: "convert_type_not_allowed" } });
    await expect(createDocument(draft(), { convertSourceId: "inv-1" })).rejects.toThrow(/אי אפשר להמיר/);
  });

  it("does not read convert codes on a plain create", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "convert_source_cancelled" } });
    const err = await createDocument(draft()).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ConversionBlockedError);
  });
});

describe("fresh conversion state read before issuing", () => {
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
