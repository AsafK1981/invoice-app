import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { createNotificationForBusiness } from "@/lib/notifications-server";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import { toIsraelDate, toIsraelHour } from "@/lib/date";
import { buildMonthlyReminder, type MonthlyReminderDoc, type MonthlyReminderSummary } from "@/lib/monthly-reminder";
import { sanitizeReminderDays, shouldSendMonthlyReminder } from "@/lib/reminder-schedule";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GMAIL_USER = process.env.GMAIL_USER!;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD!;
const MONTHLY_REMINDER_CRON_SECRET = process.env.MONTHLY_REMINDER_CRON_SECRET || "";

const APP_URL = CANONICAL_ORIGIN;

interface BusinessRow {
  id: string;
  name: string;
  monthly_reminder_enabled: boolean;
  monthly_reminder_days: number[] | null;
  monthly_reminder_hour: number | null;
  monthly_reminder_channels: string[] | null;
  monthly_reminder_last_sent: string | null;
  user_id: string;
}

/** "email"/"inapp" flags out of the raw channels array; unknown values
 *  (e.g. a future "whatsapp") are ignored - forward-compat, not an error. */
function resolveChannels(raw: string[] | null): { email: boolean; inapp: boolean } {
  const arr = Array.isArray(raw) ? raw : [];
  return { email: arr.includes("email"), inapp: arr.includes("inapp") };
}

interface DocRow {
  id: string;
  business_id: string;
  client_id: string | null;
  client_name: string;
  number: number;
  date: string;
  total: number;
  total_ils: number | null;
  type: MonthlyReminderDoc["type"];
  status: MonthlyReminderDoc["status"];
  converted_to_id: string | null;
  paid_at: string | null;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(businessName: string, summary: MonthlyReminderSummary): string {
  const openRows = summary.openItems
    .map(
      (item) =>
        `<li style="margin-bottom:6px;">${escapeHtml(DOCUMENT_TYPE_LABELS[item.type])} #${item.number} - ${escapeHtml(item.clientName)} (₪${item.amount.toLocaleString("he-IL")})</li>`,
    )
    .join("");

  const retainerRows = summary.missingRetainerClients
    .map((c) => `<li style="margin-bottom:6px;">${escapeHtml(c)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>${escapeHtml(businessName)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f7f2;font-family:Arial,sans-serif;">
  <div dir="rtl" style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:#2f3a45;background-image:linear-gradient(135deg,#2f3a45,#263039);padding:24px;border-radius:16px;color:#ffffff;text-align:center;margin-bottom:24px;">
      <h1 style="margin:0;font-size:22px;">${escapeHtml(businessName)}</h1>
      <p style="margin:8px 0 0 0;font-size:14px;opacity:0.9;">תזכורת חודשית - ${escapeHtml(summary.periodLabel)}</p>
    </div>
    <div style="background:#ffffff;border:1px solid #e4e7e2;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 16px 0;font-size:15px;color:#1f252b;line-height:1.6;">
        החודש הוצאתם ${summary.documentsThisMonthCount} מסמכים. הנה מה שכדאי לבדוק:
      </p>
      ${
        summary.openItems.length
          ? `<p style="margin:0 0 6px 0;font-size:14px;font-weight:bold;color:#1f252b;">מסמכים פתוחים שטרם הפכו לחשבונית:</p>
             <ul style="margin:0 0 16px 0;padding-inline-start:20px;font-size:14px;color:#1f252b;">${openRows}</ul>`
          : ""
      }
      ${
        summary.missingRetainerClients.length
          ? `<p style="margin:0 0 6px 0;font-size:14px;font-weight:bold;color:#1f252b;">לקוחות שקיבלו מסמך חודש שעבר אך לא החודש:</p>
             <ul style="margin:0 0 16px 0;padding-inline-start:20px;font-size:14px;color:#1f252b;">${retainerRows}</ul>`
          : ""
      }
      ${
        summary.unpaidCount > 0
          ? `<p style="margin:0 0 16px 0;font-size:14px;color:#1f252b;">יש ${summary.unpaidCount} מסמכים שטרם שולמו.</p>`
          : ""
      }
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${escapeHtml(APP_URL)}/documents" style="display:inline-block;background:#2f3a45;background-image:linear-gradient(135deg,#2f3a45,#263039);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:bold;">
        לצפייה במסמכים ←
      </a>
    </div>
    <p style="font-size:11px;color:#8b95a0;text-align:center;">תזכורת חודשית אוטומטית. ניתן לכבות בהגדרות החשבון.</p>
  </div>
</body>
</html>`;
}

function buildText(businessName: string, summary: MonthlyReminderSummary): string {
  const lines = [`תזכורת חודשית - ${summary.periodLabel}`, "", `החודש הוצאתם ${summary.documentsThisMonthCount} מסמכים.`];
  if (summary.openItems.length) {
    lines.push("", "מסמכים פתוחים שטרם הפכו לחשבונית:");
    for (const item of summary.openItems) {
      lines.push(`- ${DOCUMENT_TYPE_LABELS[item.type]} #${item.number} - ${item.clientName} (₪${item.amount.toLocaleString("he-IL")})`);
    }
  }
  if (summary.missingRetainerClients.length) {
    lines.push("", "לקוחות שקיבלו מסמך חודש שעבר אך לא החודש:");
    for (const c of summary.missingRetainerClients) lines.push(`- ${c}`);
  }
  if (summary.unpaidCount > 0) {
    lines.push("", `יש ${summary.unpaidCount} מסמכים שטרם שולמו.`);
  }
  lines.push("", `${APP_URL}/documents`);
  return lines.join("\n");
}

// Concurrency model (accepted, not enforced at the DB level): this route is
// gated by a shared secret only the GH Actions workflow holds, and that
// workflow's `concurrency: { group: monthly-reminder-daily, cancel-in-progress:
// false }` serializes runs so two invocations never overlap in practice. That
// is why there's no atomic per-row claim here. If a second legitimate caller
// with the secret is ever introduced (a second workflow, a manual trigger
// that can race the scheduled one, etc.), the upgrade path is an atomic
// claim on the update, e.g. `UPDATE businesses SET monthly_reminder_last_sent
// = :today WHERE id = :id AND (monthly_reminder_last_sent IS NULL OR
// monthly_reminder_last_sent < :scheduledDate) RETURNING id` - only proceed
// with the send if a row came back.
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-cron-secret") || "";
  if (!MONTHLY_REMINDER_CRON_SECRET || provided !== MONTHLY_REMINDER_CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now = new Date();
  const todayIsrael = toIsraelDate(now);
  const currentHourIsrael = toIsraelHour(now);

  const { data: bizs, error: bizsError } = await admin
    .from("businesses")
    .select(
      "id, name, monthly_reminder_enabled, monthly_reminder_days, monthly_reminder_hour, monthly_reminder_channels, monthly_reminder_last_sent, user_id",
    )
    .eq("monthly_reminder_enabled", true);

  if (bizsError) {
    // A schema/transient failure here must not read as "0 businesses opted
    // in" - that would silently skip every business's reminder for this
    // tick with a 200 "all good" response. Fail loudly: non-2xx makes the
    // GH workflow's HTTP-status check fail immediately (it checks status
    // before it even tries to parse an errors count out of the body).
    return NextResponse.json(
      { ok: false, sent: 0, skipped: 0, errors: 1, message: `businesses query failed: ${bizsError.message}` },
      { status: 500 },
    );
  }

  if (!bizs || bizs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, errors: 0, message: "no businesses opted in" });
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;
  const details: Array<{ business: string; outcome: string }> = [];

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
  });

  // Candidates: this run's hourly tick is the first (or a later catch-up)
  // tick at/after the chosen hour on the latest chosen day-of-month that has
  // already arrived, and last_sent hasn't caught up to that date yet. See
  // reminder-schedule.ts for the exact rule (including multi-day-per-month,
  // missed-day, and month-rollover catch-up semantics).
  const candidates = (bizs as BusinessRow[]).filter((b) =>
    shouldSendMonthlyReminder({
      days: sanitizeReminderDays(b.monthly_reminder_days),
      hour: b.monthly_reminder_hour ?? 9,
      lastSent: b.monthly_reminder_last_sent,
      todayIsrael,
      currentHourIsrael,
    }),
  );

  // Owner auth lookups are only needed for candidates that might actually
  // email (checking every enabled business's owner on every hourly tick was
  // wasted work for the ~23 ticks/day that have zero or few candidates).
  const ownerIdsNeedingEmail = Array.from(
    new Set(
      candidates
        .filter((b) => resolveChannels(b.monthly_reminder_channels).email)
        .map((b) => b.user_id)
        .filter(Boolean),
    ),
  );
  const ownerConfirmed = new Map<string, boolean>();
  const ownerEmail = new Map<string, string | null>();
  await Promise.all(
    ownerIdsNeedingEmail.map(async (uid) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(uid);
        ownerConfirmed.set(uid, !error && Boolean(data?.user?.email_confirmed_at));
        ownerEmail.set(uid, data?.user?.email ?? null);
      } catch {
        ownerConfirmed.set(uid, false);
        ownerEmail.set(uid, null);
      }
    }),
  );

  for (const biz of candidates) {
    const channels = resolveChannels(biz.monthly_reminder_channels);

    if (!channels.email && !channels.inapp) {
      skipped++;
      details.push({ business: biz.id, outcome: "skipped: no channels" });
      await admin.from("businesses").update({ monthly_reminder_last_sent: todayIsrael }).eq("id", biz.id);
      continue;
    }

    // Same auth-gate reasoning as dunning: this route has no user session,
    // only the cron secret, so it must not be able to email real clients...
    // except here the recipient IS the business owner, not a client. Still
    // gate on email verification for consistency and to avoid emailing an
    // address nobody confirmed control of. Crucially, an unverified/missing
    // owner email does NOT kill a selected inapp channel - it just means
    // email is unavailable for this send; only when email was the ONLY
    // selected channel does that become a full skip.
    let recipientEmail: string | null = null;
    let emailUnavailableReason: string | null = null;
    if (channels.email) {
      if (!ownerConfirmed.get(biz.user_id)) {
        emailUnavailableReason = "owner email not verified";
      } else {
        recipientEmail = ownerEmail.get(biz.user_id) ?? null;
        if (!recipientEmail) {
          // A confirmed owner always has an auth email; this is a defensive
          // fallback only.
          emailUnavailableReason = "no owner email";
        }
      }
    }

    if (emailUnavailableReason && !channels.inapp) {
      // Email was the only selected channel and it's unavailable - nothing
      // left to deliver. Don't stamp last_sent so a future run retries once
      // the account is in a normal state.
      skipped++;
      details.push({ business: biz.id, outcome: `skipped: ${emailUnavailableReason}` });
      continue;
    }

    const { data: docs, error: docsError } = await admin
      .from("documents")
      .select("id, business_id, client_id, client_name, number, date, total, total_ils, type, status, converted_to_id, paid_at")
      .eq("business_id", biz.id);

    if (docsError) {
      errors++;
      details.push({ business: biz.id, outcome: `error: documents query failed - ${docsError.message}` });
      continue;
    }

    const summary = buildMonthlyReminder(
      ((docs as DocRow[] | null) || []).map((d) => ({
        id: d.id,
        type: d.type,
        status: d.status,
        date: d.date,
        number: d.number,
        clientId: d.client_id,
        clientName: d.client_name,
        total: d.total,
        totalIls: d.total_ils,
        convertedToId: d.converted_to_id,
        paidAt: d.paid_at,
      })),
      now,
    );

    // Mark the date as evaluated regardless of outcome so this hourly cron
    // doesn't re-check the business on every later tick, whether we sent or
    // skipped (empty-month case still updates so it doesn't reprocess this
    // scheduled date again until the next chosen day arrives).
    try {
      if (!summary) {
        skipped++;
        details.push({ business: biz.id, outcome: "skipped: nothing open" });
        await admin.from("businesses").update({ monthly_reminder_last_sent: todayIsrael }).eq("id", biz.id);
        continue;
      }

      // Same reminder-style title/body regardless of which channel(s) fire -
      // when inapp is the only channel, the notification itself IS the
      // reminder, so it must not read like a mere "we emailed you" receipt.
      const notificationBody = `${summary.documentsThisMonthCount} מסמכים החודש, ${summary.openItems.length} פתוחים.`;

      const emailAttempted = channels.email && Boolean(recipientEmail);
      if (emailAttempted) {
        const subject = `תזכורת חודשית - ${biz.name}`;
        const html = buildHtml(biz.name, summary);
        const text = buildText(biz.name, summary);

        await transporter.sendMail({
          from: `"${biz.name}" <${GMAIL_USER}>`,
          to: recipientEmail as string,
          subject,
          html,
          text,
          headers: {
            "X-Auto-Response-Suppress": "All",
            "Auto-Submitted": "auto-generated",
          },
        });
      }

      let inappSuccess: boolean | null = null;
      if (channels.inapp) {
        inappSuccess = await createNotificationForBusiness({
          businessId: biz.id,
          kind: "monthly_reminder_sent",
          title: "תזכורת חודשית",
          body: notificationBody,
          href: "/documents",
        });
      }

      // inapp is the ONLY channel that actually delivered anything for this
      // send (email wasn't selected, or was selected but unavailable) - a
      // failed insert there means nothing went out at all. Don't stamp, so
      // the next hourly tick retries instead of silently losing the month.
      if (channels.inapp && inappSuccess === false && !emailAttempted) {
        errors++;
        details.push({ business: biz.id, outcome: "error: inapp notification insert failed" });
        continue;
      }

      const { error: stampError } = await admin
        .from("businesses")
        .update({ monthly_reminder_last_sent: todayIsrael })
        .eq("id", biz.id);

      let outcome = "sent";
      if (emailAttempted && channels.inapp && inappSuccess === false) {
        outcome = "sent: email ok, inapp notification insert failed";
      } else if (!emailAttempted && channels.inapp && emailUnavailableReason) {
        outcome = `sent: inapp only, ${emailUnavailableReason}`;
      }
      if (stampError) {
        // The send already happened and can't be undone - but if we don't
        // notice this, the business double-sends next hour because
        // last_sent never advanced. Count it as an error so the workflow
        // alarm fires and a human looks, even though the reminder itself
        // went out fine.
        errors++;
        details.push({ business: biz.id, outcome: `${outcome}, stamp failed after send: ${stampError.message}` });
      } else {
        sent++;
        details.push({ business: biz.id, outcome });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      // Deliberately do NOT stamp monthly_reminder_last_sent on a send
      // failure - the next hourly run should retry rather than silently
      // skip the rest of the month because of one transient SMTP error.
      errors++;
      details.push({ business: biz.id, outcome: `error: ${msg}` });
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    errors,
    businesses: bizs.length,
    candidates: candidates.length,
    details: details.slice(0, 50),
  });
}
