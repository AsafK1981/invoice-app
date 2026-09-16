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
import { allowsDueDate, type Client, type InvoiceDocument } from "./types";
import { resolveDocumentClientId } from "./client-picker";

export type PaymentTerms =
  | "immediate"   // מיידי
  | "net_15" | "net_30" | "net_45" | "net_60"  // N days from the invoice date
  | "eom"         // שוטף - end of the invoice month
  | "eom_30" | "eom_45" | "eom_60" | "eom_90"; // שוטף + N

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  immediate: "מיידי",
  net_15: "15 יום מהחשבונית",
  net_30: "30 יום מהחשבונית",
  net_45: "45 יום מהחשבונית",
  net_60: "60 יום מהחשבונית",
  eom: "שוטף",
  eom_30: "שוטף + 30",
  eom_45: "שוטף + 45",
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
  "eom_45",
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
  eom_45: 45,
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

/**
 * שוטף + 45: the payment period חוק מוסר תשלומים לספקים, סעיף 3(ז) applies
 * when a business customer and its supplier agreed on nothing. The editor
 * offers it as a one-click suggestion for a client without agreed terms; it
 * is never applied on its own.
 */
export const STATUTORY_DEFAULT_TERMS: PaymentTerms = "eom_45";

/** The date a document issued on `issueDate` is expected to be paid. */
export function dueDateFor(issueDate: string, terms: PaymentTerms): string {
  if (terms === "immediate") return issueDate;
  const days = NET_DAYS[terms] ?? 0;
  // שוטף counts from the end of the invoice month; net_N counts from the
  // invoice itself. That difference is the whole point of this module.
  const anchor = terms.startsWith("eom") ? endOfMonth(issueDate) : issueDate;
  return days === 0 ? anchor : addDays(anchor, days);
}

/**
 * Where a document editor's "לתשלום עד" value came from. "terms" (the
 * client's agreed terms) and "statutory" (the one-click שוטף + 45 suggestion)
 * are rules, so they follow the document date. "manual" is the user's own
 * value, a deliberately cleared field included, and is never overwritten.
 */
export type DueDateSource = "terms" | "statutory" | "manual";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The due date the editor should show after the document date or the client
 * changed. Agreed terms win over the statutory suggestion, because שוטף + 45
 * is only the default for when nothing was agreed. With neither, the field is
 * empty: a date nobody agreed to is never guessed onto a document.
 */
export function resolveEditorDueDate(input: {
  current: string;
  source: DueDateSource | null;
  issueDate: string;
  clientTerms?: PaymentTerms;
}): { dueDate: string; source: DueDateSource | null } {
  const { current, source, issueDate, clientTerms } = input;
  if (source === "manual") return { dueDate: current, source };
  // A half-typed document date is not a date to count from; leave it be.
  if (!ISO_DATE.test(issueDate)) return { dueDate: current, source };
  if (clientTerms) return { dueDate: dueDateFor(issueDate, clientTerms), source: "terms" };
  if (source === "statutory") {
    return { dueDate: dueDateFor(issueDate, STATUTORY_DEFAULT_TERMS), source };
  }
  return { dueDate: "", source: null };
}

/**
 * "לתשלום עד" for a document issued WITHOUT the editor (the recurring page,
 * an approved proposal card). Only a type that may state one, and only when
 * the document's client - resolved by the app-wide identity rule, so an
 * unlinked document naming a saved client counts - has agreed terms.
 *
 * No agreed terms means no date. The statutory שוטף + 45 is never applied
 * here: in the editor it is a suggestion a person accepts, and a one-click
 * issue has nobody to accept it.
 */
export function oneClickDueDate(
  doc: Pick<InvoiceDocument, "type" | "date" | "clientId" | "clientName" | "clientTaxId">,
  clients: Pick<Client, "id" | "name" | "taxId" | "paymentTerms">[],
): string | undefined {
  if (!allowsDueDate(doc.type) || !ISO_DATE.test(doc.date)) return undefined;
  const clientId = resolveDocumentClientId(doc, clients);
  const terms = clientId ? clients.find((c) => c.id === clientId)?.paymentTerms : undefined;
  return isPaymentTerms(terms) ? dueDateFor(doc.date, terms) : undefined;
}

/** Whole days from the issue date to the expected payment date. */
export function daysToPayFor(issueDate: string, terms: PaymentTerms): number {
  return daysInclusive(issueDate, dueDateFor(issueDate, terms)) - 1;
}
