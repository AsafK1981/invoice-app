export type DocumentType =
  | "receipt"
  | "quote"
  | "proforma"
  | "tax_invoice"
  | "tax_invoice_receipt"
  | "credit_note";

export type DocumentStatus = "draft" | "sent" | "paid" | "cancelled";

export type PaymentMethod = "bank_transfer" | "cash" | "check" | "credit_card" | "bit" | "paypal";

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
  /** Customer's עוסק/ח.פ number — required for חשבונית ישראל allocation requests. */
  clientTaxId?: string;
  subject?: string;
  status: DocumentStatus;
  items: DocumentItem[];
  subtotal: number;
  vat: number;
  total: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
  approvedAt?: string;
  approvalSignature?: string;
  emailedAt?: string;
  /** When the recipient first opened the email (loaded the 1×1 tracking pixel). */
  emailOpenedAt?: string;
  /** Total number of times the tracking pixel has loaded (open + later re-reads). */
  emailOpenCount?: number;
  /**
   * מספר הקצאה — Tax Authority allocation number from חשבונית ישראל.
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
   * When the document was marked paid (either manually or via the bank-
   * import matcher). Independent of status — historical docs that were
   * marked paid before this field existed have status=paid but null here.
   */
  paidAt?: string;
  /** Free-form payment reference — bank transaction id, Bit ref, etc. */
  paymentReference?: string;
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

export interface Expense {
  id: string;
  date: string;
  category: string;
  supplier: string;
  amount: number;
  description?: string;
  /**
   * VAT (מע"מ) component of the expense — used by עוסק מורשה for
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
