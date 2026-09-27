// Mandatory pension, pension tax benefits and study fund (קרן השתלמות) for the
// Israeli self-employed. Pure figures and arithmetic, no React, so the
// /reports/pension page and the 31.12 filing reminder share one calculation.
//
// Figures verified 2026-09-27 against three sources that agree: the 2026
// ceilings table "טבלת תקרות וסכומים לשנת 2026", Bizportal 19.8.2026 and
// Pensuni 16.1.2026. When the next year's table is published, add a row to
// PENSION_FIGURES_BY_YEAR.
//
// The base is always the taxable profit (הכנסה חייבת = income minus
// expenses), never turnover.
//
// Spec: docs/superpowers/specs/2026-09-27-pension-calculator-design.md

import { roundShekelHalfUp } from "./ita/income-tax-advances";

export interface PensionFigures {
  year: number;
  /** השכר הממוצע במשק, monthly. */
  averageWageMonthly: number;
  /** % on profit up to half the yearly average wage. */
  pensionLowRate: number;
  /** % on profit between half and the full yearly average wage. */
  pensionHighRate: number;
  /** הכנסה מזכה for the pension tax benefits, yearly. */
  qualifyingIncome: number;
  /** ניכוי: % of the qualifying income. */
  deductionRate: number;
  /** זיכוי: applies to a deposit of up to this % of the qualifying income. */
  creditDepositRate: number;
  /** זיכוי: % of that deposit comes off the tax. */
  creditRate: number;
  /** Study fund income ceiling, yearly. */
  studyFundIncomeCeiling: number;
  /** Study fund deductible deposit: % of income up to the ceiling. */
  studyFundDeductionRate: number;
  /** Study fund deposit whose gains are exempt from capital-gains tax, yearly. */
  studyFundExemptDeposit: number;
}

export const PENSION_FIGURES_BY_YEAR: Record<number, PensionFigures> = {
  2026: {
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
  },
};

/** The newest table for a year <= `year`, else the newest table available. */
export function pensionFiguresFor(year: number): PensionFigures {
  const years = Object.keys(PENSION_FIGURES_BY_YEAR).map(Number).sort((a, b) => a - b);
  const atOrBefore = years.filter((y) => y <= year);
  const pick = atOrBefore.length > 0 ? atOrBefore[atOrBefore.length - 1] : years[years.length - 1];
  return PENSION_FIGURES_BY_YEAR[pick];
}

const pct = (base: number, rate: number) => (base * rate) / 100;

export interface MandatoryPension {
  halfAverageWage: number;
  fullAverageWage: number;
  /** min(profit, half). */
  lowBase: number;
  lowAmount: number;
  /** clamp(profit - half, 0, half). */
  highBase: number;
  highAmount: number;
  /** Whole shekels: lowAmount + highAmount, so the breakdown adds up. */
  total: number;
  /** Profit reached the full average wage: nothing more is mandatory above it. */
  capped: boolean;
  /** total / 12, half-up. */
  monthly: number;
}

export function mandatoryPension(taxableProfit: number, year: number): MandatoryPension {
  const f = pensionFiguresFor(year);
  const fullAverageWage = f.averageWageMonthly * 12;
  const halfAverageWage = fullAverageWage / 2;
  const profit = Number.isFinite(taxableProfit) ? taxableProfit : 0;
  if (profit <= 0) {
    return { halfAverageWage, fullAverageWage, lowBase: 0, lowAmount: 0, highBase: 0, highAmount: 0, total: 0, capped: false, monthly: 0 };
  }
  const lowBase = roundShekelHalfUp(Math.min(profit, halfAverageWage));
  const highBase = roundShekelHalfUp(Math.min(Math.max(profit - halfAverageWage, 0), halfAverageWage));
  const lowAmount = roundShekelHalfUp(pct(lowBase, f.pensionLowRate));
  const highAmount = roundShekelHalfUp(pct(highBase, f.pensionHighRate));
  const total = lowAmount + highAmount;
  return {
    halfAverageWage,
    fullAverageWage,
    lowBase,
    lowAmount,
    highBase,
    highAmount,
    total,
    capped: profit >= fullAverageWage,
    monthly: roundShekelHalfUp(total / 12),
  };
}

export interface PensionTaxBenefit {
  /** min(profit, qualifyingIncome), 0 when profit <= 0. */
  qualifyingBase: number;
  /** ניכוי: 11% of the base. */
  deductionDeposit: number;
  /** The deposit the זיכוי applies to: 5.5% of the base. */
  creditDeposit: number;
  /** The זיכוי itself: 35% of creditDeposit. */
  creditValue: number;
  /** deductionDeposit + creditDeposit (16.5% of the base). */
  optimalDeposit: number;
}

export function pensionTaxBenefit(taxableProfit: number, year: number): PensionTaxBenefit {
  const f = pensionFiguresFor(year);
  const profit = Number.isFinite(taxableProfit) ? taxableProfit : 0;
  const qualifyingBase = profit > 0 ? roundShekelHalfUp(Math.min(profit, f.qualifyingIncome)) : 0;
  const deductionDeposit = roundShekelHalfUp(pct(qualifyingBase, f.deductionRate));
  const creditDeposit = roundShekelHalfUp(pct(qualifyingBase, f.creditDepositRate));
  const creditValue = roundShekelHalfUp(pct(pct(qualifyingBase, f.creditDepositRate), f.creditRate));
  return { qualifyingBase, deductionDeposit, creditDeposit, creditValue, optimalDeposit: deductionDeposit + creditDeposit };
}

export interface StudyFund {
  /** min(profit, ceiling), 0 when profit <= 0. */
  incomeBase: number;
  /** 4.5% of the base, whole shekels rounded DOWN (the published cap is 13,202). */
  deductibleDeposit: number;
  /** The yearly capital-gains-exempt deposit, independent of income. */
  exemptDeposit: number;
}

export function studyFund(taxableProfit: number, year: number): StudyFund {
  const f = pensionFiguresFor(year);
  const profit = Number.isFinite(taxableProfit) ? taxableProfit : 0;
  const incomeBase = profit > 0 ? roundShekelHalfUp(Math.min(profit, f.studyFundIncomeCeiling)) : 0;
  // The tiny epsilon keeps an exact whole result (e.g. 4,500.0000001 or
  // 4,499.9999999 from binary floating point) from flooring a shekel low.
  const deductibleDeposit = Math.floor(pct(incomeBase, f.studyFundDeductionRate) + 1e-9);
  return { incomeBase, deductibleDeposit, exemptDeposit: f.studyFundExemptDeposit };
}

/** The mandatory deposit applies at 21 to 60 after at least six months registered. */
export function isObligated(args: { ageBetween21And60: boolean; sixMonthsRegistered: boolean }): boolean {
  return args.ageBetween21And60 && args.sixMonthsRegistered;
}
