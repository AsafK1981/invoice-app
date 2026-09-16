/**
 * תנאי תשלום - what the owner and the client actually agreed on, as a rule
 * that turns an invoice date into the date the money is expected.
 *
 * The cash-flow forecast used to infer that timing from the client's own
 * payment history, and history cannot express the term Israeli freelancers
 * agree to most often: "שוטף + 30" means the END OF THE INVOICE MONTH plus 30
 * days, not the issue date plus 30. Two invoices from the same month, one on
 * the 1st and one on the 28th, fall due on the SAME day under that term - a
 * single median number of days can never say that. A brand new client has no
 * history at all, and the agreed terms are known from the first document.
 *
 * Pure string arithmetic on YYYY-MM-DD, no clock and no Date in the output,
 * so the forecast, the tests and anything else that dates money agree exactly.
 */

import { addDays, daysInclusive } from "./report-period";
import { singleMonthRange } from "./ita/vat-periods";

export type PaymentTerms =
  | "immediate"   // מיידי
  | "net_15" | "net_30" | "net_45" | "net_60"  // N days from the invoice date
  | "eom"         // שוטף - end of the invoice month
  | "eom_30" | "eom_60" | "eom_90";            // שוטף + N

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  immediate: "מיידי",
  net_15: "15 יום מהחשבונית",
  net_30: "30 יום מהחשבונית",
  net_45: "45 יום מהחשבונית",
  net_60: "60 יום מהחשבונית",
  eom: "שוטף",
  eom_30: "שוטף + 30",
  eom_60: "שוטף + 60",
  eom_90: "שוטף + 90",
};

/**
 * The order the select offers them in. The שוטף family comes first: it is what
 * Israeli freelancers actually sign, and "N יום מהחשבונית" is the exception.
 */
export const PAYMENT_TERMS_ORDER: PaymentTerms[] = [
  "immediate",
  "eom",
  "eom_30",
  "eom_60",
  "eom_90",
  "net_15",
  "net_30",
  "net_45",
  "net_60",
];

/** Runtime guard for a value off a DB row or a form. */
export function isPaymentTerms(value: unknown): value is PaymentTerms {
  // hasOwnProperty, not `in`: "toString" is in every object's prototype chain.
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PAYMENT_TERMS_LABELS, value);
}

/** Days added after the anchor date, per code. */
const NET_DAYS: Partial<Record<PaymentTerms, number>> = {
  net_15: 15,
  net_30: 30,
  net_45: 45,
  net_60: 60,
  eom_30: 30,
  eom_60: 60,
  eom_90: 90,
};

/**
 * The last calendar day of the month `iso` falls in, through the same helper
 * the VAT reports use, so February and leap years are right in one place only.
 */
function endOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return singleMonthRange(new Date(y, m - 1, 1), 0).end;
}

/** The date a document issued on `issueDate` is expected to be paid. */
export function dueDateFor(issueDate: string, terms: PaymentTerms): string {
  if (terms === "immediate") return issueDate;
  const days = NET_DAYS[terms] ?? 0;
  // שוטף counts from the end of the invoice month; net_N counts from the
  // invoice itself. That difference is the whole point of this module.
  const anchor = terms.startsWith("eom") ? endOfMonth(issueDate) : issueDate;
  return days === 0 ? anchor : addDays(anchor, days);
}

/** Whole days from the issue date to the expected payment date. */
export function daysToPayFor(issueDate: string, terms: PaymentTerms): number {
  return daysInclusive(issueDate, dueDateFor(issueDate, terms)) - 1;
}
