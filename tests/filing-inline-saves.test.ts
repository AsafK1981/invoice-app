import { describe, it, expect, vi, beforeEach } from "vitest";
type Call = { table: string; update?: Record<string, unknown>; in?: [string, string[]]; eq?: [string, string] };
const state = vi.hoisted(() => ({ calls: [] as { table: string; update?: Record<string, unknown>; in?: [string, string[]]; eq?: [string, string] }[], rows: 0, error: null as null | { message: string } }));
vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "business", onBusinessReady: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: (table: string) => {
  const call: Call = { table };
  state.calls.push(call);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    update(row: Record<string, unknown>) { call.update = row; return q; },
    in(column: string, values: string[]) { call.in = [column, values]; return q; },
    eq(column: string, value: string) { call.eq = [column, value]; return q; },
    select: () => q,
    then(resolve: (v: unknown) => void) {
      return Promise.resolve(resolve({ data: state.error ? null : Array.from({ length: state.rows }, (_, i) => ({ id: String(i) })), error: state.error }));
    },
  };
  return q;
} } }));
import { updateExpenseFilingFields } from "@/lib/expense-store";
import { saveBusinessTaxId } from "@/lib/business-store";
import { updateDocumentClientTaxId } from "@/lib/document-store";

beforeEach(() => { state.calls = []; state.rows = 0; state.error = null; window.dispatchEvent = vi.fn(); });

describe("updateExpenseFilingFields", () => {
  it("writes only the named filing columns to every listed expense", async () => {
    state.rows = 2;
    await updateExpenseFilingFields(["a", "b"], { supplierTaxId: "513-333-336" });
    expect(state.calls[0]).toMatchObject({ table: "expenses", update: { supplier_tax_id: "513333336" }, in: ["id", ["a", "b"]] });
    expect(Object.keys(state.calls[0].update!)).toEqual(["supplier_tax_id"]);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("validates the raw supplier number and saves the padded form, never stripping letters", async () => {
    state.rows = 1;
    await expect(updateExpenseFilingFields(["a"], { supplierTaxId: "51333333X6" })).rejects.toThrow("אותיות");
    await expect(updateExpenseFilingFields(["a"], { supplierTaxId: "513333337" })).rejects.toThrow("ספרת הביקורת");
    expect(state.calls).toEqual([]);
    await updateExpenseFilingFields(["a"], { supplierTaxId: "13333331" });
    expect(state.calls[0].update).toEqual({ supplier_tax_id: "013333331" });
  });

  it("clears the supplier number to null on an empty value", async () => {
    state.rows = 1;
    await updateExpenseFilingFields(["a"], { supplierTaxId: " " });
    expect(state.calls[0].update).toEqual({ supplier_tax_id: null });
  });

  it("maps reference, allocation and date", async () => {
    state.rows = 1;
    await updateExpenseFilingFields(["a"], { reference: " INV-9 ", allocationNumber: "111-222-333", date: "2026-08-10" });
    expect(state.calls[0].update).toEqual({ reference: "INV-9", allocation_number: "111222333", date: "2026-08-10" });
  });

  it("throws on a partial write and on an error, without broadcasting", async () => {
    state.rows = 1;
    await expect(updateExpenseFilingFields(["a", "b"], { reference: "1" })).rejects.toThrow("חלק מההוצאות");
    state.error = { message: "denied" };
    await expect(updateExpenseFilingFields(["a"], { reference: "1" })).rejects.toThrow("denied");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });
});

describe("updateDocumentClientTaxId", () => {
  it("refuses letters, too many digits and a bad checksum without writing", async () => {
    state.rows = 1;
    await expect(updateDocumentClientTaxId("d", "DE12345678")).rejects.toThrow("אותיות");
    await expect(updateDocumentClientTaxId("d", "5133333360")).rejects.toThrow("9 ספרות");
    await expect(updateDocumentClientTaxId("d", "513333337")).rejects.toThrow("ספרת הביקורת");
    expect(state.calls).toEqual([]);
  });

  it("saves the 9-digit form, and null when cleared", async () => {
    state.rows = 1;
    await updateDocumentClientTaxId("d", "13333331");
    expect(state.calls[0]).toMatchObject({ table: "documents", update: { client_tax_id: "013333331" }, eq: ["id", "d"] });
    await updateDocumentClientTaxId("d", "");
    expect(state.calls[1].update).toEqual({ client_tax_id: null });
  });
});

describe("saveBusinessTaxId", () => {
  it("updates only tax_id on the business", async () => {
    state.rows = 1;
    await saveBusinessTaxId("biz", " 512345679 ");
    expect(state.calls[0]).toMatchObject({ table: "businesses", update: { tax_id: "512345679" }, eq: ["id", "biz"] });
    expect(Object.keys(state.calls[0].update!)).toEqual(["tax_id"]);
  });

  it("throws when RLS updated nothing", async () => {
    await expect(saveBusinessTaxId("biz", "512345679")).rejects.toThrow("השמירה לא בוצעה");
  });
});
