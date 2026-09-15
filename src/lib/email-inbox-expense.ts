// Validation of the expense an owner approves from the email inbox queue.
// Lives outside the route file so it is unit-tested (and because a Next.js
// route module may only export its HTTP handlers and route config).

import { expenseVatForBusinessType } from "./vat";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ExpenseInput {
  date: string;
  category: string;
  supplier: string;
  amount: number;
  vatAmount: number;
  description: string | null;
  supplierTaxId: string | null;
  reference: string | null;
  isEquipment: boolean;
  allocationNumber: string | null;
}

/**
 * Validate what the owner submitted. Everything the books depend on (date,
 * amount, supplier) is required; the rest is optional and normalised the same
 * way expenseStore.save() normalises it, so an email-approved row is
 * indistinguishable from a hand-typed one.
 *
 * The returned object is handed to email_inbox_approve() as jsonb, so its key
 * names are part of that function's contract - see the INSERT there.
 */
export function parseExpense(raw: unknown, businessType: string | null): ExpenseInput | string {
  if (!raw || typeof raw !== "object") return "חסרים פרטי ההוצאה.";
  const e = raw as Record<string, unknown>;

  const date = String(e.date || "").trim();
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return "תאריך לא תקין.";
  }
  const year = Number(date.slice(0, 4));
  if (year < 2000 || year > 2100) return "תאריך לא תקין.";

  const supplier = String(e.supplier ?? "").trim().slice(0, 120);
  if (!supplier) return "חסר שם ספק.";

  const amount = round2(Number(e.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return "סכום לא תקין.";
  }

  // An עוסק פטור deducts no input VAT: whatever the scanner read (or the
  // client sent) is dropped, and the expense stays at its gross amount.
  const rawVat = e.vatAmount == null || e.vatAmount === "" ? 0 : Number(e.vatAmount);
  const vatAmount = expenseVatForBusinessType(round2(rawVat), businessType);
  if (!Number.isFinite(vatAmount) || vatAmount < 0 || vatAmount > amount) {
    return "סכום מע\"מ לא תקין.";
  }

  const category = String(e.category ?? "").trim().slice(0, 60) || "אחר";
  const description = String(e.description ?? "").trim().slice(0, 1000) || null;
  const supplierTaxId = String(e.supplierTaxId ?? "").replace(/\D/g, "").slice(0, 15) || null;
  const reference = String(e.reference ?? "").trim().slice(0, 60) || null;
  // מספר הקצאה of the SUPPLIER's invoice (חשבונית ישראל). Digits only, same
  // normalisation filingColumns() applies, because the PCN874 writer reads
  // this column without re-cleaning it.
  const allocationNumber = String(e.allocationNumber ?? "").replace(/\D/g, "").slice(0, 30) || null;

  return {
    date,
    category,
    supplier,
    amount,
    vatAmount,
    description,
    supplierTaxId,
    reference,
    isEquipment: e.isEquipment === true,
    allocationNumber,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
