import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
const state = vi.hoisted(() => ({ seeds: [] as unknown[], index: 0, saves: [] as any[], inserts: [] as any[] }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useState: (initial: unknown) => [state.index < state.seeds.length ? state.seeds[state.index++] : initial, vi.fn()], useRef: () => ({ current: null }), useMemo: (fn: () => unknown) => fn() };
});
vi.mock("@/lib/client-store", () => ({ clientStore: { save: async (row: unknown, opts: unknown) => { state.saves.push({ row, opts }); } } }));
vi.mock("@/lib/product-store", () => ({ productStore: { save: async (row: unknown, opts: unknown) => { state.saves.push({ row, opts }); } } }));
vi.mock("@/lib/expense-store", () => ({ expenseStore: { save: async (row: unknown, opts: unknown) => { state.saves.push({ row, opts }); } } }));
vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "business" }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: async () => ({ error: null }), from: (table: string) => {
  // `limit` is part of the chain since the import paths stopped using
  // maybeSingle for name lookups (two clients may legitimately share a name),
  // and `rpc` because the counter bump is now one atomic statement in the
  // database (see src/lib/document-counters.ts).
  const q: any = { select: () => q, eq: () => q, ilike: () => q, maybeSingle: () => q, update: () => q,
    limit: () => q, lt: () => q, order: () => q,
    insert: (row: unknown) => { state.inserts.push({ table, row }); return q; },
    then: (resolve: (v: unknown) => void) => Promise.resolve(resolve({ data: null, error: null })),
  }; return q;
} } }));
import { CsvImportModal } from "@/components/csv-import-modal";
import { BulkImportZone } from "@/components/bulk-import-zone";
function handler(node: any, name: string): (() => Promise<void>) | undefined {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) { const found = handler(child, name); if (found) return found; } return; }
  if (node.props?.onClick?.name === name) return node.props.onClick;
  return handler(node.props?.children, name) ?? handler(node.props?.footer, name);
}
beforeEach(() => { state.seeds = []; state.index = 0; state.saves = []; state.inserts = []; vi.stubGlobal("React", React); });
describe("file import entry points", () => {
  it("shares one UUID across all CSV document rows and newly created clients", async () => {
    const rows = [{ "מספר": "1", "לקוח": "Test", "סכום": "10" }, { "מספר": "2", "לקוח": "Test", "סכום": "20" }];
    state.seeds = [rows, Object.keys(rows[0]), false, null, null];
    const tree = CsvImportModal({ open: true, onClose: vi.fn(), entityType: "documents" });
    await handler(tree, "handleImport")!();
    const writes = state.inserts.filter(x => ["documents", "clients"].includes(x.table));
    expect(writes).toHaveLength(3);
    expect(new Set(writes.map(x => x.row.import_batch_id)).size).toBe(1);
    expect(writes[0].row.import_batch_id).toBeTruthy();
  });
  it("shares one UUID across every file and entity in a bulk action", async () => {
    const files = [
      { label: "clients", entity: "clients", rows: [{ name: "Test" }], headers: ["name"] },
      { label: "products", entity: "products", rows: [{ name: "Product", price: "10" }], headers: ["name", "price"] },
      { label: "expenses", entity: "expenses", rows: [{ supplier: "Supplier", amount: "10" }], headers: ["supplier", "amount"] },
      { label: "documents", entity: "documents", rows: [{ "מספר": "1", "לקוח": "Test", "סכום": "10" }], headers: ["מספר", "לקוח", "סכום"] },
    ];
    state.seeds = [files, false, null, null, null, false];
    await handler(BulkImportZone(), "handleImportAll")!();
    expect(state.saves).toHaveLength(3);
    const ids = [...state.saves.map(x => x.opts.importBatchId), ...state.inserts.filter(x => ["clients", "documents"].includes(x.table)).map(x => x.row.import_batch_id)];
    expect(ids).toHaveLength(5); expect(new Set(ids).size).toBe(1); expect(ids[0]).toBeTruthy();
  });
});
