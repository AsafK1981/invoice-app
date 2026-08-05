import { supabase } from "./supabase";
import { track } from "@vercel/analytics";
import { parseEmails, isValidEmail } from "./emails";

export interface SendReceiptEmailArgs {
  to: string;
  clientName: string;
  receiptNumber: number;
  total: number;
  businessName: string;
  documentId?: string;
  logoUrl?: string;
  /**
   * "initial" (default) sends the standard "מצורף מסמך…" body.
   * "reminder" sends a softer follow-up phrasing referencing how long
   * ago it went out, used when chasing a stale quote/invoice.
   */
  kind?: "initial" | "reminder";
  /** Only used when kind = "reminder". Drives the "ששלחנו לפני N ימים" line. */
  daysSinceSent?: number;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  mocked: boolean;
  /** Machine-readable failure reason, currently only set for
   *  "EMAIL_NOT_VERIFIED" (403 from /api/send-email), so callers can show a
   *  dedicated verification modal instead of a generic error toast. */
  code?: string;
}

export async function sendReceiptEmail(args: SendReceiptEmailArgs): Promise<SendEmailResult> {
  const recipients = parseEmails(args.to);
  if (recipients.length === 0 || !recipients.every(isValidEmail)) {
    return { ok: false, error: "כתובת אימייל לא תקינה", mocked: false };
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      return { ok: false, error: "לא מחובר - התחבר מחדש", mocked: false };
    }

    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(args),
    });

    const data = await res.json();
    if (data.ok) track("invoice_emailed");
    return {
      ok: data.ok,
      messageId: data.messageId,
      error: data.error,
      mocked: data.mocked ?? false,
      code: data.code,
    };
  } catch {
    return {
      ok: false,
      error: "שגיאה בשליחת המייל - נסה שוב",
      mocked: false,
    };
  }
}
