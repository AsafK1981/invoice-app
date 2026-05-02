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
}: Props) {
  const numberStr = number != null ? `#${number}` : "(אוטומטי)";
  const dateStr = date ? formatDate(date) : "—";
  const businessName = business.name || (placeholders ? "—" : "");
  const showItemsEmptyState =
    placeholders && (items.length === 0 || items.every((i) => !i.description));

  return (
    <>
      <div className="flex items-start justify-between pb-6 border-b-2 border-orange-400 gap-6">
        <div className="flex items-start gap-4">
          {business.logoUrl && (
            <img
              src={business.logoUrl}
              alt={business.name}
              className="w-20 h-20 object-contain flex-shrink-0"
            />
          )}
          <div>
            <h1 className="text-3xl font-bold text-stone-900">{businessName}</h1>
            <p className="text-sm text-stone-700 mt-1">
              {BUSINESS_TYPE_LABELS[business.businessType]} · {business.taxId}
            </p>
            <p className="text-sm text-stone-700 mt-1">{business.address}</p>
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
        <div className="text-left">
          <div className="inline-block px-4 py-2 bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl font-bold text-lg print:bg-emerald-600">
            {DOCUMENT_TYPE_LABELS[documentType]}
          </div>
          <p className="text-2xl font-bold text-stone-900 mt-3">{numberStr}</p>
          <p className="text-sm text-stone-700 mt-1">תאריך: {dateStr}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mt-8">
        <div>
          <h3 className="text-xs font-semibold text-stone-600 uppercase mb-2">ללקוח</h3>
          {client ? (
            <>
              <p className="font-bold text-stone-900 text-lg">{client.name}</p>
              {client.taxId && (
                <p className="text-sm text-stone-700 mt-0.5">ח.פ / ת.ז: {client.taxId}</p>
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
            <h3 className="text-xs font-semibold text-stone-600 uppercase mb-2">נושא</h3>
            <p className="text-stone-900">{subject}</p>
          </div>
        )}
      </div>

      <div className="mt-8">
        <table className="w-full">
          <thead>
            <tr className="bg-orange-50 border-b-2 border-orange-200">
              <th className="text-right px-4 py-3 font-semibold text-sm text-stone-800">תיאור</th>
              <th className="text-center px-4 py-3 font-semibold text-sm text-stone-800 w-24">כמות</th>
              <th className="text-left px-4 py-3 font-semibold text-sm text-stone-800 w-32">מחיר יחידה</th>
              <th className="text-left px-4 py-3 font-semibold text-sm text-stone-800 w-32">סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {showItemsEmptyState ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-stone-400">
                  לא הוזנו פריטים עדיין
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-b border-orange-100">
                  <td className="px-4 py-3 text-sm text-stone-800">
                    {item.description || (placeholders ? <span className="text-stone-400">—</span> : "")}
                  </td>
                  <td className="px-4 py-3 text-sm text-center text-stone-800">{item.quantity}</td>
                  <td className="px-4 py-3 text-sm text-left text-stone-800">
                    {formatCurrency(item.unitPrice)}
                  </td>
                  <td className="px-4 py-3 text-sm text-left font-semibold text-stone-900">
                    {formatCurrency(item.total)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex justify-end">
        <div className="w-72 space-y-2">
          <div className="flex justify-between text-sm text-stone-700">
            <span>סכום ביניים</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          {vatRate > 0 && (
            <div className="flex justify-between text-sm text-stone-700">
              <span>מע״מ ({vatRate}%)</span>
              <span>{formatCurrency(vat)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-3 border-t-2 border-orange-400">
            <span className="font-bold text-stone-900">{DOC_SUM_LABEL[documentType]}</span>
            <span className="text-2xl font-bold bg-gradient-to-l from-orange-500 to-rose-500 bg-clip-text text-transparent print:text-stone-900 print:bg-none">
              {formatCurrency(total)}
            </span>
          </div>
        </div>
      </div>

      {paymentMethod && (
        <div className="mt-6 pt-6 border-t border-orange-100">
          <p className="text-sm text-stone-700">
            <span className="font-semibold">אמצעי תשלום: </span>
            {PAYMENT_METHOD_LABELS[paymentMethod]}
          </p>
        </div>
      )}

      {showPaymentInfo(documentType, business) && (
        <div className="mt-6 pt-6 border-t border-orange-100">
          <h3 className="text-xs font-semibold text-stone-600 uppercase mb-2">פרטי תשלום</h3>
          <div className="text-sm text-stone-800 space-y-1">
            {(business.bankName || business.bankBranch || business.bankAccount) && (
              <p>
                <span className="font-semibold">העברה בנקאית: </span>
                {[
                  business.bankName,
                  business.bankBranch ? `סניף ${business.bankBranch}` : "",
                  business.bankAccount ? `חשבון ${business.bankAccount}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {business.paymentNotes && (
              <p className="text-stone-700">{business.paymentNotes}</p>
            )}
          </div>
        </div>
      )}

      {notes && (
        <div className="mt-6 pt-6 border-t border-orange-100">
          <h3 className="text-xs font-semibold text-stone-600 uppercase mb-2">הערות</h3>
          <p className="text-sm text-stone-800 whitespace-pre-wrap">{notes}</p>
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-orange-100 text-center">
        <p className="text-xs text-stone-500">תודה על שיתוף הפעולה!</p>
        <p className="text-xs text-stone-400 mt-1">
          מסמך זה הופק אלקטרונית · {business.name}
        </p>
      </div>
    </>
  );
}
