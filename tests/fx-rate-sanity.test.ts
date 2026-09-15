import { describe, it, expect } from "vitest";
import { foreignRateProblem } from "@/lib/fx-rate-sanity";

describe("foreignRateProblem", () => {
  it("accepts a plausible rate", () => {
    expect(foreignRateProblem("USD", 3.7)).toBeNull();
    expect(foreignRateProblem("EUR", 4.02)).toBeNull();
    expect(foreignRateProblem("GBP", 4.8)).toBeNull();
    expect(foreignRateProblem("JPY", 0.025)).toBeNull();
  });
  it("refuses a missing or non-positive rate", () => {
    for (const rate of [undefined, NaN, 0, -3.7]) expect(foreignRateProblem("USD", rate)).toBe("missing");
  });
  it("refuses exactly 1: the editor and the database default when the rate was never fetched", () => {
    expect(foreignRateProblem("USD", 1)).toBe("one");
    expect(foreignRateProblem("JPY", 1)).toBe("one");
  });
  it("refuses a rate far outside the known range for USD, EUR and GBP", () => {
    expect(foreignRateProblem("USD", 37)).toBe("out_of_range");
    expect(foreignRateProblem("EUR", 1.1)).toBe("out_of_range");
    expect(foreignRateProblem("GBP", 0.27)).toBe("out_of_range");
  });
  it("has nothing to say about a shekel document", () => {
    expect(foreignRateProblem("ILS", 1)).toBeNull();
    expect(foreignRateProblem(undefined, undefined)).toBeNull();
  });
});
