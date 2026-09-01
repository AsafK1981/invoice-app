import { describe, it, expect } from "vitest";
import {
  suggestedWithholding,
  netAfterWithholding,
  withholdingRateOnPanelOpen,
  DEFAULT_WITHHOLDING_RATE_PERCENT,
} from "@/lib/withholding";
import { round2 } from "@/lib/vat";

const netOf = (total: number, rate: number) =>
  netAfterWithholding(total, suggestedWithholding(total, rate));

describe("suggestedWithholding: whole-shekel withholding, whole-shekel net, both half-up", () => {
  it("turns the owner's 10,641.50 into 10,642 (the withholding absorbs the agorot)", () => {
    // 16,371.50 × 35% = 5,730.03 → 5,730 whole → net 10,641.50 → half-up 10,642
    expect(suggestedWithholding(16371.5, 35)).toBe(5729.5);
    expect(netOf(16371.5, 35)).toBe(10642);
  });

  it("rounds a net below .50 DOWN (half-up, not ceil)", () => {
    // 1234.56 × 35% = 432.10 → 432 → net 802.56 → 803 / 431.56
    expect(suggestedWithholding(1234.56, 35)).toBe(431.56);
    expect(netOf(1234.56, 35)).toBe(803);
    // 100.13 × 30% = 30.04 → 30 → net 70.13 → 70 / 30.13
    expect(suggestedWithholding(100.13, 30)).toBe(30.13);
    expect(netOf(100.13, 30)).toBe(70);
    // 1170.10 × 30% = 351.03 → 351 → net 819.10 → 819 / 351.10
    expect(suggestedWithholding(1170.1, 30)).toBe(351.1);
    expect(netOf(1170.1, 30)).toBe(819);
  });

  it("splits a whole-shekel total into two whole-shekel parts", () => {
    // 16,372 × 35% = 5,730.20 → 5,730 / 10,642
    expect(suggestedWithholding(16372, 35)).toBe(5730);
    expect(netOf(16372, 35)).toBe(10642);
    // 990 × 17.5% = 173.25 → 173 / 817
    expect(suggestedWithholding(990, 17.5)).toBe(173);
    expect(netOf(990, 17.5)).toBe(817);
    // 992 × 17.5% = 173.60 → 174 / 818
    expect(suggestedWithholding(992, 17.5)).toBe(174);
    // 1234 × 35% = 431.90 → 432 / 802
    expect(suggestedWithholding(1234, 35)).toBe(432);
    expect(netOf(1234, 35)).toBe(802);
  });

  it("rounds exactly .5 UP on the withholding (half-up, not banker's rounding)", () => {
    // 1000 × 17.25% = 172.5 → 173 / 827
    expect(suggestedWithholding(1000, 17.25)).toBe(173);
    // 351 × 50% = 175.5 → 176
    expect(suggestedWithholding(351, 50)).toBe(176);
    // 350.10 × 50% = 175.05 → 175 → net 175.10 → 175 / 175.10
    expect(suggestedWithholding(350.1, 50)).toBe(175.1);
    expect(netOf(350.1, 50)).toBe(175);
  });

  it("leaves an already-whole split alone", () => {
    expect(suggestedWithholding(1000, 35)).toBe(350);
    expect(suggestedWithholding(11700, 30)).toBe(3510);
    expect(suggestedWithholding(200, 50)).toBe(100);
    expect(suggestedWithholding(10000, 17.5)).toBe(1750);
  });

  it("survives float dust on a value that is mathematically x.5", () => {
    // 8.15 × 100 is 814.9999999999999 in IEEE-754: 1629 × 50% = 814.5 → 815
    expect(suggestedWithholding(1629, 50)).toBe(815);
    expect(suggestedWithholding(1631, 50)).toBe(816); // 815.5 → 816
    // 16.30 × 50% = 8.15 → 8 → net 8.30 → 8 / 8.30
    expect(suggestedWithholding(16.3, 50)).toBe(8.3);
    // 1.01 × 50% = 0.505 → 1 → net 0.01 → 0 → falls back to the raw product 0.51
    expect(suggestedWithholding(1.01, 50)).toBe(0.51);
  });

  it("falls back to the plain product when the whole-shekel withholding would be 0", () => {
    // 100 × 0.3% = 0.30 → whole 0 → net 100 = total → raw 0.30
    expect(suggestedWithholding(100, 0.3)).toBe(0.3);
    // 3 × 3% = 0.09 → raw
    expect(suggestedWithholding(3, 3)).toBe(0.09);
    // 2 × 35% = 0.70 → 1 / 1 (a whole-shekel split still exists)
    expect(suggestedWithholding(2, 35)).toBe(1);
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

  it("never shows agorot on the net, for any plausible total and rate", { timeout: 30_000 }, () => {
    for (let total = 40; total <= 20000; total += 37.13) {
      const t = round2(total);
      for (const rate of [3, 5, 10, 17.5, 20, 30, 35, 47, 50]) {
        const w = suggestedWithholding(t, rate);
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThan(t);
        expect(round2(w)).toBe(w);
        const net = netAfterWithholding(t, w);
        expect(Number.isInteger(net)).toBe(true);
        // two half-up roundings, each within half a shekel of the exact figure
        const exactNet = t - (t * rate) / 100;
        expect(Math.abs(net - exactNet)).toBeLessThanOrEqual(1);
        // a whole-shekel total always splits into two whole-shekel parts
        if (Number.isInteger(t)) expect(Number.isInteger(w)).toBe(true);
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
