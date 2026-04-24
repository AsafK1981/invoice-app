import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

const resend = new Resend(process.env.RESEND_API_KEY);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

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
}) {
  const { businessName, clientName, receiptNumber, total, viewUrl, logoUrl } = args;
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
          מצורף מסמך מספר <strong>#${escapeHtml(String(receiptNumber))}</strong> על סך <strong>₪${escapeHtml(String(Number(total).toLocaleString()))}</strong>.
        </p>
        <p style="margin: 0; font-size: 14px; color: #78716c;">
          לצפייה במסמך המלא והדפסה/הורדה כ-PDF, לחץ על הכפתור למטה.
        </p>
      </div>

      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${escapeHtml(viewUrl)}" style="display: inline-block; background: linear-gradient(135deg, #f97316, #e11d48); color: white; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-size: 16px; font-weight: bold;">
          צפה במסמך ←
        </a>
      </div>

      <div style="text-align: center; margin-bottom: 24px;">
        <p style="font-size: 13px; color: #a8a29e;">
          מסמך זה נשלח אוטומטית מ${escapeHtml(businessName)}
        </p>
      </div>
    </div>
  `;
}

export async function POST(req: NextRequest) {
  try {
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

    const body = await req.json();
    const { to, clientName, receiptNumber, total, businessName, subject, documentId, logoUrl } = body;

    const baseUrl = process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL || "https://invoice-app-ochre-five.vercel.app";
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

    const emailSubject = subject || `${businessName} - מסמך #${receiptNumber}`;
    const html = buildHtml({ businessName, clientName, receiptNumber, total, viewUrl, logoUrl });

    // Use Gmail SMTP if configured, else fall back to Resend
    if (GMAIL_USER && GMAIL_APP_PASSWORD) {
      try {
        const transporter = nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: {
            user: GMAIL_USER,
            pass: GMAIL_APP_PASSWORD,
          },
        });

        const info = await transporter.sendMail({
          from: `${businessName} <${GMAIL_USER}>`,
          to: recipients.join(", "),
          subject: emailSubject,
          html,
        });

        return NextResponse.json({
          ok: true,
          messageId: info.messageId,
          mocked: false,
          provider: "gmail",
        });
      } catch (gmailErr) {
        console.error("Gmail SMTP error:", gmailErr);
        // Fall through to Resend
      }
    }

    // Fallback: Resend
    const { data, error } = await resend.emails.send({
      from: `${escapeHtml(businessName)} <onboarding@resend.dev>`,
      to: recipients,
      subject: emailSubject,
      html,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, messageId: data?.id, mocked: false, provider: "resend" });
  } catch (err) {
    console.error("Send email error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
