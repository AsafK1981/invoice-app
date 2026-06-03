// Israeli self-employed (עוסק) yearly tax projection.
//
// Estimates the year-end tax + ביטוח לאומי + דמי בריאות bill based on
// year-to-date income and expenses, projecting linearly through year-end.
// The goal isn't accountant-grade precision — it's "don't get blindsided
// in January by a 20K bill you didn't put aside." Disclaimer surfaces in
// the UI: this is an estimate, not tax advice.
//
// Numbers updated for 2026. When brackets / BL rates change for 2027,
// add a new constant + branch on year. Sources:
//   - 2026 income tax brackets: סעיף 121 לפקודת מס הכנסה
//     https://taxsummaries.pwc.com/israel/individual/taxes-on-personal-income
//   - 2026 BL rates: btl.gov.il (Self_Employed/rates page)

// Annual income-tax brackets for 2026, in ILS. Each tuple: [upperBound, rate].
// The last entry uses Infinity to catch everything above 721,560.
// Note: the 50% top bracket is actually 47% income tax + 3% מס יסף surtax;
// for projection purposes we combine them, since both hit the same income.
const TAX_BRACKETS_2026: ReadonlyArray<[number, number]> = [
  [84_120, 0.10],
  [120_720, 0.14],
  [193_800, 0.20],
  [269_280, 0.31],
  [560_280, 0.35],
  [721_560, 0.47],
  [Infinity, 0.50],
];

// Bituach Leumi + דמי בריאות 2026 — combined rates for self-employed
// aged 18–retirement.
const BL_MONTHLY_THRESHOLD_2026 = 7_703; // ₪/month — below = low band, above = high band
const BL_RATE_LOW_2026 = 0.077; // 4.47% NI + 3.23% health
const BL_RATE_HIGH_2026 = 0.18; // 12.83% NI + 5.17% health
const BL_MONTHLY_CAP_2026 = 51_910; // monthly income above this isn't charged BL

// Tax credit point (נקודת זיכוי) value for 2026.
// 2.25 points = baseline IL resident male over 18.
// 2.75 points for a resident woman. Parents get more per child.
const TAX_CREDIT_POINT_VALUE_2026 = 242 * 12; // ≈ 2,904 ₪/year per point
const DEFAULT_TAX_CREDIT_POINTS = 2.25;

export interface ProjectionInputs {
  /** YTD revenue — sum of paid income through today. */
  ytdIncome: number;
  /** YTD deductible expenses. */
  ytdExpenses: number;
  /** Days elapsed in the year so far. */
  daysElapsed: number;
  /** Days in the full calendar year (365/366). */
  daysInYear: number;
  /** User's personal tax credit points (default 2.25). */
  taxCreditPoints?: number;
}

export interface ProjectionResult {
  projectedIncome: number;
  projectedExpenses: number;
  projectedProfit: number;

  /** מס הכנסה — annual income tax after applying credit points. */
  incomeTax: number;
  /** ביטוח לאומי + דמי בריאות annual liability. */
  bituachLeumi: number;
  /** Total combined annual tax liability. */
  totalTax: number;

  /** Effective rate on projected profit. */
  effectiveRate: number;
  /** Recommended % of EACH paid invoice to set aside for tax. */
  setAsidePct: number;
  /** Months remaining in the calendar year (for monthly reserve). */
  monthsRemaining: number;
  /** Recommended monthly reserve from today through year-end. */
  monthlyReserve: number;
}

/** Apply progressive brackets to a yearly amount. Returns the tax. */
export function computeIncomeTax(
  taxableIncome: number,
  brackets: ReadonlyArray<[number, number]> = TAX_BRACKETS_2026,
): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  let last = 0;
  for (const [upper, rate] of brackets) {
    const slice = Math.min(taxableIncome, upper) - last;
    if (slice > 0) tax += slice * rate;
    last = upper;
    if (taxableIncome <= upper) break;
  }
  return tax;
}

/** Compute annual Bituach Leumi + דמי בריאות liability for self-employed. */
export function computeBituachLeumi(annualProfit: number): number {
  if (annualProfit <= 0) return 0;
  // BL is charged monthly but on annual income / 12 buckets. Closest
  // approximation: convert to monthly profit, apply tiered rates, then
  // multiply by 12.
  const monthly = Math.min(annualProfit / 12, BL_MONTHLY_CAP_2026);
  const lowBand = Math.min(monthly, BL_MONTHLY_THRESHOLD_2026);
  const highBand = Math.max(0, monthly - BL_MONTHLY_THRESHOLD_2026);
  const monthlyBl = lowBand * BL_RATE_LOW_2026 + highBand * BL_RATE_HIGH_2026;
  return monthlyBl * 12;
}

/**
 * Project the year-end tax liability based on YTD income/expenses.
 * Uses linear projection — naive but matches what most accountants
 * eyeball. When days elapsed is very small (< 30) the projection is
 * unstable; UI should warn the user in that case.
 */
export function projectAnnualTax(inputs: ProjectionInputs): ProjectionResult {
  const {
    ytdIncome,
    ytdExpenses,
    daysElapsed,
    daysInYear,
    taxCreditPoints = DEFAULT_TAX_CREDIT_POINTS,
  } = inputs;

  const safeDaysElapsed = Math.max(1, daysElapsed);
  const projectionFactor = daysInYear / safeDaysElapsed;

  const projectedIncome = ytdIncome * projectionFactor;
  const projectedExpenses = ytdExpenses * projectionFactor;
  const projectedProfit = Math.max(0, projectedIncome - projectedExpenses);

  const rawIncomeTax = computeIncomeTax(projectedProfit);
  const creditReduction = taxCreditPoints * TAX_CREDIT_POINT_VALUE_2026;
  const incomeTax = Math.max(0, rawIncomeTax - creditReduction);

  const bituachLeumi = computeBituachLeumi(projectedProfit);
  const totalTax = incomeTax + bituachLeumi;

  const effectiveRate = projectedProfit > 0 ? totalTax / projectedProfit : 0;
  const setAsidePct = projectedIncome > 0 ? totalTax / projectedIncome : 0;

  const monthsRemaining = Math.max(0.5, (daysInYear - daysElapsed) / 30.4);
  // Subtract money already conceptually owed against YTD profit, since
  // YTD profit already incurred tax that should have been set aside.
  // Simpler heuristic: total / (12 - months passed), so the monthly
  // reserve evens out over the year.
  const monthlyReserve = monthsRemaining > 0.5
    ? Math.max(0, totalTax * (monthsRemaining / 12))
    : totalTax;

  return {
    projectedIncome,
    projectedExpenses,
    projectedProfit,
    incomeTax,
    bituachLeumi,
    totalTax,
    effectiveRate,
    setAsidePct,
    monthsRemaining,
    monthlyReserve: monthlyReserve / Math.max(1, monthsRemaining),
  };
}

export const TAX_BRACKETS_PUBLIC = TAX_BRACKETS_2026;
export const TAX_CREDIT_DEFAULT_POINTS = DEFAULT_TAX_CREDIT_POINTS;
export const TAX_CREDIT_POINT_VALUE = TAX_CREDIT_POINT_VALUE_2026;
