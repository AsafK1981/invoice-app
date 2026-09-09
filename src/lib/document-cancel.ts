// Which way out of a mistaken document the law actually leaves open.
//
// הוראות מס הכנסה (ניהול פנקסי חשבונות), סעיף 23א, "נוהל תיקון חשבונית",
// verbatim:
//
//   "בוטלה עיסקה, כולה או מקצתה, או שונו תנאיה, או נתגלתה טעות בחשבונית, או
//    שונה סכום החשבונית מסיבה כלשהי, ינהג הנישום כלהלן:
//    (1) טרם יצא מקור החשבונית מרשות הנישום וטרם דיווח עליה כדין בדו"ח
//        התקופתי [...] תבוטל החשבונית על ידי ציון המלה 'מבוטל' על גבי המקור
//        וההעתקים והצמדת המקור להעתקים;
//    (2) יצא מקור החשבונית מרשות הנישום ינהג לפי אחת מאלה:
//        (א) יתקן בהתאם את סכום החשבונית שתוצא לאחר מכן לאותו לקוח [...]
//        (ג) אם תוך תקופת הדיווח [...] לא נערכה ללקוח חשבונית נוספת, רשאי
//            הנישום להוציא הודעת זיכוי;
//    (3) הוצאה ללקוח הודעת זיכוי [...] רשאי הנישום להקטין בהתאם את סכום
//        המכירות ואת החיוב במס ערך מוסף בתנאי שיתמלא אחד מאלה: [confirmation
//        of receipt by the customer, four alternatives]"
//
// Two things follow that the app has to respect.
//
// First, "מבוטל" (paragraph 1) is NOT the general remedy. It is available only
// while BOTH conditions hold: the original never left the taxpayer's hands AND
// the period was not yet reported. The app knows the first fact (emailedAt /
// originalIssuedAt); only the owner knows the second, so the UI asks them to
// affirm it and the audit log keeps the answer.
//
// Second, and this is why the routing matters rather than being a nicety:
// paragraph 3 lets a credit note reduce the reported VAT only once the customer
// has confirmed receiving it. Our VAT report and the PCN874 export both drop
// cancelled documents from their totals (vat-period-report.tsx, ita/pcn874.ts).
// So letting an owner mark an already-delivered tax invoice "מבוטל" would take
// it out of the VAT the Tax Authority is told about, with no credit note and no
// customer confirmation - exactly what paragraph 3 exists to prevent, and with
// the customer possibly having already deducted the input VAT. For those
// documents the route is the credit note, and this module says so.
//
// עוסק פטור has no VAT to reverse and the app offers them no credit note, so
// cancelling is their whole remedy; the routing reflects that too.

import type { InvoiceDocument } from "./types";

/** Document types that carry VAT a credit note would have to reverse. */
const VAT_BEARING = new Set(["tax_invoice", "tax_invoice_receipt"]);

export type CancellationRoute =
  /** A draft never took a number: it is deleted, not reversed. */
  | { kind: "delete" }
  /** Already reversed. */
  | { kind: "none" }
  /** 23א(1): mark "מבוטל". `delivered` drives the wording of the affirmation. */
  | { kind: "cancel"; delivered: boolean }
  /** 23א(2)+(3): the document is out there and carries VAT. Credit note. */
  | { kind: "credit_note" };

export interface RouteInput {
  type: InvoiceDocument["type"];
  status: InvoiceDocument["status"];
  emailedAt?: string | null;
  originalIssuedAt?: string | null;
}

/** Whether the original has left the taxpayer's possession, as far as we can tell. */
export function hasLeftPossession(doc: RouteInput): boolean {
  return Boolean(doc.emailedAt || doc.originalIssuedAt);
}

export function cancellationRoute(
  doc: RouteInput,
  opts: { vatRegistered: boolean },
): CancellationRoute {
  if (doc.status === "draft") return { kind: "delete" };
  if (doc.status === "cancelled") return { kind: "none" };
  const delivered = hasLeftPossession(doc);
  if (delivered && opts.vatRegistered && VAT_BEARING.has(doc.type)) {
    return { kind: "credit_note" };
  }
  return { kind: "cancel", delivered };
}
