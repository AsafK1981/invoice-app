import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { sanitizeEmailSubject } from "@/lib/email-subject";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/types";
import { requiresAllocationNumber, normalizeCustomerVatNumber } from "@/lib/tax-authority";
import { canIssueTaxInvoicesByType } from "@/lib/vat";
import { buildHtml, buildText } from "./template";

const resend = new Resend(process.env.RESEND_API_KEY);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FALLBACK_GMAIL_USER = process.env.GMAIL_USER;
const FALLBACK_GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;


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
    // Only these come from the client. Everything shown in the email
    // (business name, amount, doc number, client name, logo) is derived
    // from the DB below — never trusted from the body — so an authenticated
    // user can't send fabricated invoice content (phishing) through the
    // platform's shared Gmail identity.
    const { to, subject, documentId, kind, daysSinceSent } = body;

    if (!documentId || !UUID_RE.test(String(documentId))) {
      return NextResponse.json({ ok: false, error: "documentId required" }, { status: 400 });
    }

    // Verify the caller owns this document, then pull the real content from it.
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // הוראות ניהול ספרים סעיף 18ב: a successful send is the first authoritative
    // delivery of the מקור. Stamp original_issued_at once (idempotent — only
    // while NULL) so every later render is העתק. Best-effort: a failure here must
    // NOT fail the (already-sent) email.
    const stampOriginalIssued = async () => {
      try {
        await admin
          .from("documents")
          .update({ original_issued_at: new Date().toISOString() })
          .eq("id", documentId)
          .is("original_issued_at", null);
      } catch (err) {
        console.error("[send-email] failed to stamp original_issued_at", { documentId, err });
      }
    };
    const { data: docRow } = await admin
      .from("documents")
      .select(
        "id, business_id, number, total, client_name, type, currency, date, subtotal, subtotal_ils, total_ils, allocation_number, client_id, client_tax_id",
      )
      .eq("id", documentId)
      .maybeSingle();
    if (!docRow) {
      return NextResponse.json({ ok: false, error: "מסמך לא נמצא" }, { status: 404 });
    }
    const { data: bizRow } = await admin
      .from("businesses")
      .select("id, user_id, name, logo_url, business_type")
      .eq("id", docRow.business_id)
      .maybeSingle();
    if (!bizRow || bizRow.user_id !== user.id) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Resolve the buyer's business/VAT number: the doc's stored client_tax_id
    // (snapshotted in the editor), falling back to the linked client's tax_id.
    // A private customer (no number) is B2C — the allocation gate below doesn't
    // apply to them (they can't deduct input VAT).
    let customerTaxId = normalizeCustomerVatNumber(docRow.client_tax_id);
    if (!customerTaxId && docRow.client_id) {
      const { data: clientRow } = await admin
        .from("clients")
        .select("tax_id")
        .eq("id", docRow.client_id as string)
        .maybeSingle();
      customerTaxId = normalizeCustomerVatNumber(clientRow?.tax_id);
    }

    // Server-side allocation gate (defense in depth — the editor blocks this
    // too, but a crafted request must not bypass it). A tax document from an
    // עוסק מורשה/חברה to a BUSINESS customer that is over the חשבונית ישראל
    // threshold may not be sent until it carries an allocation number. B2C
    // (private customer) invoices are not gated.
    if (
      canIssueTaxInvoicesByType(bizRow.business_type as string) &&
      !docRow.allocation_number &&
      requiresAllocationNumber(
        {
          type: docRow.type as never,
          date: docRow.date as string,
          total: docRow.total as number,
          totalIls: (docRow.total_ils ?? docRow.total) as number,
          subtotal: docRow.subtotal as number,
          subtotalIls: (docRow.subtotal_ils ?? docRow.subtotal) as number,
        } as never,
        customerTaxId,
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "לא ניתן לשלוח חשבונית החייבת במספר הקצאה ללא מספר הקצאה. בקש מספר הקצאה מרשות המסים ואז שלח.",
        },
        { status: 422 },
      );
    }

    // Authentic content, straight from the owned document.
    const businessName = bizRow.name as string;
    const logoUrl = (bizRow.logo_url as string) || undefined;
    const receiptNumber = docRow.number as string | number;
    const total = docRow.total as number;
    const clientName = (docRow.client_name as string) || "";
    const currency = (docRow.currency as string) || "ILS";
    const documentType = docRow.type as DocumentType | undefined;
    const docLabel = (documentType && DOCUMENT_TYPE_LABELS[documentType]) || "מסמך";

    // Always use the canonical URL — never NEXT_PUBLIC_VERCEL_URL, which
    // is the immutable per-deploy hash and will decay into stale-code
    // views minutes after the next push. The link is going into an email
    // that will sit in someone's inbox for weeks.
    const baseUrl = "https://mysuperfriendlyinvoiceapp.vercel.app";
    const viewUrl = `${baseUrl}/view/${documentId}`;

    if (!to) {
      return NextResponse.json({ ok: false, error: "חסר נמען" }, { status: 400 });
    }

    const recipients = String(to)
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      return NextResponse.json({ ok: false, error: "לא נמצאו נמענים" }, { status: 400 });
    }

    const isReminder = kind === "reminder";
    const baseSubject = sanitizeEmailSubject(subject, `${businessName} - ${docLabel} #${receiptNumber}`);
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
      documentType,
      trackingPixelUrl,
      currency,
    });
    const text = buildText({
      businessName,
      clientName,
      receiptNumber,
      total,
      viewUrl,
      kind: isReminder ? "reminder" : "initial",
      daysSinceSent: typeof daysSinceSent === "number" ? daysSinceSent : undefined,
      documentType,
      currency,
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
          text,
          headers: {
            "X-Auto-Response-Suppress": "All",
            "List-Unsubscribe": `<mailto:${userGmailUser}?subject=unsubscribe>`,
          },
        });

        // nodemailer reports per-recipient outcome; a resolved sendMail does
        // NOT mean every recipient was accepted. Surface partial failures so
        // the caller/user knows which addresses bounced at handoff.
        const addrList = (v: unknown): string[] =>
          Array.isArray(v)
            ? v.map((a) =>
                typeof a === "string" ? a : (a as { address?: string })?.address || String(a),
              )
            : [];
        const accepted = addrList((info as { accepted?: unknown }).accepted);
        const rejected = addrList((info as { rejected?: unknown }).rejected);

        // Every recipient rejected → treat as a hard failure.
        if (accepted.length === 0 && rejected.length > 0) {
          console.error("[send-email] gmail all recipients rejected", { rejected, documentId });
          return NextResponse.json(
            {
              ok: false,
              error: "כל הנמענים נדחו על ידי שרת הדואר. בדוק את כתובות המייל ונסה שוב.",
              rejected,
            },
            { status: 502 },
          );
        }

        console.log("[send-email] gmail ok", {
          to: recipients,
          accepted,
          rejected,
          messageId: info.messageId,
          documentId,
        });

        // At least one recipient accepted → the מקור has been delivered. Stamp
        // original_issued_at once (18ב) so future renders become העתק.
        await stampOriginalIssued();

        // Some (but not all) recipients rejected → partial success (207).
        if (rejected.length > 0) {
          return NextResponse.json(
            {
              ok: true,
              partial: true,
              error: `חלק מהנמענים נדחו: ${rejected.join(", ")}`,
              messageId: info.messageId,
              mocked: false,
              provider: "gmail",
              accepted,
              rejected,
            },
            { status: 207 },
          );
        }

        return NextResponse.json({
          ok: true,
          messageId: info.messageId,
          mocked: false,
          provider: "gmail",
          accepted,
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
      text,
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

    // Resend's send API does not expose a per-recipient rejected[] list, so
    // (unlike the Gmail path) we can only report the addresses we handed off.
    console.log("[send-email] resend ok", { to: recipients, messageId: data?.id, documentId });

    // מקור delivered via Resend → stamp original_issued_at once (18ב).
    await stampOriginalIssued();

    return NextResponse.json({
      ok: true,
      messageId: data?.id,
      mocked: false,
      provider: "resend",
      accepted: recipients,
    });
  } catch (err) {
    console.error("Send email error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
