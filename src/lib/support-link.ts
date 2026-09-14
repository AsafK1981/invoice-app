/** Asaf's WhatsApp, the app's support channel (same number as the sidebar bug button). */
export const SUPPORT_WHATSAPP_PHONE = "972549000684";

/** Which filing report a support request is about. */
export type FilingReportKind = "pcn874" | "uniform" | "invoices_period";

const PURPOSE: Record<FilingReportKind, string> = {
  pcn874: "כדי להגיש את הדיווח המפורט למע״מ",
  uniform: "כדי להפיק קובץ מבנה אחיד",
  invoices_period: "כדי שדוח החשבוניות התקופתי יהיה מלא",
};

export function supportWhatsappHref(text: string): string {
  return `https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(text)}`;
}

/**
 * The prefilled request for a data fix on a locked document. Deliberately
 * only the document id and the error code: never amounts or names.
 */
export function filingDataFixMessage(documentId: string | undefined, code: string, report: FilingReportKind = "pcn874"): string {
  return [
    `היי, צריך תיקון נתונים ${PURPOSE[report]}.`,
    ...(documentId ? [`מזהה מסמך: ${documentId}`] : []),
    `קוד: ${code}`,
  ].join("\n");
}
