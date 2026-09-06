// Pure email-rendering functions. Extracted from route.ts so unit tests
// can import them without dragging in next/server, which crashes vitest.
//
// Every shape requirement asserted by tests/email-html.test.ts maps to
// a property a real corporate mail filter checks before deciding to
// render, strip, or quarantine an email. Don't change a structure
// invariant here without updating the tests too; the gate exists
// because a regression in this file silently broke a real customer
// once (2026-06-01).

import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/types";
import { docStrings, toDocLang, type DocLang } from "@/lib/document-strings";
import { formatMoney } from "@/lib/currencies";
import { formatCurrency } from "@/lib/format";
import { CANONICAL_ORIGIN } from "@/lib/public-url";

/** Landing target for the footer credit, tagged so signups arriving through a
 *  client's invoice email are attributable to the growth loop. */
const BRAND_URL_EMAIL = `${CANONICAL_ORIGIN}/?utm_source=document&utm_medium=email_footer&utm_campaign=growth_loop`;

// Format a document total in its own currency, the same way the app itself
// renders a total (see document-body.tsx's `money` helper): the shared
// formatCurrency for ILS ("₪1,500.50", locale-aware decimals), formatMoney
// with the right symbol ($, €, …) for anything else.
function formatDocTotal(total: number, currency?: string): string {
  const code = currency || "ILS";
  return code === "ILS" ? formatCurrency(Number(total)) : formatMoney(Number(total), code);
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
// grammatically masculine; the rest, including "הצעת מחיר" (quote), are
// feminine → "מצורפת".
function docWording(
  type?: DocumentType,
  lang: DocLang = "he",
): { attached: string; noun: string } {
  if (lang === "en") {
    // English has no grammatical gender to get right, so the wording is the
    // same for every type: "Attached is your tax invoice".
    if (!type || !DOCUMENT_TYPE_LABELS[type]) return { attached: "Attached is a document", noun: "document" };
    const label = docStrings("en").documentTypes[type];
    return { attached: `Attached is your ${label}`, noun: label };
  }
  if (!type || !DOCUMENT_TYPE_LABELS[type]) return { attached: "מצורף מסמך", noun: "מסמך" };
  const label = DOCUMENT_TYPE_LABELS[type];
  return { attached: `${type === "proforma" ? "מצורף" : "מצורפת"} ${label}`, noun: label };
}

// The email's default look - the brand's graphite band (2026-09-06 rebrand),
// the same pair ACCENT_HEX.gold emits, so a business with no chosen document
// design gets an email that matches its documents. Kept as named constants
// (not inlined at each call site) so the "no document design chosen"
// fallback is one visible value, never a value that drifted.
const DEFAULT_ACCENT_GRAD = "linear-gradient(135deg, #2f3a45, #263039)";
const DEFAULT_ACCENT_SOLID = "#2f3a45";

export function buildHtml(args: {
  businessName: string;
  clientName: string;
  receiptNumber: string | number;
  total: number;
  viewUrl: string;
  logoUrl?: string;
  kind?: "initial" | "reminder";
  daysSinceSent?: number;
  /** Document type: names the doc in the copy ("מצורפת חשבונית מס"). */
  documentType?: DocumentType;
  /** 1×1 tracking-pixel URL: stamps email_opened_at when the recipient
   *  loads the message. Omit to disable tracking for a particular send. */
  trackingPixelUrl?: string;
  /** ISO 4217 currency the document total is denominated in. Default "ILS". */
  currency?: string;
  /** Growth loop: a one-line "נשלח באמצעות" credit in the footer. Defaults to
   *  true; the caller passes false for a paying subscriber. */
  showBranding?: boolean;
  /**
   * The business's chosen document-design accent, already resolved to CSS
   * values by the caller via `ACCENT_HEX[normalizeDocumentDesign(...).accent]`
   * - never a raw string read off the DB. `grad` themes the header band,
   * `solid` themes the CTA button and inline link colors. Omit (or pass
   * undefined) to keep the brand graphite look - the behaviour for
   * every business that hasn't chosen a document design.
   */
  accent?: { grad: string; solid: string };
  /**
   * The language of the DOCUMENT this email carries. An English invoice
   * arrives with an English covering email; anything else (the default) keeps
   * the Hebrew message exactly as it has always been.
   */
  language?: string;
}): string {
  const { businessName, clientName, receiptNumber, total, viewUrl, logoUrl, kind = "initial", daysSinceSent, documentType, trackingPixelUrl, currency, showBranding = true, accent, language } = args;
  const lang = toDocLang(language);
  const isEnglish = lang === "en";
  const isReminder = kind === "reminder";
  const { attached, noun } = docWording(documentType, lang);
  const totalFormatted = escapeHtml(formatDocTotal(total, currency));
  const accentGrad = accent?.grad || DEFAULT_ACCENT_GRAD;
  const accentSolid = accent?.solid || DEFAULT_ACCENT_SOLID;
  const number = escapeHtml(String(receiptNumber));
  const introLine = isEnglish
    ? isReminder
      ? `Hope all is well. Just a gentle reminder about ${escapeHtml(noun)} no. <strong>#${number}</strong> for <strong>${totalFormatted}</strong>${
          daysSinceSent ? `, sent ${daysSinceSent} days ago` : ""
        }. Let me know that it arrived and what you think.`
      : `${escapeHtml(attached)} no. <strong>#${number}</strong> for <strong>${totalFormatted}</strong>.`
    : isReminder
      ? `מקווה שאתם בסדר. רק תזכורת קלה לגבי ${escapeHtml(noun)} מספר <strong>#${number}</strong> על סך <strong>${totalFormatted}</strong>${
          daysSinceSent ? ` ששלחנו לפני ${daysSinceSent} ימים` : ""
        }. אשמח לדעת אם הוא הגיע ומה דעתכם.`
      : `${escapeHtml(attached)} מספר <strong>#${number}</strong> על סך <strong>${totalFormatted}</strong>.`;
  const ctaLine = isEnglish
    ? isReminder
      ? "To view the full document again:"
      : "To view the full document, print it or download it as a PDF, use the button below."
    : isReminder
      ? "לצפייה חוזרת במסמך המלא:"
      : "לצפייה במסמך המלא והדפסה/הורדה כ-PDF, לחץ על הכפתור למטה.";
  const greeting = isEnglish ? `Hello ${escapeHtml(clientName)},` : `שלום ${escapeHtml(clientName)},`;
  const ctaButton = isEnglish ? "View document &rarr;" : "צפה במסמך ←";
  const fallbackLine = isEnglish
    ? "If the button does not open, copy this link:"
    : "אם הכפתור לא נפתח, העתק את הקישור:";
  const sentByLine = isEnglish
    ? isReminder
      ? `Automatic reminder from ${escapeHtml(businessName)}`
      : `This document was sent automatically from ${escapeHtml(businessName)}`
    : isReminder
      ? `תזכורת אוטומטית מ${escapeHtml(businessName)}`
      : `מסמך זה נשלח אוטומטית מ${escapeHtml(businessName)}`;

  // Full HTML document: corporate mail filters (Microsoft 365 Defender,
  // Mimecast, etc.) flag bare HTML fragments as suspicious. Wrap with a
  // proper doctype + charset + body so Outlook/Exchange clients accept
  // the message and render the Hebrew correctly.
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${isEnglish ? "ltr" : "rtl"}" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(businessName)}</title>
</head>
<body style="margin:0; padding:0; background:#f7f7f2; font-family: Arial, sans-serif;">
  <div dir="${isEnglish ? "ltr" : "rtl"}" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: ${accentSolid}; background-image: ${accentGrad}; padding: 24px; border-radius: 16px; color: #ffffff; text-align: center; margin-bottom: 24px;">
      ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName)}" style="max-height: 60px; max-width: 200px; margin-bottom: 12px; background: white; padding: 8px; border-radius: 8px;" />` : ""}
      <h1 style="margin: 0; font-size: 24px;">${escapeHtml(businessName)}</h1>
    </div>

    <div style="background: #ffffff; border: 1px solid #e4e7e2; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
      <p style="margin: 0 0 12px 0; font-size: 16px; color: #1f252b;">
        ${greeting}
      </p>
      <p style="margin: 0 0 16px 0; font-size: 16px; color: #1f252b;">
        ${introLine}
      </p>
      <p style="margin: 0; font-size: 14px; color: #5f6b76;">
        ${ctaLine}
      </p>
    </div>

    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${escapeHtml(viewUrl)}" style="display: inline-block; background: ${accentSolid}; background-image: ${accentGrad}; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-size: 16px; font-weight: bold;">
        ${ctaButton}
      </a>
    </div>

    <div style="text-align: center; margin-bottom: 16px;">
      <p style="font-size: 13px; color: #5f6b76; margin: 0 0 6px 0;">
        ${fallbackLine}
      </p>
      <p style="font-size: 12px; color: #8b95a0; margin: 0; word-break: break-all;">
        <a href="${escapeHtml(viewUrl)}" style="color: ${accentSolid};">${escapeHtml(viewUrl)}</a>
      </p>
    </div>

    <div style="text-align: center; margin-bottom: 24px;">
      <p style="font-size: 13px; color: #8b95a0;">
        ${sentByLine}
      </p>
      ${
        showBranding
          ? `<p style="font-size: 11px; color: #8b95a0; margin: 6px 0 0 0;">
        ${isEnglish ? "Sent with" : "נשלח באמצעות"} <a href="${escapeHtml(BRAND_URL_EMAIL)}" style="color: #8b95a0; text-decoration: underline;">${isEnglish ? "FriendlyInvoice" : "חשבונית ידידותית"}</a> · ${isEnglish ? "simple admin for a thriving business" : "התנהלות פשוטה לעסק מצליח"}
      </p>`
          : ""
      }
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
  /** Growth loop: mirrors buildHtml's footer credit in the plain-text part. */
  showBranding?: boolean;
  /** Language of the document this email carries; mirrors buildHtml. */
  language?: string;
}): string {
  const { businessName, clientName, receiptNumber, total, viewUrl, kind = "initial", daysSinceSent, documentType, currency, showBranding = true, language } = args;
  const lang = toDocLang(language);
  const isReminder = kind === "reminder";
  const { attached, noun } = docWording(documentType, lang);
  const totalFormatted = formatDocTotal(total, currency);
  if (lang === "en") {
    const intro = isReminder
      ? `A gentle reminder about ${noun} no. #${receiptNumber} for ${totalFormatted}${
          daysSinceSent ? `, sent ${daysSinceSent} days ago` : ""
        }.`
      : `${attached} no. #${receiptNumber} for ${totalFormatted}.`;
    return `Hello ${clientName},

${intro}

To view the full document, print it or download it as a PDF, open this link:
${viewUrl}

${isReminder ? "Automatic reminder" : "Document sent automatically"} from ${businessName}
${showBranding ? `\nSent with FriendlyInvoice · simple admin for a thriving business\n${BRAND_URL_EMAIL}\n` : ""}`;
  }
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
${showBranding ? `\nנשלח באמצעות חשבונית ידידותית · התנהלות פשוטה לעסק מצליח\n${BRAND_URL_EMAIL}\n` : ""}`;
}
