"use client";

import { formatCurrency, formatDate } from "@/lib/format";
import {
  BUSINESS_TYPE_LABELS,
  DOC_SUM_LABEL,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type Business,
  type DocumentItem,
  type DocumentType,
  type PaymentMethod,
} from "@/lib/types";

export interface DocumentBodyClient {
  name: string;
  taxId?: string;
  address?: string;
  phone?: string;
  email?: string;
}

function showPaymentInfo(type: DocumentType, business: Business): boolean {
  // Only show payment info on docs awaiting payment
  if (type === "receipt" || type === "tax_invoice_receipt" || type === "credit_note") {
    return false;
  }
  return Boolean(
    business.bankName ||
      business.bankBranch ||
      business.bankAccount ||
      business.paymentNotes
  );
}

/**
 * Color scheme per document type — gives the recipient an instant visual
 * cue without having to read the Hebrew label. Receipts = emerald (paid /
 * positive), tax invoices = blue (formal / fiscal), quotes = amber
 * (pending), credit notes = rose (refund), tax-invoice-receipt = teal.
 */
function badgeStylesFor(type: DocumentType): { bg: string; print: string } {
  switch (type) {
    case "receipt":
      return { bg: "from-emerald-500 to-teal-600", print: "print:bg-emerald-600" };
    case "tax_invoice":
      return { bg: "from-blue-500 to-indigo-600", print: "print:bg-blue-600" };
    case "tax_invoice_receipt":
      return { bg: "from-teal-500 to-cyan-600", print: "print:bg-teal-600" };
    case "quote":
      return { bg: "from-amber-500 to-orange-600", print: "print:bg-amber-600" };
    case "credit_note":
      return { bg: "from-rose-500 to-pink-600", print: "print:bg-rose-600" };
    default:
      return { bg: "from-stone-500 to-stone-700", print: "print:bg-stone-700" };
  }
}

interface Props {
  business: Business;
  client: DocumentBodyClient | null;
  documentType: DocumentType;
  number: number | null;
  date: string;
  subject?: string;
  items: DocumentItem[];
  subtotal: number;
  vat: number;
  vatRate: number;
  total: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
  placeholders?: boolean;
  /** מספר הקצאה (Tax Authority allocation), shown on tax-invoice docs that have one. */
  allocationNumber?: string;
}

export function DocumentBody({
  business,
  client,
  documentType,
  number,
  date,
  subject,
  items,
  subtotal,
  vat,
  vatRate,
  total,
  paymentMethod,
  notes,
  placeholders = false,
  allocationNumber,
}: Props) {
  const numberStr = number != null ? `#${number}` : "(אוטומטי)";
  const dateStr = date ? formatDate(date) : "—";
  const businessName = business.name || (placeholders ? "—" : "");
  const showItemsEmptyState =
    placeholders && (items.length === 0 || items.every((i) => !i.description));
  const badge = badgeStylesFor(documentType);

  return (
    <>
      {/* Header: business identity on the right, doc identity on the left.
          Thicker accent border + slightly more breathing room than before. */}
      <div className="flex items-start justify-between pb-7 border-b-[3px] border-orange-500 gap-6">
        <div className="flex items-start gap-5">
          {business.logoUrl && (
            <img
              src={business.logoUrl}
              alt={business.name}
              className="w-24 h-24 object-contain flex-shrink-0 rounded-xl"
            />
          )}
          <div className="space-y-0.5">
            <h1 className="text-[28px] leading-tight font-bold text-stone-900">{businessName}</h1>
            <p className="text-sm text-stone-700 mt-1.5">
              {BUSINESS_TYPE_LABELS[business.businessType]}
              {business.taxId && (
                <>
                  {" · "}
                  <span dir="ltr" className="font-mono">{business.taxId}</span>
                </>
              )}
            </p>
            {business.address && (
              <p className="text-sm text-stone-700">{business.address}</p>
            )}
            {business.phone && (
              <p className="text-sm text-stone-700" dir="ltr">
                {business.phone}
              </p>
            )}
            {business.email && (
              <p className="text-sm text-stone-700" dir="ltr">
                {business.email}
              </p>
            )}
          </div>
        </div>
        <div className="text-left space-y-2">
          <div
            className={`inline-block px-5 py-2 bg-gradient-to-br ${badge.bg} ${badge.print} text-white rounded-2xl font-bold text-lg shadow-sm`}
          >
            {DOCUMENT_TYPE_LABELS[documentType]}
          </div>
          <p className="text-3xl font-bold text-stone-900 leading-none">{numberStr}</p>
          <p className="text-sm text-stone-700">{dateStr}</p>
          {allocationNumber && (
            <div className="mt-3 inline-block px-3 py-1.5 rounded-xl bg-stone-100 border border-stone-200 print:border-stone-400">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-stone-600">
                מספר הקצאה — חשבונית ישראל
              </p>
              <p className="text-sm font-mono font-bold text-stone-900 mt-0.5" dir="ltr">
                {allocationNumber}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Client + subject — two side-by-side blocks under the header */}
      <div className="grid grid-cols-2 gap-8 mt-8">
        <div>
          <h3 className="text-[11px] font-bold text-stone-500 uppercase tracking-wider mb-2.5">
            ללקוח
          </h3>
          {client ? (
            <>
              <p className="font-bold text-stone-900 text-lg leading-tight">{client.name}</p>
              {client.taxId && (
                <p className="text-sm text-stone-700 mt-1">
                  <span className="text-stone-500">ח.פ / ת.ז: </span>
                  <span dir="ltr" className="font-mono">{client.taxId}</span>
                </p>
              )}
              {client.address && (
                <p className="text-sm text-stone-700 mt-0.5">{client.address}</p>
              )}
              {client.phone && (
                <p className="text-sm text-stone-700 mt-0.5" dir="ltr">
                  {client.phone}
                </p>
              )}
              {client.email && (
                <p className="text-sm text-stone-700 mt-0.5" dir="ltr">
                  {client.email}
                </p>
              )}
            </>
          ) : (
            <p className="font-bold text-stone-400 text-lg">לקוח לא נבחר</p>
          )}
        </div>
        {subject && (
          <div>
            <h3 className="text-[11px] font-bold text-stone-500 uppercase tracking-wider mb-2.5">
              נושא
            </h3>
            <p className="text-stone-900 leading-relaxed">{subject}</p>
          </div>
        )}
      </div>

      {/* Items table — zebra rows, generous padding, no harsh borders */}
      <div className="mt-10 overflow-hidden rounded-xl border border-stone-200 print:border-stone-300">
        <table className="w-full">
          <thead>
            <tr className="bg-gradient-to-l from-orange-50 to-amber-50 print:bg-orange-50">
              <th className="text-right px-5 py-3 font-bold text-[12px] uppercase tracking-wide text-stone-700">
                תיאור
              </th>
              <th className="text-center px-3 py-3 font-bold text-[12px] uppercase tracking-wide text-stone-700 w-20">
                כמות
              </th>
              <th className="text-left px-4 py-3 font-bold text-[12px] uppercase tracking-wide text-stone-700 w-32">
                מחיר יחידה
              </th>
              <th className="text-left px-4 py-3 font-bold text-[12px] uppercase tracking-wide text-stone-700 w-32">
                סה״כ
              </th>
            </tr>
          </thead>
          <tbody>
            {showItemsEmptyState ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm text-stone-400">
                  לא הוזנו פריטים עדיין
                </td>
              </tr>
            ) : (
              items.map((item, idx) => (
                <tr
                  key={item.id}
                  className={
                    idx % 2 === 0
                      ? "bg-white"
                      : "bg-stone-50/60 print:bg-stone-50"
                  }
                >
                  <td className="px-5 py-3.5 text-sm text-stone-800 leading-relaxed">
                    {item.description || (placeholders ? <span className="text-stone-400">—</span> : "")}
                  </td>
                  <td className="px-3 py-3.5 text-sm text-center text-stone-800 tabular-nums">
                    {item.quantity}
                  </td>
                  <td className="px-4 py-3.5 text-sm text-left text-stone-800 tabular-nums">
                    {formatCurrency(item.unitPrice)}
                  </td>
                  <td className="px-4 py-3.5 text-sm text-left font-semibold text-stone-900 tabular-nums">
                    {formatCurrency(item.total)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Totals block — right-aligned, highlighted background on the
          grand total row so it draws the eye instantly. */}
      <div className="mt-6 flex justify-end">
        <div className="w-80 space-y-2 text-stone-700">
          <div className="flex justify-between text-sm">
            <span>סכום ביניים</span>
            <span className="tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
          {vatRate > 0 && (
            <div className="flex justify-between text-sm">
              <span>מע״מ ({vatRate}%)</span>
              <span className="tabular-nums">{formatCurrency(vat)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-3 border-t-[3px] border-orange-500 mt-1 rounded-b-xl bg-orange-50/60 print:bg-orange-50 -mx-3 px-3 py-2.5">
            <span className="font-bold text-stone-900 text-base">{DOC_SUM_LABEL[documentType]}</span>
            <span className="text-2xl font-bold text-stone-900 tabular-nums">
              {formatCurrency(total)}
            </span>
          </div>
        </div>
      </div>

      {paymentMethod && (
        <div className="mt-7 pt-5 border-t border-stone-200">
          <p className="text-sm text-stone-700">
            <span className="font-semibold text-stone-900">אמצעי תשלום: </span>
            {PAYMENT_METHOD_LABELS[paymentMethod]}
          </p>
        </div>
      )}

      {showPaymentInfo(documentType, business) && (
        <div className="mt-7 pt-5 border-t border-stone-200">
          <h3 className="text-[11px] font-bold text-stone-500 uppercase tracking-wider mb-2.5">
            פרטי תשלום
          </h3>
          <div className="text-sm text-stone-800 space-y-1.5">
            {(business.bankName || business.bankBranch || business.bankAccount) && (
              <p>
                <span className="font-semibold text-stone-900">העברה בנקאית: </span>
                <span dir="ltr" className="font-mono">
                  {[
                    business.bankName,
                    business.bankBranch ? `סניף ${business.bankBranch}` : "",
                    business.bankAccount ? `חשבון ${business.bankAccount}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </p>
            )}
            {business.paymentNotes && (
              <p className="text-stone-700 whitespace-pre-wrap">{business.paymentNotes}</p>
            )}
          </div>
        </div>
      )}

      {notes && (
        <div className="mt-7 pt-5 border-t border-stone-200">
          <h3 className="text-[11px] font-bold text-stone-500 uppercase tracking-wider mb-2.5">
            הערות
          </h3>
          <p className="text-sm text-stone-800 whitespace-pre-wrap leading-relaxed">{notes}</p>
        </div>
      )}

      {/* Footer — soft separator, brand mark on the right, "thank you" on
          the left. The mark doubles as a soft signal of which tool issued
          the document. */}
      <div className="mt-12 pt-5 border-t border-stone-200 flex items-center justify-between text-[11px] text-stone-500">
        <div className="space-y-0.5">
          <p>מסמך זה הופק אלקטרונית{business.name ? ` · ${business.name}` : ""}</p>
          <p className="text-[10px] text-stone-400">
            הופק באמצעות MySuperFriendlyInvoiceApp · mysuperfriendlyinvoiceapp.vercel.app
          </p>
        </div>
        <p className="font-semibold text-stone-600">תודה על שיתוף הפעולה!</p>
      </div>
    </>
  );
}
