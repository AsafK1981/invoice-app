import { describe, it, expect } from "vitest";
import {
  suggestedWithholding,
  netAfterWithholding,
  withholdingRateOnPanelOpen,
  DEFAULT_WITHHOLDING_RATE_PERCENT,
} from "@/lib/withholding";
import { round2 } from "@/lib/vat";

describe("suggestedWithholding: rounds to the nearest whole shekel", () => {
  it("rounds a .25 remainder down", () => {
    // 990 × 17.5% = 173.25
    expect(suggestedWithholding(990, 17.5)).toBe(173);
  });

  it("rounds a .60 remainder up", () => {
    // 992 × 17.5% = 173.60
    expect(suggestedWithholding(992, 17.5)).toBe(174);
  });

  it("rounds exactly .5 UP (half-up, not banker's rounding)", () => {
    // 1000 × 17.25% = 172.5  → 173
    expect(suggestedWithholding(1000, 17.25)).toBe(173);
    // 3 × 50% = 1.5 → 2
    expect(suggestedWithholding(3, 50)).toBe(2);
    // 350.10 × 50% = 175.05 → 175 (just over the boundary, still down)
    expect(suggestedWithholding(350.1, 50)).toBe(175);
    // 351 × 50% = 175.5 → 176
    expect(suggestedWithholding(351, 50)).toBe(176);
  });

  it("survives float dust on a value that is mathematically x.5", () => {
    // 1170.10 × 30% = 351.03; and a classic float-hostile product:
    // 8.15 × 100 is 814.9999999999999 in IEEE-754, so the intermediate
    // round2 has to fire before Math.round.
    expect(suggestedWithholding(1170.1, 30)).toBe(351);
    expect(suggestedWithholding(1629, 50)).toBe(815); // 814.5 → 815
    expect(suggestedWithholding(1631, 50)).toBe(816); // 815.5 → 816
  });

  it("handles values just under and just over a whole shekel", () => {
    expect(suggestedWithholding(999.9, 10)).toBe(100); // 99.99 → 100
    expect(suggestedWithholding(1004, 10)).toBe(100); // 100.40 → 100
    expect(suggestedWithholding(1006, 10)).toBe(101); // 100.60 → 101
  });

  it("returns 0 for a 0 rate, a negative rate, or a 0 total", () => {
    expect(suggestedWithholding(5000, 0)).toBe(0);
    expect(suggestedWithholding(5000, -5)).toBe(0);
    expect(suggestedWithholding(0, 35)).toBe(0);
    expect(suggestedWithholding(-100, 35)).toBe(0);
  });

  it("returns 0 for a non-numeric rate (empty input parsed with parseFloat)", () => {
    expect(suggestedWithholding(1000, parseFloat(""))).toBe(0);
    expect(suggestedWithholding(parseFloat("abc"), 30)).toBe(0);
  });

  it("keeps an already-exact integer result exact", () => {
    expect(suggestedWithholding(1000, 35)).toBe(350);
    expect(suggestedWithholding(11700, 30)).toBe(3510);
    expect(suggestedWithholding(200, 50)).toBe(100);
  });

  it("always returns a whole number, for any plausible total and rate", () => {
    for (let total = 1; total <= 5000; total += 37.13) {
      for (const rate of [3, 5, 10, 17.5, 20, 30, 35, 47, 50]) {
        const w = suggestedWithholding(round2(total), rate);
        expect(Number.isInteger(w)).toBe(true);
      }
    }
  });
});

describe("netAfterWithholding: the reconciliation invariant", () => {
  it("gives back the total exactly when added to the withholding", () => {
    for (let total = 1; total <= 5000; total += 13.37) {
      const t = round2(total);
      for (const rate of [3, 10, 17.5, 30, 35, 50]) {
        const w = suggestedWithholding(t, rate);
        const net = netAfterWithholding(t, w);
        // total = net + withheld, exactly, at agora precision
        expect(round2(net + w)).toBe(t);
      }
    }
  });

  it("holds for a manually-typed (non-whole) override too", () => {
    expect(round2(netAfterWithholding(1234.56, 173.25) + 173.25)).toBe(1234.56);
  });

  it("kills float dust that a plain subtraction would leave", () => {
    // 1234.56 - 173 is 1061.5600000000002 in IEEE-754
    expect(netAfterWithholding(1234.56, 173)).toBe(1061.56);
    expect(netAfterWithholding(0.3, 0.1)).toBe(0.2);
  });

  it("treats a missing withholding amount as zero", () => {
    expect(netAfterWithholding(500, 0)).toBe(500);
    expect(netAfterWithholding(500, NaN)).toBe(500);
  });
});

describe("withholdingRateOnPanelOpen: the panel's fresh-open default", () => {
  it("fills in the standard 35% when the field is genuinely empty", () => {
    expect(withholdingRateOnPanelOpen("")).toBe("35");
    expect(withholdingRateOnPanelOpen("")).toBe(DEFAULT_WITHHOLDING_RATE_PERCENT);
  });

  it("treats whitespace-only input as empty too", () => {
    expect(withholdingRateOnPanelOpen("   ")).toBe("35");
  });

  it("never overwrites an existing rate - resumed draft, duplicate, or hand-typed", () => {
    expect(withholdingRateOnPanelOpen("20")).toBe("20");
    expect(withholdingRateOnPanelOpen("17.5")).toBe("17.5");
    expect(withholdingRateOnPanelOpen("0")).toBe("0");
  });
});
