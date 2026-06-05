// Shared types + helpers for the in-app notifications system.
// Producers (server: dunning cron / email tracking pixel / quote approve;
// client: bank-import matcher) write rows; consumers (bell dropdown +
// /notifications page) read.

export type NotificationKind =
  | "dunning_sent"
  | "invoice_viewed"
  | "payment_matched"
  | "quote_approved"
  | "ceiling_approaching"
  | "tax_token_expiring";

export interface NotificationRow {
  id: string;
  business_id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  document_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  documentId?: string;
  readAt?: string;
  createdAt: string;
}

export function mapNotificationRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body || undefined,
    href: row.href || undefined,
    documentId: row.document_id || undefined,
    readAt: row.read_at || undefined,
    createdAt: row.created_at,
  };
}

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  dunning_sent: "תזכורת תשלום נשלחה",
  invoice_viewed: "הלקוח פתח את החשבונית",
  payment_matched: "תשלום זוהה בבנק",
  quote_approved: "הצעת מחיר אושרה",
  ceiling_approaching: "מתקרבים לתקרת פטור",
  tax_token_expiring: "האישור לרשות המסים פג בקרוב",
};

/** Same-origin guard for href values stored in notifications. Same shape
 *  as the AI insights guard — never let a notification navigate off-site
 *  even if a producer was sloppy. */
const SAFE_HREF = /^\/(?!\/)[A-Za-z0-9_\-/?=&.%#]*$/;
export function isSafeHref(s: string | null | undefined): s is string {
  return typeof s === "string" && SAFE_HREF.test(s);
}
