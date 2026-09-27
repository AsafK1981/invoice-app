import { describe, it, expect } from "vitest";
import {
  PENSION_FIGURES_BY_YEAR,
  isObligated,
  mandatoryPension,
  pensionFiguresFor,
  pensionTaxBenefit,
  studyFund,
} from "@/lib/pension";

describe("pensionFiguresFor", () => {
  it("uses the 2026 table for 2026, for an earlier year and for a later one", () => {
    expect(pensionFiguresFor(2026).year).toBe(2026);
    expect(pensionFiguresFor(2025).year).toBe(2026);
    expect(pensionFiguresFor(2030).year).toBe(2026);
  });

  it("picks the newest table at or before the year once there are several", () => {
    PENSION_FIGURES_BY_YEAR[2028] = { ...PENSION_FIGURES_BY_YEAR[2026], year: 2028 };
    try {
      expect(pensionFiguresFor(2027).year).toBe(2026);
      expect(pensionFiguresFor(2028).year).toBe(2028);
      expect(pensionFiguresFor(2030).year).toBe(2028);
      expect(pensionFiguresFor(2020).year).toBe(2028);
    } finally {
      delete PENSION_FIGURES_BY_YEAR[2028];
    }
  });

  it("holds the verified 2026 figures", () => {
    expect(pensionFiguresFor(2026)).toEqual({
      year: 2026,
      averageWageMonthly: 13_769,
      pensionLowRate: 4.45,
      pensionHighRate: 12.55,
      qualifyingIncome: 232_800,
      deductionRate: 11,
      creditDepositRate: 5.5,
      creditRate: 35,
      studyFundIncomeCeiling: 293_397,
      studyFundDeductionRate: 4.5,
      studyFundExemptDeposit: 20_566,
    });
  });
});

describe("mandatoryPension", () => {
  it("is all zero with no profit, or a loss", () => {
    for (const profit of [0, -5_000, NaN]) {
      const m = mandatoryPension(profit, 2026);
      expect(m).toMatchObject({ lowBase: 0, lowAmount: 0, highBase: 0, highAmount: 0, total: 0, capped: false, monthly: 0 });
      expect(m.halfAverageWage).toBe(82_614);
      expect(m.fullAverageWage).toBe(165_228);
    }
  });

  it("charges only the low rate up to half the average wage", () => {
    expect(mandatoryPension(50_000, 2026)).toEqual({
      halfAverageWage: 82_614, fullAverageWage: 165_228,
      lowBase: 50_000, lowAmount: 2_225, highBase: 0, highAmount: 0, total: 2_225, capped: false, monthly: 185,
    });
    expect(mandatoryPension(82_614, 2026)).toMatchObject({ lowBase: 82_614, lowAmount: 3_676, highBase: 0, total: 3_676, capped: false, monthly: 306 });
  });

  it("adds the high rate between half and the full average wage", () => {
    // 37,386 x 12.55% = 4,691.94
    expect(mandatoryPension(120_000, 2026)).toMatchObject({ lowBase: 82_614, lowAmount: 3_676, highBase: 37_386, highAmount: 4_692, total: 8_368, capped: false, monthly: 697 });
  });

  it("stops at the published maximum of 14,044 from the full average wage up", () => {
    for (const profit of [165_228, 1_000_000]) {
      expect(mandatoryPension(profit, 2026)).toMatchObject({ lowAmount: 3_676, highBase: 82_614, highAmount: 10_368, total: 14_044, capped: true, monthly: 1_170 });
    }
    expect(mandatoryPension(165_227, 2026).capped).toBe(false);
  });

  it("the breakdown always adds up to the total", () => {
    for (const profit of [1, 12_345.67, 99_999.5, 150_000.49]) {
      const m = mandatoryPension(profit, 2026);
      expect(m.lowAmount + m.highAmount).toBe(m.total);
      expect(Number.isInteger(m.total)).toBe(true);
    }
  });
});

describe("pensionTaxBenefit", () => {
  it("reproduces the published caps from a profit of 1,000,000", () => {
    expect(pensionTaxBenefit(1_000_000, 2026)).toEqual({
      qualifyingBase: 232_800,
      deductionDeposit: 25_608,
      creditDeposit: 12_804,
      creditValue: 4_481,
      optimalDeposit: 38_412,
    });
  });

  it("follows the profit below the qualifying income", () => {
    expect(pensionTaxBenefit(100_000, 2026)).toEqual({ qualifyingBase: 100_000, deductionDeposit: 11_000, creditDeposit: 5_500, creditValue: 1_925, optimalDeposit: 16_500 });
  });

  it("is zero with no profit", () => {
    expect(pensionTaxBenefit(-1, 2026)).toEqual({ qualifyingBase: 0, deductionDeposit: 0, creditDeposit: 0, creditValue: 0, optimalDeposit: 0 });
  });
});

describe("studyFund", () => {
  it("reproduces the published caps from a profit of 1,000,000 (the deductible rounds down)", () => {
    expect(studyFund(1_000_000, 2026)).toEqual({ incomeBase: 293_397, deductibleDeposit: 13_202, exemptDeposit: 20_566 });
  });

  it("is 4.5% of a lower profit, with the exempt deposit unchanged", () => {
    expect(studyFund(100_000, 2026)).toEqual({ incomeBase: 100_000, deductibleDeposit: 4_500, exemptDeposit: 20_566 });
    expect(studyFund(0, 2026)).toEqual({ incomeBase: 0, deductibleDeposit: 0, exemptDeposit: 20_566 });
  });
});

describe("isObligated", () => {
  it("needs both conditions", () => {
    expect(isObligated({ ageBetween21And60: true, sixMonthsRegistered: true })).toBe(true);
    expect(isObligated({ ageBetween21And60: false, sixMonthsRegistered: true })).toBe(false);
    expect(isObligated({ ageBetween21And60: true, sixMonthsRegistered: false })).toBe(false);
    expect(isObligated({ ageBetween21And60: false, sixMonthsRegistered: false })).toBe(false);
  });
});
