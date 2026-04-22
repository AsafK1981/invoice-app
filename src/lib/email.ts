import { supabase } from "./supabase";

export interface SendReceiptEmailArgs {
  to: string;
  clientName: string;
  receiptNumber: number;
  total: number;
  businessName: string;
  documentId?: string;
  logoUrl?: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  mocked: boolean;
}

export async function sendReceiptEmail(args: SendReceiptEmailArgs): Promise<SendEmailResult> {
  if (!args.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.to)) {
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
    return {
      ok: data.ok,
      messageId: data.messageId,
      error: data.error,
      mocked: data.mocked ?? false,
    };
  } catch {
    return {
      ok: false,
      error: "שגיאה בשליחת המייל - נסה שוב",
      mocked: false,
    };
  }
}
