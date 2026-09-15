// Which documents the daily dunning run may chase, shared by both passes:
// the client-facing email (src/app/api/dunning/run/route.ts) and the assisted
// WhatsApp pass (planAssistedReminders). Before 2026-09-15 the email pass had
// its own looser filter and reminded clients about QUOTES as if they were
// unpaid tax invoices; one rule here keeps the two from drifting again.
//
// Pure: no Supabase, no clock beyond the `today` argument.

import { daysSinceIssue, dunningStageFor, type DunningStage } from "./dunning-copy";

/** Only real receivables get chased. A quote is not money owed yet. */
export const RECEIVABLE_TYPES = ["tax_invoice", "proforma"] as const;

const RECEIVABLE_SET = new Set<string>(RECEIVABLE_TYPES);

export interface ReceivableCandidate {
  type: string;
  status: string;
  paid_at: string | null;
  converted_to_id?: string | null;
}

/**
 * An issued, unpaid receivable that has not been converted onward (a
 * proforma converted to a tax invoice, or an invoice converted to a receipt,
 * is settled or superseded by the newer document). Drafts, cancelled and
 * paid documents are never chased.
 */
export function isOpenReceivable(doc: ReceivableCandidate): boolean {
  if (!RECEIVABLE_SET.has(doc.type)) return false;
  if (doc.status !== "sent") return false;
  if (doc.paid_at) return false;
  if (doc.converted_to_id) return false;
  return true;
}

export interface EmailPlanDoc extends ReceivableCandidate {
  id: string;
  client_id: string | null;
  date: string;
}

export interface EmailPlanLogRow {
  document_id: string;
  day_bucket: number;
  channel?: string | null;
}

export interface EmailReminderPlan<D extends EmailPlanDoc> {
  doc: D;
  stage: DunningStage;
  days: number;
  email: string;
}

export interface EmailPlanResult<D extends EmailPlanDoc> {
  queue: EmailReminderPlan<D>[];
  /** Documents skipped for any reason (not receivable, no stage, already
   *  emailed, or no client email). */
  skipped: number;
  /** The subset of skipped documents that were due but had no client email,
   *  surfaced in the run details. */
  noEmail: Array<{ doc: D; stage: DunningStage }>;
}

/**
 * Decide which reminder emails today's run should send. Email dedupe reads
 * only its own channel's rows; rows written before the channel column existed
 * default to "email", which is what they are.
 */
export function planDunningEmails<D extends EmailPlanDoc>(
  docs: D[],
  emailByClient: Map<string, string | null>,
  logRows: EmailPlanLogRow[],
  today: Date = new Date(),
): EmailPlanResult<D> {
  const seen = new Set(
    logRows
      .filter((l) => (l.channel ?? "email") === "email")
      .map((l) => `${l.document_id}:${l.day_bucket}`),
  );
  const queue: EmailReminderPlan<D>[] = [];
  const noEmail: Array<{ doc: D; stage: DunningStage }> = [];
  let skipped = 0;
  for (const doc of docs) {
    if (!isOpenReceivable(doc)) {
      skipped++;
      continue;
    }
    const days = daysSinceIssue(doc.date, today);
    const stage = dunningStageFor(days);
    if (!stage || seen.has(`${doc.id}:${stage}`)) {
      skipped++;
      continue;
    }
    const email = doc.client_id ? emailByClient.get(doc.client_id) : null;
    if (!email) {
      skipped++;
      noEmail.push({ doc, stage });
      continue;
    }
    queue.push({ doc, stage, days, email });
  }
  return { queue, skipped, noEmail };
}
