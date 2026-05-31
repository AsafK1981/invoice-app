export type DocumentType =
  | "receipt"
  | "quote"
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
  quote: "חשבון עסקה",
  tax_invoice: "חשבונית מס",
  tax_invoice_receipt: "חשבונית מס/קבלה",
  credit_note: "חשבונית זיכוי",
};

export const DOCUMENT_TYPE_ROW_COLORS: Record<DocumentType, string> = {
  receipt: "bg-emerald-50/60 hover:bg-emerald-100/70",
  quote: "bg-amber-50/60 hover:bg-amber-100/70",
  tax_invoice: "bg-blue-50/60 hover:bg-blue-100/70",
  tax_invoice_receipt: "bg-violet-50/60 hover:bg-violet-100/70",
  credit_note: "bg-rose-50/60 hover:bg-rose-100/70",
};

export const DOCUMENT_TYPE_BADGE_COLORS: Record<DocumentType, string> = {
  receipt: "bg-emerald-100 text-emerald-800",
  quote: "bg-amber-100 text-amber-800",
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
  tax_invoice: 201,
  tax_invoice_receipt: 201,
  credit_note: 201,
};

export const DOC_SUM_LABEL: Record<DocumentType, string> = {
  receipt: "סה״כ לתשלום",
  quote: "סה״כ הצעה",
  tax_invoice: "סה״כ לתשלום",
  tax_invoice_receipt: "סה״כ לתשלום",
  credit_note: "סה״כ זיכוי",
};
