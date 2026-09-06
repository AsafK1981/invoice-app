"use client";

import { useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { onBusinessReady } from "./business-init";
import { createSharedStore } from "./shared-store";

/**
 * Client half of "הוצאות מהמייל".
 *
 * The pending queue lives in `email_inbox_items`, a table with RLS enabled
 * and ZERO policies (service role only), so the browser cannot read it with
 * the Supabase client the way it reads expenses. Everything here goes through
 * `/api/email-inbox`, which checks the caller's session and scopes every
 * query to their business.
 *
 * One module-level shared store backs BOTH consumers - the settings card and
 * the /expenses queue - so opening a page that shows both costs one request,
 * and approving an item on one surface updates the other.
 */

export type EmailInboxReason =
  | "no_attachment"
  | "too_large"
  | "quota"
  | "not_expense"
  | "unreadable"
  | "rate_limited"
  | "download_failed"
  | "duplicate"
  | "too_many"
  | "gmail_verification"
  | "error";

/** Hebrew explanation shown on a failed item. Unknown reasons fall back to
 *  the generic one rather than rendering an English enum at the user. */
export const EMAIL_INBOX_REASON_TEXT: Record<EmailInboxReason, string> = {
  no_attachment: "לא נמצא קובץ PDF או תמונה במייל",
  too_large: "הקובץ גדול מדי",
  quota: "הגעתם למכסת הסריקות החודשית",
  not_expense: "הקובץ לא נראה כמו חשבונית או קבלה",
  unreadable: "לא הצלחנו לקרוא את הקובץ",
  rate_limited: "יותר מדי מיילים בשעה האחרונה",
  download_failed: "ההורדה מ-Resend נכשלה, נסו להעביר שוב",
  duplicate: "הקובץ הזה כבר נמצא בהוצאות או ממתין לאישור",
  too_many: "יותר מ-5 קבצים במייל אחד, הועברו רק החמישה הראשונים",
  gmail_verification: "אימות העברה מ-Gmail",
  error: "שגיאה בעיבוד",
};

export function reasonText(reason: string | null | undefined): string {
  if (reason && reason in EMAIL_INBOX_REASON_TEXT) {
    return EMAIL_INBOX_REASON_TEXT[reason as EmailInboxReason];
  }
  return EMAIL_INBOX_REASON_TEXT.error;
}

export type EmailInboxScan = {
  vendor?: string | null;
  amount?: number | null;
  vatAmount?: number | null;
  /** YYYY-MM-DD */
  date?: string | null;
  category?: string | null;
  description?: string | null;
  /** Hebrew field names the scanner could not read with confidence. */
  unreadFields?: string[] | null;
  documentKind?: string | null;
};

export type EmailInboxItem = {
  id: string;
  from: string | null;
  subject: string | null;
  receivedAt: string;
  attachmentName: string | null;
  receiptPath: string | null;
  status: "pending" | "failed" | "approved" | "rejected";
  reason?: EmailInboxReason | string | null;
  /** Extra context for a failed item. For `gmail_verification` this is the
   *  confirmation link Gmail put in the mail, when one was found. */
  detail?: string | null;
  scan?: EmailInboxScan | null;
};

/** The payload `/api/email-inbox/items/<id>` accepts on approve. */
export type EmailInboxApproval = {
  date: string;
  category: string;
  supplier: string;
  amount: number;
  vatAmount: number;
  description?: string;
  supplierTaxId?: string;
  reference?: string;
  isEquipment?: boolean;
  /** מספר הקצאה printed on the SUPPLIER's invoice (חשבונית ישראל). */
  allocationNumber?: string;
};

export type EmailInboxSnapshot = {
  enabled: boolean;
  address: string | null;
  /** Everything the queue shows: pending items plus recent failures. */
  items: EmailInboxItem[];
  /**
   * The endpoint answered. False while loading and after any failure, which
   * is what hides the settings card instead of showing a half-broken switch -
   * the same posture WhatsAppSection takes when no bot number is configured.
   */
  available: boolean;
};

const EMPTY: EmailInboxSnapshot = {
  enabled: false,
  address: null,
  items: [],
  available: false,
};

/** Same event name expense-store.ts listens on, so approving an item makes
 *  the expenses table refetch without reaching into that module. */
const EXPENSES_CHANGED = "invoice-app:expenses-changed";

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("ההתחברות שלך פגה. רענן את הדף ונסה שוב.");
  return { Authorization: `Bearer ${session.access_token}` };
}

async function fetchInbox(): Promise<EmailInboxSnapshot | undefined> {
  try {
    const res = await fetch("/api/email-inbox", { headers: await authHeader() });
    if (!res.ok) return EMPTY;
    const data = (await res.json()) as {
      enabled?: boolean;
      address?: string | null;
      /** pending + recent failed, newest first. */
      items?: EmailInboxItem[];
      /** pending only. Read as a fallback so an older server still works. */
      pending?: EmailInboxItem[];
    };
    const list = Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.pending)
        ? data.pending
        : [];
    return {
      enabled: Boolean(data.enabled),
      address: data.address ?? null,
      items: list,
      available: true,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * How often an open, visible tab re-reads the queue. The Gmail forwarding
 * code is the case that matters: the user has Gmail on one screen and the
 * app on another, clicks "add forwarding address", and looks straight at the
 * app. The tab never went hidden, so a visibility listener alone showed
 * nothing until a manual refresh (Asaf, 2026-09-06). Fifteen seconds is well
 * inside Gmail's patience and costs one small authenticated GET per tick.
 */
const POLL_MS = 15_000;

const inboxStore = createSharedStore<EmailInboxSnapshot>(fetchInbox, EMPTY, (refetch) => {
  onBusinessReady(() => void refetch());
  // Re-read the moment the user comes back to this tab or window...
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refetch();
  });
  window.addEventListener("focus", () => void refetch());
  // ...and keep a visible tab current on its own, so a code or an invoice
  // that lands while the page is already on screen shows up by itself.
  setInterval(() => {
    if (document.visibilityState === "visible") void refetch();
  }, POLL_MS);
});

export function useEmailInbox() {
  const snapshot = useSyncExternalStore(
    inboxStore.subscribe,
    inboxStore.getSnapshot,
    inboxStore.getServerSnapshot,
  );
  return { ...snapshot.data, ready: snapshot.ready };
}

export function refreshEmailInbox() {
  return inboxStore.refetch();
}

/** Turn the address on, off, or mint a fresh one. */
export async function setEmailInboxState(
  action: "enable" | "disable" | "rotate",
): Promise<{ enabled: boolean; address: string | null }> {
  const res = await fetch("/api/email-inbox", {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "הפעולה נכשלה.");
  await inboxStore.refetch();
  return { enabled: Boolean(data.enabled), address: data.address ?? null };
}

export class InboxItemGoneError extends Error {}

/**
 * Approve a pending item with the values the owner actually confirmed.
 *
 * A 409 means the item was already turned into an expense (a second tab, a
 * double click). That is not an error to shout about - the queue just needs
 * to catch up - so it surfaces as its own type and the caller drops the card.
 */
export async function approveEmailInboxItem(id: string, expense: EmailInboxApproval): Promise<void> {
  const res = await fetch(`/api/email-inbox/items/${id}`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "approve", expense }),
  });
  if (res.status === 409 || res.status === 404) {
    await inboxStore.refetch();
    window.dispatchEvent(new Event(EXPENSES_CHANGED));
    throw new InboxItemGoneError("הפריט כבר טופל.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "האישור נכשל.");
  }
  window.dispatchEvent(new Event(EXPENSES_CHANGED));
  await inboxStore.refetch();
}

export async function rejectEmailInboxItem(id: string): Promise<void> {
  const res = await fetch(`/api/email-inbox/items/${id}`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reject" }),
  });
  if (!res.ok && res.status !== 409 && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "הדחייה נכשלה.");
  }
  await inboxStore.refetch();
}

/**
 * Gmail's forwarding confirmation carries the code in the SUBJECT, e.g.
 * "(#123456789) Gmail Forwarding Confirmation - Receive Mail from ...".
 * Pulling it out here means the owner never has to open the raw mail.
 */
export function gmailVerificationCode(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const m = subject.match(/#?(\d{6,})/);
  return m ? m[1] : null;
}
