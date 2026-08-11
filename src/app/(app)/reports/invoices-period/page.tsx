"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileSpreadsheet, Download, Printer } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useClients } from "@/lib/client-store";
import { formatCurrency } from "@/lib/format";
import { todayInIsrael } from "@/lib/date";
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

/** First day of the month AFTER `endYm`, exclusive upper bound for the range. */
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
  return `${MONTH_NAMES[s.getMonth()]} ${s.getFullYear()} עד ${end}`;
}

export default function InvoicesPeriodReportPage() {
  const { documents, ready } = useDocuments();
  const { items: clients } = useClients();

  const [rangeMode, setRangeMode] = useState<"preset" | "custom">("preset");
  const [lengthMonths, setLengthMonths] = useState<number>(2);
  const [endMonth, setEndMonth] = useState<string>(() => ym(new Date()));
  const [fromDate, setFromDate] = useState<string>(() => `${ym(new Date())}-01`);
  const [toDate, setToDate] = useState<string>(() => todayInIsrael());

  const taxIdByClient = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of clients) if (c.taxId) map[c.id] = c.taxId;
    return map;
  }, [clients]);

  const inRange = useMemo(() => {
    if (rangeMode === "custom") {
      const lo = fromDate || "0000-00-00";
      const hi = toDate || "9999-99-99";
      return (date: string) => date >= lo && date <= hi;
    }
    const start = startOfRange(endMonth, lengthMonths);
    const end = afterEnd(endMonth);
    return (date: string) => date >= start && date < end;
  }, [rangeMode, fromDate, toDate, endMonth, lengthMonths]);

  const rows = useMemo(() => {
    return documents
      .filter(
        (d) =>
          REPORT_TYPES.includes(d.type) &&
          typeof d.date === "string" &&
          inRange(d.date),
      )
      .map((d) => ({
        id: d.id,
        type: d.type,
        number: d.number,
        date: d.date,
        customerTaxId: d.clientTaxId || taxIdByClient[d.clientId] || "",
        clientName: d.clientName,
        net: d.subtotalIls ?? d.subtotal,
        vat: d.vatIls ?? d.vat,
        total: d.totalIls ?? d.total,
        allocation: d.allocationNumber || "",
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number));
  }, [documents, inRange, taxIdByClient]);

  const currentLabel =
    rangeMode === "custom"
      ? `${fromDate ? fmtDate(fromDate) : "?"} עד ${toDate ? fmtDate(toDate) : "?"}`
      : rangeLabel(endMonth, lengthMonths);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({ net: acc.net + r.net, vat: acc.vat + r.vat, total: acc.total + r.total }),
        { net: 0, vat: 0, total: 0 },
      ),
    [rows],
  );

  function fmtDate(iso: string): string {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  function exportCsv() {
    const headers = ["ת.ז / ח.פ", "מספר חשבונית", "תאריך", "סכום ללא מע\"מ", "מע\"מ", "סכום כולל מע\"מ", "מספר הקצאה"];
    const lines = rows.map((r) =>
      [r.customerTaxId, r.number, fmtDate(r.date), r.net.toFixed(2), r.vat.toFixed(2), r.total.toFixed(2), r.allocation]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = "﻿" + [headers.join(","), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `דוח-חשבוניות-${
      rangeMode === "custom" ? `${fromDate}_עד_${toDate}` : `${endMonth}-${lengthMonths}ח`
    }.csv`;
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
            <span className="w-11 h-11 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </span>
            דוח חשבוניות תקופתי
          </h1>
          <p className="text-sm text-stone-600 mt-2 mr-14">
            כל חשבוניות המס בתקופה: ת.ז/ח.פ, מספר, תאריך, סכום לפני ואחרי מע״מ, ומספר הקצאה.
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
      <div className="card-soft p-4 space-y-3 no-print">
        <div className="flex flex-wrap items-center gap-1 bg-stone-100 rounded-xl p-1 w-max max-w-full">
          {LENGTHS.map((l) => (
            <button
              key={l.months}
              onClick={() => {
                setRangeMode("preset");
                setLengthMonths(l.months);
              }}
              className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                rangeMode === "preset" && lengthMonths === l.months
                  ? "bg-white text-orange-700 shadow-sm"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {l.label}
            </button>
          ))}
          <button
            onClick={() => setRangeMode("custom")}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              rangeMode === "custom"
                ? "bg-white text-orange-700 shadow-sm"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            טווח מותאם
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-stone-100">
          {rangeMode === "preset" ? (
            <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
              חודש סיום:
              <input
                type="month"
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value || ym(new Date()))}
                className="input-warm py-2 px-3 text-sm w-auto"
                dir="ltr"
              />
            </label>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
                מתאריך:
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="input-warm py-2 px-3 text-sm w-auto"
                  dir="ltr"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
                עד תאריך:
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  className="input-warm py-2 px-3 text-sm w-auto"
                  dir="ltr"
                />
              </label>
            </>
          )}
          <span className="text-sm text-stone-500 sm:mr-auto">
            מציג: <span className="font-bold text-orange-700">{currentLabel}</span>
          </span>
        </div>
      </div>

      {/* Report */}
      <div className="card-soft overflow-hidden">
        <div className="px-5 py-3.5 border-b border-stone-100 flex items-baseline justify-between">
          <h2 className="font-bold text-stone-900 text-lg">{currentLabel}</h2>
          <span className="text-sm text-stone-500">{rows.length} חשבוניות</span>
        </div>
        {ready && rows.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            אין חשבוניות מס בתקופה שנבחרה.
          </div>
        ) : (
          <div className="p-5 overflow-x-auto">
            <table className="gk-rtable w-full text-sm border-separate border-spacing-0 rounded-xl overflow-hidden shadow-sm">
              <thead>
                <tr className="bg-gradient-to-l from-orange-500 to-rose-500 text-white">
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">ת.ז / ח.פ</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">מספר חשבונית</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">תאריך</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">סכום ללא מע״מ</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">מע״מ</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">סכום כולל מע״מ</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap">מספר הקצאה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={`${i % 2 ? "bg-orange-50/40" : "bg-white"} hover:bg-amber-50/40 transition-colors`}>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{r.customerTaxId || <span className="text-stone-300">-</span>}</td>
                    <td className="px-4 py-3.5 text-center align-middle whitespace-nowrap border-b border-l border-stone-200">
                      <Link href={`/documents/${r.id}`} className="text-orange-700 hover:underline font-bold">
                        {DOCUMENT_TYPE_LABELS[r.type]} #{r.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{fmtDate(r.date)}</td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{formatCurrency(r.net)}</td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{formatCurrency(r.vat)}</td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums font-extrabold text-stone-900 whitespace-nowrap border-b border-l border-stone-200">{formatCurrency(r.total)}</td>
                    <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-stone-200">{r.allocation || <span className="text-stone-300">-</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-orange-50 text-stone-900 font-black">
                  <td className="px-4 py-4 text-center border-t-2 border-l border-orange-200" colSpan={3}>סה״כ · {rows.length} חשבוניות</td>
                  <td className="px-4 py-4 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrency(totals.net)}</td>
                  <td className="px-4 py-4 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrency(totals.vat)}</td>
                  <td className="px-4 py-4 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrency(totals.total)}</td>
                  <td className="px-4 py-4 border-t-2 border-orange-200"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
