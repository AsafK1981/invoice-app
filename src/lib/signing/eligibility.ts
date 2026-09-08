// Which documents the app signs with the business's secured electronic
// signature, and which it deliberately does not.
//
// הוראות מס הכנסה (ניהול פנקסי חשבונות), התשל"ג-1973:
//
//   * סעיף 1, "מסמך ממוחשב": a document delivered as a file is a מסמך ממוחשב
//     only when it carries a secured (or certified) electronic signature OF
//     THE TAXPAYER who issued it. Without the signature the file is not a tax
//     document at all; the customer then has to receive a paper original.
//   * סעיף 18ב(ד): a document signed with a SECURED signature (what this app
//     uses; a certified one needs a licensed CA) may record payment only by
//     כרטיס אשראי, שיק שאינו סחיר or העברה בנקאית. מזומן and the app-based
//     transfers are outside that list, so a receipt for such a payment cannot
//     be a signed מסמך ממוחשב. It stays a paper document: printed and handed
//     over.
//
// Pure and client-safe: the paper (document-body) uses it to decide whether
// to print "מסמך ממוחשב", and the PDF route uses the same answer to decide
// whether to sign. Both must agree, so this is the single place that decides.

import type { DocumentStatus, DocumentType, PaymentMethod } from "../types";

/** Payment methods 18ב(ד) allows on a secured-signature document. */
export const SIGNABLE_PAYMENT_METHODS: ReadonlySet<PaymentMethod> = new Set<PaymentMethod>([
  "credit_card",
  "check",
  "bank_transfer",
]);

/** Document types that record a payment, and so fall under 18ב(ד). */
const PAYMENT_DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>([
  "receipt",
  "tax_invoice_receipt",
]);

export type IneligibleReason =
  /** Still a draft (קובץ זמני): nothing to sign yet. */
  | "draft"
  /** A payment document whose payment method 18ב(ד) excludes. */
  | "payment_method"
  /** A payment document with no payment method recorded: cannot prove 18ב(ד). */
  | "payment_method_missing";

export interface SigningEligibility {
  eligible: boolean;
  reason: IneligibleReason | null;
}

export interface EligibilityInput {
  type: DocumentType;
  status: DocumentStatus;
  paymentMethod?: PaymentMethod | null;
}

export function signingEligibility(doc: EligibilityInput): SigningEligibility {
  if (doc.status === "draft") return { eligible: false, reason: "draft" };
  if (PAYMENT_DOCUMENT_TYPES.has(doc.type)) {
    if (!doc.paymentMethod) return { eligible: false, reason: "payment_method_missing" };
    if (!SIGNABLE_PAYMENT_METHODS.has(doc.paymentMethod)) {
      return { eligible: false, reason: "payment_method" };
    }
  }
  return { eligible: true, reason: null };
}

/**
 * Whether the paper may carry the words "מסמך ממוחשב". True exactly when the
 * app will sign the PDF it emits for this document. A document that is not
 * signed must not claim to be one.
 */
export function isComputerizedDocument(doc: EligibilityInput): boolean {
  return signingEligibility(doc).eligible;
}
