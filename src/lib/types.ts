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
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  supplier: string;
  amount: number;
  description?: string;
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
