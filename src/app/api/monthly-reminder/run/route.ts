import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { createNotificationForBusiness } from "@/lib/notifications-server";
import { CANONICAL_ORIGIN } from "@/lib/public-url";
import { toIsraelDate } from "@/lib/date";
import { buildMonthlyReminder, type MonthlyReminderDoc, type MonthlyReminderSummary } from "@/lib/monthly-reminder";
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
  monthly_reminder_day: number;
  monthly_reminder_last_sent: string | null;
  user_id: string;
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
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,sans-serif;">
  <div dir="rtl" style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#f97316,#e11d48);padding:24px;border-radius:16px;color:white;text-align:center;margin-bottom:24px;">
      <h1 style="margin:0;font-size:22px;">${escapeHtml(businessName)}</h1>
      <p style="margin:8px 0 0 0;font-size:14px;opacity:0.9;">תזכורת חודשית - ${escapeHtml(summary.periodLabel)}</p>
    </div>
    <div style="background:#fffaf5;border:1px solid #fed7aa;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 16px 0;font-size:15px;color:#44403c;line-height:1.6;">
        החודש הוצאתם ${summary.documentsThisMonthCount} מסמכים. הנה מה שכדאי לבדוק:
      </p>
      ${
        summary.openItems.length
          ? `<p style="margin:0 0 6px 0;font-size:14px;font-weight:bold;color:#44403c;">מסמכים פתוחים שטרם הפכו לחשבונית:</p>
             <ul style="margin:0 0 16px 0;padding-inline-start:20px;font-size:14px;color:#44403c;">${openRows}</ul>`
          : ""
      }
      ${
        summary.missingRetainerClients.length
          ? `<p style="margin:0 0 6px 0;font-size:14px;font-weight:bold;color:#44403c;">לקוחות שקיבלו מסמך חודש שעבר אך לא החודש:</p>
             <ul style="margin:0 0 16px 0;padding-inline-start:20px;font-size:14px;color:#44403c;">${retainerRows}</ul>`
          : ""
      }
      ${
        summary.unpaidCount > 0
          ? `<p style="margin:0 0 16px 0;font-size:14px;color:#44403c;">יש ${summary.unpaidCount} מסמכים שטרם שולמו.</p>`
          : ""
      }
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${escapeHtml(APP_URL)}/documents" style="display:inline-block;background:linear-gradient(135deg,#f97316,#e11d48);color:white;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:bold;">
        לצפייה במסמכים ←
      </a>
    </div>
    <p style="font-size:11px;color:#a8a29e;text-align:center;">תזכורת חודשית אוטומטית. ניתן לכבות בהגדרות החשבון.</p>
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

/** Same calendar-month check the content builder uses, but on the raw DB date string. */
function isPreviousMonthOrNull(lastSent: string | null, todayIsrael: string): boolean {
  if (!lastSent) return true;
  return lastSent.slice(0, 7) !== todayIsrael.slice(0, 7);
}

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
  const todayOfMonth = Number(todayIsrael.split("-")[2]);

  const { data: bizs } = await admin
    .from("businesses")
    .select("id, name, monthly_reminder_enabled, monthly_reminder_day, monthly_reminder_last_sent, user_id")
    .eq("monthly_reminder_enabled", true);

  if (!bizs || bizs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, errors: 0, message: "no businesses opted in" });
  }

  // Same auth-gate reasoning as dunning: this route has no user session, only
  // the cron secret, so it must not be able to email real clients... except
  // here the recipient IS the business owner, not a client. Still gate on
  // email verification for consistency and to avoid emailing an address
  // nobody confirmed control of.
  const ownerIds = Array.from(new Set((bizs as BusinessRow[]).map((b) => b.user_id).filter(Boolean)));
  const ownerConfirmed = new Map<string, boolean>();
  const ownerEmail = new Map<string, string | null>();
  await Promise.all(
    ownerIds.map(async (uid) => {
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

  // Candidates: today matches the chosen day, OR the chosen day already
  // passed this month and the business hasn't been sent to yet - the retry
  // path promised below on send failure. isPreviousMonthOrNull already
  // guards against resending within the same calendar month.
  const candidates = (bizs as BusinessRow[]).filter(
    (b) =>
      todayOfMonth >= b.monthly_reminder_day &&
      isPreviousMonthOrNull(b.monthly_reminder_last_sent, todayIsrael),
  );

  for (const biz of candidates) {
    if (!ownerConfirmed.get(biz.user_id)) {
      skipped++;
      details.push({ business: biz.id, outcome: "skipped: owner email not verified" });
      continue;
    }
    const recipientEmail = ownerEmail.get(biz.user_id) ?? null;
    if (!recipientEmail) {
      // A confirmed owner always has an auth email; this is a defensive
      // fallback only. Don't stamp last_sent so a future run retries once
      // the account is in a normal state.
      skipped++;
      details.push({ business: biz.id, outcome: "skipped: no owner email" });
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

    // Mark the day as evaluated regardless of outcome so we don't re-check
    // this business daily for the rest of the month, whether we sent or
    // skipped (empty-month case still updates so the cron doesn't reprocess
    // it on day+1, day+2, ... until the next chosen day).
    try {
      if (!summary) {
        skipped++;
        details.push({ business: biz.id, outcome: "skipped: nothing open" });
        await admin.from("businesses").update({ monthly_reminder_last_sent: todayIsrael }).eq("id", biz.id);
        continue;
      }

      const subject = `תזכורת חודשית - ${biz.name}`;
      const html = buildHtml(biz.name, summary);
      const text = buildText(biz.name, summary);

      await transporter.sendMail({
        from: `"${biz.name}" <${GMAIL_USER}>`,
        to: recipientEmail,
        subject,
        html,
        text,
        headers: {
          "X-Auto-Response-Suppress": "All",
          "Auto-Submitted": "auto-generated",
        },
      });

      await createNotificationForBusiness({
        businessId: biz.id,
        kind: "monthly_reminder_sent",
        title: "נשלחה תזכורת חודשית",
        body: `${summary.documentsThisMonthCount} מסמכים החודש, ${summary.openItems.length} פתוחים.`,
        href: "/documents",
      });

      await admin.from("businesses").update({ monthly_reminder_last_sent: todayIsrael }).eq("id", biz.id);
      sent++;
      details.push({ business: biz.id, outcome: "sent" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      // Deliberately do NOT stamp monthly_reminder_last_sent on a send
      // failure - the next day's run should retry rather than silently
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
