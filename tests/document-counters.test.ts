import { describe, it, expect, beforeEach } from "vitest";
import { bumpDocumentCounter, bumpDocumentCounters } from "@/lib/document-counters";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The counter bump is what stops a freshly imported invoice number from being
 * handed out again to a live document. It used to read the counter first and
 * drop the error, so a refused read left it unraised while the import reported
 * success. It is now a single atomic RPC (GREATEST inside ON CONFLICT), so the
 * only thing left to get wrong in application code is the arithmetic and the
 * error handling - which is what these cover.
 */
let rpcCalls: { fn: string; args: Record<string, unknown> }[];
let rpcErrors: ({ message: string } | null)[];

function fakeClient(): SupabaseClient {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: rpcErrors.shift() ?? null });
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  rpcCalls = [];
  rpcErrors = [];
});

describe("bumpDocumentCounter", () => {
  it("delegates the whole decision to one atomic statement", async () => {
    await bumpDocumentCounter(fakeClient(), "biz", "receipt", 1020);
    expect(rpcCalls).toEqual([
      {
        fn: "bump_document_counter",
        args: { p_business_id: "biz", p_doc_type: "receipt", p_target: 1020 },
      },
    ]);
  });

  // The original regression: a failure here must surface. Skipping the bump
  // silently is how the next live document gets a number the import just used.
  it("throws when the counter could not be raised", async () => {
    rpcErrors = [{ message: "permission denied" }];
    await expect(bumpDocumentCounter(fakeClient(), "biz", "receipt", 5)).rejects.toThrow(
      /מונה המספור/,
    );
  });

  it("never claims the import succeeded, since it also runs after a partial one", async () => {
    rpcErrors = [{ message: "boom" }];
    await expect(bumpDocumentCounter(fakeClient(), "biz", "receipt", 5)).rejects.toThrow(
      /המסמכים יובאו/,
    );
  });
});

describe("bumpDocumentCounters", () => {
  it("passes highest + 1, because next_number is the number handed out next", async () => {
    await bumpDocumentCounters(fakeClient(), "biz", [["receipt", 1019]]);
    expect(rpcCalls[0].args).toMatchObject({ p_target: 1020 });
  });

  // A single try around the whole loop meant a failure on the first type left
  // the rest unraised, with their documents already committed.
  it("attempts every type even when one fails, and reports them all", async () => {
    rpcErrors = [{ message: "receipt boom" }, null, { message: "quote boom" }];
    await expect(
      bumpDocumentCounters(fakeClient(), "biz", [
        ["receipt", 10],
        ["invoice", 20],
        ["quote", 30],
      ]),
    ).rejects.toThrow(/receipt boom[\s\S]*quote boom/);
    expect(rpcCalls.map((c) => c.args.p_doc_type)).toEqual(["receipt", "invoice", "quote"]);
  });

  it("resolves quietly when every type is raised", async () => {
    await expect(
      bumpDocumentCounters(fakeClient(), "biz", [
        ["receipt", 1],
        ["invoice", 2],
      ]),
    ).resolves.toBeUndefined();
  });

  it("does nothing at all when the import touched no documents", async () => {
    await bumpDocumentCounters(fakeClient(), "biz", []);
    expect(rpcCalls).toHaveLength(0);
  });
});
