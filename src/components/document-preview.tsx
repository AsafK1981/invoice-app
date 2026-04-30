"use client";

import { useEffect, useRef, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type Business,
  type Client,
  type DocumentItem,
  type DocumentType,
  type PaymentMethod,
} from "@/lib/types";

const businessTypeLabels = {
  exempt: "עוסק פטור",
  authorized: "עוסק מורשה",
  company: "חברה בע״מ",
};

interface PreviewClient {
  name: string;
  taxId?: string;
  address?: string;
  phone?: string;
  email?: string;
}

interface Props {
  business: Business;
  client: PreviewClient | null;
  documentType: DocumentType;
  number?: number | null;
  date: string;
  subject?: string;
  items: DocumentItem[];
  subtotal: number;
  vat: number;
  vatRate: number;
  total: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
}

const PAGE_WIDTH_PX = 794;

export function DocumentPreview(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [naturalHeight, setNaturalHeight] = useState<number>(1100);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / PAGE_WIDTH_PX));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!pageRef.current) return;
    const el = pageRef.current;
    const update = () => {
      const h = el.offsetHeight;
      if (h > 0) setNaturalHeight(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="w-full">
      <div
        style={{
          height: naturalHeight * scale,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: PAGE_WIDTH_PX,
            transform: `scale(${scale})`,
            transformOrigin: "top right",
          }}
        >
          <div ref={pageRef}>
            <PreviewPage {...props} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewPage({
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
}: Props) {
  const isCreditNote = documentType === "credit_note";
  const sumLabel = documentType === "quote" ? "סה״כ הצעה" : isCreditNote ? "סה״כ זיכוי" : "סה״כ לתשלום";
  const numberStr = number != null ? `#${number}` : "(אוטומטי)";

  return (
    <div
      className="preview-page bg-white rounded-2xl shadow-md p-10"
      dir="rtl"
    >
      <div className="flex items-start justify-between pb-6 border-b-2 border-orange-400 gap-6">
        <div className="flex items-start gap-4">
          {business.logoUrl && (
            <img
              src={business.logoUrl}
              alt={business.name}
              className="w-16 h-16 object-contain flex-shrink-0"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold text-stone-900">{business.name || "—"}</h1>
            <p className="text-sm text-stone-700 mt-1">
              {businessTypeLabels[business.businessType]} · {business.taxId}
            </p>
            <p className="text-sm text-stone-700 mt-1">{business.address}</p>
            {business.phone && (
              <p className="text-sm text-stone-700" dir="ltr">{business.phone}</p>
            )}
            {business.email && (
              <p className="text-sm text-stone-700" dir="ltr">{business.email}</p>
            )}
          </div>
        </div>
        <div className="text-left">
          <div className="inline-block px-4 py-2 bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl font-bold text-lg">
            {DOCUMENT_TYPE_LABELS[documentType]}
          </div>
          <p className="text-2xl font-bold text-stone-900 mt-3">{numberStr}</p>
          <p className="text-sm text-stone-700 mt-1">תאריך: {date ? formatDate(date) : "—"}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mt-8">
        <div>
          <h3 className="text-xs font-semibold text-stone-600 uppercase mb-2">ללקוח</h3>
          <p className="font-bold text-stone-900 text-lg">
            {client?.name || <span className="text-stone-400">לקוח לא נבחר</span>}
          </p>
          {client?.taxId && (
            <p className="text-sm text-stone-700 mt-0.5">ח.פ / ת.ז: {client.taxId}</p>
          )}
          {client?.address && (
            <p className="text-sm text-stone-700 mt-0.5">{client.address}</p>
          )}
          {client?.phone && (
            <p className="text-sm text-stone-700 mt-0.5" dir="ltr">{client.phone}</p>
          )}
          {client?.email && (
            <p className="text-sm text-stone-700 mt-0.5" dir="ltr">{client.email}</p>
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
            {items.length === 0 || items.every((i) => !i.description) ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-stone-400">
                  לא הוזנו פריטים עדיין
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-b border-orange-100">
                  <td className="px-4 py-3 text-sm text-stone-800">
                    {item.description || <span className="text-stone-400">—</span>}
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
            <span className="font-bold text-stone-900">{sumLabel}</span>
            <span className="text-2xl font-bold bg-gradient-to-l from-orange-500 to-rose-500 bg-clip-text text-transparent">
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
    </div>
  );
}

export type { PreviewClient };
