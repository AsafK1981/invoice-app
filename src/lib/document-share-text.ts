// The WhatsApp message the owner opens when sharing an issued document from
// its page ("שלח בוואטסאפ"). Kept pure so the wording, the grammatical gender
// and the currency are unit-tested rather than rebuilt inline in the page.
//
// Mirrors the covering email (src/app/api/send-email/template.ts): a document
// issued in English gets an English message, and the total is always shown in
// the document's own currency, never a shekel sign on a dollar quote.

import { formatDocTotal } from "./currencies";
import { docStrings, toDocLang } from "./document-strings";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "./types";

export function whatsappShareText(args: {
  clientName: string;
  type: DocumentType;
  number: number;
  total: number;
  currency?: string | null;
  language?: string | null;
  viewUrl: string;
}): string {
  const total = formatDocTotal(args.total, args.currency);
  if (toDocLang(args.language) === "en") {
    const label = docStrings("en").documentTypes[args.type] || "document";
    return (
      `Hello ${args.clientName},\n\n` +
      `Attached is your ${label} no. #${args.number} for ${total}.\n\n` +
      `View and download: ${args.viewUrl}`
    );
  }
  const label = DOCUMENT_TYPE_LABELS[args.type] || "מסמך";
  // Only "חשבון עסקה" is masculine; every other type is feminine.
  const attached = args.type === "proforma" || !DOCUMENT_TYPE_LABELS[args.type] ? "מצורף" : "מצורפת";
  return (
    `שלום ${args.clientName},\n\n` +
    `${attached} ${label} מספר #${args.number} על סך ${total}.\n\n` +
    `לצפייה והורדה: ${args.viewUrl}`
  );
}
