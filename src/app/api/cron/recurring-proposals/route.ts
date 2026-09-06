import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cronAuthError, cronAdminClient } from "@/lib/cron";
import { createNotificationForBusiness } from "@/lib/notifications-server";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import { toIsraelDate } from "@/lib/date";
import { canIssueTaxInvoicesByType } from "@/lib/vat";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/types";
import { MAX_SOURCE_LABEL, clean, cleanNotes, parseItems } from "@/lib/proposal-build";
import {
  alreadyBilledForPeriod,
  detectRecurringPatterns,
  isPatternMuted,
  findConflictingProposal,
  monthsBackStart,
  periodMinusMonths,
  type OpenProposalRow,
  type RecurringPattern,
  type RecurringSourceDoc,
} from "@/lib/recurring-patterns";

/**
 * Daily: turn a detected billing cadence into a card the owner can approve.
 *
 * "You issue גין דין ענה the same rent receipt around the 1st of every month"
 * is something the app can see for itself. On the day, this cron prepares the
 * document as an `invoice_proposals` row - NOT a draft, which would burn a
 * document number the owner may never use - and the dashboard card offers
 * אשר והפק / ערוך לפני הפקה / לא עכשיו.
 *
 * The detector lives in lib/recurring-patterns.ts and is pure; this route is
 * only the plumbing: who to look at, what already exists, and who to tell.
 *
 * Restraint is the whole design. A card the owner did not ask for is a cost,
 * so every one of these is a reason to stay quiet:
 *   - recurring_suggestions_enabled = false (settings toggle);
 *   - no document at all in the last 60 days (dormant business);
 *   - fewer than 3 occurrences, or gaps that are not roughly monthly;
 *   - the document for this period already exists (they billed it by hand,
 *     this month or in advance at the end of last month);
 *   - a proposal row for (source, period) already exists, in any status;
 *   - another producer (finish-gigs) already has an open card for the same
 *     period + type + client;
 *   - muted: the last two offers were both dismissed, or "לא לזהות יותר את זה".
 *
 * Idempotent: UNIQUE (business_id, source, period) means a re-run inserts
 * nothing, and a lost-response race surfaces as 23505 and is counted as a
 * skip, not an error.
 */

const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";
const APP_URL = CANONICAL_ORIGIN;

/**
 * The run walks every active business and can send mail; the platform default
 * would cut it off mid-loop, leaving some businesses processed and the rest
 * silently skipped for the day.
 */
export const maxDuration = 300;

/** Businesses with no document in this many days are not looked at. */
const ACTIVE_WINDOW_DAYS = 60;
/** How far back the detector reads. */
const LOOKBACK_MONTHS = 12;
/** Documents read per business (a year of documents, generously). */
const DOC_LIMIT = 500;
/** Cards this run may create for one business, so a bad month can't flood. */
const MAX_PROPOSALS_PER_BUSINESS = 5;
/** Rows per page when walking a whole table. */
const PAGE_SIZE = 1000;

interface BusinessRow {
  id: string;
  name: string;
  user_id: string;
  business_type: string | null;
  monthly_reminder_enabled: boolean | null;
  monthly_reminder_channels: string[] | null;
  recurring_suggestions_enabled?: boolean | null;
}

const BUSINESS_COLUMNS =
  "id, name, user_id, business_type, monthly_reminder_enabled, monthly_reminder_channels, recurring_suggestions_enabled";
/** Without the 2026-09-01 migration applied yet. See loadBusinesses.
 *  `monthly_reminder_enabled` is safe here: it has existed since the
 *  2026-08-09 monthly-reminder migration. */
const BUSINESS_COLUMNS_LEGACY =
  "id, name, user_id, business_type, monthly_reminder_enabled, monthly_reminder_channels";

/** YYYY-MM-DD, `days` days before `iso`. */
function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The businesses that may receive a suggestion.
 *
 * `recurring_suggestions_enabled` arrives with
 * scripts/migrations/20260901-recurring-suggestions.sql. If the code reaches
 * an environment where that migration has not run yet, PostgREST answers 42703
 * ("column does not exist") and the whole run would die; fall back to the
 * pre-migration column list and treat every business as opted in, which is the
 * column's default anyway.
 */
async function loadBusinesses(
  admin: SupabaseClient,
): Promise<{ rows: BusinessRow[]; error: string | null }> {
  // Paged, ordered by id: PostgREST caps a plain select at its configured max
  // rows, and an unnoticed cap here would silently stop proposing for every
  // business past the cut.
  async function page(columns: string, from: number) {
    return admin
      .from("businesses")
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
  }

  let columns = BUSINESS_COLUMNS;
  const rows: BusinessRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let result = await page(columns, from);
    if (result.error?.code === "42703" && columns === BUSINESS_COLUMNS) {
      columns = BUSINESS_COLUMNS_LEGACY;
      result = await page(columns, from);
    }
    if (result.error) return { rows: [], error: result.error.message };
    const batch = (result.data || []) as unknown as BusinessRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { rows, error: null };
}

/**
 * Business ids with at least one issued document since `since`. Paged for the
 * same reason as the businesses walk: a row cap here would read as "these
 * businesses are dormant" and skip them.
 */
async function loadActiveBusinessIds(
  admin: SupabaseClient,
  since: string,
): Promise<{ ids: Set<string>; error: string | null }> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("documents")
      .select("business_id, id")
      .gte("date", since)
      .neq("status", "draft")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { ids, error: error.message };
    const batch = (data || []) as Record<string, unknown>[];
    for (const row of batch) ids.add(String(row.business_id));
    if (batch.length < PAGE_SIZE) break;
  }
  return { ids, error: null };
}

/** Map a `documents` row (+ its items) to the detector's input shape. */
function toSourceDoc(row: Record<string, unknown>): RecurringSourceDoc {
  const rawItems = Array.isArray(row.document_items)
    ? (row.document_items as Record<string, unknown>[])
    : [];
  return {
    id: String(row.id),
    number: Number(row.number) || 0,
    type: String(row.type || "") as DocumentType,
    status: String(row.status || ""),
    date: String(row.date || ""),
    clientId: row.client_id ? String(row.client_id) : null,
    clientName: String(row.client_name || ""),
    subject: String(row.subject || ""),
    notes: row.notes != null ? String(row.notes) : null,
    currency: row.currency != null ? String(row.currency) : "ILS",
    zeroRated: row.zero_rated === true,
    discountAmount: row.discount_amount != null ? Number(row.discount_amount) : 0,
    withholdingAmount: row.withholding_amount != null ? Number(row.withholding_amount) : 0,
    items: rawItems.map((i) => ({
      description: String(i.description || ""),
      quantity: Number(i.quantity) || 0,
      unitPrice: Number(i.unit_price) || 0,
    })),
  };
}

export async function GET(req: Request) {
  const unauth = cronAuthError(req);
  if (unauth) return unauth;

  const admin = cronAdminClient();
  const today = toIsraelDate(new Date());
  const period = today.slice(0, 7);

  const { rows: businesses, error: bizError } = await loadBusinesses(admin);
  if (bizError) {
    // A failed businesses read must not read as "nobody qualified" with a 200.
    return NextResponse.json(
      { ok: false, error: `businesses query failed: ${bizError}` },
      { status: 500 },
    );
  }

  const enabled = businesses.filter((b) => b.recurring_suggestions_enabled !== false);
  if (enabled.length === 0) {
    return NextResponse.json({
      ok: true,
      today,
      period,
      processed: 0,
      proposalsCreated: 0,
      skipped: 0,
      errors: 0,
    });
  }

  // One scan answers "which businesses are alive at all", instead of a
  // per-business existence check for every dormant account in the table.
  const { ids: activeIds, error: recentError } = await loadActiveBusinessIds(
    admin,
    shiftDays(today, -ACTIVE_WINDOW_DAYS),
  );
  if (recentError) {
    return NextResponse.json(
      { ok: false, error: `documents query failed: ${recentError}` },
      { status: 500 },
    );
  }
  const candidates = enabled.filter((b) => activeIds.has(b.id));

  const since = monthsBackStart(today, LOOKBACK_MONTHS);
  let processed = 0;
  let proposalsCreated = 0;
  let skipped = 0;
  let errors = 0;
  const details: { business: string; outcome: string }[] = [];

  // Built once, only if something actually needs emailing.
  let transporter: nodemailer.Transporter | null = null;
  function mailer(): nodemailer.Transporter | null {
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
      });
    }
    return transporter;
  }

  // Sequential on purpose: this is a background job with all night to run,
  // and a burst of parallel service-role queries buys nothing but contention.
  for (const biz of candidates) {
    processed++;
    try {
      const { data: docRows, error: docsError } = await admin
        .from("documents")
        .select(
          "id, number, type, status, date, client_id, client_name, subject, notes, currency, zero_rated, discount_amount, withholding_amount, document_items(description, quantity, unit_price, sort_order)",
        )
        .eq("business_id", biz.id)
        .neq("status", "draft")
        .gte("date", since)
        .order("date", { ascending: false })
        .order("sort_order", { foreignTable: "document_items" })
        .limit(DOC_LIMIT);
      if (docsError) {
        errors++;
        details.push({ business: biz.id, outcome: `error: documents - ${docsError.message}` });
        continue;
      }

      const docs = ((docRows || []) as Record<string, unknown>[]).map(toSourceDoc);
      const due = detectRecurringPatterns(docs, { today, lookbackMonths: LOOKBACK_MONTHS }).filter(
        (p) => p.due,
      );
      if (due.length === 0) continue;

      // A client row deleted since the last occurrence would make the insert
      // fail on the foreign key; resolve which ids still exist, once.
      const wantedClientIds = [...new Set(due.map((p) => p.clientId).filter(Boolean))] as string[];
      const liveClientIds = new Set<string>();
      if (wantedClientIds.length > 0) {
        const { data: clientRows } = await admin
          .from("clients")
          .select("id")
          .eq("business_id", biz.id)
          .in("id", wantedClientIds);
        for (const c of clientRows || []) liveClientIds.add(String((c as { id: string }).id));
      }

      let createdForBusiness = 0;
      for (const pattern of due) {
        if (createdForBusiness >= MAX_PROPOSALS_PER_BUSINESS) {
          skipped++;
          details.push({ business: biz.id, outcome: "skipped: per-business cap" });
          break;
        }

        const outcome = await proposePattern(admin, biz, pattern, {
          docs,
          period,
          liveClientIds,
          mailer,
        });
        if (outcome === "created") {
          proposalsCreated++;
          createdForBusiness++;
        } else if (outcome.startsWith("error")) {
          errors++;
          details.push({ business: biz.id, outcome });
        } else {
          // Every skip is recorded too: "the cron ran and created nothing" is
          // indistinguishable from "the cron is broken" without the reason.
          skipped++;
          details.push({ business: biz.id, outcome });
        }
      }
    } catch (err) {
      // One business's failure must never take the rest of the run down.
      errors++;
      details.push({
        business: biz.id,
        outcome: `error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    today,
    period,
    processed,
    proposalsCreated,
    skipped,
    errors,
    details: details.slice(0, 50),
  });
}

interface ProposeContext {
  docs: RecurringSourceDoc[];
  period: string;
  liveClientIds: Set<string>;
  mailer: () => nodemailer.Transporter | null;
}

/**
 * Everything that has to be true before one pattern becomes a card, then the
 * insert and the nudge. Returns "created", a "skipped: ..." reason, or an
 * "error: ..." string - the caller only counts them.
 */
async function proposePattern(
  admin: SupabaseClient,
  biz: BusinessRow,
  pattern: RecurringPattern,
  ctx: ProposeContext,
): Promise<string> {
  const { docs, period } = ctx;

  // An עוסק פטור may never issue a tax invoice, and create_document_atomic
  // only rejects one carrying nonzero VAT - so a zero-VAT one would slip
  // through and the owner would issue a document their status forbids. Same
  // guard /api/proposals applies to its callers.
  if (
    (pattern.documentType === "tax_invoice" || pattern.documentType === "tax_invoice_receipt") &&
    !canIssueTaxInvoicesByType(biz.business_type)
  ) {
    return "skipped: cannot issue tax invoices";
  }
  if (!(pattern.documentType in DOCUMENT_TYPE_LABELS)) return "skipped: unknown document type";

  const subject = clean(pattern.subject);
  const clientName = clean(pattern.clientName);
  if (!subject || !clientName) return "skipped: incomplete template";

  // Already billed by hand this month - the commonest reason to stay quiet.
  if (alreadyBilledForPeriod(docs, pattern, period)) return "skipped: already issued";

  const { data: priorRows, error: priorError } = await admin
    .from("invoice_proposals")
    .select("period, status, details")
    .eq("business_id", biz.id)
    .eq("source", pattern.source)
    .order("period", { ascending: false })
    .limit(6);
  if (priorError) return `error: proposals read - ${priorError.message}`;
  const prior = (priorRows || []) as { period: string; status: string; details: unknown }[];

  // Any row for this period, in any status, means this month is answered.
  if (prior.some((r) => r.period === period)) return "skipped: proposal exists";
  if (isPatternMuted(prior, period)) return "skipped: muted";

  // Another producer's card for the same bill.
  //
  // The finish-gigs automation and this detector both look at the same
  // history, so the same monthly invoice can look like "mine" to both - and
  // because they use different `source` values, the UNIQUE (business, source,
  // period) constraint does not stop the second one. Worse, the two producers
  // do not even agree what `period` means: finish-gigs bills IN ARREARS (the
  // card created on Sep 1 carries period 2026-08), while this detector's
  // period is the issue month (2026-09) - so equal-period matching would miss
  // the exact collision it exists to prevent. The check is therefore
  // source-agnostic AND spans the previous period too, on the identity that
  // actually matters: type + client + signature.
  const conflict = await findOtherProducerProposal(admin, biz.id, pattern, period);
  if (conflict === "error") return "error: cross-producer check failed";
  if (conflict) return "skipped: other producer";

  const parsed = parseItems(pattern.items);
  if (typeof parsed === "string") return `skipped: ${parsed}`;

  const clientId =
    pattern.clientId && ctx.liveClientIds.has(pattern.clientId) ? pattern.clientId : null;

  // Last month's card, never answered, must not sit next to this month's:
  // approving a stale one issues a document whose subject names the wrong
  // month. Best effort - if this fails, the worst case is the old card
  // lingering, which is what happens today anyway.
  await admin
    .from("invoice_proposals")
    .update({
      status: "dismissed",
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", biz.id)
    .eq("source", pattern.source)
    .eq("status", "pending")
    .lt("period", period);

  const { error: insertError } = await admin.from("invoice_proposals").insert({
    business_id: biz.id,
    source: pattern.source,
    source_label: `חוזר: ${clientName}`.slice(0, MAX_SOURCE_LABEL),
    period,
    document_type: pattern.documentType,
    client_id: clientId,
    client_name: clientName,
    subject,
    notes: cleanNotes(pattern.notes) || null,
    items: parsed.items,
    total: parsed.total,
    // An OBJECT, not the array of evidence rows the גיגים automation writes -
    // the card tells the two apart and renders this one as the "why am I
    // seeing this" line. `mute` is added here later by the dismiss path.
    details: {
      pattern: {
        dayOfMonth: pattern.dayOfMonth,
        occurrences: pattern.occurrences,
        lastDocId: pattern.lastDocId,
        lastDocNumber: pattern.lastDocNumber,
      },
    },
    status: "pending",
    updated_at: new Date().toISOString(),
  });

  if (insertError) {
    // 23505: another run (a retry, a manual invocation) got there first. That
    // is the unique constraint doing its job, not a failure.
    if (insertError.code === "23505") return "skipped: raced";
    return `error: insert - ${insertError.message}`;
  }

  // In-app bell. Best effort: the proposal itself is already saved.
  try {
    await createNotificationForBusiness({
      businessId: biz.id,
      kind: "proposal_ready",
      title: "מסמך חוזר מוכן לאישור",
      body: `${subject} · ₪${parsed.total.toLocaleString("he-IL")}`,
      href: "/dashboard",
    });
  } catch {
    /* notification is best-effort */
  }

  await sendPatternEmail(admin, biz, ctx.mailer, {
    subject,
    clientName,
    total: parsed.total,
    documentType: pattern.documentType,
  }).catch(() => {
    /* the card is the delivery that matters; email is only a nudge */
  });

  return "created";
}

/**
 * Is there already a proposal for this bill from another producer?
 *
 * Deliberately ignores `source` equality (that is the field that differs
 * between producers) and deliberately spans period AND the period before it:
 * producers disagree on what `period` means (finish-gigs stamps the billed
 * month, this cron stamps the issue month), so the same obligation lives one
 * period apart in the table. The decision itself - same client, same
 * signature family, still open - is `proposalRowBlocksPattern` in
 * lib/recurring-patterns.ts, pure and unit-tested. The signature match is what
 * lets two DIFFERENT cadences of the same type to the same client (two rented
 * properties, say) each keep their own card.
 */
async function findOtherProducerProposal(
  admin: SupabaseClient,
  businessId: string,
  pattern: RecurringPattern,
  period: string,
): Promise<boolean | "error"> {
  const { data, error } = await admin
    .from("invoice_proposals")
    .select("source, period, status, client_id, client_name, subject, items")
    .eq("business_id", businessId)
    .eq("document_type", pattern.documentType)
    .neq("source", pattern.source)
    .gte("period", periodMinusMonths(period, 1))
    .in("status", ["pending", "approved"])
    .limit(200);
  if (error) return "error";

  const rows: OpenProposalRow[] = ((data || []) as Record<string, unknown>[]).map((r) => ({
    source: String(r.source || ""),
    period: String(r.period || ""),
    status: String(r.status || ""),
    clientId: r.client_id ? String(r.client_id) : null,
    clientName: String(r.client_name || ""),
    subject: String(r.subject || ""),
    items: Array.isArray(r.items) ? (r.items as { description?: string | null }[]) : [],
  }));
  return findConflictingProposal(rows, pattern, period) !== null;
}

/**
 * Email the owner - only when they actually asked to be emailed.
 *
 * Three gates, all required:
 *   1. `monthly_reminder_enabled` is true. The channels array is a preference
 *      INSIDE that feature; someone who never turned reminders on has an
 *      "email" in their channels only because that is the default, and mailing
 *      them would be sending to a person who opted into nothing.
 *   2. the channels include "email";
 *   3. the owner's address is verified - the same gate the monthly reminder
 *      applies, for the same reason: never send to an address nobody confirmed
 *      control of.
 *
 * Failing any of them is not a failure: the card and the in-app bell already
 * delivered the message.
 */
async function sendPatternEmail(
  admin: SupabaseClient,
  biz: BusinessRow,
  mailer: () => nodemailer.Transporter | null,
  proposal: { subject: string; clientName: string; total: number; documentType: DocumentType },
): Promise<void> {
  if (biz.monthly_reminder_enabled !== true) return;
  const channels = Array.isArray(biz.monthly_reminder_channels)
    ? biz.monthly_reminder_channels
    : [];
  if (!channels.includes("email")) return;

  const transporter = mailer();
  if (!transporter) return;

  const { data, error } = await admin.auth.admin.getUserById(biz.user_id);
  if (error || !data?.user?.email_confirmed_at) return;
  const to = data.user.email;
  if (!to) return;

  const typeLabel = DOCUMENT_TYPE_LABELS[proposal.documentType] || "מסמך";
  const amount = `₪${proposal.total.toLocaleString("he-IL")}`;
  // For a VAT-liable business the proposed lines are pre-VAT, so the number
  // in the mail is not the number on the finished document. Say so rather
  // than let the mail and the card disagree.
  const vatNote = canIssueTaxInvoicesByType(biz.business_type) ? " (לפני מע\"מ)" : "";
  const line = `${typeLabel} ל${proposal.clientName}: ${proposal.subject} · ${amount}${vatNote}`;

  await transporter.sendMail({
    from: `"${biz.name}" <${GMAIL_USER}>`,
    to,
    subject: `${typeLabel} חוזר מוכן לאישור - ${proposal.clientName}`,
    text: [
      "הכנו מסמך שנראה שאתה מוציא כל חודש.",
      "",
      line,
      "",
      "הוא מחכה לאישור בדשבורד, ולא יופק בלי שתאשר:",
      `${APP_URL}/dashboard`,
      "",
      "אפשר לכבות את ההצעות החכמות בעמוד התזכורות.",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8" /><title>${escapeHtml(biz.name)}</title></head>
<body style="margin:0;padding:0;background:#f7f7f2;font-family:Arial,sans-serif;">
  <div dir="rtl" style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#2f3a45;background-image:linear-gradient(135deg,#2f3a45,#263039);padding:24px;border-radius:16px;color:#ffffff;text-align:center;margin-bottom:24px;">
      <h1 style="margin:0;font-size:22px;">${escapeHtml(biz.name)}</h1>
      <p style="margin:8px 0 0 0;font-size:14px;opacity:0.9;">מסמך חוזר מוכן לאישור</p>
    </div>
    <div style="background:#ffffff;border:1px solid #e4e7e2;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 12px 0;font-size:15px;color:#1f252b;line-height:1.6;">הכנו מסמך שנראה שאתה מוציא כל חודש. הוא לא יופק בלי שתאשר.</p>
      <p style="margin:0;font-size:15px;font-weight:bold;color:#1f252b;">${escapeHtml(line)}</p>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${escapeHtml(APP_URL)}/dashboard" style="display:inline-block;background:#2f3a45;background-image:linear-gradient(135deg,#2f3a45,#263039);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:bold;">לאישור המסמך ←</a>
    </div>
    <p style="font-size:11px;color:#8b95a0;text-align:center;">הצעה אוטומטית למסמך חוזר. ניתן לכבות בעמוד התזכורות.</p>
  </div>
</body>
</html>`,
    headers: {
      "X-Auto-Response-Suppress": "All",
      "Auto-Submitted": "auto-generated",
    },
  });
}
