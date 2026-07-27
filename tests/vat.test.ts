import { describe, it, expect } from "vitest";
import {
  getVatRate,
  calculateVat,
  round2,
  computeAmounts,
  canIssueTaxInvoices,
  canIssueTaxInvoicesByType,
  deriveVatRate,
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
    // Direct check: sum of 30 × 33.33 = 999.90 (might float-drift to 999.8999...)
    expect(Math.abs(result.subtotal - 999.9)).toBeLessThan(0.01);
  });
});

describe("computeAmounts: optional final-total rounding (הפרש עיגול)", () => {
  it("rounding OFF (default): total unchanged, rounding = 0", () => {
    const off = computeAmounts([{ quantity: 3, unitPrice: 33.33 }], 18, "exclusive");
    expect(off.subtotal).toBe(99.99);
    expect(off.vat).toBe(18);
    expect(off.total).toBe(117.99);
    expect(off.rounding).toBe(0);
    // Explicit false behaves identically to the default.
    const offExplicit = computeAmounts([{ quantity: 3, unitPrice: 33.33 }], 18, "exclusive", false);
    expect(offExplicit.total).toBe(117.99);
    expect(offExplicit.rounding).toBe(0);
  });

  it("rounding ON: rounds the total to a whole number, keeps subtotal + vat exact", () => {
    const on = computeAmounts([{ quantity: 3, unitPrice: 33.33 }], 18, "exclusive", true);
    // subtotal + vat untouched (99.99 + 18.00 = 117.99) → rounds up to 118.
    expect(on.subtotal).toBe(99.99);
    expect(on.vat).toBe(18);
    expect(on.total).toBe(118);
    expect(Number.isInteger(on.total)).toBe(true);
    expect(on.rounding).toBe(0.01); // signed diff: 118 - 117.99
  });

  it("rounding is the correct signed diff (rounds down when < .5)", () => {
    const on = computeAmounts([{ quantity: 1, unitPrice: 100.4 }], 18, "exclusive", true);
    // subtotal 100.40, vat round2(18.072)=18.07 → 118.47 → rounds down to 118.
    expect(on.subtotal).toBe(100.4);
    expect(on.vat).toBe(18.07);
    expect(on.total).toBe(118);
    expect(on.rounding).toBe(-0.47);
  });

  it("invariant total = subtotal + vat + rounding holds", () => {
    for (const items of [
      [{ quantity: 3, unitPrice: 33.33 }],
      [{ quantity: 1, unitPrice: 100.4 }],
      [{ quantity: 7, unitPrice: 13.7 }, { quantity: 3, unitPrice: 99.9 }],
    ]) {
      const on = computeAmounts(items, 18, "exclusive", true);
      expect(round2(on.subtotal + on.vat + on.rounding)).toBe(on.total);
    }
  });

  it("exempt (vat = 0): rounds the subtotal-only total", () => {
    const on = computeAmounts([{ quantity: 1, unitPrice: 100.4 }], 0, "exclusive", true);
    expect(on.subtotal).toBe(100.4);
    expect(on.vat).toBe(0);
    expect(on.total).toBe(100);
    expect(on.rounding).toBe(-0.4);
    expect(round2(on.subtotal + on.vat + on.rounding)).toBe(on.total);
  });

  it("rounds half up, robust to float drift on the .50 boundary", () => {
    // 100.10 + 18.40 = 118.50 (both terms float-imprecise) → must round UP to 119.
    const on = computeAmounts(
      [{ quantity: 1, unitPrice: 100.1 }, { quantity: 1, unitPrice: 18.4 }],
      0,
      "exclusive",
      true,
    );
    expect(on.subtotal).toBe(118.5);
    expect(on.total).toBe(119);
    expect(on.rounding).toBe(0.5);
  });
});

describe("canIssueTaxInvoicesByType", () => {
  it("is true for VAT-charging types (authorized / company)", () => {
    expect(canIssueTaxInvoicesByType("authorized")).toBe(true);
    expect(canIssueTaxInvoicesByType("company")).toBe(true);
  });

  it("is false for exempt, unknown, or nullish types", () => {
    expect(canIssueTaxInvoicesByType("exempt")).toBe(false);
    expect(canIssueTaxInvoicesByType("licensed")).toBe(false); // stale value that used to bite us
    expect(canIssueTaxInvoicesByType(null)).toBe(false);
    expect(canIssueTaxInvoicesByType(undefined)).toBe(false);
  });

  it("agrees with the Business-object variant", () => {
    expect(canIssueTaxInvoices(authorizedBiz)).toBe(canIssueTaxInvoicesByType("authorized"));
    expect(canIssueTaxInvoices(exemptBiz)).toBe(canIssueTaxInvoicesByType("exempt"));
  });
});

describe("deriveVatRate", () => {
  it("derives a whole 18% from clean totals", () => {
    expect(deriveVatRate(180, 1000)).toBe(18);
  });

  it("rounds to a whole rate so we never send 17.99 / 18.01", () => {
    // round2'd vat on an odd subtotal drifts slightly off exactly 18%
    expect(deriveVatRate(18.05, 100.3)).toBe(18);
    expect(deriveVatRate(17.99, 100)).toBe(18);
  });

  it("falls back to the canonical standard rate when subtotal is 0", () => {
    expect(deriveVatRate(0, 0)).toBe(VAT_RATES.authorized);
  });
});

describe("computeAmounts: line/header reconciliation (multi-line rounding)", () => {
  // Re-derive the per-line net amounts the document persists and assert they
  // sum exactly to the header; the bug was a few-agorot drift here.
  function lineNetsOf(items: { quantity: number; unitPrice: number }[], factor: number) {
    return items.map((i) => round2(i.quantity * round2(i.unitPrice * factor)));
  }

  const tricky = [
    { quantity: 3, unitPrice: 33.33 },
    { quantity: 7, unitPrice: 13.7 },
    { quantity: 2, unitPrice: 19.99 },
    { quantity: 1, unitPrice: 0.07 },
  ];

  it("exclusive: sum of line nets equals header subtotal, and subtotal + vat == total", () => {
    const r = computeAmounts(tricky, 18, "exclusive");
    const lineSum = round2(lineNetsOf(tricky, 1).reduce((s, n) => s + n, 0));
    expect(lineSum).toBe(r.subtotal);
    expect(round2(r.subtotal + r.vat)).toBe(r.total);
  });

  it("inclusive: sum of line nets equals header subtotal, and subtotal + vat == total", () => {
    const factor = 1 / 1.18;
    const r = computeAmounts(tricky, 18, "inclusive");
    const lineSum = round2(lineNetsOf(tricky, factor).reduce((s, n) => s + n, 0));
    expect(lineSum).toBe(r.subtotal);
    expect(round2(r.subtotal + r.vat)).toBe(r.total);
  });

  it("zero-rate: lines reconcile and there is no VAT", () => {
    const r = computeAmounts(tricky, 0, "exclusive");
    const lineSum = round2(lineNetsOf(tricky, 1).reduce((s, n) => s + n, 0));
    expect(lineSum).toBe(r.subtotal);
    expect(r.total).toBe(r.subtotal);
    expect(r.vat).toBe(0);
  });

  it("30 identical inclusive lines reconcile exactly", () => {
    const items = Array.from({ length: 30 }, () => ({ quantity: 1, unitPrice: 11.81 }));
    const r = computeAmounts(items, 18, "inclusive");
    const lineSum = round2(lineNetsOf(items, 1 / 1.18).reduce((s, n) => s + n, 0));
    expect(lineSum).toBe(r.subtotal);
    expect(round2(r.subtotal + r.vat)).toBe(r.total);
  });
});
