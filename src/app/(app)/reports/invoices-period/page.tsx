"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileSpreadsheet, Download, Printer } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useClients } from "@/lib/client-store";
import { formatCurrency } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/types";

// VAT documents that carry a net/VAT breakdown and an allocation number.
const REPORT_TYPES: DocumentType[] = ["tax_invoice", "tax_invoice_receipt", "credit_note"];

const LENGTHS: { months: number; label: string }[] = [
  { months: 1, label: "חודש" },
  { months: 2, label: "חודשיים" },
  { months: 3, label: "שלושה חודשים" },
  { months: 6, label: "חצי שנה" },
];

const MONTH_NAMES = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function ym(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** First day (YYYY-MM-01) of the month `back` months before `endYm` (YYYY-MM). */
function startOfRange(endYm: string, lengthMonths: number): string {
  const [y, m] = endYm.split("-").map(Number);
  const d = new Date(y, m - 1 - (lengthMonths - 1), 1);
  return `${ym(d)}-01`;
}

/** First day of the month AFTER `endYm` — exclusive upper bound for the range. */
function afterEnd(endYm: string): string {
  const [y, m] = endYm.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${ym(d)}-01`;
}

function rangeLabel(endYm: string, lengthMonths: number): string {
  const [ey, em] = endYm.split("-").map(Number);
  const end = `${MONTH_NAMES[em - 1]} ${ey}`;
  if (lengthMonths === 1) return end;
  const s = new Date(ey, em - 1 - (lengthMonths - 1), 1);
  return `${MONTH_NAMES[s.getMonth()]} ${s.getFullYear()} – ${end}`;
}

export default function InvoicesPeriodReportPage() {
  const { documents, ready } = useDocuments();
  const { items: clients } = useClients();

  const [lengthMonths, setLengthMonths] = useState<number>(2);
  const [endMonth, setEndMonth] = useState<string>(() => ym(new Date()));

  const taxIdByClient = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of clients) if (c.taxId) map[c.id] = c.taxId;
    return map;
  }, [clients]);

  const rows = useMemo(() => {
    const start = startOfRange(endMonth, lengthMonths);
    const end = afterEnd(endMonth);
    return documents
      .filter(
        (d) =>
          REPORT_TYPES.includes(d.type) &&
          typeof d.date === "string" &&
          d.date >= start &&
          d.date < end,
      )
      .map((d) => ({
        id: d.id,
        type: d.type,
        number: d.number,
        date: d.date,
        customerTaxId: d.clientTaxId || taxIdByClient[d.clientId] || "",
        clientName: d.clientName,
        net: d.subtotalIls ?? d.subtotal,
        total: d.totalIls ?? d.total,
        allocation: d.allocationNumber || "",
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number));
  }, [documents, endMonth, lengthMonths, taxIdByClient]);

  const totals = useMemo(
    () => rows.reduce((acc, r) => ({ net: acc.net + r.net, total: acc.total + r.total }), { net: 0, total: 0 }),
    [rows],
  );

  function fmtDate(iso: string): string {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  function exportCsv() {
    const headers = ["ת.ז / ח.פ", "מספר חשבונית", "תאריך", "סכום ללא מע\"מ", "סכום כולל מע\"מ", "מספר הקצאה"];
    const lines = rows.map((r) =>
      [r.customerTaxId, r.number, fmtDate(r.date), r.net.toFixed(2), r.total.toFixed(2), r.allocation]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = "﻿" + [headers.join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `דוח-חשבוניות-${endMonth}-${lengthMonths}ח.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="no-print">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לדוחות
        </Link>
      </div>

      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-sm">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </span>
            דוח חשבוניות תקופתי
          </h1>
          <p className="text-sm text-stone-600 mt-2 mr-14">
            כל חשבוניות המס בתקופה — ת.ז/ח.פ, מספר, תאריך, סכום לפני ואחרי מע״מ, ומספר הקצאה.
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border-2 border-emerald-200 text-stone-800 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            ייצוא Excel/CSV
          </button>
          <button
            onClick={() => window.print()}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Printer className="w-4 h-4 text-orange-600" />
            הדפסה / PDF
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="card-soft p-4 flex flex-wrap items-center gap-4 no-print">
        <div className="flex items-center gap-1 bg-stone-100 rounded-xl p-1">
          {LENGTHS.map((l) => (
            <button
              key={l.months}
              onClick={() => setLengthMonths(l.months)}
              className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                lengthMonths === l.months
                  ? "bg-white text-sky-700 shadow-sm"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          חודש סיום:
          <input
            type="month"
            value={endMonth}
            onChange={(e) => setEndMonth(e.target.value || ym(new Date()))}
            className="input-warm py-2 px-3 text-sm"
            dir="ltr"
          />
        </label>
        <span className="text-sm text-stone-500">
          מציג: <span className="font-semibold text-stone-800">{rangeLabel(endMonth, lengthMonths)}</span>
        </span>
      </div>

      {/* Report */}
      <div className="card-soft overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100 flex items-baseline justify-between">
          <h2 className="font-bold text-stone-900">{rangeLabel(endMonth, lengthMonths)}</h2>
          <span className="text-sm text-stone-500">{rows.length} חשבוניות</span>
        </div>
        {ready && rows.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            אין חשבוניות מס בתקופה שנבחרה.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-stone-600 bg-stone-50/70 text-right">
                  <th className="px-4 py-2.5 font-semibold">ת.ז / ח.פ</th>
                  <th className="px-4 py-2.5 font-semibold">מספר חשבונית</th>
                  <th className="px-4 py-2.5 font-semibold">תאריך</th>
                  <th className="px-4 py-2.5 font-semibold">סכום ללא מע״מ</th>
                  <th className="px-4 py-2.5 font-semibold">סכום כולל מע״מ</th>
                  <th className="px-4 py-2.5 font-semibold">מספר הקצאה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-orange-50/30">
                    <td className="px-4 py-2.5 tabular-nums" dir="ltr">{r.customerTaxId || "—"}</td>
                    <td className="px-4 py-2.5">
                      <Link href={`/documents/${r.id}`} className="text-sky-700 hover:underline font-medium">
                        {DOCUMENT_TYPE_LABELS[r.type]} #{r.number}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums" dir="ltr">{fmtDate(r.date)}</td>
                    <td className="px-4 py-2.5 tabular-nums" dir="ltr">{formatCurrency(r.net)}</td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold" dir="ltr">{formatCurrency(r.total)}</td>
                    <td className="px-4 py-2.5 tabular-nums" dir="ltr">{r.allocation || "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-stone-50 font-bold text-stone-900 border-t-2 border-stone-200">
                  <td className="px-4 py-3" colSpan={3}>סה״כ ({rows.length} חשבוניות)</td>
                  <td className="px-4 py-3 tabular-nums" dir="ltr">{formatCurrency(totals.net)}</td>
                  <td className="px-4 py-3 tabular-nums" dir="ltr">{formatCurrency(totals.total)}</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
