import { describe, it, expect } from "vitest";
import { computeMoney } from "@/lib/whatsapp/handlers";

/**
 * REGRESSION GUARD: the arithmetic that ends up on a legal document.
 *
 * The bot channel takes an amount out of a Hebrew sentence and turns it into a
 * tax document that is IMMUTABLE once issued (see the immutability triggers;
 * undoing one requires a credit note). Two things therefore have to hold for
 * every possible input, not just the round ones:
 *
 *   1. total === subtotal + vat, to the agora. create_document_for_bot RAISEs
 *      'inconsistent totals' with a 0.01 tolerance, so a rounding split that
 *      drifts doesn't produce a wrong document — it produces a *failed* one,
 *      mid-conversation, after the user already tapped "confirm".
 *   2. An עוסק פטור never gets VAT. The RPC rejects that outright, so getting
 *      it wrong here is again a hard failure at the worst moment.
 *
 * The VAT-inclusive path is the one that can actually break: it derives the
 * subtotal by division, which is where the two roundings could disagree.
 */

const EXEMPT = 0;
const AUTHORIZED = 18;

describe("computeMoney", () => {
  it("gives an exempt business no VAT at all", () => {
    const m = computeMoney(1200, false, EXEMPT);
    expect(m).toEqual({ subtotal: 1200, vat: 0, total: 1200 });
  });

  it("ignores 'includes VAT' for an exempt business", () => {
    // An עוסק פטור cannot charge VAT even if the sentence claimed the amount
    // included it, so both flags must land on the same VAT-free document.
    expect(computeMoney(1200, true, EXEMPT)).toEqual(computeMoney(1200, false, EXEMPT));
  });

  it("adds VAT on top when the amount is pre-VAT", () => {
    const m = computeMoney(1000, false, AUTHORIZED);
    expect(m.subtotal).toBe(1000);
    expect(m.vat).toBe(180);
    expect(m.total).toBe(1180);
  });

  it("extracts VAT from the inside when the amount already includes it", () => {
    const m = computeMoney(1180, true, AUTHORIZED);
    expect(m.total).toBe(1180);
    expect(m.subtotal).toBe(1000);
    expect(m.vat).toBe(180);
  });

  it("keeps total === subtotal + vat across amounts that do not divide cleanly", () => {
    // These are the values where deriving VAT independently (rather than by
    // subtraction) would drift by an agora and trip the RPC's invariant.
    const awkward = [0.01, 0.05, 33.33, 99.99, 333.33, 1000.01, 7777.77, 123456.78];
    for (const amount of awkward) {
      for (const includesVat of [true, false]) {
        for (const rate of [EXEMPT, AUTHORIZED]) {
          const m = computeMoney(amount, includesVat, rate);
          expect(
            Math.abs(m.total - (m.subtotal + m.vat)),
            `total invariant broke for ${amount} includesVat=${includesVat} rate=${rate}`,
          ).toBeLessThanOrEqual(0.01);
        }
      }
    }
  });

  it("never emits more than two decimal places", () => {
    // document_items and documents both persist currency amounts; a value like
    // 1000.004999 would render as a wrong-looking line on the PDF.
    const m = computeMoney(1234.567, true, AUTHORIZED);
    for (const v of [m.subtotal, m.vat, m.total]) {
      expect(Math.round(v * 100)).toBe(v * 100);
    }
  });

  it("preserves the stated amount as the total in both directions", () => {
    // Whatever the user said is what the customer pays when they said it
    // included VAT; when they said it didn't, the total grows by exactly VAT.
    expect(computeMoney(500, true, AUTHORIZED).total).toBe(500);
    expect(computeMoney(500, false, AUTHORIZED).total).toBe(590);
  });
});
