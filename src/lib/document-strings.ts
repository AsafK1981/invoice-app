import {
  BUSINESS_TYPE_LABELS,
  DOC_SUM_LABEL,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type Business,
  type DocumentType,
  type PaymentMethod,
} from "./types";

/**
 * The language a single document is issued in. A document is Hebrew unless its
 * owner explicitly chose English for it (foreign customer); the choice is
 * snapshotted on the row and frozen once the document leaves 'draft', exactly
 * like the currency.
 *
 * This is the DOCUMENT's language only. The app chrome (tables, reports,
 * settings, the assistant) stays Hebrew - the user is an Israeli freelancer
 * either way; it is their customer who reads English.
 */
export type DocLang = "he" | "en";

/**
 * Every literal that appears on the printed document. No i18n library: one
 * typed dictionary with two complete entries is the whole feature, and the
 * type makes a missing translation a compile error rather than a Hebrew word
 * surfacing in the middle of an English invoice.
 *
 * The Hebrew entries are the exact strings the document rendered before this
 * dictionary existed, and the type/sum/payment/business maps are the SAME
 * objects the rest of the app uses - so Hebrew output cannot drift here.
 */
export interface DocStrings {
  /** מקור / העתק - the legally required original-vs-copy stamp (ניהול ספרים 18ב). */
  original: string;
  copy: string;
  /**
   * "מסמך ממוחשב" - הוראות ניהול ספרים סעיף 1 + 18ב(א) require the words to
   * appear "בצורה בולטת לעין" on a document delivered as a file. Rendered on
   * every ISSUED document, next to מקור/העתק.
   */
  computerized: string;
  /**
   * "טיוטה" - נספח ה' (א)(3): "ציון בצורה בולטת של המלה 'טיוטה' על גבי פלט
   * חזותי המופק מקובץ זמני". Rendered instead of מקור/העתק on anything that
   * has not been issued, plus a full-sheet watermark.
   */
  draftMark: string;
  /**
   * "מבוטל" - an issued document the owner reversed (סעיף 23(ב)). It keeps its
   * number and stays in the books, so the mark has to be unmissable on any
   * output of it: a watermark plus a line in the identity block.
   */
  cancelledMark: string;
  /**
   * Replaces "מסמך ממוחשב" on an issued document the app does NOT sign: a
   * receipt for a payment 18ב(ד) keeps off secured-signature documents. The
   * customer must get it on paper, and the paper says so.
   */
  paperOnly: string;
  /** Footer line on a signed document, followed by the /verify URL. */
  signedLine: string;
  verifyLabel: string;
  /** Placeholder shown in the editor preview before a number is allocated. */
  autoNumber: string;
  /** Customer card caption. */
  toLabel: string;
  /** Caption for the customer's ח.פ / ת.ז line. */
  clientTaxId: string;
  noClient: string;
  /** מספר הקצאה (חשבונית ישראל) card caption. */
  allocationLabel: string;
  subjectLabel: string;
  itemsLabel: string;
  thDescription: string;
  thQuantity: string;
  thUnitPrice: string;
  thAmount: string;
  noItems: string;
  totalBeforeDiscount: string;
  discount: string;
  subtotal: string;
  vat: string;
  zeroRatedNote: string;
  rounding: string;
  /** Grand-total caption, per document type. */
  sumLabel: Record<DocumentType, string>;
  /** Foreign-currency footnote: "<totalInIls> (rate 3.7000): ₪1,234". */
  totalInIls: string;
  exchangeRate: (rate: string) => string;
  withholding: string;
  paidActual: string;
  paidNote: string;
  paymentMethodLabel: string;
  paymentMethods: Record<PaymentMethod, string>;
  paymentDetailsLabel: string;
  bankTransfer: string;
  branch: (value: string) => string;
  account: (value: string) => string;
  check: (value: string) => string;
  checkDueDate: (value: string) => string;
  cardLast4: (value: string) => string;
  cardApproval: (value: string) => string;
  reference: (value: string) => string;
  notesLabel: string;
  /** Footer: "<footerIssued> · <business name>". */
  footerIssued: string;
  /** Footer credit prefix, followed by the app link. */
  footerBrand: string;
  documentTypes: Record<DocumentType, string>;
  businessTypes: Record<Business["businessType"], string>;
}

const HE: DocStrings = {
  original: "מקור",
  copy: "העתק",
  computerized: "מסמך ממוחשב",
  draftMark: "טיוטה",
  cancelledMark: "מבוטל",
  paperOnly: "להדפסה ולשמירה בנייר",
  signedLine: "חתום בחתימה אלקטרונית מאובטחת",
  verifyLabel: "אימות",
  autoNumber: "(אוטומטי)",
  toLabel: "לכבוד",
  clientTaxId: "ח.פ / ת.ז",
  noClient: "לקוח לא נבחר",
  allocationLabel: "מספר הקצאה · חשבונית ישראל",
  subjectLabel: "בגין",
  itemsLabel: "פירוט",
  thDescription: "תיאור",
  thQuantity: "כמות",
  thUnitPrice: "מחיר יחידה",
  thAmount: "סכום",
  noItems: "לא הוזנו פריטים עדיין",
  totalBeforeDiscount: "סה״כ לפני הנחה",
  discount: "הנחה",
  subtotal: "סכום ביניים",
  vat: "מע״מ",
  zeroRatedNote: "עסקה בשיעור אפס: ייצוא שירותים",
  rounding: "עיגול",
  sumLabel: DOC_SUM_LABEL,
  totalInIls: "סה״כ ב-₪",
  exchangeRate: (rate) => `(שער ${rate})`,
  withholding: "ניכוי מס במקור",
  paidActual: "שולם בפועל",
  paidNote: "הסכום נטו שהתקבל, אחרי ניכוי מס במקור",
  paymentMethodLabel: "אמצעי תשלום",
  paymentMethods: PAYMENT_METHOD_LABELS,
  paymentDetailsLabel: "פרטי תשלום",
  bankTransfer: "העברה בנקאית",
  branch: (value) => `סניף ${value}`,
  account: (value) => `חשבון ${value}`,
  check: (value) => `שיק ${value}`,
  checkDueDate: (value) => `ז״פ ${value}`,
  cardLast4: (value) => `מסתיים ב-${value}`,
  cardApproval: (value) => `אישור ${value}`,
  reference: (value) => `אסמכתא ${value}`,
  notesLabel: "הערות",
  footerIssued: "מסמך זה הופק אלקטרונית",
  footerBrand: "הופק באמצעות",
  documentTypes: DOCUMENT_TYPE_LABELS,
  businessTypes: BUSINESS_TYPE_LABELS,
};

/**
 * English document type names, as an Israeli business would name them to a
 * foreign customer. "Tax Invoice" is the standard English rendering of
 * חשבונית מס on Israeli export invoices; "Pro Forma Invoice" for חשבון עסקה
 * is the term foreign buyers already know.
 */
const EN_DOCUMENT_TYPES: Record<DocumentType, string> = {
  receipt: "Receipt",
  quote: "Quote",
  proforma: "Pro Forma Invoice",
  tax_invoice: "Tax Invoice",
  tax_invoice_receipt: "Tax Invoice / Receipt",
  credit_note: "Credit Note",
};

const EN: DocStrings = {
  original: "ORIGINAL",
  copy: "COPY",
  computerized: "Computerized document",
  draftMark: "DRAFT",
  cancelledMark: "CANCELLED",
  paperOnly: "Print and keep on paper",
  signedLine: "Signed with a secured electronic signature",
  verifyLabel: "Verify",
  autoNumber: "(auto)",
  toLabel: "To",
  clientTaxId: "Tax ID",
  noClient: "No customer selected",
  allocationLabel: "Allocation number · Israel Invoice",
  subjectLabel: "Re",
  itemsLabel: "Details",
  thDescription: "Description",
  thQuantity: "Qty",
  thUnitPrice: "Unit price",
  thAmount: "Amount",
  noItems: "No items yet",
  totalBeforeDiscount: "Total before discount",
  discount: "Discount",
  subtotal: "Subtotal",
  vat: "VAT",
  zeroRatedNote: "Zero-rated transaction: export of services",
  rounding: "Rounding",
  sumLabel: {
    receipt: "Total received",
    quote: "Quote total",
    proforma: "Total due",
    tax_invoice: "Total due",
    tax_invoice_receipt: "Total received",
    credit_note: "Total credited",
  },
  totalInIls: "Total in ILS",
  exchangeRate: (rate) => `(rate ${rate})`,
  withholding: "Withholding tax",
  paidActual: "Amount paid",
  paidNote: "The net amount received, after withholding tax",
  paymentMethodLabel: "Payment method",
  paymentMethods: {
    bank_transfer: "Bank transfer",
    cash: "Cash",
    check: "Check",
    credit_card: "Credit card",
    bit: "Bit",
    paypal: "PayPal",
  },
  paymentDetailsLabel: "Payment details",
  bankTransfer: "Bank transfer",
  branch: (value) => `Branch ${value}`,
  account: (value) => `Account ${value}`,
  check: (value) => `Check ${value}`,
  checkDueDate: (value) => `Due ${value}`,
  cardLast4: (value) => `ending in ${value}`,
  cardApproval: (value) => `Approval ${value}`,
  reference: (value) => `Ref. ${value}`,
  notesLabel: "Notes",
  footerIssued: "This document was issued electronically",
  footerBrand: "Issued with",
  documentTypes: EN_DOCUMENT_TYPES,
  businessTypes: {
    exempt: "Exempt Dealer",
    authorized: "Licensed Dealer",
    company: "Ltd. Company",
  },
};

export const DOC_STRINGS: Record<DocLang, DocStrings> = { he: HE, en: EN };

/**
 * The dictionary for a document's language. Anything that is not exactly "en"
 * (undefined, a legacy row, a value read off an untrusted payload) falls back
 * to Hebrew, so a bad value can never blank out a document.
 */
export function docStrings(lang?: string | null): DocStrings {
  return lang === "en" ? EN : HE;
}

/** Narrow an untrusted value to a DocLang, defaulting to Hebrew. */
export function toDocLang(value?: string | null): DocLang {
  return value === "en" ? "en" : "he";
}

/**
 * The two statutory marks, in the form that goes ON the sheet.
 *
 * סעיף 1 and נספח ה' (א)(3) require the HEBREW words "מסמך ממוחשב" / "טיוטה"
 * on the document itself. A document issued in English still has to satisfy
 * an Israeli inspector, so it carries both: the English wording its recipient
 * reads, then the Hebrew wording the law names. A Hebrew document is
 * unchanged - just the one word.
 */
export function statutoryMark(lang: DocLang, key: "computerized" | "draftMark" | "cancelledMark"): string {
  return lang === "he" ? HE[key] : `${EN[key]} · ${HE[key]}`;
}

/** Writing direction of a document in this language. */
export function docDir(lang?: string | null): "rtl" | "ltr" {
  return lang === "en" ? "ltr" : "rtl";
}
