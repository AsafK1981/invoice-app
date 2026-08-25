export type DocumentType =
  | "receipt"
  | "quote"
  | "proforma"
  | "tax_invoice"
  | "tax_invoice_receipt"
  | "credit_note";

export type DocumentStatus = "draft" | "sent" | "paid" | "cancelled";

export type PaymentMethod = "bank_transfer" | "cash" | "check" | "credit_card" | "bit" | "paypal";

/**
 * Structured payment detail captured per payment method on receipts /
 * tax-invoice-receipts (פירוט אמצעי תשלום). All fields optional: only the
 * ones relevant to the chosen method are filled. The primary human reference
 * (bank/Bit/PayPal reference, or the check number, or the card approval) is
 * also mirrored into the document's `paymentReference` so the bank-import
 * matcher / timeline keep working.
 */
export interface PaymentDetails {
  /** העברה בנקאית / Bit / PayPal: אסמכתא. */
  reference?: string;
  /** צ'ק: מספר שיק. */
  checkNumber?: string;
  /** צ'ק: בנק. */
  checkBank?: string;
  /** צ'ק: סניף. */
  checkBranch?: string;
  /** צ'ק: מספר חשבון. */
  checkAccount?: string;
  /** צ'ק: תאריך פירעון (ז"פ), ISO date. */
  checkDueDate?: string;
  /** אשראי: 4 ספרות אחרונות. */
  cardLast4?: string;
  /** אשראי: מספר אישור. */
  cardApproval?: string;
}

export interface Business {
  id: string;
  name: string;
  businessType: "exempt" | "authorized" | "company";
  taxId: string;
  address: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  bankName?: string;
  bankBranch?: string;
  bankAccount?: string;
  paymentNotes?: string;
  defaultDocNotes?: string;
  /** When true, the daily dunning cron sends reminder emails for
   *  this business's unpaid invoices at day 3 / 14 / 30 after issue. */
  dunningEnabled?: boolean;
  /** Optional friendly From name on dunning emails (defaults to name). */
  dunningFromName?: string;
  /** When true, the hourly monthly-reminder cron may notify this business's
   *  owner a monthly nudge (open quotes/proformas, quiet retainer clients). */
  monthlyReminderEnabled?: boolean;
  /** Days of month the reminder is evaluated on, 1-31, up to 3 (Asia/Jerusalem).
   *  A day beyond the current month's length clamps to the last day of that month. */
  monthlyReminderDays?: number[];
  /** Hour of day (0-23, Asia/Jerusalem) the reminder fires at on a chosen day. */
  monthlyReminderHour?: number;
  /** Which channels fire on send: "email", "inapp". Unknown values (e.g. a
   *  future "whatsapp") are ignored for now. Empty/neither -> no-op skip. */
  monthlyReminderChannels?: string[];
  /** `YYYY-MM-DD` of the last time this business's reminder was sent or
   *  evaluated-and-skipped, so the cron doesn't re-check it every hour. */
  monthlyReminderLastSent?: string;
  /** Default state for the per-document "round total to whole shekel" toggle. */
  roundTotalDefault?: boolean;
  /**
   * Profession-tailored document design (template/accent/font/logo
   * position), chosen in Settings. `unknown` on purpose: this is the RAW
   * value read off the `document_design` JSONB column (or echoed by the
   * public API) - untrusted by construction. NEVER read a field off it
   * directly; always pass it through `normalizeDocumentDesign()` from
   * `@/lib/document-themes` first, which is the only place allowed to turn
   * it into something safe to render. `undefined`/`null` (every existing
   * business today) means "no theme chosen" and renders the original gold
   * design unchanged.
   */
  documentDesign?: unknown;
}

export interface Client {
  id: string;
  name: string;
  taxId?: string;
  address?: string;
  phone?: string;
  email?: string;
  notes?: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  unit: string;
}

export interface DocumentItem {
  id: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoiceDocument {
  id: string;
  type: DocumentType;
  number: number;
  date: string;
  clientId: string;
  clientName: string;
  /** Customer's עוסק/ח.פ number, required for חשבונית ישראל allocation requests. */
  clientTaxId?: string;
  subject?: string;
  status: DocumentStatus;
  items: DocumentItem[];
  subtotal: number;
  vat: number;
  total: number;
  /**
   * הפרש עיגול, signed rounding adjustment absorbing the difference when the
   * final total is rounded to a whole unit of the document currency. 0 (default)
   * when rounding is off. Invariant: total = subtotal + vat + rounding.
   */
  rounding?: number;
  /** Whether the final total was rounded to a whole shekel (עגל סכום לתשלום). */
  roundTotal?: boolean;
  paymentMethod?: PaymentMethod;
  notes?: string;
  approvedAt?: string;
  approvalSignature?: string;
  emailedAt?: string;
  /**
   * Comma-joined recipient addresses of the most recent successful send (the
   * accepted ones only). Overwritten on every resend. Undefined for documents
   * emailed before 2026-08-02, when we started recording it - never inferred
   * from the client's address, so it is safe to present as fact.
   */
  emailedTo?: string;
  /**
   * When the document's מקור (original) was first emitted to the customer,
   * first email send / PDF download / print. NULL ⇒ the doc still renders the
   * legally-required "מקור" label; once set, every reprint/re-download/re-send
   * renders "העתק" (הוראות ניהול ספרים סעיף 18ב). A שכפול creates a fresh row
   * with this NULL again → its own new "מקור".
   */
  originalIssuedAt?: string | null;
  /** When the recipient first opened the email (loaded the 1×1 tracking pixel). */
  emailOpenedAt?: string;
  /** Total number of times the tracking pixel has loaded (open + later re-reads). */
  emailOpenCount?: number;
  /**
   * מספר הקצאה: Tax Authority allocation number from חשבונית ישראל.
   * Required on tax invoices above the annual threshold (סעיף 47ב לחוק מע"מ).
   * Manually entered by the user after submitting the doc to the gov portal;
   * future API integration will set this automatically.
   */
  allocationNumber?: string;
  allocationSetAt?: string;
  /**
   * When a quote was converted into a receipt/tax-invoice (because the
   * client paid), this is the resulting doc's id. NULL on receipts and
   * on quotes that haven't been converted yet.
   */
  convertedToId?: string;
  /**
   * For a credit note (חשבונית זיכוי): FK to the original tax invoice it
   * reverses, when that invoice exists as an app document (picked from the
   * editor). NULL when the original was issued externally and entered manually.
   * In that case the reference lives only in the notes line. Additive to the
   * human-readable notes reference, not a replacement for it.
   */
  originalDocumentId?: string | null;
  /**
   * When the document was marked paid (either manually or via the bank-
   * import matcher). Independent of status; historical docs that were
   * marked paid before this field existed have status=paid but null here.
   */
  paidAt?: string;
  /** Free-form payment reference: bank transaction id, Bit ref, etc. */
  paymentReference?: string;
  /**
   * Structured payment detail per method (check/bank/card). Only meaningful on
   * receipts / tax-invoice-receipts. See {@link PaymentDetails}.
   */
  paymentDetails?: PaymentDetails;
  /**
   * ניכוי מס במקור, withholding tax the customer deducts from the payment and
   * remits to the Tax Authority on the supplier's behalf. Computed on the TOTAL
   * including VAT. This does NOT change subtotal/vat/total; it's a split of the
   * payment (total = actually-paid + withholding). Applies to עוסק פטור too
   * (it's income tax, not VAT). Only recorded on receipts / tax-invoice-receipts.
   */
  withholdingRate?: number;
  withholdingAmount?: number;
  /**
   * Document-level discount (הנחה) in the document currency, applied BEFORE VAT.
   * The stored `subtotal` is the DISCOUNTED subtotal (lines subtotal − discount);
   * this field carries the discount itself so the pre-discount subtotal and the
   * "amount before discount" tax-export field can be reconstructed.
   */
  discountAmount?: number;
  /** ISO 4217 currency the document is denominated in. Default "ILS". */
  currency?: string;
  /** ₪ per 1 unit of `currency`, snapshotted at issue. ILS → 1. */
  exchangeRate?: number;
  /** ₪ equivalents snapshotted at issue (= foreign × rate). For ILS docs = the foreign value. */
  subtotalIls?: number;
  vatIls?: number;
  totalIls?: number;
  /** Zero-rated export transaction (0% VAT, distinct from עוסק פטור). */
  zeroRated?: boolean;
}

/**
 * Document types that represent actual revenue (מחזור עסקאות). Price quotes
 * (הצעת מחיר) and proforma invoices (חשבון עסקה) are pre-payment documents and
 * are NOT revenue. Credit notes (חשבונית זיכוי) subtract, they're stored
 * negative, and are handled separately from this list.
 */
export const REVENUE_DOCUMENT_TYPES: DocumentType[] = [
  "receipt",
  "tax_invoice",
  "tax_invoice_receipt",
];

/**
 * Should this document count toward revenue / income totals?
 *
 * Counts revenue types and credit notes (which subtract), but EXCLUDES any
 * document that has been converted into another one (`convertedToId` set):
 * on conversion the source (e.g. a quote/proforma) is marked "paid" while the
 * target receipt is also created, so counting both double-counts the same
 * revenue. Callers keep their own status filter (e.g. `paid`) and credit-note
 * sign handling.
 */
export function isCountableRevenue(
  doc: Pick<InvoiceDocument, "type" | "convertedToId">,
): boolean {
  if (doc.convertedToId) return false;
  return doc.type === "credit_note" || REVENUE_DOCUMENT_TYPES.includes(doc.type);
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  supplier: string;
  amount: number;
  description?: string;
  /**
   * VAT (מע"מ) component of the expense, used by עוסק מורשה for
   * input-VAT credit on periodic VAT returns. Always 0 for עוסק פטור.
   */
  vatAmount?: number;
  /** Storage path in the `expense-receipts` bucket, set when the expense
   *  was created from a scanned document. */
  receiptPath?: string;
}

export interface DocumentAttachment {
  id: string;
  documentId: string;
  filePath: string;
  filename: string;
  fileSize: number;
  contentType?: string;
  uploadedAt: string;
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  receipt: "קבלה",
  quote: "הצעת מחיר",
  proforma: "חשבון עסקה",
  tax_invoice: "חשבונית מס",
  tax_invoice_receipt: "חשבונית מס/קבלה",
  credit_note: "חשבונית זיכוי",
};

export const DOCUMENT_TYPE_ROW_COLORS: Record<DocumentType, string> = {
  receipt: "bg-emerald-50/60 hover:bg-emerald-100/70",
  quote: "bg-amber-50/60 hover:bg-amber-100/70",
  proforma: "bg-fuchsia-50/60 hover:bg-fuchsia-100/70",
  tax_invoice: "bg-blue-50/60 hover:bg-blue-100/70",
  tax_invoice_receipt: "bg-violet-50/60 hover:bg-violet-100/70",
  credit_note: "bg-rose-50/60 hover:bg-rose-100/70",
};

export const DOCUMENT_TYPE_BADGE_COLORS: Record<DocumentType, string> = {
  receipt: "bg-emerald-100 text-emerald-800",
  quote: "bg-amber-100 text-amber-800",
  proforma: "bg-fuchsia-100 text-fuchsia-800",
  tax_invoice: "bg-blue-100 text-blue-800",
  tax_invoice_receipt: "bg-violet-100 text-violet-800",
  credit_note: "bg-rose-100 text-rose-800",
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: "טיוטה",
  sent: "נשלח",
  paid: "שולם",
  cancelled: "מבוטל",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "העברה בנקאית",
  cash: "מזומן",
  check: "צ'ק",
  credit_card: "אשראי",
  bit: "Bit",
  paypal: "PayPal",
};

export const BUSINESS_TYPE_LABELS: Record<Business["businessType"], string> = {
  exempt: "עוסק פטור",
  authorized: "עוסק מורשה",
  company: "חברה בע״מ",
};

export const DEFAULT_NEXT_NUMBER: Record<DocumentType, number> = {
  receipt: 1001,
  quote: 201,
  proforma: 201,
  tax_invoice: 201,
  tax_invoice_receipt: 201,
  credit_note: 201,
};

export const DOC_SUM_LABEL: Record<DocumentType, string> = {
  receipt: "סה״כ לתשלום",
  quote: "סה״כ הצעה",
  proforma: "סה״כ לתשלום",
  tax_invoice: "סה״כ לתשלום",
  tax_invoice_receipt: "סה״כ לתשלום",
  credit_note: "סה״כ זיכוי",
};
