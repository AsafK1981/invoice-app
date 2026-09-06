# Cash-flow forecast report (deterministic, 3 months ahead) - design

Date: 2026-09-06. Approved by Asaf; open invoices are timed "לפי ההיסטוריה של הלקוח".

## Context

No cash-timing forecast exists; the closest are aging (`src/lib/aging.ts`) and the annual
tax projection. There is no due-date or payment-terms field anywhere, but `paidAt` exists,
recurring cadence detection exists (`src/lib/recurring-patterns.ts`), and מקדמות / VAT
periods have computable due dates. No LLM is involved.

## Pure module `src/lib/cash-flow-forecast.ts` (tested)

Input shape mirrors what both the client stores and the assistant route can supply:

```ts
interface ForecastInputs {
  documents: InvoiceDocument[];   // as from useDocuments()
  expenses: Expense[];
  business: { businessType; incomeTaxAdvanceRate? };
  today: string;                  // YYYY-MM-DD, Israel
  months?: number;                // default 3
}
interface ForecastLine {
  date: string; amount: number;   // positive inflow, negative outflow (credit notes are already negative)
  kind: "open_invoice" | "recurring_income" | "expenses_avg" | "income_tax_advance" | "vat";
  confidence: "certain" | "likely" | "estimate";
  label: string; href?: string; clientName?: string; documentId?: string;
}
interface ForecastMonth { period: "YYYY-MM"; label: string; inflow; outflow; net; lines: ForecastLine[] }
interface ForecastResult { months: ForecastMonth[]; potentialQuotes: { count; total }; totals: { inflow; outflow; net }; assumptions: string[] }
export function forecastCashFlow(inputs: ForecastInputs): ForecastResult;
export function expectedDaysToPay(clientKey, documents, fallback = 30): number; // median issue->paidAt
```

Rules:

- Open invoices: `status === "sent"` and type in `tax_invoice | proforma`, not converted.
  Expected pay date = `date + expectedDaysToPay(client)`, where days-to-pay is the median of
  `paidAt - date` over that client's paid revenue documents (use `resolveDocumentClientId`
  from `src/components/client-picker` for identity, as aging does). No history: 30 days.
  If the expected date is already past, place it in the current month. `confidence: certain`
  for the amount, dated by estimate; amount `totalIls ?? total`.
- Recurring income: `detectRecurringPatterns()` over the documents; each pattern becomes one
  `likely` line per forward month at `targetDate + days-to-pay(client)`, amount = sum of
  `items` qty × unitPrice (pattern has no total). Skip a period that
  `alreadyBilledForPeriod` says is billed (that money shows as an open invoice instead).
- Open quotes (`quote`, `sent`, not converted) are NOT in the totals; they are reported
  under `potentialQuotes` (count + total).
- Expenses: trailing-3-month average of `expense.amount` (plain sum as in
  `src/lib/expense-summary.ts`) posted on the 15th of each forward month, `estimate`.
- מקדמות: only when `incomeTaxAdvanceRate` is set. For each forward month, the advance for
  the previous month is due on the 15th (`advanceDueDate` in
  `src/lib/ita/income-tax-advances.ts`); amount = `computeAdvance(documents, singleMonthRange, rate).due`
  for a month that already happened, otherwise rate × that month's forecast inflow
  (pre-VAT approximation: divide by (1 + VAT rate) for authorized businesses). `estimate`.
- VAT: only for `authorized | company`. Bi-monthly periods from `src/lib/ita/vat-periods.ts`;
  net due = output VAT (tax_invoice, tax_invoice_receipt, credit_note, non-draft/cancelled,
  `vatIls ?? vat`) minus input VAT (`expense.vatAmount`), due on the 15th after the period
  end. Only periods whose due date falls in the window. `likely` when the period has ended,
  `estimate` when it is still running (extrapolate the running period from its actual
  figures so far). Never negative (a refund is shown as 0 with an assumption note).
- `assumptions` lists in Hebrew what was assumed (days-to-pay defaults used, missing advance
  rate, VAT extrapolation).

## Report page `src/app/(app)/reports/cash-flow/page.tsx`

- Thin page like `src/app/(app)/reports/aging/page.tsx`: `useDocuments`, `useExpenses`,
  `useBusiness`, loading guard, `<ReportPageHeader icon={TrendingUp} title="תחזית תזרים"
  subtitle="3 החודשים הקרובים, לפי מה שכבר ידוע" actions=... />`, then
  `<CashFlowForecast />` in `src/components/cash-flow-forecast.tsx`.
- Layout: three KPI tiles (צפוי להיכנס / צפוי לצאת / נטו) using the page-local `Kpi`
  pattern from `src/app/(app)/reports/page.tsx` (~L525-536); `<ReportsBarChart>` from
  `src/components/reports-bar-chart.tsx` with `income = inflow`, `expenses = outflow` per
  month; a table per month with the lines (date, label, client, kind chip, confidence chip,
  amount); a "פוטנציאל: N הצעות מחיר פתוחות בסך X" note; an "הנחות" footer listing
  `assumptions`. Money via `formatCurrency` (prefix rule), dates via `formatDate`.
- Actions: `<DownloadPdfButton filename="cash-flow-forecast.pdf" />` and an xlsx export via a
  new `exportCashFlowForecast(result)` in `src/lib/csv-export.ts` built on
  `src/lib/xlsx-export.ts` (`sheet({...})` with a sum total row). Controls carry `.no-print`.
- No PeriodPicker: the window is fixed at the next 3 months (YAGNI; the picker's modes are
  backward-looking).
- Register the card in `src/app/(app)/reports/page.tsx` `cards` array (~L216-264):
  icon `TrendingUp`, title "תחזית תזרים", desc "מה צפוי להיכנס ולצאת ב-3 החודשים הקרובים",
  href `/reports/cash-flow`.

## Assistant read tool

`get_cash_flow_forecast` in `TOOLS` (`src/app/api/assistant/route.ts` ~L354): no inputs;
handler selects the documents/expenses columns the module needs for this business,
maps to the client shapes (reuse `mapDocRow`-equivalent fields: date, type, status,
total, total_ils, subtotal, subtotal_ils, vat, vat_ils, client_id, client_name,
client_tax_id, paid_at, converted_to_id, items for recurring), runs `forecastCashFlow`, and
returns `asData({ months (without lines), totals, potentialQuotes, assumptions })`. Add the
routing hint in the SYSTEM prompt next to the income/expense hints (~L100-103):
"מה צפוי להיכנס החודש הבא / איך נראה התזרים" -> `get_cash_flow_forecast`.

## Verification

- `tests/cash-flow-forecast.test.ts`: days-to-pay median and fallback; open invoice past its
  expected date lands in the current month; recurring pattern projected 3 months and skipped
  when already billed; quotes excluded from totals but counted in potential; expenses
  average; advance only with a rate; VAT only for authorized, due-date placement, never
  negative; credit note reduces inflow (no double negation).
- `npx tsc --noEmit`, `npx vitest run` green.
- Screenshots of `/reports/cash-flow` at desktop and mobile (Vercel preview, Lynkeus QA
  user): chart legible, tables scroll inside their container on mobile, RTL intact, print
  preview fits (PDF download works).
- Assistant: "מה צפוי להיכנס בחודש הבא?" answers with the same net figure the page shows.
