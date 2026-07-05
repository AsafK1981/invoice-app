// Pure email-rendering functions. Extracted from route.ts so unit tests
// can import them without dragging in next/server, which crashes vitest.
//
// Every shape requirement asserted by tests/email-html.test.ts maps to
// a property a real corporate mail filter checks before deciding to
// render, strip, or quarantine an email. Don't change a structure
// invariant here without updating the tests too — the gate exists
// because a regression in this file silently broke a real customer
// once (2026-06-01).

import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/types";
import { currencySymbol } from "@/lib/currencies";

// Format a document total in its own currency. Defaults to ILS (₪) so
// legacy/ILS documents render exactly as before; foreign-currency docs get
// the correct symbol ($, €, …) instead of a hardcoded ₪.
function formatDocTotal(total: number, currency?: string): string {
  return `${currencySymbol(currency || "ILS")}${Number(total).toLocaleString()}`;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Name the actual document type in the email ("מצורפת חשבונית מס" / "מצורף
// חשבון עסקה") instead of a generic "מסמך". Only "חשבון עסקה" (proforma) is
// grammatically masculine — the rest, including "הצעת מחיר" (quote), are
// feminine → "מצורפת".
function docWording(type?: DocumentType): { attached: string; noun: string } {
  if (!type || !DOCUMENT_TYPE_LABELS[type]) return { attached: "מצורף מסמך", noun: "מסמך" };
  const label = DOCUMENT_TYPE_LABELS[type];
  return { attached: `${type === "proforma" ? "מצורף" : "מצורפת"} ${label}`, noun: label };
}

export function buildHtml(args: {
  businessName: string;
  clientName: string;
  receiptNumber: string | number;
  total: number;
  viewUrl: string;
  logoUrl?: string;
  kind?: "initial" | "reminder";
  daysSinceSent?: number;
  /** Document type — names the doc in the copy ("מצורפת חשבונית מס"). */
  documentType?: DocumentType;
  /** 1×1 tracking-pixel URL — stamps email_opened_at when the recipient
   *  loads the message. Omit to disable tracking for a particular send. */
  trackingPixelUrl?: string;
  /** ISO 4217 currency the document total is denominated in. Default "ILS". */
  currency?: string;
}): string {
  const { businessName, clientName, receiptNumber, total, viewUrl, logoUrl, kind = "initial", daysSinceSent, documentType, trackingPixelUrl, currency } = args;
  const isReminder = kind === "reminder";
  const { attached, noun } = docWording(documentType);
  const totalFormatted = escapeHtml(formatDocTotal(total, currency));
  const introLine = isReminder
    ? `מקווה שאתם בסדר. רק תזכורת קלה לגבי ${escapeHtml(noun)} מספר <strong>#${escapeHtml(String(receiptNumber))}</strong> על סך <strong>${totalFormatted}</strong>${
        daysSinceSent ? ` ששלחנו לפני ${daysSinceSent} ימים` : ""
      } — אשמח לדעת אם הוא הגיע ומה דעתכם.`
    : `${escapeHtml(attached)} מספר <strong>#${escapeHtml(String(receiptNumber))}</strong> על סך <strong>${totalFormatted}</strong>.`;
  const ctaLine = isReminder
    ? "לצפייה חוזרת במסמך המלא:"
    : "לצפייה במסמך המלא והדפסה/הורדה כ-PDF, לחץ על הכפתור למטה.";

  // Full HTML document — corporate mail filters (Microsoft 365 Defender,
  // Mimecast, etc.) flag bare HTML fragments as suspicious. Wrap with a
  // proper doctype + charset + body so Outlook/Exchange clients accept
  // the message and render the Hebrew correctly.
  return `<!DOCTYPE html>
<html lang="he" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(businessName)}</title>
</head>
<body style="margin:0; padding:0; background:#f5f5f4; font-family: Arial, sans-serif;">
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

    <div style="text-align: center; margin-bottom: 16px;">
      <p style="font-size: 13px; color: #57534e; margin: 0 0 6px 0;">
        אם הכפתור לא נפתח, העתק את הקישור:
      </p>
      <p style="font-size: 12px; color: #78716c; margin: 0; word-break: break-all;">
        <a href="${escapeHtml(viewUrl)}" style="color: #ea580c;">${escapeHtml(viewUrl)}</a>
      </p>
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
</body>
</html>`;
}

export function buildText(args: {
  businessName: string;
  clientName: string;
  receiptNumber: string | number;
  total: number;
  viewUrl: string;
  kind?: "initial" | "reminder";
  daysSinceSent?: number;
  documentType?: DocumentType;
  /** ISO 4217 currency the document total is denominated in. Default "ILS". */
  currency?: string;
}): string {
  const { businessName, clientName, receiptNumber, total, viewUrl, kind = "initial", daysSinceSent, documentType, currency } = args;
  const isReminder = kind === "reminder";
  const { attached, noun } = docWording(documentType);
  const totalFormatted = formatDocTotal(total, currency);
  const intro = isReminder
    ? `תזכורת קלה לגבי ${noun} מספר #${receiptNumber} על סך ${totalFormatted}${
        daysSinceSent ? ` ששלחנו לפני ${daysSinceSent} ימים` : ""
      }.`
    : `${attached} מספר #${receiptNumber} על סך ${totalFormatted}.`;
  return `שלום ${clientName},

${intro}

לצפייה במסמך המלא והדפסה/הורדה כ-PDF, פתח את הקישור:
${viewUrl}

${isReminder ? "תזכורת אוטומטית" : "מסמך נשלח אוטומטית"} מ${businessName}
`;
}
