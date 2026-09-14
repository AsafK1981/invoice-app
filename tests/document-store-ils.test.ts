import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/business-init", () => ({ getBusinessId: () => "", onBusinessReady: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
import { mapDocRow } from "@/lib/document-store";

const base = { id: "d", type: "tax_invoice", number: 1, date: "2026-08-01", status: "sent", subtotal: 1000, vat: 180, total: 1180, currency: "USD" };

describe("document store shekel snapshots", () => {
  it("keeps missing shekel amounts undefined instead of copying native amounts", () => {
    const doc = mapDocRow({ ...base, subtotal_ils: null, vat_ils: null, total_ils: null }, []);
    expect(doc.subtotalIls).toBeUndefined();
    expect(doc.vatIls).toBeUndefined();
    expect(doc.totalIls).toBeUndefined();
  });

  it("keeps stored shekel amounts, zero included", () => {
    const doc = mapDocRow({ ...base, subtotal_ils: 3700, vat_ils: 0, total_ils: "3700" }, []);
    expect(doc.subtotalIls).toBe(3700);
    expect(doc.vatIls).toBe(0);
    expect(doc.totalIls).toBe(3700);
  });
});
