"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Trash2, ReceiptText, FileText as FileTextIcon, FileCheck, FileMinus, FileSpreadsheet } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { deleteDocument } from "@/lib/document-store";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_STATUS_LABELS,
  type InvoiceDocument,
  type DocumentType,
} from "@/lib/types";

type TypeFilter = "all" | DocumentType;

interface Props {
  documents: InvoiceDocument[];
  limit?: number;
}

const TYPE_ICONS: Record<DocumentType, typeof ReceiptText> = {
  receipt: ReceiptText,
  quote: FileTextIcon,
  tax_invoice: FileCheck,
  tax_invoice_receipt: FileSpreadsheet,
  credit_note: FileMinus,
};

const TYPE_THEMES: Record<DocumentType, { row: string; badge: string; icon: string }> = {
  receipt: {
    row: "hover:bg-emerald-50/60",
    badge: "bg-emerald-100 text-emerald-800",
    icon: "text-emerald-500 bg-emerald-100",
  },
  quote: {
    row: "hover:bg-amber-50/60",
    badge: "bg-amber-100 text-amber-800",
    icon: "text-amber-600 bg-amber-100",
  },
  tax_invoice: {
    row: "hover:bg-sky-50/60",
    badge: "bg-sky-100 text-sky-800",
    icon: "text-sky-500 bg-sky-100",
  },
  tax_invoice_receipt: {
    row: "hover:bg-violet-50/60",
    badge: "bg-violet-100 text-violet-800",
    icon: "text-violet-500 bg-violet-100",
  },
  credit_note: {
    row: "hover:bg-rose-50/60",
    badge: "bg-rose-100 text-rose-800",
    icon: "text-rose-500 bg-rose-100",
  },
};

const STATUS_THEMES: Record<string, string> = {
  draft: "bg-stone-100 text-stone-700",
  sent: "bg-sky-100 text-sky-700",
  paid: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
};

export function DocumentsTable({ documents, limit }: Props) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  const availableMonths = useMemo(() => {
    const set = new Set(documents.map((d) => d.date.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [documents]);

  const filtered = useMemo(() => {
    let result = documents;
    if (typeFilter !== "all") result = result.filter((d) => d.type === typeFilter);
    if (monthFilter !== "all") result = result.filter((d) => d.date.startsWith(monthFilter));
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (d) =>
          String(d.number).includes(q) ||
          d.clientName.toLowerCase().includes(q) ||
          (d.subject?.toLowerCase().includes(q) ?? false)
      );
    }
    result = [...result].sort((a, b) => b.date.localeCompare(a.date));
    if (limit) result = result.slice(0, limit);
    return result;
  }, [documents, typeFilter, monthFilter, search, limit]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-6 py-4 bg-orange-50/50 border-b border-orange-100">
        <div className="relative">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי מספר / לקוח / נושא..."
            className="input-warm pr-10 pl-9 w-72"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
              aria-label="נקה חיפוש"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <FilterSelect
          label="סוג"
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as TypeFilter)}
          options={[
            { value: "all", label: "כל הסוגים" },
            { value: "receipt", label: DOCUMENT_TYPE_LABELS.receipt },
            { value: "quote", label: DOCUMENT_TYPE_LABELS.quote },
            { value: "tax_invoice", label: DOCUMENT_TYPE_LABELS.tax_invoice },
            { value: "tax_invoice_receipt", label: DOCUMENT_TYPE_LABELS.tax_invoice_receipt },
            { value: "credit_note", label: DOCUMENT_TYPE_LABELS.credit_note },
          ]}
        />
        <FilterSelect
          label="חודש"
          value={monthFilter}
          onChange={setMonthFilter}
          options={[
            { value: "all", label: "כל החודשים" },
            ...availableMonths.map((m) => ({ value: m, label: formatMonthLabel(m) })),
          ]}
        />
        <div className="text-sm font-medium text-stone-700 mr-auto">
          {filtered.length} מסמכים
        </div>
      </div>

      <table className="w-full">
        <thead className="text-xs text-stone-700 bg-white">
          <tr>
            <th className="text-right px-6 py-3 font-semibold">מספר</th>
            <th className="text-right px-6 py-3 font-semibold">סוג</th>
            <th className="text-right px-6 py-3 font-semibold">לקוח</th>
            <th className="text-right px-6 py-3 font-semibold">נושא</th>
            <th className="text-right px-6 py-3 font-semibold">תאריך</th>
            <th className="text-right px-6 py-3 font-semibold">סטטוס</th>
            <th className="text-left px-6 py-3 font-semibold">סכום</th>
            <th className="px-4 py-3 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-6 py-16 text-center">
                <div className="text-4xl mb-2">📭</div>
                <div className="text-sm text-stone-500">אין מסמכים העונים לסינון הנבחר</div>
              </td>
            </tr>
          ) : (
            filtered.map((d) => {
              const theme = TYPE_THEMES[d.type];
              const Icon = TYPE_ICONS[d.type];
              return (
                <tr
                  key={d.id}
                  onClick={() => router.push(`/documents/${d.id}`)}
                  className={`border-t border-orange-50 transition-colors cursor-pointer ${theme.row}`}
                >
                  <td className="px-6 py-3 text-sm font-bold text-stone-900">#{d.number}</td>
                  <td className="px-6 py-3 text-sm">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${theme.badge}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {DOCUMENT_TYPE_LABELS[d.type]}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-stone-900">{d.clientName}</td>
                  <td className="px-6 py-3 text-sm text-stone-700">{d.subject || "—"}</td>
                  <td className="px-6 py-3 text-sm text-stone-600">{formatDate(d.date)}</td>
                  <td className="px-6 py-3 text-sm">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_THEMES[d.status]}`}
                    >
                      {DOCUMENT_STATUS_LABELS[d.status]}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm font-bold text-left text-stone-900">
                    {formatCurrency(d.total)}
                  </td>
                  <td className="px-2 py-3 text-center">
                    {d.status === "draft" ? (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (confirm(`למחוק את מסמך #${d.number}?`)) await deleteDocument(d.id);
                        }}
                        className="text-stone-300 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                        title="מחק"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <span
                        className="text-stone-200 p-1.5 inline-block cursor-not-allowed"
                        title="לא ניתן למחוק מסמך שנשלח או שולם"
                      >
                        <Trash2 className="w-4 h-4" />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-stone-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-warm py-1.5 px-3 text-sm w-auto"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const names = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  return `${names[parseInt(m, 10) - 1]} ${year}`;
}
