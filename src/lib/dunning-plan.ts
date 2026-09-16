// Which documents the daily dunning run may chase, shared by both passes:
// the client-facing email (src/app/api/dunning/run/route.ts) and the assisted
// WhatsApp pass (planAssistedReminders). Before 2026-09-15 the email pass had
// its own looser filter and reminded clients about QUOTES as if they were
// unpaid tax invoices; one rule here keeps the two from drifting again.
//
// Lateness is counted from the document's own "לתשלום עד" when it states one,
// and from the issue date otherwise (daysLate). A document whose due date has
// not passed by 3 days has no stage and is simply skipped.
//
// Pure: no Supabase, no clock beyond the `today` argument.

import {
  PRE_DUE_BUCKET,
  daysLate,
  dunningStageFor,
  preDueDaysUntil,
  type DunningStage,
} from "./dunning-copy";

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
  /** "לתשלום עד", YYYY-MM-DD, or null when the document states none. */
  due_date?: string | null;
  /** true when the due date is not printed on the client's copy. Timing is
   *  unchanged; only what the client is told (and the pre-due email) is. */
  due_date_hidden?: boolean | null;
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
  /** Documents skipped for any reason (not receivable, no stage - which
   *  includes not yet 3 days past a stated due date - already emailed, or no
   *  client email). */
  skipped: number;
  /** The subset of skipped documents that had reached a stage but had no client email,
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
    const days = daysLate({ date: doc.date, dueDate: doc.due_date }, today);
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

export interface PreDueReminderPlan<D extends EmailPlanDoc> {
  doc: D;
  daysUntilDue: number;
  email: string;
}

/**
 * Decide which friendly pre-due emails today's run should send: open
 * receivables whose due date is 1 to 5 days away (and at least 7 days after
 * issue, see preDueDaysUntil) and printed on the client's copy (a hidden due
 * date is skipped outright), not already logged under PRE_DUE_BUCKET on the
 * email channel, with a client email. Independent of the 3 / 14 / 30 plan:
 * it reads only its own bucket and never changes what that plan decides.
 *
 * The caller runs it only when the business turned the setting on AND the
 * email pass is active. A document without a client email is simply left
 * out; the stage plan reports those once the document is actually late.
 */
export function planPreDueEmails<D extends EmailPlanDoc>(
  docs: D[],
  emailByClient: Map<string, string | null>,
  logRows: EmailPlanLogRow[],
  today: Date = new Date(),
): PreDueReminderPlan<D>[] {
  const seen = new Set(
    logRows
      .filter((l) => (l.channel ?? "email") === "email" && l.day_bucket === PRE_DUE_BUCKET)
      .map((l) => l.document_id),
  );
  const out: PreDueReminderPlan<D>[] = [];
  for (const doc of docs) {
    if (!isOpenReceivable(doc)) continue;
    if (seen.has(doc.id)) continue;
    const daysUntilDue = preDueDaysUntil(
      { date: doc.date, dueDate: doc.due_date, dueDateHidden: doc.due_date_hidden },
      today,
    );
    if (daysUntilDue == null) continue;
    const email = doc.client_id ? emailByClient.get(doc.client_id) : null;
    if (!email) continue;
    out.push({ doc, daysUntilDue, email });
  }
  return out;
}
