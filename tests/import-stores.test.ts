import { describe, it, expect, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({ existing: false, error: false, writes: [] as { kind: string; row: Record<string, unknown> }[] }));
vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "business", onBusinessReady: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => {
  let kind = "read";
  const q: any = {
    select: () => q, eq: () => q, single: () => q, maybeSingle: () => q,
    insert(row: Record<string, unknown>) { kind = "insert"; state.writes.push({ kind, row }); return q; },
    update(row: Record<string, unknown>) { kind = "update"; state.writes.push({ kind, row }); return q; },
    then(resolve: (v: unknown) => void) { return Promise.resolve(resolve({ data: kind === "read" ? (state.existing ? { id: "existing" } : null) : (state.error ? null : [{ id: "existing" }]), error: kind !== "read" && state.error ? new Error("write failed") : null })); },
  }; return q;
} } }));
import { clientStore } from "@/lib/client-store";
import { productStore } from "@/lib/product-store";
import { expenseStore } from "@/lib/expense-store";
const cases = [
  ["client", (options?: { importBatchId: string }) => clientStore.save({ id: "id", name: "Test", createdAt: "2026-09-13" }, options)],
  ["product", (options?: { importBatchId: string }) => productStore.save({ id: "id", name: "Test", price: 10, unit: "unit" }, options)],
  ["expense", (options?: { importBatchId: string }) => expenseStore.save({ id: "id", date: "2026-09-13", category: "other", supplier: "Test", amount: 10 }, options)],
] as const;
beforeEach(() => { state.existing = false; state.error = false; state.writes = []; window.dispatchEvent = vi.fn(); });
describe.each(cases)("%s import store", (name, save) => {
  it("stamps import inserts atomically and leaves manual insert unchanged", async () => {
    await save({ importBatchId: "batch" });
    expect(state.writes[0]).toMatchObject({ kind: "insert", row: { import_batch_id: "batch" } });
    await save();
    expect(state.writes[1].row).not.toHaveProperty("import_batch_id");
  });
  it("never clears or retags provenance on updates", async () => {
    state.existing = true;
    await save({ importBatchId: "new-batch" }); await save();
    expect(state.writes.every(w => w.kind === "update" && !("import_batch_id" in w.row))).toBe(true);
  });
  it("propagates insert failure on BOTH paths so callers cannot count it successful", async () => {
    state.error = true;
    await expect(save({ importBatchId: "batch" })).rejects.toThrow("write failed");
    // The manual path throws too. It used to be `if (error && options) throw`,
    // so only imports reported failures: a manual product or expense whose
    // INSERT was refused still fired the change event and closed the form with
    // a success toast, and the row was simply never written. Silent data loss,
    // and the same class of fail-quiet bug as the businesses RLS incident
    // (Sentry INVOICE-APP-J). clientStore was fixed for this earlier; product
    // and expense were left behind until 2026-09-16.
    await expect(save()).rejects.toThrow("write failed");
  });
});
