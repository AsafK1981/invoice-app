import { describe, it, expect } from "vitest";
import { computeAmounts, netLineAmounts, round2, calculateVat, type VatMode } from "@/lib/vat";

// ── The computeAmounts that shipped before 2026-09-15, verbatim, as the
// reference for "exclusive and zero-VAT documents compute exactly as before".
function legacyComputeAmounts(
  items: { quantity: number; unitPrice: number }[],
  vatRate: number,
  vatMode: VatMode,
  roundTotal = false,
  discount = 0,
) {
  const sum = (arr: number[]) => round2(arr.reduce((s, n) => s + n, 0));
  const withRounding = <T extends { subtotal: number; vat: number; total: number }>(base: T) => {
    if (!roundTotal) return { ...base, rounding: 0 };
    const target = base.subtotal + base.vat;
    const roundedTotal = Math.round(round2(target));
    return { ...base, rounding: round2(roundedTotal - target), total: roundedTotal };
  };
  const withDiscount = (base: { subtotal: number; vat: number; total: number; netUnitPriceFactor: number }) => {
    const d = round2(discount);
    if (!(d > 0) || d >= base.subtotal) return { ...base, discount: 0 };
    const subtotal = round2(base.subtotal - d);
    const vat = vatRate === 0 ? 0 : calculateVat(subtotal, vatRate);
    return { subtotal, vat, total: round2(subtotal + vat), netUnitPriceFactor: base.netUnitPriceFactor, discount: d };
  };
  if (vatRate === 0) {
    const subtotal = sum(items.map((i) => round2(i.quantity * round2(i.unitPrice))));
    const adj = withDiscount({ subtotal, vat: 0, total: subtotal, netUnitPriceFactor: 1 });
    return { ...withRounding(adj), discount: adj.discount };
  }
  if (vatMode === "inclusive") {
    const factor = 1 / (1 + vatRate / 100);
    const subtotal = sum(items.map((i) => round2(i.quantity * round2(i.unitPrice * factor))));
    const total = sum(items.map((i) => round2(i.quantity * i.unitPrice)));
    const adj = withDiscount({ subtotal, vat: round2(total - subtotal), total, netUnitPriceFactor: factor });
    return { ...withRounding(adj), discount: adj.discount };
  }
  const subtotal = sum(items.map((i) => round2(i.quantity * round2(i.unitPrice))));
  const vat = calculateVat(subtotal, vatRate);
  const adj = withDiscount({ subtotal, vat, total: round2(subtotal + vat), netUnitPriceFactor: 1 });
  return { ...withRounding(adj), discount: adj.discount };
}

// The editor's old per-line persistence (receipt-editor handleSave).
function legacyPersistLine(i: { quantity: number; unitPrice: number }, factor: number, sign: 1 | -1) {
  const netUnitPrice = round2(i.unitPrice * factor);
  return { unitPrice: netUnitPrice, total: round2(sign * i.quantity * netUnitPrice) };
}

// Deterministic pseudo-random generator so the broad sweep is reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomItems(r: () => number) {
  const n = 1 + Math.floor(r() * 5);
  return Array.from({ length: n }, () => ({
    quantity: [1, 2, 3, 0.5, 1.25, 7, 12, 40, 1000][Math.floor(r() * 9)],
    unitPrice: Math.round(r() * 500000) / 100,
  }));
}

describe("exclusive and zero-VAT documents are unchanged (regression)", () => {
  it("computeAmounts matches the pre-fix implementation on 5,000 random documents", () => {
    const r = rng(20260915);
    let checked = 0;
    for (let k = 0; k < 5000; k++) {
      const items = randomItems(r);
      const vatRate = [0, 17, 18][Math.floor(r() * 3)];
      const roundTotal = r() < 0.3;
      const discount = r() < 0.3 ? Math.round(r() * 20000) / 100 : 0;
      // Zero VAT ignores the mode, so inclusive at 0% must be unchanged too.
      const modes: VatMode[] = vatRate === 0 ? ["exclusive", "inclusive"] : ["exclusive"];
      for (const mode of modes) {
        expect(computeAmounts(items, vatRate, mode, roundTotal, discount)).toEqual(
          legacyComputeAmounts(items, vatRate, mode, roundTotal, discount),
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5000);
  }, 60_000);

  it("stored line unit prices and totals match the pre-fix editor on the same sweep, both signs", () => {
    const r = rng(42);
    const mismatches: string[] = [];
    for (let k = 0; k < 5000; k++) {
      for (const item of randomItems(r)) {
        for (const sign of [1, -1] as const) {
          for (const [rate, mode] of [[18, "exclusive"], [0, "exclusive"], [0, "inclusive"]] as const) {
            const line = netLineAmounts(item, rate, mode, sign);
            const legacy = legacyPersistLine(item, 1, sign);
            if (line.unitPrice !== legacy.unitPrice || line.total !== legacy.total) {
              mismatches.push(`${item.quantity} x ${item.unitPrice} sign ${sign} ${rate}% ${mode}`);
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  }, 60_000);

  it("stored inclusive unit prices do not move either (only line totals change)", () => {
    const r = rng(7);
    for (let k = 0; k < 2000; k++) {
      for (const item of randomItems(r)) {
        expect(netLineAmounts(item, 18, "inclusive").unitPrice).toBe(legacyPersistLine(item, 1 / 1.18, 1).unitPrice);
      }
    }
  }, 60_000);
});

describe("VAT-inclusive entry derives the net from the line's gross", () => {
  const cases: { name: string; items: { quantity: number; unitPrice: number }[]; subtotal: number; vat: number; total: number }[] = [
    { name: "1000 x 1.00", items: [{ quantity: 1000, unitPrice: 1 }], subtotal: 847.46, vat: 152.54, total: 1000 },
    { name: "40 x 117.99", items: [{ quantity: 40, unitPrice: 117.99 }], subtotal: 3999.66, vat: 719.94, total: 4719.6 },
    { name: "1 x 118", items: [{ quantity: 1, unitPrice: 118 }], subtotal: 100, vat: 18, total: 118 },
    { name: "12 x 9.90", items: [{ quantity: 12, unitPrice: 9.9 }], subtotal: 100.68, vat: 18.12, total: 118.8 },
    { name: "3 x 33.33", items: [{ quantity: 3, unitPrice: 33.33 }], subtotal: 84.74, vat: 15.25, total: 99.99 },
    {
      name: "mixed 2 x 59 + 250 x 0.35 + 1 x 1,234.56",
      items: [{ quantity: 2, unitPrice: 59 }, { quantity: 250, unitPrice: 0.35 }, { quantity: 1, unitPrice: 1234.56 }],
      subtotal: 1220.39,
      vat: 219.67,
      total: 1440.06,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const a = computeAmounts(c.items, 18, "inclusive");
      expect({ subtotal: a.subtotal, vat: a.vat, total: a.total }).toEqual({ subtotal: c.subtotal, vat: c.vat, total: c.total });
    });
  }

  it("each line's net is round2(qty x price / 1.18)", () => {
    expect(netLineAmounts({ quantity: 1000, unitPrice: 1 }, 18, "inclusive")).toEqual({ unitPrice: 0.85, total: 847.46 });
    expect(netLineAmounts({ quantity: 40, unitPrice: 117.99 }, 18, "inclusive")).toEqual({ unitPrice: 99.99, total: 3999.66 });
  });

  it("satisfies create_document_atomic's checks and stays within an agora of 18% on random documents", () => {
    const r = rng(99);
    for (let k = 0; k < 5000; k++) {
      const items = randomItems(r);
      const roundTotal = r() < 0.3;
      const discount = r() < 0.2 ? Math.round(r() * 5000) / 100 : 0;
      const a = computeAmounts(items, 18, "inclusive", roundTotal, discount);
      for (const sign of [1, -1]) {
        // What the editor persists (see receipt-editor handleSave).
        const lineTotals = items.map((i) => netLineAmounts(i, 18, "inclusive", sign as 1 | -1).total);
        const itemSum = lineTotals.reduce((s, n) => s + n, 0);
        const subtotal = round2(sign * a.subtotal);
        const vat = round2(sign * a.vat);
        const total = round2(sign * a.total);
        const rounding = round2(sign * a.rounding);
        // RPC: item totals minus discount = subtotal; total = subtotal + vat + rounding (tolerance 0.01).
        expect(Math.abs(itemSum - round2(sign * a.discount) - subtotal)).toBeLessThanOrEqual(0.01 + 1e-9);
        expect(Math.abs(total - (subtotal + vat + rounding))).toBeLessThanOrEqual(0.01 + 1e-9);
      }
      if (a.discount === 0 && items.length === 1) {
        // One line: VAT is exactly the gross minus round2(gross / 1.18), so it
        // is within one agora of 18% of the stored subtotal.
        expect(Math.abs(a.vat - a.subtotal * 0.18)).toBeLessThanOrEqual(0.01 + 1e-9);
      }
    }
  }, 60_000);
});
