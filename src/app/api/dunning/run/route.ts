import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { createNotificationForBusiness } from "@/lib/notifications-server";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import {
  DUNNING_SUBJECTS,
  DUNNING_TONES,
  daysSinceIssue,
  dunningStageFor,
  fillDunningVars,
  type DunningStage,
} from "@/lib/dunning-copy";
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
  total: number;
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
  businessName: string;
  fromName: string;
  clientName: string;
  number: number;
  total: number;
  date: string;
  days: number;
  bucket: DunningStage;
  viewUrl: string;
}): string {
  const { businessName, fromName, clientName, number, total, date, days, bucket, viewUrl } = args;
  const tone = DUNNING_TONES[bucket];
  const vars = {
    n: String(number),
    total: total.toLocaleString("he-IL"),
    date,
    days: String(days),
  };
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>${escapeHtml(fromName)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f7f2;font-family:Arial,sans-serif;">
  <div dir="rtl" style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#2f3a45;background-image:linear-gradient(135deg,#2f3a45,#263039);padding:24px;border-radius:16px;color:#ffffff;text-align:center;margin-bottom:24px;">
      <h1 style="margin:0;font-size:22px;">${escapeHtml(fromName)}</h1>
    </div>
    <div style="background:#ffffff;border:1px solid #e4e7e2;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 12px 0;font-size:16px;color:#1f252b;">שלום ${escapeHtml(clientName)},</p>
      <p style="margin:0 0 16px 0;font-size:15px;color:#1f252b;line-height:1.6;">${escapeHtml(fillDunningVars(tone.intro, vars))}</p>
      <p style="margin:0 0 12px 0;font-size:14px;color:#1f252b;line-height:1.6;">${escapeHtml(fillDunningVars(tone.cta, vars))}</p>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#2f3a45;background-image:linear-gradient(135deg,#2f3a45,#263039);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:bold;">
        צפו במסמך ←
      </a>
    </div>
    <div style="text-align:center;margin-bottom:16px;">
      <p style="font-size:13px;color:#5f6b76;margin:0 0 6px 0;">אם הכפתור לא עובד, העתיקו את הקישור:</p>
      <p style="font-size:12px;color:#5f6b76;margin:0;word-break:break-all;">
        <a href="${escapeHtml(viewUrl)}" style="color:#2f3a45;">${escapeHtml(viewUrl)}</a>
      </p>
    </div>
    <p style="font-size:13px;color:#5f6b76;text-align:center;margin-bottom:8px;">${escapeHtml(tone.signoff)}</p>
    <p style="font-size:14px;color:#1f252b;text-align:center;font-weight:600;margin:0 0 16px 0;">${escapeHtml(fromName)}</p>
    <p style="font-size:11px;color:#8b95a0;text-align:center;">תזכורת אוטומטית. אם התשלום כבר בוצע ולא הגיע, נשמח לשמוע.</p>
  </div>
</body>
</html>`;
}

function buildText(args: {
  fromName: string;
  clientName: string;
  number: number;
  total: number;
  date: string;
  days: number;
  bucket: DunningStage;
  viewUrl: string;
}): string {
  const { fromName, clientName, number, total, date, days, bucket, viewUrl } = args;
  const tone = DUNNING_TONES[bucket];
  const vars = {
    n: String(number),
    total: total.toLocaleString("he-IL"),
    date,
    days: String(days),
  };
  return `שלום ${clientName},

${fillDunningVars(tone.intro, vars)}

${fillDunningVars(tone.cta, vars)}

לצפייה במסמך:
${viewUrl}

${tone.signoff}
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
    .select("id, name, dunning_enabled, dunning_whatsapp_enabled, dunning_from_name, email, user_id")
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
      .select("id, business_id, client_id, client_name, number, date, total, type, status, paid_at, converted_to_id")
      .eq("business_id", biz.id)
      .in("type", ["quote", "proforma", "tax_invoice"])
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

    // Email dedupe reads only its own channel's rows. Rows written before
    // the channel column existed default to 'email', which is what they are.
    const seenBuckets = new Set(
      (existingLogs || [])
        .filter((l) => (l.channel ?? "email") === "email")
        .map((l) => `${l.document_id}:${l.day_bucket}`),
    );

    // Empty when the business only opted in to the assisted pass, so the
    // whole email block below is skipped without another level of nesting.
    const emailQueue = emailPass ? (docs as DocRow[]) : [];

    for (const doc of emailQueue) {
      const days = daysSinceIssue(doc.date);
      const bucket = dunningStageFor(days);
      if (!bucket) {
        skipped++;
        continue;
      }
      if (seenBuckets.has(`${doc.id}:${bucket}`)) {
        skipped++;
        continue;
      }
      const clientEmail = doc.client_id ? emailByClient.get(doc.client_id) : null;
      if (!clientEmail) {
        skipped++;
        details.push({ doc: doc.id, bucket, outcome: "no client email" });
        continue;
      }

      const fromName = biz.dunning_from_name || biz.name;
      const subject = fillDunningVars(DUNNING_SUBJECTS[bucket], { n: String(doc.number) });
      const viewUrl = `${APP_URL}/view/${doc.id}`;
      const html = buildHtml({
        businessName: biz.name,
        fromName,
        clientName: doc.client_name,
        number: doc.number,
        total: doc.total,
        date: doc.date,
        days,
        bucket,
        viewUrl,
      });
      const text = buildText({
        fromName,
        clientName: doc.client_name,
        number: doc.number,
        total: doc.total,
        date: doc.date,
        days,
        bucket,
        viewUrl,
      });

      try {
        await transporter.sendMail({
          from: `"${fromName}" <${GMAIL_USER}>`,
          to: clientEmail,
          replyTo: biz.email || GMAIL_USER,
          subject,
          html,
          text,
          headers: {
            "X-Auto-Response-Suppress": "All",
            "Auto-Submitted": "auto-generated",
          },
        });
        await admin.from("dunning_log").insert({
          document_id: doc.id,
          business_id: biz.id,
          day_bucket: bucket,
          sent_to: clientEmail,
          success: true,
          // Explicit, though it is also the column default: the assisted
          // pass below writes rows for the same (document, bucket) pair and
          // only the channel tells them apart.
          channel: "email",
        });
        await createNotificationForBusiness({
          businessId: biz.id,
          kind: "dunning_sent",
          title: `נשלחה תזכורת ל-${doc.client_name}`,
          body: `מסמך #${doc.number} (₪${Number(doc.total).toLocaleString("he-IL")}): תזכורת יום ${bucket}.`,
          href: `/documents/${doc.id}`,
          documentId: doc.id,
        });
        sent++;
        details.push({ doc: doc.id, bucket, outcome: "sent" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        // Deliberately do NOT write a dunning_log row on failure: the
        // UNIQUE(document_id, day_bucket, channel) constraint + the seenBuckets
        // check would then treat this bucket as already-done and never
        // retry, so a transient send failure would silently drop that
        // reminder forever. Leaving no row means the next run retries.
        // The failure is still surfaced in the run response `details`.
        errors++;
        details.push({ doc: doc.id, bucket, outcome: `error: ${msg}` });
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
