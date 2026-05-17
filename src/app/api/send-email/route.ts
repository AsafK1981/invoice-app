import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { checkRate, clientIp } from "@/lib/rate-limit";

const resend = new Resend(process.env.RESEND_API_KEY);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const FALLBACK_GMAIL_USER = process.env.GMAIL_USER;
const FALLBACK_GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(args: {
  businessName: string;
  clientName: string;
  receiptNumber: string | number;
  total: number;
  viewUrl: string;
  logoUrl?: string;
  kind?: "initial" | "reminder";
  daysSinceSent?: number;
  /** 1×1 tracking-pixel URL — stamps email_opened_at when the recipient
   *  loads the message. Omit to disable tracking for a particular send. */
  trackingPixelUrl?: string;
}) {
  const { businessName, clientName, receiptNumber, total, viewUrl, logoUrl, kind = "initial", daysSinceSent, trackingPixelUrl } = args;
  const isReminder = kind === "reminder";
  const introLine = isReminder
    ? `מקווה שאתם בסדר. רק תזכורת קלה לגבי מסמך מספר <strong>#${escapeHtml(String(receiptNumber))}</strong> על סך <strong>₪${escapeHtml(String(Number(total).toLocaleString()))}</strong>${
        daysSinceSent ? ` ששלחנו לפני ${daysSinceSent} ימים` : ""
      } — אשמח לדעת אם הוא הגיע ומה דעתכם.`
    : `מצורף מסמך מספר <strong>#${escapeHtml(String(receiptNumber))}</strong> על סך <strong>₪${escapeHtml(String(Number(total).toLocaleString()))}</strong>.`;
  const ctaLine = isReminder
    ? "לצפייה חוזרת במסמך המלא:"
    : "לצפייה במסמך המלא והדפסה/הורדה כ-PDF, לחץ על הכפתור למטה.";

  return `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #f97316, #e11d48); padding: 24px; border-radius: 16px; color: white; text-align: center; margin-bottom: 24px;">
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName)}" style="max-height: 60px; max-width: 200px; margin-bottom: 12px; background: white; padding: 8px; border-radius: 8px;" />` : ""}
        <h1 style="margin: 0; font-size: 24px;">${escapeHtml(businessName)}</h1>
      </div>

      <div style="background: #fffaf5; border: 1px solid #fed7aa; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <p style="margin: 0 0 12px 0; font-size: 16px; color: #44403c;">
          שלום ${escapeHtml(clientName)},
        </p>
        <p style="margin: 0 0 16px 0; font-size: 16px; color: #44403c;">
          ${introLine}
        </p>
        <p style="margin: 0; font-size: 14px; color: #78716c;">
          ${ctaLine}
        </p>
      </div>

      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${escapeHtml(viewUrl)}" style="display: inline-block; background: linear-gradient(135deg, #f97316, #e11d48); color: white; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-size: 16px; font-weight: bold;">
          צפה במסמך ←
        </a>
      </div>

      <div style="text-align: center; margin-bottom: 24px;">
        <p style="font-size: 13px; color: #a8a29e;">
          ${isReminder ? `תזכורת אוטומטית מ${escapeHtml(businessName)}` : `מסמך זה נשלח אוטומטית מ${escapeHtml(businessName)}`}
        </p>
      </div>

      ${
        trackingPixelUrl
          ? `<img src="${escapeHtml(trackingPixelUrl)}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;border:0;outline:none;" />`
          : ""
      }
    </div>
  `;
}

export async function POST(req: NextRequest) {
  try {
    // Rate limit BEFORE auth: cheaper to reject bad actors early. Using
    // IP because we haven't auth'd yet. 20 sends per IP per minute is
    // generous for legitimate users (a freelancer sending out a batch)
    // but stops a runaway script from blasting through Gmail's daily
    // quota in seconds.
    const ip = clientIp(req);
    const ipLimit = checkRate({ key: `send-email:ip:${ip}`, max: 20, windowMs: 60_000 });
    if (!ipLimit.ok) {
      return NextResponse.json(
        { ok: false, error: "יותר מדי בקשות. נסה שוב בעוד דקה." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(ipLimit.resetIn / 1000)) } },
      );
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Per-user limit on top of per-IP. A legitimate user behind a NAT
    // shouldn't see this; a single user account being abused will.
    const userLimit = checkRate({ key: `send-email:user:${user.id}`, max: 60, windowMs: 60 * 60_000 });
    if (!userLimit.ok) {
      return NextResponse.json(
        { ok: false, error: "חרגת ממכסת השליחה השעתית (60 מיילים בשעה)." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(userLimit.resetIn / 1000)) } },
      );
    }

    const body = await req.json();
    const { to, clientName, receiptNumber, total, businessName, subject, documentId, logoUrl, kind, daysSinceSent } = body;

    // Always use the canonical URL — never NEXT_PUBLIC_VERCEL_URL, which
    // is the immutable per-deploy hash and will decay into stale-code
    // views minutes after the next push. The link is going into an email
    // that will sit in someone's inbox for weeks.
    const baseUrl = "https://mysuperfriendlyinvoiceapp.vercel.app";
    const viewUrl = `${baseUrl}/view/${documentId}`;

    if (!to || !clientName || !receiptNumber) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const recipients = String(to)
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      return NextResponse.json({ ok: false, error: "לא נמצאו נמענים" }, { status: 400 });
    }

    const isReminder = kind === "reminder";
    const baseSubject = subject || `${businessName} - מסמך #${receiptNumber}`;
    const emailSubject = isReminder ? `תזכורת: ${baseSubject}` : baseSubject;
    // Tracking pixel — only when we have a documentId to attribute the
    // open event to. Suffix `.gif` for mail clients that are picky about
    // extensionless image URLs.
    const trackingPixelUrl =
      typeof documentId === "string" && documentId
        ? `${baseUrl}/api/email/track/${documentId}.gif`
        : undefined;

    const html = buildHtml({
      businessName,
      clientName,
      receiptNumber,
      total,
      viewUrl,
      logoUrl,
      kind: isReminder ? "reminder" : "initial",
      daysSinceSent: typeof daysSinceSent === "number" ? daysSinceSent : undefined,
      trackingPixelUrl,
    });

    // Pick Gmail credentials: prefer the user's own, fall back to global env vars
    const userGmailUser = (user.user_metadata?.gmail_user as string) || FALLBACK_GMAIL_USER;
    const userGmailPassword =
      (user.user_metadata?.gmail_app_password as string) || FALLBACK_GMAIL_APP_PASSWORD;

    // Sanitize for SMTP From header (no HTML, no quotes, no commas)
    const fromName = String(businessName || "").replace(/[",;<>\r\n]/g, " ").trim() || "Invoices";

    // Prefer Gmail SMTP when configured. If both Gmail creds are present and
    // the send fails, surface the error directly — falling through to Resend
    // hides the real cause from the user (and Resend's onboarding@resend.dev
    // sender can only deliver to the Resend account owner anyway, so it's not
    // a useful fallback for arbitrary recipients).
    if (userGmailUser && userGmailPassword) {
      try {
        const transporter = nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: {
            user: userGmailUser,
            pass: String(userGmailPassword).replace(/\s+/g, ""),
          },
        });

        const info = await transporter.sendMail({
          from: `"${fromName}" <${userGmailUser}>`,
          to: recipients.join(", "),
          subject: emailSubject,
          html,
        });

        console.log("[send-email] gmail ok", {
          to: recipients,
          messageId: info.messageId,
          documentId,
        });
        return NextResponse.json({
          ok: true,
          messageId: info.messageId,
          mocked: false,
          provider: "gmail",
        });
      } catch (gmailErr) {
        const msg = gmailErr instanceof Error ? gmailErr.message : String(gmailErr);
        console.error("[send-email] gmail failed", { to: recipients, msg });
        return NextResponse.json(
          { ok: false, error: `שליחה ב-Gmail נכשלה: ${msg}` },
          { status: 500 },
        );
      }
    }

    // Resend fallback path — only if Gmail isn't configured at all.
    const { data, error } = await resend.emails.send({
      from: `${fromName} <onboarding@resend.dev>`,
      to: recipients,
      subject: emailSubject,
      html,
    });

    if (error) {
      // Full error stays in server logs; client gets a generic string
      // so we don't leak Resend / Postgres internals to authenticated
      // users (who can be arbitrary signups).
      console.error("[send-email] resend failed", { to: recipients, error });
      return NextResponse.json(
        { ok: false, error: "שליחת המייל נכשלה. נסה שוב או פנה לתמיכה." },
        { status: 500 },
      );
    }

    console.log("[send-email] resend ok", { to: recipients, messageId: data?.id, documentId });
    return NextResponse.json({ ok: true, messageId: data?.id, mocked: false, provider: "resend" });
  } catch (err) {
    console.error("Send email error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
