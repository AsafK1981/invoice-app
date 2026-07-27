"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { Printer, ArrowRight } from "lucide-react";
import { useClients } from "@/lib/client-store";
import { useDocuments } from "@/lib/document-store";
import { useBusiness } from "@/lib/business-store";
import { formatCurrency, formatDate } from "@/lib/format";
import { todayInIsrael } from "@/lib/date";
import { DOCUMENT_TYPE_LABELS, BUSINESS_TYPE_LABELS } from "@/lib/types";

export default function ClientStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { items: clients, ready: clientsReady } = useClients();
  const { documents, ready: docsReady } = useDocuments();
  const { business, ready: bizReady } = useBusiness();

  const client = clients.find((c) => c.id === id) ?? null;

  const data = useMemo(() => {
    if (!client) {
      return {
        rows: [],
        totalBilled: 0,
        totalPaid: 0,
        balance: 0,
      };
    }
    const mine = documents
      .filter((d) => d.clientId === client.id)
      .filter((d) => d.status !== "draft" && d.status !== "cancelled")
      .sort((a, b) => a.date.localeCompare(b.date));

    let totalBilled = 0;
    let totalPaid = 0;
    const rows = mine.map((d) => {
      const sign = d.type === "credit_note" ? -1 : 1;
      const signed = sign * d.total;
      // Use signed amount for billed (credit notes subtract).
      // "Paid" only counts when status=paid (signed too).
      totalBilled += signed;
      if (d.status === "paid") totalPaid += signed;
      return { doc: d, signed };
    });

    return {
      rows,
      totalBilled,
      totalPaid,
      balance: totalBilled - totalPaid,
    };
  }, [client, documents]);

  if (!clientsReady || !docsReady || !bizReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  if (!client) {
    return (
      <div className="card-soft p-8 text-center">
        <p className="text-stone-700">לקוח לא נמצא</p>
        <Link href="/clients" className="text-orange-600 mt-4 inline-block">
          חזרה ללקוחות
        </Link>
      </div>
    );
  }

  const today = todayInIsrael();

  return (
    <div className="space-y-6">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 1.5cm 1cm;
          }
          html, body { background: white !important; }
          .no-print, nav, aside, [role="navigation"] { display: none !important; }
          table { font-size: 9pt; }
        }
      `}</style>

      <div className="no-print flex items-center justify-between flex-wrap gap-3">
        <Link
          href={`/clients/${id}`}
          className="inline-flex items-center gap-2 text-sm text-stone-700 hover:text-stone-900"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לכרטיס הלקוח
        </Link>
        <button
          onClick={() => {
            const original = document.title;
            document.title = `כרטסת ${client.name} - ${business.name}`;
            try {
              window.print();
            } finally {
              document.title = original;
            }
          }}
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all"
        >
          <Printer className="w-4 h-4" />
          הדפס / שמור כ-PDF
        </button>
      </div>

      <div className="gk-paper bg-white rounded-2xl shadow-sm border border-orange-100 p-6 sm:p-8 print:shadow-none print:border-0 print:rounded-none print:p-0">
        <header className="pb-6 mb-6 border-b border-stone-200 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-stone-900">כרטסת לקוח</h1>
            <p className="text-sm text-stone-600 mt-1">
              הופק ב-{formatDate(today)}
            </p>
          </div>
          <div className="text-xs text-stone-700 text-left">
            <p className="font-semibold text-stone-900">{business.name || "-"}</p>
            <p>
              {BUSINESS_TYPE_LABELS[business.businessType]} · ע.מ {business.taxId || "-"}
            </p>
            {business.address && <p>{business.address}</p>}
          </div>
        </header>

        <section className="mb-6">
          <h2 className="text-lg font-bold text-stone-900 mb-2">פרטי הלקוח</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-6 text-sm text-stone-700">
            <p>
              <span className="text-stone-500">שם:</span>{" "}
              <span className="font-semibold text-stone-900">{client.name}</span>
            </p>
            {client.taxId && (
              <p>
                <span className="text-stone-500">ח.פ / ת.ז:</span>{" "}
                <span className="font-mono">{client.taxId}</span>
              </p>
            )}
            {client.address && (
              <p>
                <span className="text-stone-500">כתובת:</span> {client.address}
              </p>
            )}
            {client.phone && (
              <p>
                <span className="text-stone-500">טלפון:</span>{" "}
                <span className="font-mono" dir="ltr">{client.phone}</span>
              </p>
            )}
            {client.email && (
              <p>
                <span className="text-stone-500">מייל:</span>{" "}
                <span dir="ltr">{client.email}</span>
              </p>
            )}
          </div>
        </section>

        <section className="mb-6">
          <h2 className="text-lg font-bold text-stone-900 mb-3">
            כל המסמכים ({data.rows.length})
          </h2>
          {data.rows.length === 0 ? (
            <p className="text-sm text-stone-500 py-6 text-center">
              אין מסמכים ללקוח זה
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-stone-100">
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">תאריך</th>
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">סוג</th>
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">מס׳</th>
                  <th className="text-right px-3 py-2 border border-stone-300 font-semibold text-stone-700">סטטוס</th>
                  <th className="text-left px-3 py-2 border border-stone-300 font-semibold text-stone-700">סכום</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ doc, signed }) => (
                  <tr key={doc.id} className="even:bg-stone-50/60">
                    <td className="px-3 py-1.5 border border-stone-200 whitespace-nowrap">{formatDate(doc.date)}</td>
                    <td className="px-3 py-1.5 border border-stone-200">{DOCUMENT_TYPE_LABELS[doc.type]}</td>
                    <td className="px-3 py-1.5 border border-stone-200 font-mono">{doc.number}</td>
                    <td className="px-3 py-1.5 border border-stone-200">
                      {doc.status === "paid" ? "שולם" : "ממתין"}
                      {doc.paidAt && doc.status === "paid" && (
                        <span className="text-xs text-stone-500"> ({formatDate(doc.paidAt.slice(0, 10))})</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 border border-stone-200 text-left font-mono">
                      {formatCurrency(signed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>

        <section className="bg-stone-50/60 rounded-xl p-4 print:bg-transparent print:rounded-none print:border print:border-stone-300 print:p-3">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-stone-600 mb-1">סה״כ חיוב</p>
              <p className="text-lg font-bold text-stone-900" dir="ltr">
                {formatCurrency(data.totalBilled)}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-600 mb-1">שולם</p>
              <p className="text-lg font-bold text-emerald-700" dir="ltr">
                {formatCurrency(data.totalPaid)}
              </p>
            </div>
            <div>
              <p className="text-xs text-stone-600 mb-1">יתרה לתשלום</p>
              <p
                className={`text-lg font-bold ${
                  data.balance > 0.5 ? "text-rose-700" : "text-stone-900"
                }`}
                dir="ltr"
              >
                {formatCurrency(data.balance)}
              </p>
            </div>
          </div>
        </section>

        <footer className="text-xs text-stone-500 text-center mt-6 pt-4 border-t border-stone-200">
          הופק ממערכת MySuperFriendlyInvoiceApp · {formatDate(today)}
        </footer>
      </div>
    </div>
  );
}
