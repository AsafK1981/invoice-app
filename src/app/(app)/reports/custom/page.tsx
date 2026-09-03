"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, SlidersHorizontal, Download, Printer } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useClients } from "@/lib/client-store";
import { formatCurrency } from "@/lib/format";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  type DocumentStatus,
  type DocumentType,
} from "@/lib/types";
import { filterDocuments, summarize, type ReportFilters } from "@/lib/report-filters";
import { useBusiness } from "@/lib/business-store";
import { exportCustomReport } from "@/lib/csv-export";

const ALL_TYPES: DocumentType[] = [
  "tax_invoice",
  "tax_invoice_receipt",
  "receipt",
  "credit_note",
  "proforma",
  "quote",
];

const STATUS_OPTIONS: ("all" | DocumentStatus)[] = ["all", "paid", "sent", "draft", "cancelled"];

const MONTH_NAMES = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

type Preset = string; // "all" | "2026" | "2026-Q1" | "2026-B1" (bimonth, Jan-Feb) | "2026-01"

interface PresetBounds {
  from: string | null;
  to: string | null;
}

function lastDayOfMonth(year: number, month1: number): string {
  const d = new Date(year, month1, 0); // day 0 of next month = last day of this month
  return `${year}-${String(month1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Turn a preset value into inclusive from/to ISO bounds (null = open). */
function presetBounds(preset: Preset): PresetBounds {
  if (preset === "all") return { from: null, to: null };
  if (preset.includes("-Q")) {
    const [y, q] = preset.split("-Q");
    const startMonth = (Number(q) - 1) * 3 + 1;
    return {
      from: `${y}-${String(startMonth).padStart(2, "0")}-01`,
      to: lastDayOfMonth(Number(y), startMonth + 2),
    };
  }
  if (preset.includes("-B")) {
    const [y, b] = preset.split("-B");
    const startMonth = (Number(b) - 1) * 2 + 1;
    return {
      from: `${y}-${String(startMonth).padStart(2, "0")}-01`,
      to: lastDayOfMonth(Number(y), startMonth + 1),
    };
  }
  if (/^\d{4}-\d{2}$/.test(preset)) {
    const [y, m] = preset.split("-");
    return { from: `${preset}-01`, to: lastDayOfMonth(Number(y), Number(m)) };
  }
  // year
  return { from: `${preset}-01-01`, to: `${preset}-12-31` };
}

function buildPresetOptions(years: number[]): { value: Preset; label: string }[] {
  const opts: { value: Preset; label: string }[] = [{ value: "all", label: "כל הזמנים" }];
  for (const y of years) {
    opts.push({ value: String(y), label: `שנת ${y}` });
    opts.push({ value: `${y}-Q1`, label: `${y} · רבעון 1 (ינו-מרץ)` });
    opts.push({ value: `${y}-Q2`, label: `${y} · רבעון 2 (אפר-יונ)` });
    opts.push({ value: `${y}-Q3`, label: `${y} · רבעון 3 (יול-ספט)` });
    opts.push({ value: `${y}-Q4`, label: `${y} · רבעון 4 (אוק-דצמ)` });
    // The six VAT bimonthly windows, the period most returns are filed for.
    for (let b = 1; b <= 6; b++) {
      const from = (b - 1) * 2;
      opts.push({ value: `${y}-B${b}`, label: `${y} · חודשיים ${b} (${MONTH_NAMES[from]}-${MONTH_NAMES[from + 1]})` });
    }
    for (let m = 1; m <= 12; m++) {
      opts.push({ value: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTH_NAMES[m - 1]} ${y}` });
    }
  }
  return opts;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function CustomReportPage() {
  const { documents, ready } = useDocuments();
  const { items: clients } = useClients();

  const { business } = useBusiness();
  const [rangeMode, setRangeMode] = useState<"preset" | "custom">("preset");
  const [preset, setPreset] = useState<Preset>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [allocation, setAllocation] = useState<ReportFilters["allocation"]>("all");
  const [clientId, setClientId] = useState<string>("all");
  const [types, setTypes] = useState<DocumentType[]>(ALL_TYPES);
  const [status, setStatus] = useState<"all" | DocumentStatus>("all");

  const taxIdByClient = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of clients) if (c.taxId) map[c.id] = c.taxId;
    return map;
  }, [clients]);

  const yearsWithData = useMemo(() => {
    const set = new Set<number>();
    documents.forEach((d) => {
      const y = parseInt(d.date.slice(0, 4), 10);
      if (!Number.isNaN(y)) set.add(y);
    });
    if (set.size === 0) set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => b - a);
  }, [documents]);

  const presetOptions = useMemo(() => buildPresetOptions(yearsWithData), [yearsWithData]);

  const filters = useMemo<ReportFilters>(() => {
    const bounds =
      rangeMode === "custom"
        ? { from: fromDate || null, to: toDate || null }
        : presetBounds(preset);
    return {
      from: bounds.from,
      to: bounds.to,
      allocation,
      clientId,
      types,
      status,
    };
  }, [rangeMode, fromDate, toDate, preset, allocation, clientId, types, status]);

  const rows = useMemo(() => {
    return filterDocuments(documents, filters)
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.number - b.number));
  }, [documents, filters]);

  const totals = useMemo(() => summarize(rows), [rows]);

  // Human-readable description of the period the report covers. The filter
  // controls are `no-print`, so without this line a printed / PDF'd report
  // carried no trace of which dates it was for.
  const periodLabel = useMemo(() => {
    if (rangeMode === "preset") {
      return presetOptions.find((o) => o.value === preset)?.label ?? "כל הזמנים";
    }
    if (fromDate && toDate) return `מ-${fmtDate(fromDate)} עד ${fmtDate(toDate)}`;
    if (fromDate) return `מ-${fmtDate(fromDate)}`;
    if (toDate) return `עד ${fmtDate(toDate)}`;
    return "כל הזמנים";
  }, [rangeMode, preset, presetOptions, fromDate, toDate]);

  // The other narrowing filters, same reason: a printout that says "3 documents"
  // should also say "for client X, paid only".
  const activeFilterLabels = useMemo(() => {
    const out: string[] = [];
    if (clientId !== "all") {
      const name = clients.find((c) => c.id === clientId)?.name;
      if (name) out.push(`לקוח: ${name}`);
    }
    if (allocation === "with") out.push("עם מספר הקצאה");
    if (allocation === "without") out.push("ללא מספר הקצאה");
    if (status !== "all") out.push(`סטטוס: ${DOCUMENT_STATUS_LABELS[status]}`);
    if (types.length > 0 && types.length < ALL_TYPES.length) {
      out.push(`סוגים: ${types.map((t) => DOCUMENT_TYPE_LABELS[t]).join(", ")}`);
    }
    return out;
  }, [clientId, clients, allocation, status, types]);

  function toggleType(t: DocumentType) {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  // Styled .xlsx with a total row (csv-export.ts); the subtitle carries the
  // period and the active filters, same as the printed report's header.
  function exportCsv() {
    void exportCustomReport({
      rows,
      taxIdFor: (d) => d.clientTaxId || taxIdByClient[d.clientId] || "",
      subtitle: [periodLabel, ...activeFilterLabels].join(" · "),
      businessName: business.name,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end no-print">
        <Link href="/reports" className="pgbtn pgbtn-quiet">
          <ArrowRight aria-hidden="true" />
          חזרה לדוחות
        </Link>
      </div>

      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
              <SlidersHorizontal className="w-5 h-5 text-white" />
            </span>
            דוח מותאם
          </h1>
          <p className="text-sm text-stone-600 mt-2 mr-14">
            שלב מסננים חופשי (תאריך, הקצאה, לקוח, סוג מסמך וסטטוס) כדי להפיק כל חתך שתרצה.
          </p>
        </div>
        <div className="pgactions no-print">
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="pgbtn pgbtn-quiet"
          >
            <Download aria-hidden="true" />
            ייצוא Excel
          </button>
          <button
            onClick={() => window.print()}
            disabled={rows.length === 0}
            className="pgbtn pgbtn-quiet"
          >
            <Printer aria-hidden="true" />
            הדפסה / PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card-soft p-4 space-y-4 no-print">
        {/* Date range */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1 bg-stone-100 rounded-xl p-1 w-max max-w-full">
            <button
              onClick={() => setRangeMode("preset")}
              className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                rangeMode === "preset" ? "bg-white text-orange-700 shadow-sm" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              תקופה
            </button>
            <button
              onClick={() => setRangeMode("custom")}
              className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                rangeMode === "custom" ? "bg-white text-orange-700 shadow-sm" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              טווח מותאם
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {rangeMode === "preset" ? (
              <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
                תקופה:
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                  className="input-warm py-2 px-3 text-sm w-auto"
                >
                  {presetOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
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
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-3 border-t border-stone-100">
          {/* Allocation */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-stone-700">הקצאה:</span>
            <div className="flex items-center gap-1 bg-stone-100 rounded-xl p-1">
              {([
                { value: "all", label: "הכל" },
                { value: "with", label: "עם הקצאה" },
                { value: "without", label: "ללא הקצאה" },
              ] as const).map((o) => (
                <button
                  key={o.value}
                  onClick={() => setAllocation(o.value)}
                  className={`inline-flex items-center min-h-[40px] sm:min-h-0 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    allocation === o.value ? "bg-white text-orange-700 shadow-sm" : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Client */}
          <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
            לקוח:
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="input-warm py-2 px-3 text-sm w-auto max-w-[16rem]"
            >
              <option value="all">כל הלקוחות</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Status */}
          <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
            סטטוס:
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "all" | DocumentStatus)}
              className="input-warm py-2 px-3 text-sm w-auto"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "כל הסטטוסים" : DOCUMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Document types */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-stone-100">
          <span className="text-sm font-medium text-stone-700 ml-1">סוגי מסמכים:</span>
          {ALL_TYPES.map((t) => {
            const active = types.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={`inline-flex items-center min-h-[40px] sm:min-h-0 px-3 py-1.5 rounded-full text-sm font-semibold border-2 transition-colors ${
                  active
                    ? "bg-orange-50 border-orange-300 text-orange-800"
                    : "bg-white border-stone-200 text-stone-500 hover:border-stone-300"
                }`}
              >
                {DOCUMENT_TYPE_LABELS[t]}
              </button>
            );
          })}
          <div className="flex items-center gap-1 mr-2">
            <button
              onClick={() => setTypes(ALL_TYPES)}
              className="inline-flex items-center min-h-[40px] sm:min-h-0 px-2 text-xs font-semibold text-orange-600 hover:text-orange-700"
            >
              הכל
            </button>
            <span className="text-stone-300">·</span>
            <button
              onClick={() => setTypes([])}
              className="inline-flex items-center min-h-[40px] sm:min-h-0 px-2 text-xs font-semibold text-stone-500 hover:text-stone-700"
            >
              נקה
            </button>
          </div>
        </div>
      </div>

      {/* Report */}
      <div className="card-soft overflow-hidden">
        <div className="px-5 py-3.5 border-b border-stone-100 flex items-baseline justify-between flex-wrap gap-x-4 gap-y-1">
          <div>
            <h2 className="font-bold text-stone-900 text-lg">תוצאות</h2>
            <p className="text-sm text-stone-600 mt-0.5">
              <span className="font-semibold text-stone-800">תקופה: {periodLabel}</span>
              {activeFilterLabels.map((label) => (
                <span key={label}>
                  <span className="text-stone-300 mx-1.5">·</span>
                  {label}
                </span>
              ))}
            </p>
          </div>
          <span className="flex flex-wrap items-baseline gap-y-0.5 text-sm text-stone-600">
            <span className="whitespace-nowrap">{totals.count} מסמכים</span>
            <span className="whitespace-nowrap">
              <span className="text-stone-300 mx-1.5">·</span>
              סה״כ כולל מע״מ{" "}
              <span className="font-bold text-orange-700">{formatCurrency(totals.total)}</span>
            </span>
            <span className="whitespace-nowrap">
              <span className="text-stone-300 mx-1.5">·</span>
              לא כולל מע״מ{" "}
              <span className="font-semibold text-stone-800">{formatCurrency(totals.net)}</span>
            </span>
            <span className="whitespace-nowrap">
              <span className="text-stone-300 mx-1.5">·</span>
              מע״מ{" "}
              <span className="font-semibold text-stone-800">{formatCurrency(totals.vat)}</span>
            </span>
          </span>
        </div>
        {ready && rows.length === 0 ? (
          <div className="p-12 text-center text-stone-500">
            אין מסמכים התואמים למסננים שנבחרו.
          </div>
        ) : (
          <div className="p-5 overflow-x-auto">
            <table className="gk-rtable w-full text-sm border-separate border-spacing-0 rounded-xl overflow-hidden shadow-sm">
              <thead>
                <tr className="bg-gradient-to-l from-orange-500 to-rose-500 text-white">
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">תאריך</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">מספר</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">סוג</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">לקוח</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">ת.ז / ח.פ</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">סכום לא כולל מע״מ</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">מע״מ</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">סכום כולל מע״מ</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap border-l border-white/20">מספר הקצאה</th>
                  <th className="px-4 py-3.5 text-xs font-extrabold tracking-wide text-center whitespace-nowrap">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d, i) => {
                  const taxId = d.clientTaxId || taxIdByClient[d.clientId] || "";
                  return (
                    <tr key={d.id} className={`${i % 2 ? "bg-orange-50/40" : "bg-white"} hover:bg-amber-50/40 transition-colors`}>
                      <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{fmtDate(d.date)}</td>
                      <td className="px-4 py-3.5 text-center align-middle whitespace-nowrap border-b border-l border-stone-200">
                        <Link href={`/documents/${d.id}`} className="text-orange-700 hover:underline font-bold">
                          #{d.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 text-center align-middle whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{DOCUMENT_TYPE_LABELS[d.type]}</td>
                      <td className="px-4 py-3.5 text-center align-middle text-stone-700 border-b border-l border-stone-200">{d.clientName}</td>
                      <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{taxId || <span className="text-stone-300">-</span>}</td>
                      <td className="px-4 py-3.5 text-center align-middle tabular-nums text-stone-700 whitespace-nowrap border-b border-l border-stone-200">{formatCurrency(d.subtotalIls ?? d.subtotal)}</td>
                      <td className="px-4 py-3.5 text-center align-middle tabular-nums text-stone-700 whitespace-nowrap border-b border-l border-stone-200">{formatCurrency(d.vatIls ?? d.vat)}</td>
                      <td className="px-4 py-3.5 text-center align-middle tabular-nums font-extrabold text-stone-900 whitespace-nowrap border-b border-l border-stone-200">{formatCurrency(d.totalIls ?? d.total)}</td>
                      <td className="px-4 py-3.5 text-center align-middle tabular-nums whitespace-nowrap text-stone-700 border-b border-l border-stone-200">{d.allocationNumber || <span className="text-stone-300">-</span>}</td>
                      <td className="px-4 py-3.5 text-center align-middle whitespace-nowrap text-stone-700 border-b border-stone-200">{DOCUMENT_STATUS_LABELS[d.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-orange-50 text-stone-900 font-black">
                  <td className="px-4 py-4 text-center border-t-2 border-l border-orange-200" colSpan={5}>
                    סה״כ · {totals.count} מסמכים
                  </td>
                  <td className="px-4 py-4 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrency(totals.net)}</td>
                  <td className="px-4 py-4 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrency(totals.vat)}</td>
                  <td className="px-4 py-4 text-center tabular-nums whitespace-nowrap border-t-2 border-l border-orange-200">{formatCurrency(totals.total)}</td>
                  <td className="px-4 py-4 border-t-2 border-l border-orange-200"></td>
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
