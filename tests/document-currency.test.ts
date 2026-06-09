import { describe, it, expect } from "vitest";
import { ilsEquivalents } from "@/lib/exchange-rate";

describe("document ₪ snapshot at create", () => {
  it("USD export doc: rate 3.7, $1000 zero-rated -> ₪3700 total, 0 vat", () => {
    expect(ilsEquivalents({ subtotal: 1000, vat: 0, total: 1000 }, 3.7))
      .toEqual({ subtotalIls: 3700, vatIls: 0, totalIls: 3700 });
  });
  it("ILS doc: rate 1 -> identical (no behavior change)", () => {
    expect(ilsEquivalents({ subtotal: 100, vat: 18, total: 118 }, 1))
      .toEqual({ subtotalIls: 100, vatIls: 18, totalIls: 118 });
  });
});
