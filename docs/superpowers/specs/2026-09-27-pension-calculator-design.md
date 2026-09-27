# Pension + study-fund calculator for the self-employed

Date: 2026-09-27. Approved by Asaf (full version: page + amount in the 31.12 reminder).
Step 2 of the BestOffice roadmap (step 1 shipped as fb001dd: filing reminders with amounts).

## Figures (verified 2026-09-27 against three sources that agree: the 2026 ceilings table
"טבלת תקרות וסכומים לשנת 2026", Bizportal 19.8.2026, Pensuni 16.1.2026)

| key | 2026 |
|---|---|
| averageWageMonthly | 13,769 |
| pension low rate (up to half the yearly average wage) | 4.45% |
| pension high rate (between half and the full yearly average wage) | 12.55% |
| qualifying income for pension tax benefits (הכנסה מזכה, yearly) | 232,800 |
| pension deduction (ניכוי) | 11% of qualifying income |
| pension credit (זיכוי) | 35% of a deposit of up to 5.5% of qualifying income |
| study fund income ceiling (yearly) | 293,397 |
| study fund deductible deposit | 4.5% of income up to the ceiling |
| study fund exempt deposit (yearly, capital-gains exemption) | 20,566 |

Half the yearly average wage = 13,769 x 12 / 2 = 82,614. Full = 165,228.
Mandatory maximum = 82,614 x 4.45% + 82,614 x 12.55% = 14,044 (whole shekels, half-up).
Obligated: self-employed aged 21 to 60, registered at least six months. Base = taxable profit
(הכנסה חייבת = income minus expenses), never turnover. Deadline 31 December. Fine about 500 after a warning.

## Non-goals

No new DB columns. No birth date or start date stored (the page asks two checkboxes; the reminder
states the condition in words). No employer/employee split (companies are out of scope, the
calendar already excludes pension_deposit for `company`). No marginal-tax "you save X" figure.

## 1. Pure module: `src/lib/pension.ts`

```ts
export interface PensionFigures {
  year: number;
  averageWageMonthly: number;
  pensionLowRate: number;      // 4.45
  pensionHighRate: number;     // 12.55
  qualifyingIncome: number;    // 232_800
  deductionRate: number;       // 11
  creditDepositRate: number;   // 5.5
  creditRate: number;          // 35
  studyFundIncomeCeiling: number; // 293_397
  studyFundDeductionRate: number; // 4.5
  studyFundExemptDeposit: number; // 20_566
}
export const PENSION_FIGURES_BY_YEAR: Record<number, PensionFigures>  // 2026 only
export function pensionFiguresFor(year: number): PensionFigures
// Same fallback rule as getExemptCeiling in src/lib/tax-thresholds.ts (read it): the newest year
// that is <= the requested year, else the newest year available.

export interface MandatoryPension {
  halfAverageWage: number;   // 82_614
  fullAverageWage: number;   // 165_228
  lowBase: number;           // min(profit, half)
  lowAmount: number;         // lowBase x 4.45%
  highBase: number;          // clamp(profit - half, 0, half)
  highAmount: number;        // highBase x 12.55%
  total: number;             // whole shekels, half-up (roundShekelHalfUp from ita/income-tax-advances)
  capped: boolean;           // profit >= fullAverageWage
  monthly: number;           // total / 12, half-up
}
export function mandatoryPension(taxableProfit: number, year: number): MandatoryPension
// profit <= 0 -> all zero.

export interface PensionTaxBenefit {
  qualifyingBase: number;   // min(profit, qualifyingIncome), 0 when profit <= 0
  deductionDeposit: number; // 11% of base
  creditDeposit: number;    // 5.5% of base
  creditValue: number;      // 35% of creditDeposit
  optimalDeposit: number;   // deductionDeposit + creditDeposit (16.5% of base)
}
export function pensionTaxBenefit(taxableProfit: number, year: number): PensionTaxBenefit

export interface StudyFund {
  incomeBase: number;      // min(profit, ceiling), 0 when profit <= 0
  deductibleDeposit: number; // 4.5% of base, whole shekels FLOOR (the published cap is 13,202)
  exemptDeposit: number;   // 20_566 (constant, independent of income)
}
export function studyFund(taxableProfit: number, year: number): StudyFund

export function isObligated(args: { ageBetween21And60: boolean; sixMonthsRegistered: boolean }): boolean
```

Rounding: every shekel figure via `roundShekelHalfUp` except the study-fund deductible (floor), so
the published caps (14,044 / 25,608 / 12,804 / 13,202) reproduce exactly. Add a test asserting each
published cap from a profit of 1,000,000.

## 2. Page: `src/app/(app)/reports/pension/page.tsx` ("פנסיה וקרן השתלמות")

Model the shell on `src/app/(app)/reports/tax-projection/page.tsx` (header with icon tile, back
link to /reports, the same loading/error/retry handling via `useDocuments`, `useExpenses`,
`useBusiness`, and the same disclaimer footer style). "use client".

- Year: the current tax year in Israel time (todayInIsrael). Show it in the header.
- Taxable profit input: `NumberInput` (src/components/number-input.tsx) prefilled with the
  projected annual profit = `projectAnnualTax(...)`'s projected income minus projected expenses if
  that is what ProjectionResult exposes; otherwise compute `yearToDateTaxBase` and multiply by the
  same projectionFactor tax-projection uses (read tax-projection.ts, reuse, do not duplicate the
  bracket logic). Under the input: "לפי ההכנסות וההוצאות באפליקציה, מוקרן לשנה מלאה. אפשר לשנות."
  A "חזרה לחישוב האוטומטי" text button appears when the value was edited.
- Two checkboxes, both checked by default: "אני בגיל 21 עד 60" and "אני רשום כעצמאי יותר מחצי שנה".
  If either is unchecked, the mandatory card says "לפי מה שסימנת, חובת ההפקדה לא חלה עליך השנה"
  and hides the amount; the tax-benefit and study-fund cards still show.
- Three cards, in this order, each with one big figure and a two-line explanation:
  1. "המינימום שחובה להפקיד עד 31.12" : total, then the breakdown lines
     "4.45% על {lowBase} = {lowAmount}" and (when highBase > 0) "12.55% על {highBase} = {highAmount}",
     and when capped: "מעל {fullAverageWage} אין חובה להפקיד יותר." Also "בערך {monthly} בחודש".
  2. "כמה כדאי להפקיד בשביל הטבות המס" : optimalDeposit, lines "ניכוי מההכנסה על {deductionDeposit} (11%)"
     and "זיכוי ממס של {creditValue} על הפקדה של {creditDeposit} (5.5%)". Note when profit exceeds
     qualifyingIncome: "ההטבות מחושבות עד הכנסה של {qualifyingIncome}."
  3. "קרן השתלמות" : deductibleDeposit with "4.5% מההכנסה, מוכר כהוצאה" and a second figure
     exemptDeposit "עד {exemptDeposit} בשנה הרווחים פטורים ממס רווחי הון".
- Footer disclaimer: "הערכה לפי טבלת התקרות לשנת {year}. המינימום תלוי בהכנסה החייבת בפועל בסוף
  השנה. לא ייעוץ פנסיוני או מס." plus a link to the obligations calendar.
- Money via `formatCurrencyWhole`. RTL, Heebo, existing `.rpt-*` / card classes. Mobile: cards stack.

## 3. Wiring

- `src/app/(app)/reports/page.tsx`: add a card after "צפי מס שנתי": icon `PiggyBank` (lucide),
  title "פנסיה וקרן השתלמות", href "/reports/pension", desc "כמה חובה להפקיד השנה, כמה כדאי בשביל
  הטבות המס, וכמה לקרן השתלמות." Only for businessType !== "company" (spread pattern already used).
- `src/lib/ita/filing-calendar.ts` pension_deposit: add `appHref: "/reports/pension"`,
  `appLabel: "לחישוב הסכום"`. Fix `who` to the verified rule: "כל עצמאי, עוסק פטור או עוסק מורשה,
  בגיל 21 עד 60 שרשום כעצמאי לפחות חצי שנה. בחברה ההפקדה נעשית דרך תלוש השכר." (drop the "נולד
  אחרי 1961" clause, it is not the current rule).

## 4. The 31.12 reminder carries the mandatory amount

Extend the amount-aware reminder shipped in fb001dd:
- `src/lib/filing-amounts.ts`: `periodOfOccurrence` unchanged (pension_deposit stays null).
  Add to `resolveReminderAmount` a `pension_deposit` branch: compute
  `yearToDateTaxBase(documents, expenses, year, business.businessType)` (from src/lib/tax-projection.ts)
  where year = the occurrence key suffix ("pension_deposit:2026"), profit = ytdIncome - ytdExpenses,
  then `mandatoryPension(profit, year)`. `total > 0` -> `{ status: "pay", amount: total, source: "pension",
  detail: "רווח חייב עד היום {formatCurrencyWhole(profit)}" }`; else `{ status: "zero", source: "pension" }`.
  Add "pension" to the `source` unions.
- `src/lib/filing-reminders-server.ts`: `needsRows` also true for `pension_deposit`, and the union
  range covers the whole year (1 Jan to 31 Dec of the key's year) for that item. Keep one load.
- `src/lib/filing-reminders.ts` reminderText: pay/pension body:
  "לפי הרווח החייב באפליקציה ({detail}), המינימום להפקדה הוא {amt} עד {D}. חל על עצמאי בגיל 21 עד 60
  שרשום יותר מחצי שנה. פירוט והטבות מס בדף פנסיה וקרן השתלמות." zero/pension body:
  "לפי הנתונים באפליקציה אין השנה רווח חייב, ולכן אין חובת הפקדה. אם יש הכנסות שלא באפליקציה, בדוק
  בדף פנסיה וקרן השתלמות." href for pension_deposit -> "/reports/pension".
- Tests: tests/filing-amounts.test.ts (pension pay / zero), tests/filing-reminders.test.ts (both
  bodies + href), tests/filing-reminders-server.test.ts (a pension reminder loads the full year range).

## 5. Tests

`tests/pension.test.ts`: figures fallback (2025 -> 2026 table, 2030 -> 2026), mandatoryPension at
0 / 50,000 / 82,614 / 120,000 / 165,228 / 1,000,000 (caps 14,044, capped flag, monthly), pensionTaxBenefit
caps (25,608 / 12,804 / credit 4,481 / optimal 38,412), studyFund caps (13,202 / 20,566), isObligated.

## 6. Verification (owner: main session)

vitest green, `npx next build` exit 0, screenshots of /reports/pension at desktop and mobile as the
QA user (read the PNGs), council (architect + GPT), commit, push main + master, verify the canonical
domain serves "פנסיה וקרן השתלמות".
