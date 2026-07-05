"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  X,
  Trash2,
  ReceiptText,
  FileText as FileTextIcon,
  FileCheck,
  FileMinus,
  FileSpreadsheet,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckCircle2,
  Circle,
  Download,
  Mail,
  FilePlus2,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { deleteDocument, updateDocumentStatus } from "@/lib/document-store";
import { exportDocuments } from "@/lib/csv-export";
import { matchDocument } from "@/lib/document-search";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/error-message";
import { Tooltip } from "@/components/ui/tooltip";
import { useBusiness } from "@/lib/business-store";
import { canIssueTaxInvoices } from "@/lib/vat";
import {
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_STATUS_LABELS,
  type InvoiceDocument,
  type DocumentType,
  type DocumentStatus,
} from "@/lib/types";

type TypeFilter = "all" | DocumentType;
type StatusFilter = "all" | DocumentStatus;
type SortKey = "date" | "number" | "total";
type SortDir = "asc" | "desc";

interface Props {
  documents: InvoiceDocument[];
  limit?: number;
  showExport?: boolean;
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

export function DocumentsTable({ documents, limit, showExport = false }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Read initial filter values from URL search params so dashboard cards
  // (and other deep-links like /documents?type=quote&status=sent) can
  // pre-filter the table. Validates against known values to ignore noise.
  type EmailFilter = "all" | "emailed" | "not_emailed";
  const initialType: TypeFilter = (() => {
    const v = searchParams.get("type");
    if (v === "receipt" || v === "quote" || v === "tax_invoice" || v === "tax_invoice_receipt" || v === "credit_note") return v;
    return "all";
  })();
  const initialStatus: StatusFilter = (() => {
    const v = searchParams.get("status");
    if (v === "draft" || v === "sent" || v === "paid" || v === "cancelled") return v;
    return "all";
  })();
  const initialMonth = (() => {
    const v = searchParams.get("month");
    return v && /^\d{4}-\d{2}$/.test(v) ? v : "all";
  })();
  const initialEmail: EmailFilter = (() => {
    const v = searchParams.get("email");
    if (v === "emailed" || v === "not_emailed") return v;
    return "all";
  })();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(initialType);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
  const [monthFilter, setMonthFilter] = useState<string>(initialMonth);
  const [emailFilter, setEmailFilter] = useState<EmailFilter>(initialEmail);
  const [search, setSearch] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const availableMonths = useMemo(() => {
    const set = new Set(documents.map((d) => d.date.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [documents]);

  const filtered = useMemo(() => {
    let result = documents;
    if (typeFilter !== "all") result = result.filter((d) => d.type === typeFilter);
    if (statusFilter !== "all") result = result.filter((d) => d.status === statusFilter);
    if (monthFilter !== "all") result = result.filter((d) => d.date.startsWith(monthFilter));
    if (emailFilter === "emailed") result = result.filter((d) => Boolean(d.emailedAt));
    else if (emailFilter === "not_emailed")
      result = result.filter((d) => !d.emailedAt && d.status !== "draft" && d.status !== "cancelled");
    if (search.trim()) result = result.filter((d) => matchDocument(d, search));
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.date.localeCompare(b.date);
      else if (sortKey === "number") cmp = a.number - b.number;
      else cmp = a.total - b.total;
      return sortDir === "asc" ? cmp : -cmp;
    });
    if (limit) result = result.slice(0, limit);
    return result;
  }, [documents, typeFilter, statusFilter, monthFilter, emailFilter, search, limit, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function clearFilters() {
    setTypeFilter("all");
    setStatusFilter("all");
    setMonthFilter("all");
    setEmailFilter("all");
    setSearch("");
  }

  const filtersActive =
    typeFilter !== "all" ||
    statusFilter !== "all" ||
    monthFilter !== "all" ||
    emailFilter !== "all" ||
    search.trim() !== "";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-3 sm:px-6 py-4 bg-orange-50 border-b border-orange-100 sticky top-0 z-10">
        <div className="relative">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש: מספר, לקוח, סכום, תיאור פריט..."
            className="input-warm pr-10 pl-9 w-full sm:w-72"
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
          label="סטטוס"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          options={[
            { value: "all", label: "כל הסטטוסים" },
            { value: "draft", label: DOCUMENT_STATUS_LABELS.draft },
            { value: "sent", label: DOCUMENT_STATUS_LABELS.sent },
            { value: "paid", label: DOCUMENT_STATUS_LABELS.paid },
            { value: "cancelled", label: DOCUMENT_STATUS_LABELS.cancelled },
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
        <FilterSelect
          label="מייל"
          value={emailFilter}
          onChange={(v) => setEmailFilter(v as EmailFilter)}
          options={[
            { value: "all", label: "הכל" },
            { value: "emailed", label: "נשלח במייל" },
            { value: "not_emailed", label: "טרם נשלח" },
          ]}
        />
        {filtersActive && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center justify-center min-h-[36px] px-3 text-sm font-medium text-orange-700 hover:bg-orange-100 rounded-xl"
          >
            נקה הכל
          </button>
        )}
        <div className="text-sm font-medium text-stone-700 mr-auto flex items-center gap-3">
          {showExport && filtered.length > 0 && (
            <button
              onClick={() =>
                exportDocuments(filtered, filtersActive ? "filtered" : undefined)
              }
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-sm font-medium text-stone-700 bg-white border border-orange-200 hover:bg-orange-50"
              title="ייצוא לקובץ CSV"
            >
              <Download className="w-3.5 h-3.5" />
              ייצוא ({filtered.length})
            </button>
          )}
          <span>{filtered.length} מסמכים</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="text-xs text-stone-700 bg-white">
            <tr>
              <SortableHeader
                label="מספר"
                sortKey="number"
                currentKey={sortKey}
                dir={sortDir}
                onClick={() => toggleSort("number")}
                align="right"
              />
              <th className="text-right px-3 sm:px-6 py-3 font-semibold">סוג</th>
              <th className="text-right px-3 sm:px-6 py-3 font-semibold">לקוח</th>
              <th className="text-right px-6 py-3 font-semibold hidden lg:table-cell">נושא</th>
              <th className="text-right px-3 sm:px-6 py-3 font-semibold hidden md:table-cell">
                <SortableHeader
                  label="תאריך"
                  sortKey="date"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={() => toggleSort("date")}
                  align="right"
                  inline
                />
              </th>
              <th className="text-right px-3 sm:px-6 py-3 font-semibold">סטטוס</th>
              <SortableHeader
                label="סכום"
                sortKey="total"
                currentKey={sortKey}
                dir={sortDir}
                onClick={() => toggleSort("total")}
                align="left"
              />
              <th className="px-2 sm:px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-16 text-center">
                  <div className="text-4xl mb-2">🔍</div>
                  <div className="text-sm text-stone-500">
                    {filtersActive ? "אין מסמכים העונים לסינון הנבחר" : "אין מסמכים עדיין"}
                  </div>
                  {filtersActive && (
                    <button
                      onClick={clearFilters}
                      className="text-sm text-orange-600 hover:underline mt-2"
                    >
                      נקה את כל הסינונים
                    </button>
                  )}
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
                    <td className="px-3 sm:px-6 py-3 text-sm font-bold text-stone-900 whitespace-nowrap">
                      #{d.number}
                      <div className="text-[10px] font-normal text-stone-500 md:hidden mt-0.5">
                        {formatDate(d.date)}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-3 text-sm">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium ${theme.badge}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{DOCUMENT_TYPE_LABELS[d.type]}</span>
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-3 text-sm font-medium text-stone-900">{d.clientName}</td>
                    <td className="px-6 py-3 text-sm text-stone-700 hidden lg:table-cell">{d.subject || "—"}</td>
                    <td className="px-6 py-3 text-sm text-stone-600 hidden md:table-cell">{formatDate(d.date)}</td>
                    <td className="px-3 sm:px-6 py-3 text-sm">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_THEMES[d.status]}`}
                          >
                            {DOCUMENT_STATUS_LABELS[d.status]}
                          </span>
                          {/* Only show the green Mail icon when we positively
                              know the doc was emailed (emailed_at is set).
                              Absence is intentionally silent rather than a
                              MailX — many docs predate the emailed_at column,
                              so a "not sent" badge would be misleading on
                              clearly-already-delivered legacy docs. */}
                          {d.emailedAt && (
                            <span
                              title={`נשלח במייל ב-${new Date(d.emailedAt).toLocaleString("he-IL")}`}
                              className="inline-flex"
                            >
                              <Mail className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-label="נשלח במייל" />
                            </span>
                          )}
                        </div>
                        {d.status === "sent" &&
                          d.type !== "receipt" &&
                          d.type !== "tax_invoice_receipt" &&
                          (() => {
                            const days = Math.floor(
                              (Date.now() - new Date(d.date).getTime()) / (1000 * 60 * 60 * 24)
                            );
                            if (days >= 7) {
                              return (
                                <span className="text-xs text-amber-700 font-medium">
                                  {days} ימים ללא תשלום
                                </span>
                              );
                            }
                            return null;
                          })()}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-3 text-sm font-bold text-left text-stone-900 whitespace-nowrap">
                      {formatCurrency(d.total)}
                    </td>
                    <td className="px-2 sm:px-2 py-3 text-center">
                      <RowActions doc={d} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowActions({ doc }: { doc: InvoiceDocument }) {
  const router = useRouter();
  const { business } = useBusiness();
  const isReceipt = doc.type === "receipt" || doc.type === "tax_invoice_receipt";
  const isCreditNote = doc.type === "credit_note";
  const canMarkPaid = !isReceipt && !isCreditNote && doc.status !== "draft" && doc.status !== "cancelled";
  const isPaid = doc.status === "paid";
  // Quote that's been issued (sent or paid) and isn't already linked to a
  // receipt can be one-click converted. Mirrors handleConvert() on the doc
  // detail page so the table button behaves identically.
  const canConvertToReceipt =
    doc.type === "quote" &&
    doc.status !== "draft" &&
    doc.status !== "cancelled" &&
    !doc.convertedToId;
  const confirm = useConfirm();
  const showToast = useToast();

  // Mirrors the delete logic on the doc detail page: drafts delete cleanly;
  // quotes (non-draft) get a soft warning + force-delete; receipts and tax
  // docs get a strong "this should be a credit note" warning + force-delete
  // escape hatch for test data. Numbering counters are not rolled back.
  const isLegallyProtected =
    doc.type === "receipt" ||
    doc.type === "tax_invoice" ||
    doc.type === "tax_invoice_receipt" ||
    doc.type === "credit_note";

  async function handleRowDelete(e: React.MouseEvent) {
    e.stopPropagation();
    let message: string;
    let confirmLabel: string;
    if (doc.status === "draft") {
      message = "פעולה זו לא ניתנת לביטול.";
      confirmLabel = "מחק";
    } else if (!isLegallyProtected) {
      message =
        "המסמך כבר הופק. המחיקה היא סופית והמספור לא יוחזר — תהיה רצף חסר במספרי המסמכים.";
      confirmLabel = "מחק בכל זאת";
    } else {
      message =
        "מסמכי מס וקבלות הם רשומות חשבונאיות — הדרך הנכונה לבטל היא הפקת חשבונית זיכוי. אם זה היה ניסיון בלבד שלא נשלח ללקוח אמיתי, אפשר למחוק בכפייה.";
      confirmLabel = "מחק בכפייה (היה ניסיון)";
    }
    const ok = await confirm({
      title: `למחוק את ${DOCUMENT_TYPE_LABELS[doc.type]} #${doc.number}?`,
      message,
      tone: "danger",
      confirmLabel,
    });
    if (ok) {
      try {
        await deleteDocument(doc.id);
      } catch (err) {
        showToast(friendlyError(err, "שגיאה במחיקה"));
      }
    }
  }

  return (
    <div className="flex items-center justify-center gap-1">
      {canConvertToReceipt && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            const targetType = canIssueTaxInvoices(business) ? "tax-invoice-receipt" : "receipt";
            router.push(`/documents/new/${targetType}?from=${doc.id}&convert=1`);
          }}
          className="p-1.5 rounded-lg text-stone-300 hover:text-sky-600 hover:bg-sky-50 transition-colors cursor-pointer"
          aria-label="הפק קבלה לחשבון העסקה הזה"
        >
          <Tooltip label="הפק קבלה — כסף התקבל" side="left">
            <FilePlus2 className="w-4 h-4" />
          </Tooltip>
        </button>
      )}
      {canMarkPaid && (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            try {
              await updateDocumentStatus(doc.id, isPaid ? "sent" : "paid");
            } catch (err) {
              showToast(friendlyError(err, "שגיאה בעדכון"));
            }
          }}
          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
            isPaid
              ? "text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50"
              : "text-stone-300 hover:text-emerald-500 hover:bg-emerald-50"
          }`}
          aria-label={isPaid ? "סמן כלא שולם" : "סמן כשולם"}
        >
          <Tooltip label={isPaid ? "סמן כלא שולם" : "סמן כשולם"} side="left">
            {isPaid ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
          </Tooltip>
        </button>
      )}
      <button
        onClick={handleRowDelete}
        className="text-stone-300 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
        aria-label="מחק מסמך"
      >
        <Tooltip label="מחק מסמך" side="left">
          <Trash2 className="w-4 h-4" />
        </Tooltip>
      </button>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  currentKey,
  dir,
  onClick,
  align,
  inline = false,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onClick: () => void;
  align: "right" | "left";
  inline?: boolean;
}) {
  const active = sortKey === currentKey;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  const button = (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 hover:text-orange-700 transition-colors ${
        active ? "text-orange-700" : "text-stone-700"
      }`}
    >
      {label}
      <Icon className="w-3 h-3" />
    </button>
  );
  if (inline) return button;
  return (
    <th className={`text-${align} px-3 sm:px-6 py-3 font-semibold`}>
      {button}
    </th>
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
