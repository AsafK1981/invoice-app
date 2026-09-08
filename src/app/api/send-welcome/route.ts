import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { buildWelcomeHtml, buildWelcomeText, WELCOME_SUBJECT } from "./template";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

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
      subject: WELCOME_SUBJECT,
      html: buildWelcomeHtml(),
      text: buildWelcomeText(),
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
