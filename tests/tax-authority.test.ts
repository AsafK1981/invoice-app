import { describe, it, expect } from "vitest";
import {
  getAllocationThresholdForYear,
  allocationRequiredThreshold,
  requiresAllocationNumber,
} from "@/lib/tax-authority";
import type { InvoiceDocument } from "@/lib/types";

/**
 * Minimal doc factory — requiresAllocationNumber gates on the PRE-VAT amount
 * (subtotalIls ?? subtotal). The `total` here is treated as the pre-VAT
 * governing amount and mirrored into `subtotal` so the pre-VAT path evaluates
 * it. Amounts in these tests are therefore pre-VAT figures.
 */
function doc(partial: { type: string; date: string; total: number }): InvoiceDocument {
  return { ...partial, subtotal: partial.total } as unknown as InvoiceDocument;
}

describe("getAllocationThresholdForYear", () => {
  it("returns the legislated table values", () => {
    expect(getAllocationThresholdForYear(2024)).toBe(25_000);
    expect(getAllocationThresholdForYear(2025)).toBe(20_000);
    expect(getAllocationThresholdForYear(2026)).toBe(10_000);
  });

  it("falls back to ₪5,000 for years outside the table", () => {
    expect(getAllocationThresholdForYear(2027)).toBe(5_000);
    expect(getAllocationThresholdForYear(2099)).toBe(5_000);
  });
});

describe("allocationRequiredThreshold (date-aware, honours the mid-2026 drop)", () => {
  it("is ₪10,000 for Jan–May 2026", () => {
    expect(allocationRequiredThreshold(new Date("2026-01-15"))).toBe(10_000);
    expect(allocationRequiredThreshold(new Date("2026-05-31"))).toBe(10_000);
  });

  it("drops to ₪5,000 from June 2026 onward", () => {
    expect(allocationRequiredThreshold(new Date("2026-06-01"))).toBe(5_000);
    expect(allocationRequiredThreshold(new Date("2026-12-31"))).toBe(5_000);
  });

  it("uses ₪20,000 in 2025 and ₪25,000 in 2024", () => {
    expect(allocationRequiredThreshold(new Date("2025-07-01"))).toBe(20_000);
    expect(allocationRequiredThreshold(new Date("2024-07-01"))).toBe(25_000);
  });

  it("stays ₪5,000 for 2027 and later", () => {
    expect(allocationRequiredThreshold(new Date("2027-03-01"))).toBe(5_000);
    expect(allocationRequiredThreshold(new Date("2030-01-01"))).toBe(5_000);
  });
});

describe("requiresAllocationNumber", () => {
  it("requires a number for a tax invoice at/above the date threshold", () => {
    // June 2026 threshold is ₪5,000
    expect(requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-06-10", total: 7_000 }))).toBe(true);
    expect(requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-06-10", total: 5_000 }))).toBe(true);
  });

  it("does NOT require a number below the date threshold", () => {
    expect(requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-06-10", total: 4_999 }))).toBe(false);
    // Same ₪7,000 in May 2026 is below the ₪10,000 threshold → not required
    expect(requiresAllocationNumber(doc({ type: "tax_invoice", date: "2026-05-10", total: 7_000 }))).toBe(false);
  });

  it("covers tax_invoice_receipt and credit_note, using the absolute amount", () => {
    expect(requiresAllocationNumber(doc({ type: "tax_invoice_receipt", date: "2026-06-10", total: 9_000 }))).toBe(true);
    // Credit notes are negative — abs() must still cross the threshold
    expect(requiresAllocationNumber(doc({ type: "credit_note", date: "2026-06-10", total: -8_000 }))).toBe(true);
    expect(requiresAllocationNumber(doc({ type: "credit_note", date: "2026-06-10", total: -100 }))).toBe(false);
  });

  it("never requires a number for non-tax documents", () => {
    expect(requiresAllocationNumber(doc({ type: "receipt", date: "2026-06-10", total: 50_000 }))).toBe(false);
    expect(requiresAllocationNumber(doc({ type: "quote", date: "2026-06-10", total: 50_000 }))).toBe(false);
    expect(requiresAllocationNumber(doc({ type: "invoice", date: "2026-06-10", total: 50_000 }))).toBe(false);
  });
});

describe("requiresAllocationNumber — ₪ equivalent governs the threshold", () => {
  // Zero-VAT export: the pre-VAT ₪ equivalent (subtotalIls) governs, and for a
  // zero-rated export it equals the total ₪ equivalent.
  it("a $2000 export doc worth ₪7400 (over the June-2026 ₪5,000 threshold) requires a number", () => {
    const doc = {
      type: "tax_invoice",
      date: "2026-06-10",
      total: 2000,
      totalIls: 7400,
      subtotal: 2000,
      subtotalIls: 7400,
    } as never;
    expect(requiresAllocationNumber(doc)).toBe(true);
  });
  it("a $2000 doc worth only ₪4000 is below threshold", () => {
    const doc = {
      type: "tax_invoice",
      date: "2026-06-10",
      total: 2000,
      totalIls: 4000,
      subtotal: 2000,
      subtotalIls: 4000,
    } as never;
    expect(requiresAllocationNumber(doc)).toBe(false);
  });
});
