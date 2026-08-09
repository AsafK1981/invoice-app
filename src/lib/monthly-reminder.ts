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
  /** Hebrew month + year label, e.g. "אוגוסט 2026". */
  periodLabel: string;
  documentsThisMonthCount: number;
  /** Open quotes (הצעת מחיר) and proformas (חשבון עסקה) not yet converted to a receipt/invoice. */
  openItems: OpenItem[];
  /** Clients who had a document last month but none this month (retainer case). */
  missingRetainerClients: string[];
  /** Count-only, no per-document detail - dunning already emails those individually. */
  unpaidCount: number;
}

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

/**
 * Builds the monthly reminder content for one business, or returns null when
 * there is nothing worth emailing about.
 *
 * Skip rule: if the business already issued at least one document this
 * calendar month AND there are no open quotes/proformas AND no retainer
 * client went quiet, there's nothing to nudge about - return null so the
 * caller doesn't send a "well done" email nobody asked for.
 */
export function buildMonthlyReminder(
  documents: MonthlyReminderDoc[],
  now: Date,
): MonthlyReminderSummary | null {
  const thisMonth = monthKey(toIsraelDate(now));
  const lastMonth = previousMonthKey(thisMonth);

  const docsThisMonth = documents.filter(
    (d) => d.status !== "cancelled" && d.status !== "draft" && monthKey(d.date) === thisMonth,
  );
  const docsLastMonth = documents.filter(
    (d) => d.status !== "cancelled" && d.status !== "draft" && monthKey(d.date) === lastMonth,
  );

  const openItems: OpenItem[] = documents
    .filter(
      (d) =>
        (d.type === "quote" || d.type === "proforma") &&
        !d.convertedToId &&
        d.status !== "cancelled",
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

  const unpaidCount = documents.filter(
    (d) =>
      (d.type === "quote" || d.type === "proforma" || d.type === "tax_invoice") &&
      d.status === "sent" &&
      !d.paidAt,
  ).length;

  const issuedThisMonth = docsThisMonth.length > 0;
  if (issuedThisMonth && openItems.length === 0 && missingRetainerClients.length === 0) {
    return null;
  }

  const periodLabel = now.toLocaleDateString("he-IL", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  });

  return {
    periodLabel,
    documentsThisMonthCount: docsThisMonth.length,
    openItems,
    missingRetainerClients,
    unpaidCount,
  };
}
