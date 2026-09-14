import { describe, it, expect } from "vitest";
import { CLIENT_TAX_ID_SNAPSHOT_SINCE, uniformCustomerVat } from "@/lib/uniform-structure/customer-vat";
import type { Client, InvoiceDocument } from "@/lib/types";

const client = { id: "c1", name: "x", taxId: "034567891", createdAt: "" } as Client;
const doc = (over: Partial<InvoiceDocument> = {}) => ({ id: "d", date: "2026-08-01", clientId: "c1", ...over }) as InvoiceDocument;

describe("uniformCustomerVat", () => {
  it("uses the document's own number, padded", () => {
    expect(uniformCustomerVat(doc({ clientTaxId: "13333331" }), client)).toEqual({ value: "013333331", raw: "13333331", fallback: false, refused: false });
  });

  it("never falls back to the client for a document issued after the snapshot column existed", () => {
    expect(uniformCustomerVat(doc(), client)).toEqual({ value: "", raw: "", fallback: false, refused: false });
  });

  it("falls back to the client only for an older document without a snapshot, and says so", () => {
    expect(CLIENT_TAX_ID_SNAPSHOT_SINCE).toBe("2026-06-25");
    expect(uniformCustomerVat(doc({ date: "2026-06-24" }), client)).toEqual({ value: "034567891", raw: "034567891", fallback: true, refused: false });
    expect(uniformCustomerVat(doc({ date: "2026-06-24" }), null)).toEqual({ value: "", raw: "", fallback: false, refused: false });
  });

  it("refuses a foreign id instead of stripping it", () => {
    expect(uniformCustomerVat(doc({ clientTaxId: "DE123456789" }), client)).toEqual({ value: "", raw: "DE123456789", fallback: false, refused: true });
  });
});
