import { describe, it, expect } from "vitest";
import { formatCurrencyWhole, roundToShekel } from "@/lib/format";

// Strip the bidi isolate and the narrow no-break space so assertions read plainly.
const plain = (s: string) => s.replace(/[⁦⁩]/g, "").replace(/ /g, " ");

describe("roundToShekel (half-up)", () => {
  it("rounds below .5 down and .5 or above up", () => {
    expect(roundToShekel(10641.49)).toBe(10641);
    expect(roundToShekel(10641.5)).toBe(10642);
    expect(roundToShekel(10641.51)).toBe(10642);
    expect(roundToShekel(0.4)).toBe(0);
  });

  it("does not lose a .50 to float error in a sum", () => {
    expect(roundToShekel(0.1 + 0.2 + 10641.2)).toBe(10642);
    expect(roundToShekel(10641.499999999)).toBe(10642);
  });

  it("rounds negatives away from zero", () => {
    expect(roundToShekel(-2.5)).toBe(-3);
    expect(roundToShekel(-2.4)).toBe(-2);
  });

  it("returns 0 for non-finite input", () => {
    expect(roundToShekel(NaN)).toBe(0);
  });
});

describe("formatCurrencyWhole", () => {
  it("never shows agorot", () => {
    expect(plain(formatCurrencyWhole(10641.5))).toBe("₪ 10,642");
    expect(plain(formatCurrencyWhole(1234.49))).toBe("₪ 1,234");
    expect(plain(formatCurrencyWhole(-99.5))).toBe("-₪ 100");
    expect(plain(formatCurrencyWhole(-0.4))).toBe("₪ 0");
  });
});
