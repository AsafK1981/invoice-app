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

const EOM_PLUS_DAYS = new Set([30, 45, 60, 90]);
const NET_PLUS_DAYS = new Set([15, 30, 45, 60]);

function normalizeTermsText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

const LABEL_TO_TERMS = new Map<string, PaymentTerms>(
  (Object.entries(PAYMENT_TERMS_LABELS) as [PaymentTerms, string][]).map(([code, label]) => [
    normalizeTermsText(label),
    code,
  ]),
);

/**
 * תנאי תשלום typed by a person into an imported file, read as one of our
 * codes. Recognises the codes themselves, the exact labels, and the common
 * ways Israelis write the same terms ("שוטף+30", "net 30", "45 ימים", "eom 60").
 * Anything else is undefined, never a guess: a wrong term dates money wrongly
 * on every future document, while a missing one only leaves the forecast on
 * the client's payment history. So "שוטף+120", "75 יום" and "חודשיים" are all
 * undefined, and so is a bare "30": in an Israeli file it means שוטף + 30 at
 * least as often as 30 days from the invoice, and the two fall due weeks
 * apart.
 */
export function parsePaymentTerms(text: unknown): PaymentTerms | undefined {
  if (typeof text !== "string") return undefined;
  const t = normalizeTermsText(text);
  if (!t) return undefined;
  if (isPaymentTerms(t)) return t;
  const byLabel = LABEL_TO_TERMS.get(t);
  if (byLabel) return byLabel;
  if (/^(מיידי|מידי|immediate|due on receipt)$/.test(t)) return "immediate";
  if (/^(שוטף|eom)$/.test(t)) return "eom";

  // A number with no leading zero: "030" is not something anyone means.
  const N = "([1-9]\\d*)";
  const eomPlus = t.match(new RegExp(`^(?:שוטף|eom)(?: ?\\+ ?| פלוס | )${N}$`));
  if (eomPlus) {
    const n = Number(eomPlus[1]);
    return EOM_PLUS_DAYS.has(n) ? (`eom_${n}` as PaymentTerms) : undefined;
  }
  const net =
    t.match(new RegExp(`^net ?${N}$`)) ??
    t.match(new RegExp(`^${N} (?:יום|ימים|days)$`));
  if (net) {
    const n = Number(net[1]);
    return NET_PLUS_DAYS.has(n) ? (`net_${n}` as PaymentTerms) : undefined;
  }
  return undefined;
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
