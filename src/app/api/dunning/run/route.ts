import { formatDocTotal } from "@/lib/currencies";
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { createNotificationForBusiness } from "@/lib/notifications-server";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import {
  PRE_DUE_BUCKET,
  dunningEmailContent,
  preDueEmailContent,
  type DunningEmailContent,
} from "@/lib/dunning-copy";
import { RECEIVABLE_TYPES, planDunningEmails, planPreDueEmails } from "@/lib/dunning-plan";
import {
  WHATSAPP_ASSIST_CHANNEL,
  planAssistedReminders,
  type AssistedDocRow,
} from "@/lib/assisted-dunning";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GMAIL_USER = process.env.GMAIL_USER!;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD!;
const DUNNING_CRON_SECRET = process.env.DUNNING_CRON_SECRET || "";

const APP_URL = CANONICAL_ORIGIN;

// Stage machinery + the Hebrew wording live in lib/dunning-copy.ts, shared
// byte-for-byte with the assisted WhatsApp reminder the owner sends by hand.

interface DocRow {
  id: string;
  business_id: string;
  client_id: string | null;
  client_name: string;
  number: number;
  date: string;
  /** "לתשלום עד"; lateness counts from it when set (see daysLate). */
  due_date: string | null;
  total: number;
  currency: string | null;
  type: string;
  status: string;
  paid_at: string | null;
  converted_to_id: string | null;
}

interface BusinessRow {
  id: string;
  name: string;
  dunning_enabled: boolean;
  dunning_whatsapp_enabled: boolean | null;
  /** Friendly reminder before the due date; only acts with dunning_enabled. */
  dunning_pre_due_enabled?: boolean | null;
  dunning_from_name: string | null;
  email: string | null;
  user_id: string;
}

interface ClientRow {
  id: string;
  email: string | null;
  phone: string | null;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(args: {
  fromName: string;
  clientName: string;
  content: DunningEmailContent;
  viewUrl: string;
}): string {
  const { fromName, clientName, content, viewUrl } = args;
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>${escapeHtml(fromName)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f2eb;font-family:Arial,sans-serif;">
  <div dir="rtl" style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#d96a1d;background-image:linear-gradient(135deg,#d96a1d,#c45f1a);padding:24px;border-radius:16px;color:#ffffff;text-align:center;margin-bottom:24px;">
      <h1 style="margin:0;font-size:22px;">${escapeHtml(fromName)}</h1>
    </div>
    <div style="background:#ffffff;border:1px solid #e8ddd0;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 12px 0;font-size:16px;color:#1f232b;">שלום ${escapeHtml(clientName)},</p>
      <p style="margin:0 0 16px 0;font-size:15px;color:#1f232b;line-height:1.6;">${escapeHtml(content.intro)}</p>
      <p style="margin:0 0 12px 0;font-size:14px;color:#1f232b;line-height:1.6;">${escapeHtml(content.cta)}</p>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#d96a1d;background-image:linear-gradient(135deg,#d96a1d,#c45f1a);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:bold;">
        צפו במסמך ←
      </a>
    </div>
    <div style="text-align:center;margin-bottom:16px;">
      <p style="font-size:13px;color:#6b6560;margin:0 0 6px 0;">אם הכפתור לא עובד, העתיקו את הקישור:</p>
      <p style="font-size:12px;color:#6b6560;margin:0;word-break:break-all;">
        <a href="${escapeHtml(viewUrl)}" style="color:#1f232b;">${escapeHtml(viewUrl)}</a>
      </p>
    </div>
    <p style="font-size:13px;color:#6b6560;text-align:center;margin-bottom:8px;">${escapeHtml(content.signoff)}</p>
    <p style="font-size:14px;color:#1f232b;text-align:center;font-weight:600;margin:0 0 16px 0;">${escapeHtml(fromName)}</p>
    <p style="font-size:11px;color:#9a9086;text-align:center;">תזכורת אוטומטית. אם התשלום כבר בוצע ולא הגיע, נשמח לשמוע.</p>
  </div>
</body>
</html>`;
}

function buildText(args: {
  fromName: string;
  clientName: string;
  content: DunningEmailContent;
  viewUrl: string;
}): string {
  const { fromName, clientName, content, viewUrl } = args;
  return `שלום ${clientName},

${content.intro}

${content.cta}

לצפייה במסמך:
${viewUrl}

${content.signoff}
${fromName}
`;
}

export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-cron-secret") || "";
  if (!DUNNING_CRON_SECRET || provided !== DUNNING_CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Two passes ride on this one run, with independent switches:
  //  * dunning_enabled (opt-in, default false) emails the CLIENT;
  //  * dunning_whatsapp_enabled (opt-out, default true) only notifies the
  //    OWNER that a WhatsApp reminder is ready for them to send by hand.
  // A business that turned the email pass off still gets the assisted one,
  // so the query has to be an OR, not the old .eq on dunning_enabled.
  const { data: bizs } = await admin
    .from("businesses")
    .select("id, name, dunning_enabled, dunning_whatsapp_enabled, dunning_pre_due_enabled, dunning_from_name, email, user_id")
    .or("dunning_enabled.eq.true,dunning_whatsapp_enabled.eq.true");

  if (!bizs || bizs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, message: "no businesses opted in" });
  }

  // Gate: an unverified account must not be able to get the cron to email
  // real clients on a schedule - that would bypass the /api/send-email
  // verification gate entirely (this route has no user session, only the
  // cron secret). Resolve each dunning-enabled business's OWNER once, up
  // front, in parallel - not per-business inside the loop below - and skip
  // any business whose owner hasn't confirmed their email yet. Owners are
  // deduplicated so a user with multiple businesses only costs one lookup.
  const ownerIds = Array.from(new Set((bizs as BusinessRow[]).map((b) => b.user_id).filter(Boolean)));
  const ownerConfirmed = new Map<string, boolean>();
  await Promise.all(
    ownerIds.map(async (uid) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(uid);
        ownerConfirmed.set(uid, !error && Boolean(data?.user?.email_confirmed_at));
      } catch {
        // Fail closed: if we can't confirm the owner's status, don't email
        // on their behalf.
        ownerConfirmed.set(uid, false);
      }
    }),
  );

  // An email stage is claimed in dunning_log (success=false) before sending
  // and released if the send fails. A run that died between the claim and the
  // send, or whose release failed, leaves a claim that would suppress that
  // stage forever. Claims older than an hour are from a finished run, so they
  // are cleared here and the stage is retried today. Best effort: a failed
  // sweep only means those stages wait for a later run. Accepted trade-off:
  // if a send succeeded but flipping success=true failed (same database, a
  // second earlier), that one stage can go out twice; the route logs it.
  try {
    const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { error: sweepError } = await admin
      .from("dunning_log")
      .delete()
      .eq("channel", "email")
      .eq("success", false)
      .lt("sent_at", staleBefore);
    if (sweepError) console.warn("[dunning] stale claim sweep failed:", sweepError.message);
  } catch (e) {
    console.warn("[dunning] stale claim sweep failed:", e instanceof Error ? e.message : e);
  }

  let sent = 0;
  let prepared = 0;
  let skipped = 0;
  let errors = 0;
  let skippedUnverifiedBusinesses = 0;
  const details: Array<{ doc: string; bucket: number; outcome: string }> = [];

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
  });

  for (const biz of bizs as BusinessRow[]) {
    // The verification gate gates EMAIL only. The assisted pass sends nothing
    // to anyone but the account owner themselves, so there is nothing for an
    // unverified account to abuse there.
    const ownerVerified = ownerConfirmed.get(biz.user_id) === true;
    const emailPass = biz.dunning_enabled === true && ownerVerified;
    const assistPass = biz.dunning_whatsapp_enabled !== false;
    if (biz.dunning_enabled === true && !ownerVerified) {
      skippedUnverifiedBusinesses++;
      details.push({ doc: biz.id, bucket: 0, outcome: "skipped: owner email not verified" });
    }
    if (!emailPass && !assistPass) continue;

    const { data: docs } = await admin
      .from("documents")
      .select("id, business_id, client_id, client_name, number, date, due_date, total, currency, type, status, paid_at, converted_to_id")
      .eq("business_id", biz.id)
      // Receivables only, the same rule both passes apply row by row below
      // (isOpenReceivable). Quotes used to be selected here and got a
      // "חשבונית המס" payment reminder.
      .in("type", [...RECEIVABLE_TYPES])
      .eq("status", "sent")
      // Defensive: never dun a doc that's been paid, even if its status
      // wasn't flipped to "paid" (status/paid_at can desync via the bank
      // import or a future flow).
      .is("paid_at", null);

    if (!docs || docs.length === 0) continue;

    const clientIds = Array.from(
      new Set((docs as DocRow[]).map((d) => d.client_id).filter(Boolean)),
    ) as string[];

    const { data: clients } = clientIds.length
      ? await admin.from("clients").select("id, email, phone").in("id", clientIds)
      : { data: [] };

    const emailByClient = new Map<string, string | null>(
      (clients as ClientRow[] | null)?.map((c) => [c.id, c.email]) || [],
    );

    const { data: existingLogs, error: logsError } = await admin
      .from("dunning_log")
      .select("document_id, day_bucket, channel")
      .in("document_id", (docs as DocRow[]).map((d) => d.id));

    // Fail closed. Without the log we cannot tell what already went out, and
    // treating the read failure as "nothing sent yet" would re-email real
    // clients every run until it recovers. Skipping the business costs at
    // most a day of delay; tomorrow's run picks the same documents up.
    if (logsError) {
      errors++;
      details.push({
        doc: biz.id,
        bucket: 0,
        outcome: `error: dunning_log read failed (${logsError.message})`,
      });
      continue;
    }

    // Empty when the business only opted in to the assisted pass, so the
    // whole email block below is skipped without another level of nesting.
    const emailPlan = emailPass
      ? planDunningEmails(docs as DocRow[], emailByClient, existingLogs || [])
      : { queue: [], skipped: 0, noEmail: [] };
    skipped += emailPlan.skipped;
    for (const { doc, stage } of emailPlan.noEmail) {
      details.push({ doc: doc.id, bucket: stage, outcome: "no client email" });
    }

    const fromName = biz.dunning_from_name || biz.name;

    // One email, claimed in dunning_log before it is sent. Shared by the
    // 3 / 14 / 30 stages and the friendly pre-due reminder (PRE_DUE_BUCKET),
    // so both get exactly the same claim / release / confirm handling.
    // Returns true only when the email went out.
    const sendClaimedEmail = async (
      doc: DocRow,
      bucket: number,
      clientEmail: string,
      content: DunningEmailContent,
    ): Promise<boolean> => {
      const viewUrl = `${APP_URL}/view/${doc.id}`;
      const html = buildHtml({ fromName, clientName: doc.client_name, content, viewUrl });
      const text = buildText({ fromName, clientName: doc.client_name, content, viewUrl });

      // Claim the stage BEFORE sending. The UNIQUE(document_id, day_bucket,
      // channel) key makes this the one gate a (document, stage) passes
      // exactly once: if the insert fails (a concurrent run already claimed
      // it, or the DB is unavailable) nothing is sent. The old order (send,
      // then an unchecked insert) re-sent the same stage every day whenever
      // that insert failed. The row starts as success=false and is flipped
      // after the send; a send failure removes it so tomorrow retries.
      const { error: claimError } = await admin.from("dunning_log").insert({
        document_id: doc.id,
        business_id: biz.id,
        day_bucket: bucket,
        sent_to: clientEmail,
        success: false,
        // Explicit, though it is also the column default: the assisted
        // pass below writes rows for the same (document, bucket) pair and
        // only the channel tells them apart.
        channel: "email",
      });
      if (claimError) {
        console.error(
          `[dunning] could not claim email stage ${bucket} for document ${doc.id}, not sending: ${claimError.message}`,
        );
        errors++;
        details.push({ doc: doc.id, bucket, outcome: `error: dunning_log claim failed (${claimError.message})` });
        return false;
      }

      try {
        await transporter.sendMail({
          from: `"${fromName}" <${GMAIL_USER}>`,
          to: clientEmail,
          replyTo: biz.email || GMAIL_USER,
          subject: content.subject,
          html,
          text,
          headers: {
            "X-Auto-Response-Suppress": "All",
            "Auto-Submitted": "auto-generated",
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        // Release the claim so a transient send failure is retried tomorrow
        // instead of being marked done forever by the dedupe key. If even
        // the release fails the stage stays claimed (never sent twice, but
        // not retried either), so say so loudly.
        const { error: releaseError } = await admin
          .from("dunning_log")
          .delete()
          .eq("document_id", doc.id)
          .eq("day_bucket", bucket)
          .eq("channel", "email");
        if (releaseError) {
          console.error(
            `[dunning] send failed AND claim release failed for document ${doc.id} stage ${bucket}, this stage will not retry: ${releaseError.message}`,
          );
        }
        errors++;
        details.push({ doc: doc.id, bucket, outcome: `error: ${msg}` });
        return false;
      }

      const { error: confirmError } = await admin
        .from("dunning_log")
        .update({ success: true })
        .eq("document_id", doc.id)
        .eq("day_bucket", bucket)
        .eq("channel", "email");
      if (confirmError) {
        // The email went out and the claim row still blocks a re-send; only
        // its success flag is stale.
        console.error(
          `[dunning] email sent but dunning_log success flag not updated for document ${doc.id} stage ${bucket}: ${confirmError.message}`,
        );
      }

      sent++;
      details.push({ doc: doc.id, bucket, outcome: "sent" });
      return true;
    };

    for (const { doc, stage: bucket, days, email: clientEmail } of emailPlan.queue) {
      // Hebrew copy for every document. language='en' has no English
      // collection wording yet; the amount is still in the document currency.
      const content = dunningEmailContent({
        stage: bucket,
        docType: doc.type,
        number: doc.number,
        total: doc.total,
        currency: doc.currency,
        date: doc.date,
        dueDate: doc.due_date,
        days,
      });
      if (!(await sendClaimedEmail(doc, bucket, clientEmail, content))) continue;

      await createNotificationForBusiness({
        businessId: biz.id,
        kind: "dunning_sent",
        title: `נשלחה תזכורת ל-${doc.client_name}`,
        body: `מסמך #${doc.number} (${formatDocTotal(Number(doc.total), doc.currency)}): תזכורת יום ${bucket}.`,
        href: `/documents/${doc.id}`,
        documentId: doc.id,
      });
    }

    // Friendly reminder before the due date: opt-in on top of the email pass,
    // email to the client only (no owner notification, no WhatsApp side).
    // Independent of the stages above: its own bucket, its own dedupe.
    if (emailPass && biz.dunning_pre_due_enabled === true) {
      const preDue = planPreDueEmails(docs as DocRow[], emailByClient, existingLogs || []);
      for (const { doc, email: clientEmail } of preDue) {
        const content = preDueEmailContent({
          docType: doc.type,
          number: doc.number,
          total: doc.total,
          currency: doc.currency,
          dueDate: doc.due_date,
        });
        await sendClaimedEmail(doc, PRE_DUE_BUCKET, clientEmail, content);
      }
    }

    // Assisted pass: prepare, do not send. One notification per (document,
    // stage) telling the owner a WhatsApp reminder is ready; the message
    // itself is composed on the document page when they tap it, and leaves
    // from their own number. Nothing here touches the client.
    if (assistPass) {
      const plans = planAssistedReminders(
        docs as AssistedDocRow[],
        (clients as ClientRow[] | null) || [],
        existingLogs || [],
      );
      for (const plan of plans) {
        const notified = await createNotificationForBusiness({
          businessId: biz.id,
          kind: "whatsapp_reminder_ready",
          title: plan.title,
          body: plan.body,
          href: plan.href,
          documentId: plan.documentId,
        });
        // Same rule as the email path: log only what actually happened, so a
        // failed notification is retried tomorrow instead of being marked
        // done forever by the dedupe key.
        if (!notified) {
          errors++;
          details.push({ doc: plan.documentId, bucket: plan.stage, outcome: "error: notification failed" });
          continue;
        }
        const { error: logError } = await admin.from("dunning_log").insert({
          document_id: plan.documentId,
          business_id: biz.id,
          day_bucket: plan.stage,
          // For this channel sent_to is the number the owner was prompted to
          // message, and success means "the owner was notified" - the client
          // has received nothing at this point.
          sent_to: plan.phone,
          success: true,
          channel: WHATSAPP_ASSIST_CHANNEL,
        });
        if (logError) {
          errors++;
          details.push({
            doc: plan.documentId,
            bucket: plan.stage,
            outcome: `error: whatsapp log failed (${logError.message})`,
          });
          continue;
        }
        prepared++;
        details.push({ doc: plan.documentId, bucket: plan.stage, outcome: "whatsapp reminder prepared" });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    prepared,
    skipped,
    errors,
    businesses: bizs.length,
    skippedUnverifiedBusinesses,
    details: details.slice(0, 50),
  });
}
