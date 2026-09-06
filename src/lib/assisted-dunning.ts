// Assisted WhatsApp collections: the planning half of the daily pass that
// nudges the OWNER when an open receivable hits day 3 / 14 / 30.
//
// The app never messages the client here. It writes one notification per
// (document, stage) saying "a reminder is ready", the owner opens the
// document and sends it from their own WhatsApp with one tap. That is why
// the feature can default to on: nothing leaves the account without a tap.
//
// Kept pure (no Supabase, no clock beyond the `today` argument) so the whole
// decision - which documents, which stage, what was already prepared - is
// unit-testable; the route only feeds it rows and writes what comes back.

import { daysSinceIssue, dunningStageFor, type DunningStage } from "./dunning-copy";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "./types";
import { waDigits } from "./whatsapp-link";

/** `dunning_log.channel` value for a prepared-for-the-owner reminder. Email
 *  rows stay `"email"`, which is the column default, so the old
 *  one-email-per-(document, stage) semantics are untouched. */
export const WHATSAPP_ASSIST_CHANNEL = "whatsapp_assist";

/** Only real receivables get chased. A quote is not money owed yet. */
const RECEIVABLE_TYPES = new Set(["tax_invoice", "proforma"]);

export interface AssistedDocRow {
  id: string;
  client_id: string | null;
  client_name: string;
  number: number;
  date: string;
  total: number;
  type: string;
  status: string;
  paid_at: string | null;
  converted_to_id?: string | null;
}

export interface AssistedClientRow {
  id: string;
  phone?: string | null;
}

export interface AssistedLogRow {
  document_id: string;
  day_bucket: number;
  channel?: string | null;
}

export interface AssistedReminder {
  documentId: string;
  clientId: string;
  clientName: string;
  number: number;
  total: number;
  /** Normalised wa.me digits, so the caller never has to re-parse. */
  phone: string;
  stage: DunningStage;
  days: number;
  title: string;
  body: string;
  href: string;
}

/**
 * Decide which owner notifications the assisted pass should create today.
 *
 * Skips, in order: documents that are not open receivables (wrong type, not
 * `sent`, paid, already converted to a receipt), documents that have not
 * reached a stage yet, clients with no dialable phone (the owner could not
 * send anything anyway), and any (document, stage) already prepared once.
 */
export function planAssistedReminders(
  docs: AssistedDocRow[],
  clients: AssistedClientRow[],
  logRows: AssistedLogRow[],
  today: Date = new Date(),
): AssistedReminder[] {
  const phoneByClient = new Map<string, string>();
  for (const c of clients) {
    phoneByClient.set(c.id, waDigits(c.phone));
  }

  const alreadyPrepared = new Set(
    logRows
      .filter((l) => l.channel === WHATSAPP_ASSIST_CHANNEL)
      .map((l) => `${l.document_id}:${l.day_bucket}`),
  );

  const out: AssistedReminder[] = [];
  for (const doc of docs) {
    if (!RECEIVABLE_TYPES.has(doc.type)) continue;
    if (doc.status !== "sent") continue;
    if (doc.paid_at) continue;
    if (doc.converted_to_id) continue;
    if (!doc.client_id) continue;

    const days = daysSinceIssue(doc.date, today);
    const stage = dunningStageFor(days);
    if (!stage) continue;
    if (alreadyPrepared.has(`${doc.id}:${stage}`)) continue;

    const phone = phoneByClient.get(doc.client_id) || "";
    if (!phone) continue;

    out.push({
      documentId: doc.id,
      clientId: doc.client_id,
      clientName: doc.client_name,
      number: doc.number,
      total: doc.total,
      phone,
      stage,
      days,
      title: `${DOCUMENT_TYPE_LABELS[doc.type as DocumentType] || "מסמך"} #${doc.number} של ${doc.client_name}: ${days} ימים בלי תשלום`,
      body: "לחצו כדי לשלוח תזכורת בוואטסאפ מהמספר שלכם",
      href: `/documents/${doc.id}?remind=whatsapp`,
    });
  }
  return out;
}
