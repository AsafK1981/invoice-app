import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { createNotificationForBusiness } from "@/lib/notifications-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GMAIL_USER = process.env.GMAIL_USER!;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD!;
const DUNNING_CRON_SECRET = process.env.DUNNING_CRON_SECRET || "";

const APP_URL = "https://mysuperfriendlyinvoiceapp.vercel.app";

type DayBucket = 3 | 14 | 30;
const BUCKETS: DayBucket[] = [30, 14, 3]; // newest first — earliest match wins

const SUBJECTS: Record<DayBucket, string> = {
  3: "תזכורת — חשבונית מספר {n}",
  14: "תזכורת שנייה — חשבונית מספר {n}",
  30: "חשבונית מספר {n} — תשלום מתעכב",
};

const TONES: Record<DayBucket, { intro: string; cta: string; signoff: string }> = {
  3: {
    intro: "מקווה שהמסמך הגיע בסדר. רק רציתי לוודא שראיתם את חשבונית מס מספר {n} על סך ₪{total} ששלחנו ב-{date}.",
    cta: "אם נוח לכם, אשמח לסגור את התשלום. כל פרטי התשלום נמצאים בחשבונית.",
    signoff: "תודה רבה,",
  },
  14: {
    intro: "אנחנו עוקבים אחרי חשבונית מספר {n} על סך ₪{total} ששלחנו ב-{date} — חלפו כבר {days} ימים ולא ראינו את התשלום.",
    cta: "אשמח לקבל עדכון: האם התשלום בוצע ולא הגיע, או שעדיין מתעכב?",
    signoff: "תודה,",
  },
  30: {
    intro: "חשבונית מספר {n} על סך ₪{total} מ-{date} עדיין לא שולמה — חלפו {days} ימים.",
    cta: "אנא תאמו אתנו תאריך תשלום בהקדם. אם יש בעיה או שאלה — נשמח לסייע.",
    signoff: "בכבוד רב,",
  },
};

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
}

interface BusinessRow {
  id: string;
  name: string;
  dunning_enabled: boolean;
  dunning_from_name: string | null;
  email: string | null;
}

interface ClientRow {
  id: string;
  email: string | null;
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr).getTime();
  return Math.floor((Date.now() - d) / 86400000);
}

function bucketFor(days: number): DayBucket | null {
  for (const b of BUCKETS) {
    if (days >= b) return b;
  }
  return null;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function buildHtml(args: {
  businessName: string;
  fromName: string;
  clientName: string;
  number: number;
  total: number;
  date: string;
  days: number;
  bucket: DayBucket;
  viewUrl: string;
}): string {
  const { businessName, fromName, clientName, number, total, date, days, bucket, viewUrl } = args;
  const tone = TONES[bucket];
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
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,sans-serif;">
  <div dir="rtl" style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#f97316,#e11d48);padding:24px;border-radius:16px;color:white;text-align:center;margin-bottom:24px;">
      <h1 style="margin:0;font-size:22px;">${escapeHtml(fromName)}</h1>
    </div>
    <div style="background:#fffaf5;border:1px solid #fed7aa;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 12px 0;font-size:16px;color:#44403c;">שלום ${escapeHtml(clientName)},</p>
      <p style="margin:0 0 16px 0;font-size:15px;color:#44403c;line-height:1.6;">${escapeHtml(fill(tone.intro, vars))}</p>
      <p style="margin:0 0 12px 0;font-size:14px;color:#44403c;line-height:1.6;">${escapeHtml(fill(tone.cta, vars))}</p>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:linear-gradient(135deg,#f97316,#e11d48);color:white;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:bold;">
        צפו במסמך ←
      </a>
    </div>
    <div style="text-align:center;margin-bottom:16px;">
      <p style="font-size:13px;color:#57534e;margin:0 0 6px 0;">אם הכפתור לא עובד, העתיקו את הקישור:</p>
      <p style="font-size:12px;color:#78716c;margin:0;word-break:break-all;">
        <a href="${escapeHtml(viewUrl)}" style="color:#ea580c;">${escapeHtml(viewUrl)}</a>
      </p>
    </div>
    <p style="font-size:13px;color:#78716c;text-align:center;margin-bottom:8px;">${escapeHtml(tone.signoff)}</p>
    <p style="font-size:14px;color:#44403c;text-align:center;font-weight:600;margin:0 0 16px 0;">${escapeHtml(fromName)}</p>
    <p style="font-size:11px;color:#a8a29e;text-align:center;">תזכורת אוטומטית — אם התשלום כבר בוצע ולא הגיע, נשמח לשמוע.</p>
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
  bucket: DayBucket;
  viewUrl: string;
}): string {
  const { fromName, clientName, number, total, date, days, bucket, viewUrl } = args;
  const tone = TONES[bucket];
  const vars = {
    n: String(number),
    total: total.toLocaleString("he-IL"),
    date,
    days: String(days),
  };
  return `שלום ${clientName},

${fill(tone.intro, vars)}

${fill(tone.cta, vars)}

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

  const { data: bizs } = await admin
    .from("businesses")
    .select("id, name, dunning_enabled, dunning_from_name, email")
    .eq("dunning_enabled", true);

  if (!bizs || bizs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, message: "no businesses opted in" });
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;
  const details: Array<{ doc: string; bucket: number; outcome: string }> = [];

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
  });

  for (const biz of bizs as BusinessRow[]) {
    const { data: docs } = await admin
      .from("documents")
      .select("id, business_id, client_id, client_name, number, date, total, type, status, paid_at")
      .eq("business_id", biz.id)
      .in("type", ["quote", "tax_invoice"])
      .eq("status", "sent");

    if (!docs || docs.length === 0) continue;

    const clientIds = Array.from(
      new Set((docs as DocRow[]).map((d) => d.client_id).filter(Boolean)),
    ) as string[];

    const { data: clients } = clientIds.length
      ? await admin.from("clients").select("id, email").in("id", clientIds)
      : { data: [] };

    const emailByClient = new Map<string, string | null>(
      (clients as ClientRow[] | null)?.map((c) => [c.id, c.email]) || [],
    );

    const { data: existingLogs } = await admin
      .from("dunning_log")
      .select("document_id, day_bucket")
      .in("document_id", (docs as DocRow[]).map((d) => d.id));

    const seenBuckets = new Set(
      (existingLogs || []).map((l) => `${l.document_id}:${l.day_bucket}`),
    );

    for (const doc of docs as DocRow[]) {
      const days = daysSince(doc.date);
      const bucket = bucketFor(days);
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
      const subject = fill(SUBJECTS[bucket], { n: String(doc.number) });
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
        });
        await createNotificationForBusiness({
          businessId: biz.id,
          kind: "dunning_sent",
          title: `נשלחה תזכורת ל-${doc.client_name}`,
          body: `מסמך #${doc.number} (₪${Number(doc.total).toLocaleString("he-IL")}) — תזכורת יום ${bucket}.`,
          href: `/documents/${doc.id}`,
          documentId: doc.id,
        });
        sent++;
        details.push({ doc: doc.id, bucket, outcome: "sent" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        await admin.from("dunning_log").insert({
          document_id: doc.id,
          business_id: biz.id,
          day_bucket: bucket,
          sent_to: clientEmail,
          success: false,
          error_message: msg.slice(0, 500),
        });
        errors++;
        details.push({ doc: doc.id, bucket, outcome: `error: ${msg}` });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    errors,
    businesses: bizs.length,
    details: details.slice(0, 50),
  });
}
