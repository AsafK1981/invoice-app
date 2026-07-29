"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  X,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckCircle2,
  Circle,
  Download,
  Mail,
  MailCheck,
  FilePlus2,
  Pencil,
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

/**
 * How many days a `sent` document may sit unpaid before the row calls it out
 * next to the status pill. Receipts are paid by definition and are excluded.
 */
const OVERDUE_DAYS = 7;

export function DocumentsTable({ documents, limit, showExport = false }: Props) {
  const searchParams = useSearchParams();
  const { business } = useBusiness();
  // Read initial filter values from URL search params so dashboard cards
  // (and other deep-links like /documents?type=quote&status=sent) can
  // pre-filter the list. Validates against known values to ignore noise.
  type EmailFilter = "all" | "emailed" | "not_emailed";
  const initialType: TypeFilter = (() => {
    const v = searchParams.get("type");
    if (v === "receipt" || v === "quote" || v === "proforma" || v === "tax_invoice" || v === "tax_invoice_receipt" || v === "credit_note") return v;
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

  /**
   * מספר הקצאה is a column only a business that can actually receive one
   * should have to look at. An עוסק פטור may not issue a tax invoice at all,
   * so the number can never exist for him and a column of hyphens is pure
   * noise (and ~80px stolen from the subject). Belt and braces: even for a
   * business that COULD have one, the column only appears once a document in
   * the current filtered list really carries a number. The cells are not
   * rendered and the grid drops the track, so nothing is left behind.
   */
  const showAlloc =
    business.businessType !== "exempt" &&
    filtered.some((d) => Boolean(d.allocationNumber?.trim()));

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
            { value: "proforma", label: DOCUMENT_TYPE_LABELS.proforma },
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
              className="inline-flex items-center gap-1.5 min-h-[36px] px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-l from-emerald-500 to-teal-500 shadow-sm shadow-emerald-200/70 hover:shadow-md hover:shadow-emerald-300/70 hover:brightness-105 transition-all"
              title="ייצוא לקובץ CSV / Excel"
            >
              <Download className="w-4 h-4" />
              ייצוא ל-Excel ({filtered.length})
            </button>
          )}
          <span>{filtered.length} מסמכים</span>
        </div>
      </div>

      <div className="dc-shell">
        {filtered.length === 0 ? (
          <div className="dc-empty">
            <div className="text-4xl mb-2">{filtersActive ? "🔍" : "📄"}</div>
            <div className="text-sm text-stone-500">
              {filtersActive ? "אין מסמכים העונים לסינון הנבחר" : "אין מסמכים עדיין"}
            </div>
            {filtersActive ? (
              <button
                onClick={clearFilters}
                className="text-sm text-orange-600 hover:underline mt-2"
              >
                נקה את כל הסינונים
              </button>
            ) : (
              <Link
                href="/documents/new"
                className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all mt-4"
              >
                <FilePlus2 className="w-4 h-4" />
                צור מסמך ראשון
              </Link>
            )}
          </div>
        ) : (
          <div className="dc-table" data-alloc={showAlloc ? "1" : undefined}>
            {/* One header band for the whole list. It is a subgrid item like
                every card, so each label sits exactly over the column it
                names, and the three numeric labels double as the sort control
                (the old "מיון לפי" chip strip is gone). */}
            <div className="dc-head">
              <span className="dc-cell" data-col="type">
                <span className="dc-hlabel">סוג</span>
              </span>
              <span className="dc-cell" data-col="client">
                <span className="dc-hlabel">לקוח</span>
              </span>
              <span className="dc-cell" data-col="subj">
                <span className="dc-hlabel">נושא</span>
              </span>
              <span className="dc-cell" data-col="date">
                <SortLabel
                  label="תאריך"
                  sortKey="date"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={() => toggleSort("date")}
                />
              </span>
              <span className="dc-cell" data-col="number">
                <SortLabel
                  label="מספר"
                  sortKey="number"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={() => toggleSort("number")}
                />
              </span>
              {showAlloc && (
                <span className="dc-cell" data-col="alloc">
                  <span className="dc-hlabel">הקצאה</span>
                </span>
              )}
              <span className="dc-cell" data-col="mail">
                <span className="dc-hlabel">מייל</span>
              </span>
              <span className="dc-cell" data-col="status">
                <span className="dc-hlabel">סטטוס</span>
              </span>
              <span className="dc-cell" data-col="amount">
                <SortLabel
                  label="סכום"
                  sortKey="total"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={() => toggleSort("total")}
                />
              </span>
              <span className="dc-cell" data-col="acts">
                <span className="dc-hlabel">פעולות</span>
              </span>
            </div>
            <ul className="dc-rows" role="list">
              {filtered.map((d) => (
                <DocumentRow key={d.id} doc={d} showAlloc={showAlloc} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One document, one single-line card-row. Every datum gets its OWN vertical
 * COLUMN, and every row is a `grid-template-columns: subgrid` item of the one
 * `.dc-table` grid, so the columns are sized once, from the content of the
 * whole list, and every card's cells start at exactly the same x - including
 * the header band above them:
 *
 *   סוג | לקוח | נושא | תאריך | מספר | [הקצאה] | מייל | סטטוס | סכום | ⋯
 *
 * Subgrid is what makes this both a real table AND a stack of separate white
 * cards: fixed rem widths per column would have to be guessed against the
 * widest possible Hebrew label, whereas subgrid tracks size themselves to the
 * actual data and stay shared across every card.
 *
 * Every card is exactly the same rectangle: the row height is fixed (not a
 * min-height), the type chip fills its track, the status pill has a fixed
 * width, the "N ימים" overdue note sits inline after the pill instead of
 * under it, and the action slot is four fixed cells whether or not a given
 * document offers four actions.
 *
 * The whole card is clickable via a stretched link on the client name (rather
 * than an onClick on a div), which keeps it reachable by keyboard and
 * announced as a link, while the action buttons sit above the overlay.
 */
function DocumentRow({ doc: d, showAlloc }: { doc: InvoiceDocument; showAlloc: boolean }) {
  const unpaidDays =
    d.status === "sent" && d.type !== "receipt" && d.type !== "tax_invoice_receipt"
      ? Math.floor((Date.now() - new Date(d.date).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
  const emailed = Boolean(d.emailedAt);
  // מספר הקצאה, the Tax Authority allocation number (חשבונית ישראל). Set on
  // tax invoices above the annual threshold, either by the gov API integration
  // or by hand. The column only exists at all when this business can receive
  // one AND some document in view actually has one (see `showAlloc`).
  const allocation = d.allocationNumber?.trim();
  const subject = d.subject?.trim();

  return (
    <li className="dc-row" data-type={d.type} data-status={d.status}>
      <span className="dc-cell" data-col="type">
        <span className="dc-chip">
          <i className="dc-tdot" data-type={d.type} aria-hidden="true" />
          {DOCUMENT_TYPE_LABELS[d.type]}
        </span>
      </span>

      <span className="dc-cell" data-col="client">
        <Link href={`/documents/${d.id}`} className="dc-name" title={d.clientName}>
          {d.clientName}
        </Link>
      </span>

      <span className="dc-cell" data-col="subj">
        <span className="dc-subj" title={subject || undefined}>
          {subject || "-"}
        </span>
      </span>

      <span className="dc-cell" data-col="date" data-label="תאריך">
        <span className="dc-val">{formatDate(d.date)}</span>
      </span>

      <span className="dc-cell" data-col="number" data-label="מספר">
        <span className="dc-num">#{d.number}</span>
      </span>

      {showAlloc && (
        <span className="dc-cell" data-col="alloc" data-label="הקצאה">
          {allocation ? (
            <span className="dc-val">{allocation}</span>
          ) : (
            <span className="dc-none" aria-hidden="true">
              -
            </span>
          )}
        </span>
      )}

      <span className="dc-cell" data-col="mail">
        <span
          className="dc-mail"
          data-sent={emailed ? "1" : undefined}
          title={emailed ? `נשלח במייל ב-${formatDate(d.emailedAt!)}` : "לא נשלח במייל"}
        >
          {emailed ? (
            <MailCheck className="dc-mailicon" aria-hidden="true" />
          ) : (
            <Mail className="dc-mailicon" aria-hidden="true" />
          )}
          <span className="dc-mailtxt" aria-hidden="true">
            {emailed ? "נשלח" : "לא נשלח"}
          </span>
          <span className="sr-only">
            {emailed ? `נשלח במייל ב-${formatDate(d.emailedAt!)}` : "לא נשלח במייל"}
          </span>
        </span>
      </span>

      <span
        className="dc-cell"
        data-col="status"
        data-overdue={unpaidDays >= OVERDUE_DAYS ? "1" : undefined}
        title={unpaidDays >= OVERDUE_DAYS ? `${unpaidDays} ימים ללא תשלום` : undefined}
      >
        <span className="dc-pill" data-status={d.status}>
          <i className="dc-pilldot" aria-hidden="true" />
          {DOCUMENT_STATUS_LABELS[d.status]}
        </span>
        {/* Inline, never on a second line: a note under the pill made an
            overdue card taller than every other card in the list. */}
        {unpaidDays >= OVERDUE_DAYS && (
          <span className="dc-note" title={`${unpaidDays} ימים ללא תשלום`}>
            {unpaidDays} ימים<span className="dc-tail"> ללא תשלום</span>
          </span>
        )}
      </span>

      <span className="dc-cell" data-col="amount">
        <span className="dc-amt">{formatCurrency(d.total)}</span>
      </span>

      <span className="dc-cell" data-col="acts">
        <RowActions doc={d} />
      </span>
    </li>
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
  // detail page so the card button behaves identically.
  const canConvertToReceipt =
    (doc.type === "quote" || doc.type === "proforma") &&
    doc.status !== "draft" &&
    doc.status !== "cancelled" &&
    !doc.convertedToId;
  const confirm = useConfirm();
  const showToast = useToast();

  // Delete is offered for any doc that was never emailed to the customer
  // (drafts AND issued-but-unsent). `deleteDocument` throws for an emailed doc
  // (must be cancelled via credit note), so the button is hidden for those and
  // this handler only ever runs on a deletable doc.
  const isDeletable = !doc.emailedAt;
  async function handleRowDelete(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await confirm({
      title: `למחוק את ${DOCUMENT_TYPE_LABELS[doc.type]} #${doc.number}?`,
      message:
        doc.status === "draft"
          ? "פעולה זו לא ניתנת לביטול."
          : "המספר לא יוחזר, ייתכן רצף חסר במספור. פעולה זו לא ניתנת לביטול.",
      tone: "danger",
      confirmLabel: "מחק",
    });
    if (ok) {
      try {
        await deleteDocument(doc.id);
      } catch (err) {
        showToast(friendlyError(err, "שגיאה במחיקה"));
      }
    }
  }

  // FOUR fixed slots, always, in the same order on every card. An action a
  // given document cannot offer leaves its slot empty rather than letting the
  // rest slide across, so "edit" is under "edit" and "delete" under "delete"
  // all the way down the list and the actions block is one width for every
  // row - which is also what keeps the cards identical rectangles.
  return (
    <>
      {canConvertToReceipt ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            const targetType = canIssueTaxInvoices(business) ? "tax-invoice-receipt" : "receipt";
            router.push(`/documents/new/${targetType}?from=${doc.id}&convert=1`);
          }}
          className="dc-act"
          data-tone="convert"
          aria-label="הפק קבלה לחשבון העסקה הזה"
        >
          <Tooltip label="הפק קבלה: כסף התקבל" side="top">
            <FilePlus2 className="w-4 h-4" />
          </Tooltip>
        </button>
      ) : (
        <ActSlot />
      )}
      {canMarkPaid ? (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            try {
              await updateDocumentStatus(doc.id, isPaid ? "sent" : "paid");
            } catch (err) {
              showToast(friendlyError(err, "שגיאה בעדכון"));
            }
          }}
          className="dc-act"
          data-tone="paid"
          data-on={isPaid ? "1" : undefined}
          aria-label={isPaid ? "סמן כלא שולם" : "סמן כשולם"}
        >
          <Tooltip label={isPaid ? "סמן כלא שולם" : "סמן כשולם"} side="top">
            {isPaid ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
          </Tooltip>
        </button>
      ) : (
        <ActSlot />
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          router.push(`/documents/${doc.id}`);
        }}
        className="dc-act"
        aria-label="ערוך מסמך"
      >
        <Tooltip label="ערוך" side="top">
          <Pencil className="w-4 h-4" />
        </Tooltip>
      </button>
      {isDeletable ? (
        <button
          onClick={handleRowDelete}
          className="dc-act"
          data-tone="danger"
          aria-label="מחק מסמך"
        >
          <Tooltip label="מחק" side="top">
            <Trash2 className="w-4 h-4" />
          </Tooltip>
        </button>
      ) : (
        <ActSlot />
      )}
    </>
  );
}

/** The placeholder that holds an unavailable action's place in the row. */
function ActSlot() {
  return <span className="dc-act dc-act-empty" aria-hidden="true" />;
}

/**
 * A column label that is also the sort control for that column, so sorting
 * lives where the data is instead of in a separate chip strip. Inactive
 * columns still show the up/down glyph (at low opacity) so it is discoverable
 * that the label is clickable at all.
 */
function SortLabel({
  label,
  sortKey,
  currentKey,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onClick: () => void;
}) {
  const active = sortKey === currentKey;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  const hint = !active
    ? `מיין לפי ${label}`
    : dir === "asc"
      ? `${label}: מהנמוך לגבוה, לחץ להיפוך`
      : `${label}: מהגבוה לנמוך, לחץ להיפוך`;
  return (
    <button
      type="button"
      onClick={onClick}
      className="dc-sort"
      data-active={active ? "1" : undefined}
      aria-pressed={active}
      title={hint}
    >
      {label}
      <Icon className="dc-sorticon" aria-hidden="true" />
    </button>
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
