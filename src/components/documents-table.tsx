"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  X,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronDown,
  Filter,
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

type SortKey = "date" | "number" | "total";
type SortDir = "asc" | "desc";

interface Props {
  documents: InvoiceDocument[];
  limit?: number;
  /**
   * WHERE THE EXPORT BUTTON GOES (2026-07-30).
   *
   * "ייצוא ל-Excel" used to be a loud green button INSIDE the filter bar,
   * beside the document count - which read as the screen's call to action for
   * something a freelancer does once a year. It belongs on the page's action
   * row next to "ייבוא היסטורי": import and export are the same kind of
   * once-in-a-while chore and should look like each other, with "מסמך חדש"
   * left as the only filled button on the page.
   *
   * The page owns that row, but only THIS component knows what is currently
   * filtered - which is the whole reason the button sat beside the count. So
   * the page hands over an empty `display: contents` element and the button is
   * rendered into it through a portal: one filter state, no callback echoing
   * `filtered` back up on every keystroke, and the label keeps its count.
   */
  exportSlot?: HTMLElement | null;
}

/**
 * How many days a `sent` document may sit unpaid before the row calls it out
 * under its amount. Receipts are paid by definition and are excluded.
 */
const OVERDUE_DAYS = 7;

/* =====================================================================
   ONE FILTER STATE, TWO CONTROLS (2026-07-30)

   The list is filtered by five columns. Each one is a MULTI-select set of
   values (an empty set means "no filter on this column"), and each one is
   driven by TWO controls that are always in agreement because they read and
   write the very same piece of state:

     - the select in the filter bar above the table (the only control a phone
       has, since the phone card has no header band), and
     - the Excel-style checkbox menu on the column header itself.

   Everything a column filter needs is declared once, here: how to read the
   column's value off a document, how to label a value, and how to order the
   options. `filtered`, the options list with its counts, both controls,
   "נקה הכל", the document count, the export button and the empty state are
   all derived from that one declaration - so there is no second filter state
   anywhere and no way for the two controls to drift apart.
   ===================================================================== */
type FilterKey = "type" | "client" | "status" | "mail" | "month";
type Selections = Record<FilterKey, string[]>;

const FILTER_KEYS: FilterKey[] = ["type", "client", "status", "mail", "month"];

const EMPTY_SELECTIONS: Selections = { type: [], client: [], status: [], mail: [], month: [] };

/** The value a document has in a filterable column. One string per document. */
const VALUE_OF: Record<FilterKey, (d: InvoiceDocument) => string> = {
  type: (d) => d.type,
  client: (d) => d.clientName,
  status: (d) => d.status,
  // A true partition: every document is either emailed or not, so the option
  // counts in the menu always add up to the full list.
  mail: (d) => (d.emailedAt ? "emailed" : "not_emailed"),
  month: (d) => d.date.slice(0, 7),
};

const MAIL_LABELS: Record<string, string> = { emailed: "נשלח במייל", not_emailed: "טרם נשלח" };

function filterValueLabel(key: FilterKey, value: string): string {
  if (key === "type") return DOCUMENT_TYPE_LABELS[value as DocumentType] ?? value;
  if (key === "status") return DOCUMENT_STATUS_LABELS[value as DocumentStatus] ?? value;
  if (key === "mail") return MAIL_LABELS[value] ?? value;
  if (key === "month") return formatMonthLabel(value);
  return value;
}

/** The order the options are listed in, per column. */
const TYPE_ORDER: DocumentType[] = [
  "receipt",
  "tax_invoice_receipt",
  "tax_invoice",
  "quote",
  "proforma",
  "credit_note",
];
const STATUS_ORDER: DocumentStatus[] = ["draft", "sent", "paid", "cancelled"];

function orderOptions(key: FilterKey, values: string[]): string[] {
  if (key === "type") return TYPE_ORDER.filter((t) => values.includes(t));
  if (key === "status") return STATUS_ORDER.filter((s) => values.includes(s));
  if (key === "mail") return ["emailed", "not_emailed"].filter((m) => values.includes(m));
  if (key === "month") return [...values].sort().reverse();
  return [...values].sort((a, b) => a.localeCompare(b, "he"));
}

/**
 * The label of the "no filter" option in the FILTER BAR's select. It has to
 * name its own column, because the bar's external labels ("סוג:", "לקוח:" …)
 * are gone: every one of them repeated a word the select itself was already
 * saying, and the ~60px each stole is exactly what kept the six controls from
 * fitting on one line. מייל is the only column whose natural "all" wording
 * ("הכל") says nothing on its own, so it keeps its column name in front.
 */
const ALL_LABEL: Record<FilterKey, string> = {
  type: "כל הסוגים",
  client: "כל הלקוחות",
  status: "כל הסטטוסים",
  mail: "מייל: הכל",
  month: "כל החודשים",
};

/** The header label of the column, per column - both controls use it. */
const COL_LABEL: Record<FilterKey, string> = {
  type: "סוג",
  client: "לקוח",
  status: "סטטוס",
  mail: "מייל",
  month: "חודש",
};

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

/** The sentinel a <select> shows when the set holds more than one value. */
const MULTI = "__multi";

export function DocumentsTable({ documents, limit, exportSlot }: Props) {
  const searchParams = useSearchParams();
  const { business } = useBusiness();
  // Read initial filter values from URL search params so dashboard cards
  // (and other deep-links like /documents?type=quote&status=sent) can
  // pre-filter the list. A param may carry several comma-separated values,
  // since the sets are multi-select; unknown values are dropped as noise.
  const [selections, setSelections] = useState<Selections>(() => {
    const param = (name: string) => (searchParams.get(name) ?? "").split(",").filter(Boolean);
    const known = <T extends string>(list: readonly T[], vals: string[]) =>
      vals.filter((v): v is T => (list as readonly string[]).includes(v));
    return {
      type: known(TYPE_ORDER, param("type")),
      client: param("client"),
      status: known(STATUS_ORDER, param("status")),
      mail: known(["emailed", "not_emailed"] as const, param("email")),
      month: param("month").filter((v) => /^\d{4}-\d{2}$/.test(v)),
    };
  });
  const [search, setSearch] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  /**
   * The options every filter control offers, derived from ALL the documents
   * and never from the currently filtered subset - so an option can never
   * vanish from under the pointer while it is being used, and the count beside
   * it always reads as "this many in the whole list".
   */
  const options = useMemo(() => {
    const out = {} as Record<FilterKey, FilterOption[]>;
    for (const key of FILTER_KEYS) {
      const counts = new Map<string, number>();
      for (const d of documents) {
        const v = VALUE_OF[key](d);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      out[key] = orderOptions(key, [...counts.keys()]).map((value) => ({
        value,
        label: filterValueLabel(key, value),
        count: counts.get(value) ?? 0,
      }));
    }
    return out;
  }, [documents]);

  const setColumn = useCallback((key: FilterKey, values: string[]) => {
    setSelections((prev) => ({ ...prev, [key]: values }));
  }, []);

  const toggleValue = useCallback((key: FilterKey, value: string) => {
    setSelections((prev) => {
      const cur = prev[key];
      return {
        ...prev,
        [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
      };
    });
  }, []);

  const filtered = useMemo(() => {
    let result = documents.filter((d) =>
      FILTER_KEYS.every((key) => selections[key].length === 0 || selections[key].includes(VALUE_OF[key](d))),
    );
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
  }, [documents, selections, search, limit, sortKey, sortDir]);

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

  /** Clears BOTH controls of every column, because there is only one state. */
  function clearFilters() {
    setSelections(EMPTY_SELECTIONS);
    setSearch("");
  }

  const filtersActive =
    FILTER_KEYS.some((key) => selections[key].length > 0) || search.trim() !== "";

  return (
    <div>
      {/* THE FILTER BAR: SIX CONTROLS, ONE GRID (2026-07-30).
          It used to be `flex-wrap`, and it wrapped ragged: search + סוג + לקוח
          on one line, then סטטוס + מייל + חודש + the export button on a second,
          every one of them a different width because each was sized by its own
          longest Hebrew option. Three changes make it a block instead of a pile:
            1. the five external labels are gone (see ALL_LABEL) - that is the
               ~60px per control that buys the single line;
            2. the six controls are ONE grid with equal fr tracks, so a row is
               either full or does not exist, and every control on a row is the
               same width by construction rather than by luck;
            3. "נקה הכל" and the count sit on their own line UNDER the grid, so
               a seventh and eighth item can never make a row uneven.
          The tiers (6 / 3 / 2 / 1 columns - every one of them divides 6) are
          CONTAINER queries, not media queries: the bar's width depends on
          whether the 288px sidebar is showing, so the only honest question is
          how wide the bar itself is. See `.dcbar` in app-skin.css. */}
      <div className="dcbar">
        <div className="dcbar-in">
          <div className="dcbar-grid">
            <div className="dcbar-search">
              <Search className="dcbar-glyph" aria-hidden="true" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש: מספר, לקוח, סכום, תיאור פריט..."
                aria-label="חיפוש במסמכים"
                // The field is one of six equal tracks, so on a narrow window
                // the placeholder ellipsises to "חיפוש: …". The hover title is
                // where the full list of what is searchable stays available.
                title="חיפוש: מספר, לקוח, סכום, תיאור פריט"
                className="input-warm dcbar-input"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="dcbar-clear"
                  aria-label="נקה חיפוש"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
            {FILTER_KEYS.map((key) => (
              <FilterSelect
                key={key}
                filterKey={key}
                options={options[key]}
                selected={selections[key]}
                onChange={(values) => setColumn(key, values)}
              />
            ))}
          </div>
          <div className="dcbar-foot">
            <span className="dcbar-count">{filtered.length} מסמכים</span>
            {filtersActive && (
              <button onClick={clearFilters} className="dcbar-reset">
                נקה הכל
              </button>
            )}
          </div>
        </div>
      </div>

      {/* The export button, rendered up into the page's action row beside
          "ייבוא היסטורי" - but from HERE, so its label and its payload are the
          currently filtered list. See the `exportSlot` prop. */}
      {exportSlot &&
        createPortal(
          <button
            onClick={() => exportDocuments(filtered, filtersActive ? "filtered" : undefined)}
            disabled={filtered.length === 0}
            className="pgbtn pgbtn-quiet"
            title={
              filtersActive
                ? `ייצוא ${filtered.length} המסמכים המסוננים לקובץ CSV / Excel`
                : "ייצוא כל המסמכים לקובץ CSV / Excel"
            }
          >
            <Download aria-hidden="true" />
            ייצוא ל-Excel ({filtered.length})
          </button>,
          exportSlot,
        )}

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
                names, and every label DOES something:
                  תאריך / מספר / סכום  sort the list
                  סוג / לקוח / סטטוס / מייל  open an Excel-style filter menu
                No column is both, which keeps the affordance unambiguous, and
                in both cases the glyph sits UNDER the word rather than beside
                it so the word stays on the column's centre line and the
                content-sized track never widens. */}
            <div className="dc-head">
              <span className="dc-cell" data-col="type">
                <ColumnFilter
                  filterKey="type"
                  options={options.type}
                  selected={selections.type}
                  onToggle={toggleValue}
                  onClear={setColumn}
                />
              </span>
              <span className="dc-cell" data-col="client">
                <ColumnFilter
                  filterKey="client"
                  options={options.client}
                  selected={selections.client}
                  onToggle={toggleValue}
                  onClear={setColumn}
                />
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
                <ColumnFilter
                  filterKey="mail"
                  options={options.mail}
                  selected={selections.mail}
                  onToggle={toggleValue}
                  onClear={setColumn}
                />
              </span>
              <span className="dc-cell" data-col="status">
                <ColumnFilter
                  filterKey="status"
                  options={options.status}
                  selected={selections.status}
                  onToggle={toggleValue}
                  onClear={setColumn}
                />
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
 * width, and the action slot is four fixed cells whether or not a given
 * document offers four actions.
 *
 * EVERY COLUMN IS CENTRED (2026-07-29, at the user's request). Content and
 * header label share one centre line per column; see "cells: THE ALIGNMENT
 * RULE" in `app-skin.css` for the two columns that need craft rather than a
 * plain `justify-content: center` (סכום and מספר).
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
          {/* The dot is absolutely positioned inside the chip so it costs the
              chip's centring nothing: the WORD is what has to sit on the
              column's centre line, and a 6px marker in the flex flow would
              push it off by half its own width. */}
          <i className="dc-tdot" data-type={d.type} aria-hidden="true" />
          <span className="dc-chiptxt">{DOCUMENT_TYPE_LABELS[d.type]}</span>
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
      >
        <span className="dc-pill" data-status={d.status}>
          <i className="dc-pilldot" aria-hidden="true" />
          <span className="dc-pilltxt">{DOCUMENT_STATUS_LABELS[d.status]}</span>
        </span>
        {/* Phone card only (see `.dc-note`): down there the status line has
            room at both ends and there is no column centre line to protect.
            With columns the same sentence is the `.dc-late` tag under the
            amount instead - beside the pill it dragged the pill off the
            column's centre line on the overdue rows alone. */}
        {unpaidDays >= OVERDUE_DAYS && (
          <span className="dc-note" title={`${unpaidDays} ימים ללא תשלום`}>
            {unpaidDays} ימים<span className="dc-tail"> ללא תשלום</span>
          </span>
        )}
      </span>

      {/* סכום, and - only when the document is overdue - the unpaid-days tag
          hanging in the row's vertical slack underneath it. The wrapper is the
          full width of the cell's content box (exactly what `.dc-amt` was
          before), so the amount keeps its shared digit edge, the tag is
          centred on the amount's own centre axis, and because the tag is out
          of flow it reserves nothing on the 59 rows that are not overdue. */}
      <span className="dc-cell" data-col="amount">
        <span className="dc-amtwrap">
          <span className="dc-amt">{formatCurrency(d.total)}</span>
          {unpaidDays >= OVERDUE_DAYS && (
            <span className="dc-late">{unpaidDays} ימים ללא תשלום</span>
          )}
        </span>
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
 *
 * The label sits in its own `.dc-sorttxt` span because the WORD, not the
 * word-plus-arrow group, is what must sit on the column's centre line; the CSS
 * balances the arrow with an equal empty spacer on the label's other side.
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
      <span className="dc-sorttxt">{label}</span>
      <Icon className="dc-sorticon" aria-hidden="true" />
    </button>
  );
}

/**
 * The filter bar's control for one column: the same multi-select set, seen
 * through a <select>.
 *
 * A native select can only show one row at a time, so it shows the set's ONE
 * value when the set holds one, and a "נבחרו N" summary row when it holds
 * more (the summary row only exists while it is the selected one, so it never
 * offers itself as a choice). Picking any value REPLACES the set - which is
 * exactly what a single-choice control should mean - and "הכל" empties it.
 * Every path here goes through the same `onChange` the header menu uses, so
 * the two controls cannot disagree.
 *
 * IT HAS NO VISIBLE LABEL BESIDE IT, and it does not need one: at rest it says
 * "כל הסוגים" / "כל הלקוחות", which names its column already, and once it IS
 * filtering, every one of its option texts carries the column in front of the
 * value ("סוג: קבלה", not a bare "קבלה") - so the reader can never look at the
 * bar and wonder which column a stray "קבלה" belongs to. The column name is
 * also the control's `aria-label`, which is what a screen reader announces.
 */
function FilterSelect({
  filterKey,
  options,
  selected,
  onChange,
}: {
  filterKey: FilterKey;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const value = selected.length === 0 ? "all" : selected.length === 1 ? selected[0] : MULTI;
  const col = COL_LABEL[filterKey];
  const active = selected.length > 0;
  const multiLabel = `${col}: נבחרו ${selected.length}`;
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === MULTI) return;
        onChange(v === "all" ? [] : [v]);
      }}
      className="input-warm dcbar-input"
      data-active={active ? "1" : undefined}
      aria-label={`סינון לפי ${col}`}
      title={
        active
          ? selected.length === 1
            ? `${col}: ${filterValueLabel(filterKey, selected[0])}`
            : multiLabel
          : `סינון לפי ${col}`
      }
    >
      <option value="all">{ALL_LABEL[filterKey]}</option>
      {value === MULTI && <option value={MULTI}>{multiLabel}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {col}: {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * THE COLUMN HEADER FILTER MENU - "like every other Excel sheet table".
 *
 * The header cell becomes a button. Clicking it drops a white card of
 * checkboxes under that column: one row per distinct value with its count in
 * the FULL document set, plus a "הכל" row that clears the column. Every tick
 * applies immediately - no OK button - and writes to the same `selections`
 * state the filter bar's <select> reads, so the bar always shows what the menu
 * did and "נקה הכל" clears both.
 *
 * WHY THE PANEL IS A PORTAL. Two hard constraints:
 *   1. It must not be clipped. The band, the well and the host page's card all
 *      have radii and their own stacking, and a menu that gets a corner shaved
 *      off looks broken.
 *   2. It must not disturb the subgrid tracks. The columns are CONTENT-SIZED,
 *      so anything rendered inside a header cell that is wider than the label
 *      widens that column for all 61 cards.
 * A `position: fixed` card in a portal, placed from the trigger's own rect,
 * satisfies both by construction: it is not a descendant of the grid at all,
 * and it cannot be clipped by an ancestor's overflow because it has none.
 * It is re-placed on scroll and resize so it stays welded to its header.
 *
 * WHY THE CHEVRON IS UNDER THE WORD. Same reason the sort caret is (see the
 * header-label block in `app-skin.css`): beside the word it both widens the
 * content-sized track and pushes the word off the column's centre line.
 */
function ColumnFilter({
  filterKey,
  options,
  selected,
  onToggle,
  onClear,
}: {
  filterKey: FilterKey;
  options: FilterOption[];
  selected: string[];
  onToggle: (key: FilterKey, value: string) => void;
  onClear: (key: FilterKey, values: string[]) => void;
}) {
  const label = COL_LABEL[filterKey];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const active = selected.length > 0;
  // Only the columns that can carry many values earn a search field; on a
  // four-row menu it would be one more thing to read for nothing.
  const searchable = options.length > 8;
  const shown = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const total = options.reduce((sum, o) => sum + o.count, 0);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(Math.max(b.width, 208), Math.max(208, window.innerWidth - 16));
    // RTL: the panel hangs from the trigger's inline-start edge, i.e. its
    // RIGHT edge lines up with the header cell's right edge, then it is
    // clamped into the viewport so it can never be half off-screen.
    const left = Math.min(Math.max(8, b.right - width), window.innerWidth - width - 8);
    const top = b.bottom + 4;
    setBox({ top, left, width, maxHeight: Math.min(320, window.innerHeight - top - 12) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  // Opening puts the caret where the work is: the search field when there is
  // one, otherwise the first checkbox.
  useEffect(() => {
    if (!open) return;
    const el = panelRef.current?.querySelector<HTMLElement>("input");
    el?.focus();
  }, [open]);

  const Glyph = active ? Filter : ChevronDown;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="dc-filter"
        data-active={active ? "1" : undefined}
        data-open={open ? "1" : undefined}
        aria-expanded={open}
        aria-haspopup="true"
        title={
          active
            ? `${label}: ${selected.map((v) => filterValueLabel(filterKey, v)).join(", ")}`
            : `סינון לפי ${label}`
        }
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="dc-hlabel">{label}</span>
        <Glyph className="dc-filticon" aria-hidden="true" />
        {active && <span className="sr-only">(מסונן)</span>}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            className="dc-fpanel"
            role="group"
            aria-label={`סינון לפי ${label}`}
            dir="rtl"
            style={box ? { top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight } : { opacity: 0 }}
          >
            {searchable && (
              <input
                type="text"
                className="dc-fsearch"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`חיפוש ב${label}`}
                aria-label={`חיפוש ב${label}`}
              />
            )}
            <div className="dc-flist">
              <label className="dc-fopt" data-all="1">
                <input
                  type="checkbox"
                  checked={!active}
                  onChange={() => onClear(filterKey, [])}
                />
                <span className="dc-ftxt">הכל</span>
                <span className="dc-fcount">{total}</span>
              </label>
              {shown.map((o) => (
                <label className="dc-fopt" key={o.value}>
                  <input
                    type="checkbox"
                    checked={selected.includes(o.value)}
                    onChange={() => onToggle(filterKey, o.value)}
                  />
                  <span className="dc-ftxt">{o.label}</span>
                  <span className="dc-fcount">{o.count}</span>
                </label>
              ))}
              {shown.length === 0 && <p className="dc-fempty">אין תוצאות</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const names = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  return `${names[parseInt(m, 10) - 1]} ${year}`;
}
