import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { signPortalToken, PORTAL_LINK_TTL_MS } from "@/lib/portal-token";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GMAIL_USER = process.env.GMAIL_USER!;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD!;

// Strict-and-narrow email regex. RFC technically allows `_` and `%` in
// local-parts, but they're SQL wildcards in the downstream ilike/like
// path; even if we use eq() everywhere, refusing them at the boundary
// makes a regression cheap to spot. Real users practically never use
// either in their addresses.
const EMAIL_RE = /^[a-zA-Z0-9.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = checkRate({ key: `portal-request:ip:${ip}`, max: 5, windowMs: 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: "יותר מדי בקשות. נסה שוב בעוד דקה." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : "";

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ ok: false, error: "כתובת מייל לא תקינה" }, { status: 400 });
    }

    // Always respond ok even when we don't find the email. Don't leak
    // whether an email is a customer of someone on the platform.
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ilike for case-insensitive match against stored emails. The
    // submitted email already passed EMAIL_RE (no `%`/`_`) but escape
    // anyway as defense-in-depth.
    const escapedEmail = email.replace(/[\\%_]/g, "\\$&");
    const { data: clientRows } = await admin
      .from("clients")
      .select("id, email")
      .ilike("email", escapedEmail);

    const hasMatch = (clientRows?.length ?? 0) > 0;

    if (hasMatch) {
      const token = signPortalToken(email, PORTAL_LINK_TTL_MS, "link");
      const baseUrl = "https://mysuperfriendlyinvoiceapp.vercel.app";
      const link = `${baseUrl}/api/portal/verify?token=${encodeURIComponent(token)}`;

      const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>קישור כניסה לפורטל הלקוחות</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,sans-serif;">
  <div dir="rtl" style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:linear-gradient(135deg,#f97316,#e11d48);padding:24px;border-radius:16px;color:white;text-align:center;margin-bottom:24px;">
      <h1 style="margin:0;font-size:22px;">פורטל הלקוחות</h1>
    </div>
    <div style="background:#fffaf5;border:1px solid #fed7aa;border-radius:12px;padding:24px;margin-bottom:24px;">
      <p style="margin:0 0 12px 0;font-size:16px;color:#44403c;">שלום,</p>
      <p style="margin:0 0 12px 0;font-size:14px;color:#44403c;">
        ביקשתם קישור כניסה לצפייה בכל החשבוניות שלכם.
      </p>
      <p style="margin:0;font-size:14px;color:#44403c;">
        הקישור תקף ל-24 שעות ומשמש לכניסה חד-פעמית לסשן של 7 ימים.
      </p>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#f97316,#e11d48);color:white;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:bold;">
        כניסה לפורטל ←
      </a>
    </div>
    <div style="text-align:center;margin-bottom:16px;">
      <p style="font-size:13px;color:#57534e;margin:0 0 6px 0;">אם הכפתור לא נפתח, העתיקו את הקישור:</p>
      <p style="font-size:12px;color:#78716c;margin:0;word-break:break-all;">
        <a href="${link}" style="color:#ea580c;">${link}</a>
      </p>
    </div>
    <p style="font-size:12px;color:#a8a29e;text-align:center;">
      אם לא ביקשתם קישור, אפשר להתעלם מהמייל.
    </p>
  </div>
</body>
</html>`;

      const text = `שלום,

ביקשתם קישור כניסה לפורטל הלקוחות.

לחצו על הקישור הבא (תקף ל-24 שעות):
${link}

אם לא ביקשתם, אפשר להתעלם.
`;

      try {
        const transporter = nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
        });
        await transporter.sendMail({
          from: `"פורטל לקוחות" <${GMAIL_USER}>`,
          to: email,
          subject: "קישור כניסה לפורטל הלקוחות",
          html,
          text,
          headers: {
            "X-Auto-Response-Suppress": "All",
            "Auto-Submitted": "auto-generated",
          },
        });
      } catch (err) {
        // Log but don't reveal failure; keeps email-existence
        // non-distinguishable across success/failure paths.
        console.error("portal request-link send failed", err);
      }
    }

    return NextResponse.json({
      ok: true,
      message: "אם הכתובת רשומה אצל אחד מהעסקים, נשלח אליה קישור.",
    });
  } catch (err) {
    console.error("portal request-link error", err);
    return NextResponse.json({ ok: false, error: "שגיאה בשרת" }, { status: 500 });
  }
}
