import { describe, it, expect } from "vitest";
import { ilsEquivalents } from "@/lib/exchange-rate";

describe("ilsEquivalents", () => {
  it("ILS-at-rate-1 returns the same numbers (backward compatible)", () => {
    expect(ilsEquivalents({ subtotal: 100, vat: 18, total: 118 }, 1)).toEqual({
      subtotalIls: 100, vatIls: 18, totalIls: 118,
    });
  });
  it("converts foreign amounts at the given rate, ₪ total = ₪ parts (reconciled)", () => {
    expect(ilsEquivalents({ subtotal: 100, vat: 0, total: 100 }, 3.7)).toEqual({
      subtotalIls: 370, vatIls: 0, totalIls: 370,
    });
  });
  it("rounds each part to 2dp and derives totalIls from the parts", () => {
    const r = ilsEquivalents({ subtotal: 33.33, vat: 6, total: 39.33 }, 3.715);
    expect(r.subtotalIls).toBe(123.82);
    expect(r.vatIls).toBe(22.29);
    expect(r.totalIls).toBe(146.11);
  });
});
