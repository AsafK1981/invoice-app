/** Asaf's WhatsApp, the app's support channel (same number as the sidebar bug button). */
export const SUPPORT_WHATSAPP_PHONE = "972549000684";

export function supportWhatsappHref(text: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(text)}`;
}

/**
 * The prefilled request for a data fix on a locked document. Deliberately
 * only the document id and the error code: never amounts or names.
 */
export function filingDataFixMessage(documentId: string | undefined, code: string): string {
  return [
    "היי, צריך תיקון נתונים כדי להגיש את הדיווח המפורט למע״מ.",
    ...(documentId ? [`מזהה מסמך: ${documentId}`] : []),
    `קוד: ${code}`,
  ].join("\n");
}
