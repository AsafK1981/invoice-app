import { describe, it, expect } from "vitest";
import {
  getVatRate,
  calculateVat,
  round2,
  computeAmounts,
  canIssueTaxInvoices,
  VAT_RATES,
} from "@/lib/vat";
import type { Business } from "@/lib/types";

const exemptBiz: Business = {
  id: "b1",
  name: "Solo",
  businessType: "exempt",
  taxId: "123",
  address: "x",
};

const authorizedBiz: Business = { ...exemptBiz, businessType: "authorized" };
const companyBiz: Business = { ...exemptBiz, businessType: "company" };

describe("round2", () => {
  it("fixes the classic 0.1 + 0.2 floating-point issue", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it("rounds typical positive values to 2 decimals", () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.236)).toBe(1.24);
    expect(round2(99.999)).toBe(100);
  });

  it("leaves whole numbers alone", () => {
    expect(round2(100)).toBe(100);
  });

  it("handles negative numbers (credit notes)", () => {
    expect(round2(-12.34)).toBe(-12.34);
    expect(round2(-12.346)).toBe(-12.35);
  });

  it("rounds zero to zero", () => {
    expect(round2(0)).toBe(0);
  });
});

describe("getVatRate", () => {
  it("returns 0 for exempt business", () => {
    expect(getVatRate(exemptBiz)).toBe(0);
  });

  it("returns 18 for authorized (עוסק מורשה)", () => {
    expect(getVatRate(authorizedBiz)).toBe(18);
  });

  it("returns 18 for company (חברה בע״מ)", () => {
    expect(getVatRate(companyBiz)).toBe(18);
  });

  it("returns 0 for null/undefined business", () => {
    expect(getVatRate(null)).toBe(0);
    expect(getVatRate(undefined)).toBe(0);
  });

  it("VAT_RATES table is internally consistent", () => {
    expect(VAT_RATES.exempt).toBe(0);
    expect(VAT_RATES.authorized).toBe(18);
    expect(VAT_RATES.company).toBe(18);
  });
});

describe("calculateVat", () => {
  it("computes 18% on 100", () => {
    expect(calculateVat(100, 18)).toBe(18);
  });

  it("returns 0 when rate is 0", () => {
    expect(calculateVat(100, 0)).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    // 100 * 0.17 = 17 exactly; pick something that needs rounding
    expect(calculateVat(33.33, 18)).toBe(round2(33.33 * 0.18));
  });
});

describe("canIssueTaxInvoices", () => {
  it("authorized can issue tax invoices", () => {
    expect(canIssueTaxInvoices(authorizedBiz)).toBe(true);
  });

  it("company can issue tax invoices", () => {
    expect(canIssueTaxInvoices(companyBiz)).toBe(true);
  });

  it("exempt cannot issue tax invoices", () => {
    expect(canIssueTaxInvoices(exemptBiz)).toBe(false);
  });

  it("null business cannot", () => {
    expect(canIssueTaxInvoices(null)).toBe(false);
  });
});

describe("computeAmounts", () => {
  it("zero-rate (exempt): subtotal = total = sum of lines, vat = 0", () => {
    const result = computeAmounts(
      [
        { quantity: 2, unitPrice: 50 },
        { quantity: 1, unitPrice: 100 },
      ],
      0,
      "exclusive"
    );
    expect(result.subtotal).toBe(200);
    expect(result.vat).toBe(0);
    expect(result.total).toBe(200);
    expect(result.netUnitPriceFactor).toBe(1);
  });

  it("18% exclusive (the עוסק מורשה default): adds VAT on top", () => {
    const result = computeAmounts([{ quantity: 1, unitPrice: 100 }], 18, "exclusive");
    expect(result.subtotal).toBe(100);
    expect(result.vat).toBe(18);
    expect(result.total).toBe(118);
    expect(result.netUnitPriceFactor).toBe(1);
  });

  it("18% inclusive: subtotal = total / 1.18, vat = total - subtotal", () => {
    const result = computeAmounts([{ quantity: 1, unitPrice: 118 }], 18, "inclusive");
    expect(result.subtotal).toBe(100);
    expect(result.vat).toBe(18);
    expect(result.total).toBe(118);
    expect(result.netUnitPriceFactor).toBeCloseTo(1 / 1.18, 6);
  });

  it("empty items array: all zeros", () => {
    const result = computeAmounts([], 18, "exclusive");
    expect(result.subtotal).toBe(0);
    expect(result.vat).toBe(0);
    expect(result.total).toBe(0);
  });

  it("negative quantity (credit note flow): math flows through", () => {
    const result = computeAmounts([{ quantity: -1, unitPrice: 100 }], 18, "exclusive");
    expect(result.subtotal).toBe(-100);
    expect(result.vat).toBe(-18);
    expect(result.total).toBe(-118);
  });

  it("multiple lines sum correctly", () => {
    const result = computeAmounts(
      [
        { quantity: 3, unitPrice: 33.33 },
        { quantity: 2, unitPrice: 50 },
      ],
      0,
      "exclusive"
    );
    expect(result.subtotal).toBeCloseTo(199.99, 2);
    expect(result.total).toBeCloseTo(199.99, 2);
  });

  it("zero-rate ignores vatMode (no toggle should appear in UI)", () => {
    const a = computeAmounts([{ quantity: 1, unitPrice: 100 }], 0, "exclusive");
    const b = computeAmounts([{ quantity: 1, unitPrice: 100 }], 0, "inclusive");
    expect(a.subtotal).toBe(b.subtotal);
    expect(a.total).toBe(b.total);
  });

  it("inclusive mode round-trips: net subtotal × (1 + rate) == total", () => {
    const result = computeAmounts(
      [{ quantity: 5, unitPrice: 23.6 }],
      18,
      "inclusive"
    );
    expect(result.total).toBeCloseTo(result.subtotal * 1.18, 1);
    expect(result.subtotal + result.vat).toBeCloseTo(result.total, 2);
  });

  it("exclusive mode invariant: subtotal + vat == total", () => {
    const result = computeAmounts(
      [
        { quantity: 7, unitPrice: 13.7 },
        { quantity: 3, unitPrice: 99.9 },
      ],
      18,
      "exclusive"
    );
    expect(result.subtotal + result.vat).toBeCloseTo(result.total, 2);
  });

  it("netUnitPriceFactor is 1 for exclusive and zero-rate, < 1 for inclusive", () => {
    const exclusive = computeAmounts([{ quantity: 1, unitPrice: 100 }], 18, "exclusive");
    const inclusive = computeAmounts([{ quantity: 1, unitPrice: 100 }], 18, "inclusive");
    const zero = computeAmounts([{ quantity: 1, unitPrice: 100 }], 0, "exclusive");
    expect(exclusive.netUnitPriceFactor).toBe(1);
    expect(zero.netUnitPriceFactor).toBe(1);
    expect(inclusive.netUnitPriceFactor).toBeLessThan(1);
    expect(inclusive.netUnitPriceFactor).toBeGreaterThan(0);
  });

  it("handles a 30-line invoice without precision drift > 1 cent", () => {
    const items = Array.from({ length: 30 }, () => ({ quantity: 1, unitPrice: 33.33 }));
    const result = computeAmounts(items, 18, "exclusive");
    // Direct check — sum of 30 × 33.33 = 999.90 (might float-drift to 999.8999...)
    expect(Math.abs(result.subtotal - 999.9)).toBeLessThan(0.01);
  });
});
