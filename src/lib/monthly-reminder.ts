import { toIsraelDate } from "./date";

/**
 * Channel-agnostic input shape for the monthly reminder. Deliberately a
 * subset of InvoiceDocument (+ the couple of DB columns dunning already
 * reads) so callers can pass rows straight off `documents` without mapping.
 */
export interface MonthlyReminderDoc {
  id: string;
  type: "receipt" | "quote" | "proforma" | "tax_invoice" | "tax_invoice_receipt" | "credit_note";
  status: "draft" | "sent" | "paid" | "cancelled";
  /** `YYYY-MM-DD`, Israel-local (documents are always dated that way; see date.ts). */
  date: string;
  number: number;
  clientId?: string | null;
  clientName: string;
  /** Native-currency total. Already negative on credit notes - never renegate. */
  total: number;
  /** ILS-normalized total; prefer this over `total` when summing, per project convention. */
  totalIls?: number | null;
  /** Set once a quote/proforma has been converted into a receipt/tax invoice. */
  convertedToId?: string | null;
  paidAt?: string | null;
}

export interface OpenItem {
  id: string;
  type: MonthlyReminderDoc["type"];
  number: number;
  clientName: string;
  amount: number;
}

export interface MonthlyReminderSummary {
  /** Hebrew month + year label of the month being reported, e.g. "אוגוסט 2026". */
  periodLabel: string;
  /** Label of the month before it, for the "had a document then but not now" line. */
  previousPeriodLabel: string;
  /**
   * True on the first days of a month, when the report looks back at the
   * month that just ended instead of the one that only started.
   */
  reportsPreviousMonth: boolean;
  /** Documents issued in the reported month (drafts and cancelled excluded). */
  documentsThisMonthCount: number;
  /** Recent open quotes (הצעת מחיר) and proformas (חשבון עסקה) not yet converted. Drafts excluded. */
  openItems: OpenItem[];
  /** Clients who had a document in the month before but none in the reported month (retainer case). */
  missingRetainerClients: string[];
  /** Sent, unpaid payment requests (proforma / tax invoice). Count only - dunning emails those individually. */
  unpaidCount: number;
}

/**
 * Open quotes and proformas older than this stop being listed: a quote nobody
 * converted in two months is not a live to-do, and years-old ones meant the
 * "nothing to report" skip could never trigger.
 */
export const OPEN_ITEM_WINDOW_DAYS = 60;

/**
 * On days 1-3 the new month has barely begun, so "which regular clients have
 * no document this month" would list every one of them. On those days the
 * report covers the month that just ended.
 */
const LOOK_BACK_UNTIL_DAY = 3;

function money(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function monthKey(dateStr: string): string {
  // Documents are already stamped with an Israel-local YYYY-MM-DD (date.ts),
  // so a plain string slice is the calendar month - no Date parsing/TZ math.
  return dateStr.slice(0, 7);
}

/**
 * Given a `YYYY-MM` key, returns the previous calendar month's key, rolling
 * the year at January. Pure string/number arithmetic - deliberately not
 * `Date#setMonth`, which overflows on day-31 dates (e.g. Jul 31 minus one
 * month lands on Jul 3, not June).
 */
function previousMonthKey(monthStr: string): string {
  const [yearStr, monthNumStr] = monthStr.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthNumStr);
  const prevYear = monthNum === 1 ? year - 1 : year;
  const prevMonth = monthNum === 1 ? 12 : monthNum - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15, 12)).toLocaleDateString("he-IL", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  });
}

/** `YYYY-MM-DD` that is `days` calendar days before `dateStr`. */
function daysBefore(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * Builds the monthly reminder content for one business, or returns null when
 * there is nothing worth emailing about.
 *
 * Skip rule: if the business already issued at least one document in the
 * reported month AND there are no open quotes/proformas AND no retainer
 * client went quiet, there's nothing to nudge about - return null so the
 * caller doesn't send a "well done" email nobody asked for.
 */
export function buildMonthlyReminder(
  documents: MonthlyReminderDoc[],
  now: Date,
): MonthlyReminderSummary | null {
  const today = toIsraelDate(now);
  const reportsPreviousMonth = Number(today.slice(8, 10)) <= LOOK_BACK_UNTIL_DAY;
  const thisMonth = reportsPreviousMonth ? previousMonthKey(monthKey(today)) : monthKey(today);
  const lastMonth = previousMonthKey(thisMonth);
  const windowStart = daysBefore(today, OPEN_ITEM_WINDOW_DAYS);

  const issued = (d: MonthlyReminderDoc) => d.status !== "cancelled" && d.status !== "draft";
  const docsThisMonth = documents.filter((d) => issued(d) && monthKey(d.date) === thisMonth);
  const docsLastMonth = documents.filter((d) => issued(d) && monthKey(d.date) === lastMonth);

  const openItems: OpenItem[] = documents
    .filter(
      (d) =>
        (d.type === "quote" || d.type === "proforma") &&
        !d.convertedToId &&
        issued(d) &&
        d.date >= windowStart,
    )
    .map((d) => ({
      id: d.id,
      type: d.type,
      number: d.number,
      clientName: d.clientName,
      amount: money(d.totalIls ?? d.total),
    }));

  // Dedupe/match by clientId when available so two distinct clients sharing
  // a display name don't collide; fall back to the name itself for
  // documents with no linked client record.
  const clientKey = (d: MonthlyReminderDoc) => d.clientId ?? d.clientName;
  const clientsThisMonth = new Set(docsThisMonth.map(clientKey));
  const clientsLastMonthMap = new Map<string, string>();
  for (const d of docsLastMonth) {
    clientsLastMonthMap.set(clientKey(d), d.clientName);
  }
  const missingRetainerClients = [...clientsLastMonthMap.entries()]
    .filter(([key]) => !clientsThisMonth.has(key))
    .map(([, name]) => name);

  // A quote is an offer, not a payment request, so it is never "unpaid".
  const unpaidCount = documents.filter(
    (d) =>
      (d.type === "proforma" || d.type === "tax_invoice") &&
      d.status === "sent" &&
      !d.paidAt,
  ).length;

  const issuedThisMonth = docsThisMonth.length > 0;
  if (issuedThisMonth && openItems.length === 0 && missingRetainerClients.length === 0) {
    return null;
  }

  return {
    periodLabel: monthLabel(thisMonth),
    previousPeriodLabel: monthLabel(lastMonth),
    reportsPreviousMonth,
    documentsThisMonthCount: docsThisMonth.length,
    openItems,
    missingRetainerClients,
    unpaidCount,
  };
}

function whenPhrase(summary: MonthlyReminderSummary): string {
  return summary.reportsPreviousMonth ? `ב${summary.periodLabel}` : "החודש";
}

/** "החודש הוצאתם 3 מסמכים." / "החודש הוצאתם מסמך אחד." / "באוגוסט 2026 לא הוצאתם מסמכים." */
export function issuedSentence(summary: MonthlyReminderSummary): string {
  const when = whenPhrase(summary);
  const n = summary.documentsThisMonthCount;
  if (n === 0) return `${when} לא הוצאתם מסמכים.`;
  if (n === 1) return `${when} הוצאתם מסמך אחד.`;
  return `${when} הוצאתם ${n} מסמכים.`;
}

/** Heading for the retainer list, naming both months. */
export function missingRetainerHeading(summary: MonthlyReminderSummary): string {
  return `לקוחות שקיבלו מסמך ב${summary.previousPeriodLabel} אך לא ב${summary.periodLabel}:`;
}

/** "יש מסמך אחד שטרם שולם." / "יש 4 מסמכים שטרם שולמו." (empty string for zero). */
export function unpaidSentence(summary: MonthlyReminderSummary): string {
  const n = summary.unpaidCount;
  if (n <= 0) return "";
  return n === 1 ? "יש מסמך אחד שטרם שולם." : `יש ${n} מסמכים שטרם שולמו.`;
}

/** Short in-app notification body, e.g. "מסמך אחד החודש, 2 פתוחים." */
export function notificationBody(summary: MonthlyReminderSummary): string {
  const n = summary.documentsThisMonthCount;
  const docs = n === 1 ? "מסמך אחד" : `${n} מסמכים`;
  const open = summary.openItems.length;
  const openText = open === 1 ? "פתוח אחד" : `${open} פתוחים`;
  return `${docs} ${whenPhrase(summary)}, ${openText}.`;
}
