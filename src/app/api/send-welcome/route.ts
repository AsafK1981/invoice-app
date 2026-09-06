import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { CANONICAL_ORIGIN } from "@/lib/public-url";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

const APP_URL = CANONICAL_ORIGIN;

function buildWelcomeHtml(): string {
  return `
    <div dir="rtl" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Heebo, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f252b; background: #fdeee6; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display:inline-block;background:#2f3a45;color:#ffffff;padding:14px 22px;border-radius:18px;font-weight:700;font-size:16px;">
          חשבונית ידידותית
        </div>
      </div>
      <h1 style="color:#1f252b;font-size:22px;margin:0 0 12px;">ברוך/ה הבא/ה! 🎉</h1>
      <p style="color:#1f252b;font-size:15px;line-height:1.6;margin:0 0 16px;">
        תודה שנרשמת לחשבונית ידידותית, אפליקציה אישית להפקת חשבוניות וקבלות לעצמאיים בישראל.
      </p>
      <p style="color:#1f252b;font-size:15px;line-height:1.6;margin:0 0 16px;">
        מה אפשר לעשות מכאן:
      </p>
      <ul style="color:#1f252b;font-size:15px;line-height:1.8;margin:0 0 20px;padding-right:20px;">
        <li>למלא את פרטי העסק, כדי שיופיעו אוטומטית על כל מסמך</li>
        <li>להוסיף לקוחות ומוצרים פעם אחת, והפקה הופכת לשנייה</li>
        <li>להפיק קבלות, חשבונות עסקה, חשבוניות מס</li>
        <li>לשלוח ללקוח באימייל / WhatsApp / קישור לשיתוף</li>
        <li>להוריד PDF מקצועי בלחיצה</li>
        <li>לעקוב אחרי הכנסות, הוצאות, ומסמכים פתוחים</li>
      </ul>
      <div style="text-align:center;margin:28px 0;">
        <a href="${APP_URL}/dashboard" style="display:inline-block;background:#2f3a45;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:14px;font-weight:600;font-size:15px;">
          למסך הראשי שלי
        </a>
      </div>
      <p style="color:#5f6b76;font-size:13px;line-height:1.5;margin:0 0 8px;">
        טיפ: במסך הראשי תמצא צ'ק-ליסט קצר עם 5 צעדים להפקת המסמך הראשון.
      </p>
      <p style="color:#5f6b76;font-size:13px;line-height:1.5;margin:0;">
        יש שאלה? פשוט תענה למייל הזה, מגיע אליי ישר.
      </p>
    </div>
  `;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7);

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user || !user.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Idempotency: skip if we already welcomed this user
  if (user.user_metadata?.welcomed_at) {
    return NextResponse.json({ ok: true, alreadyWelcomed: true });
  }

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return NextResponse.json(
      { ok: false, error: "Gmail SMTP not configured on the server" },
      { status: 503 }
    );
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  try {
    await transporter.sendMail({
      // Hebrew brand in the display name (2026-08-11), matching the auth
      // pages and the Supabase auth templates. The address itself is still
      // the Gmail relay - the domain is not verified with a sending
      // provider yet, so this is the most the FROM line can say truthfully.
      from: `"חשבונית ידידותית" <${GMAIL_USER}>`,
      to: user.email,
      subject: "ברוך הבא לחשבונית ידידותית 🎉",
      html: buildWelcomeHtml(),
      replyTo: GMAIL_USER,
    });

    // Mark as welcomed so we never double-send (uses service role to update auth user metadata)
    const admin = createClient(supabaseUrl, serviceKey);
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, welcomed_at: new Date().toISOString() },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}

export function GET() {
  return NextResponse.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}
