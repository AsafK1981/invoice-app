import { describe, it, expect } from "vitest";
import { computeMoney } from "@/lib/whatsapp/handlers";
import { round2 } from "@/lib/vat";

describe("computeMoney: VAT-exclusive", () => {
  it("adds VAT on top of a stated amount at 18%", () => {
    const m = computeMoney(100, false, 18);
    expect(m.subtotal).toBe(100);
    expect(m.vat).toBe(18);
    expect(m.total).toBe(118);
  });

  it("adds VAT on a non-round amount at 18%", () => {
    const m = computeMoney(1200, false, 18);
    expect(m.subtotal).toBe(1200);
    expect(m.vat).toBe(216);
    expect(m.total).toBe(1416);
  });
});

describe("computeMoney: VAT-inclusive", () => {
  it("derives subtotal from a gross amount at 18%", () => {
    const m = computeMoney(118, true, 18);
    expect(m.subtotal).toBe(100);
    expect(m.vat).toBe(18);
    expect(m.total).toBe(118);
  });

  it("derives subtotal from a non-round gross amount at 18%, VAT by subtraction", () => {
    const m = computeMoney(1416, true, 18);
    // 1416 / 1.18 = 1200 exactly.
    expect(m.subtotal).toBe(1200);
    expect(m.vat).toBe(round2(1416 - 1200));
    expect(m.total).toBe(1416);
  });
});

describe("computeMoney: ratePercent 0 (exempt)", () => {
  it("charges no VAT regardless of the includesVat flag: exclusive", () => {
    const m = computeMoney(1200, false, 0);
    expect(m.subtotal).toBe(1200);
    expect(m.vat).toBe(0);
    expect(m.total).toBe(1200);
  });

  it("charges no VAT regardless of the includesVat flag: inclusive", () => {
    const m = computeMoney(1200, true, 0);
    expect(m.subtotal).toBe(1200);
    expect(m.vat).toBe(0);
    expect(m.total).toBe(1200);
  });
});

describe("computeMoney: half-agora boundary (the epsilon fix)", () => {
  it("exclusive: an amount whose VAT lands exactly on a half-agora rounds up", () => {
    // 33.5 * 3% = 1.005 mathematically, but 33.5 * 0.03 === 1.0049999999999999
    // in IEEE-754 (float dust one hair below the true half-agora value). A
    // plain Math.round(n * 100) / 100 would drop that to 1.00, silently
    // rounding DOWN a value that is mathematically exactly on the boundary.
    // vat.ts's round2 nudges it back up to 1.01 (verified directly below),
    // and computeMoney must inherit that behavior via the shared import, not
    // a local Math.round(n * 100) / 100 shadow (the FIX 1 regression).
    expect(33.5 * 0.03).toBeCloseTo(1.005, 10);
    expect(round2(33.5 * 0.03)).toBe(1.01);

    const m = computeMoney(33.5, false, 3);
    expect(m.subtotal).toBe(33.5);
    expect(m.vat).toBe(1.01);
    expect(m.total).toBe(34.51);
  });

  it("inclusive: a gross amount that produces a half-agora subtotal/VAT split rounds consistently with vat.ts's round2", () => {
    // A gross total of 118.005 splits at 18% inclusive to subtotal 100.00424...
    // round2'd, exercising the same half-agora nudge as vat.ts.
    const total = 100.005 * 1.18;
    const m = computeMoney(total, true, 18);
    expect(m.total).toBe(round2(total));
    expect(m.subtotal).toBe(round2(m.total / 1.18));
    expect(m.vat).toBe(round2(m.total - m.subtotal));
  });

  it("rounds 1.005 up to 1.01 the way vat.ts's round2 does (not down, as a plain Math.round would)", () => {
    expect(round2(1.005)).toBe(1.01);
    // computeMoney at rate 0 is a pass-through round2 of the raw amount.
    const m = computeMoney(1.005, false, 0);
    expect(m.subtotal).toBe(1.01);
    expect(m.total).toBe(1.01);
  });
});

describe("computeMoney: total = subtotal + vat invariant (create_document_for_bot's own tolerance, 0.01)", () => {
  const amounts = [
    1, 0.5, 12.34, 99.99, 100, 118, 1200, 1416, 3333.33, 0.07, 250.5, 87654.32,
  ];

  it("holds for VAT-exclusive amounts at 18%", () => {
    for (const amount of amounts) {
      const m = computeMoney(amount, false, 18);
      expect(Math.abs(m.total - (m.subtotal + m.vat))).toBeLessThanOrEqual(0.01);
    }
  });

  it("holds for VAT-inclusive amounts at 18%", () => {
    for (const amount of amounts) {
      const m = computeMoney(amount, true, 18);
      expect(Math.abs(m.total - (m.subtotal + m.vat))).toBeLessThanOrEqual(0.01);
    }
  });

  it("holds at rate 0 (exempt) for both modes", () => {
    for (const amount of amounts) {
      expect(
        Math.abs(computeMoney(amount, false, 0).total - (computeMoney(amount, false, 0).subtotal + 0)),
      ).toBeLessThanOrEqual(0.01);
      expect(
        Math.abs(computeMoney(amount, true, 0).total - (computeMoney(amount, true, 0).subtotal + 0)),
      ).toBeLessThanOrEqual(0.01);
    }
  });
});
