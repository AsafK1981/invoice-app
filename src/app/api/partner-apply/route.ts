import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { validatePartnerApplication } from "@/lib/partner-apply";
import { checkRate, clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

/** Global ceilings per rolling day, counted in the database. */
const MAX_APPLICATIONS_PER_DAY = 30;
const MAX_OPERATOR_MAILS_PER_DAY = 10;

/**
 * POST: an accountant asks to be listed in the in-app directory.
 *
 * Public (the accountant is not a user), so: a per-IP budget, strict shape
 * validation before the database, a honeypot, one row per email address, and
 * a global daily ceiling counted in the database, because the in-memory
 * limiter is per function instance (council review, 2026-09-30).
 *
 * The stored row is the written consent the listing rules require
 * (src/lib/partner-accountants.ts): consent_at plus exactly the contact fields
 * they chose to publish. Listing, and whether someone is a founding partner,
 * stay reviewed steps on our side: the operator gets a mail and adds the
 * entry, so nothing a stranger types is shown to users unread and nobody is
 * promised a slot by a racing counter.
 *
 * The answer is the same { ok: true } for a new application and for an
 * address that already applied, so the form cannot be used to check whether
 * a given accountant has applied.
 */
export async function POST(req: NextRequest) {
  try {
    const rl = checkRate({ key: `partner-apply:ip:${clientIp(req)}`, max: 5, windowMs: 10 * 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
      );
    }

    const parsed = validatePartnerApplication(await req.json().catch(() => ({})));
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    if (!serviceKey) {
      return NextResponse.json({ ok: false, error: "השירות לא זמין כרגע. נסו שוב מאוחר יותר." }, { status: 500 });
    }

    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const app = parsed.value;

    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { count: today, error: countError } = await sb
      .from("partner_applications")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayAgo);
    if (countError || today === null) {
      return NextResponse.json({ ok: false, error: "לא הצלחנו לשמור את הבקשה. נסו שוב." }, { status: 500 });
    }
    if (today >= MAX_APPLICATIONS_PER_DAY) {
      return NextResponse.json({ ok: false, error: "קיבלנו היום הרבה בקשות. נסו שוב מחר." }, { status: 429 });
    }

    const { error } = await sb.from("partner_applications").insert({
      name: app.name,
      office: app.office,
      city: app.city,
      email: app.email,
      phone: app.phone,
      website: app.website,
      ref: app.ref,
      consent_at: new Date().toISOString(),
    });
    // 23505: this address already applied. Same answer, nothing new stored.
    if (error && error.code !== "23505") {
      return NextResponse.json({ ok: false, error: "לא הצלחנו לשמור את הבקשה. נסו שוב." }, { status: 500 });
    }

    if (!error && today < MAX_OPERATOR_MAILS_PER_DAY && GMAIL_USER && GMAIL_APP_PASSWORD) {
      // After the response: the applicant should not wait on SMTP. Capped per
      // day because this account also carries customer mail.
      after(async () => {
        try {
          const transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
          });
          const lines = [
            `שם: ${app.name}`,
            `משרד: ${app.office ?? "-"}`,
            `עיר: ${app.city}`,
            `מייל: ${app.email}`,
            `טלפון: ${app.phone ?? "-"}`,
            `אתר: ${app.website ?? "-"}`,
          ];
          await transporter.sendMail({
            from: `"חשבונית ידידותית" <${GMAIL_USER}>`,
            to: GMAIL_USER,
            subject: `רואה חשבון ביקש להצטרף לרשימה: ${app.name}`,
            text: `${lines.join("\n")}\n\nכל הבקשות מופיעות ב-/admin. כדי לפרסם: להוסיף רשומה ל-PARTNER_ACCOUNTANTS ב-src/lib/partner-accountants.ts.`,
          });
        } catch {
          // The row is saved and shows on /admin; the mail is a convenience.
        }
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "שגיאה. נסו שוב." }, { status: 500 });
  }
}
