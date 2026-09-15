/**
 * The one income rule every income figure in the app uses.
 *
 * Income = countable revenue documents (receipt / tax_invoice /
 * tax_invoice_receipt, not a converted source) that are paid, MINUS credit
 * notes. A credit note is stored negative and saved as "sent", never "paid",
 * so it counts by its issue date whatever its status (drafts and cancelled
 * documents never count). Sum amounts as `totalIls ?? total` (or the
 * matching `*Ils ?? native` field).
 *
 * The rule already lives in `countsForTurnover` (the מקדמות report and the
 * admin stats use it). This re-export gives screens that are not about tax a
 * name that says what they are asking, without a second copy that can drift:
 * before 2026-09-15 the dashboard, the reports overview and the annual
 * summary filtered `status === "paid" && isCountableRevenue(d)`, so a credit
 * note never subtracted there while /reports/profit-loss did subtract it.
 */
export { countsForTurnover as countsAsIncome } from "./ita/income-tax-advances";
