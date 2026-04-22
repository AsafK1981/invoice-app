"use client";

import { formatCurrency, formatDate } from "@/lib/format";
import {
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type Business,
  type Client,
  type InvoiceDocument,
} from "@/lib/types";

interface Props {
  business: Business;
  client: Client | null;
  document: InvoiceDocument;
}

const businessTypeLabels = {
  exempt: "עוסק פטור",
  authorized: "עוסק מורשה",
  company: "חברה בע״מ",
};

export function ReceiptView({ business, client, document: doc }: Props) {
  return (
    <div className="receipt-view mx-auto max-w-[210mm] bg-white p-12 shadow-lg print:shadow-none print:p-8">
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
            <h1 className="text-3xl font-bold text-stone-900">{business.name}</h1>
            <p className="text-sm text-stone-700 mt-1">
              {businessTypeLabels[business.businessType]} · {business.taxId}
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
            {DOCUMENT_TYPE_LABELS[doc.type]}
          </div>
          <p className="text-2xl font-bold text-stone-900 mt-3">#{doc.number}</p>
          <p className="text-sm text-stone-700 mt-1">תאריך: {formatDate(doc.date)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mt-8">
        <div>
          <h3 className="text-xs font-semibold text-stone-600 uppercase mb-2">ללקוח</h3>
          <p className="font-bold text-stone-900 text-lg">{doc.clientName}</p>
          {client?.taxId && (
            <p className="text-sm text-stone-700 mt-0.5">ח.פ / ת.ז: {client.taxId}</p>
          )}
          {client?.address && (
            <p className="text-sm text-stone-700 mt-0.5">{client.address}</p>
          )}
          {client?.phone && (
            <p className="text-sm text-stone-700 mt-0.5" dir="ltr">
              {client.phone}
            </p>
          )}
          {client?.email && (
            <p className="text-sm text-stone-700 mt-0.5" dir="ltr">
              {client.email}
            </p>
          )}
        </div>
        {doc.subject && (
          <div>
            <h3 className="text-xs font-semibold text-stone-600 uppercase mb-2">נושא</h3>
            <p className="text-stone-900">{doc.subject}</p>
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
            {doc.items.map((item) => (
              <tr key={item.id} className="border-b border-orange-100">
                <td className="px-4 py-3 text-sm text-stone-800">{item.description}</td>
                <td className="px-4 py-3 text-sm text-center text-stone-800">{item.quantity}</td>
                <td className="px-4 py-3 text-sm text-left text-stone-800">
                  {formatCurrency(item.unitPrice)}
                </td>
                <td className="px-4 py-3 text-sm text-left font-semibold text-stone-900">
                  {formatCurrency(item.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex justify-end">
        <div className="w-72 space-y-2">
          <div className="flex justify-between text-sm text-stone-700">
            <span>סכום ביניים</span>
            <span>{formatCurrency(doc.subtotal)}</span>
          </div>
          {doc.vat > 0 && (
            <div className="flex justify-between text-sm text-stone-700">
              <span>מע״מ</span>
              <span>{formatCurrency(doc.vat)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-3 border-t-2 border-orange-400">
            <span className="font-bold text-stone-900">סה״כ לתשלום</span>
            <span className="text-2xl font-bold bg-gradient-to-l from-orange-500 to-rose-500 bg-clip-text text-transparent print:text-stone-900 print:bg-none">
              {formatCurrency(doc.total)}
            </span>
          </div>
        </div>
      </div>

      {doc.paymentMethod && (
        <div className="mt-6 pt-6 border-t border-orange-100">
          <p className="text-sm text-stone-700">
            <span className="font-semibold">אמצעי תשלום: </span>
            {PAYMENT_METHOD_LABELS[doc.paymentMethod]}
          </p>
        </div>
      )}

      {doc.notes && (
        <div className="mt-6 pt-6 border-t border-orange-100">
          <h3 className="text-xs font-semibold text-stone-600 uppercase mb-2">הערות</h3>
          <p className="text-sm text-stone-800 whitespace-pre-wrap">{doc.notes}</p>
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-orange-100 text-center">
        <p className="text-xs text-stone-500">תודה על שיתוף הפעולה!</p>
        <p className="text-xs text-stone-400 mt-1">
          מסמך זה הופק אלקטרונית · {business.name}
        </p>
      </div>
    </div>
  );
}
