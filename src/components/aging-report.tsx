"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { formatCurrencyWhole, formatDate, hebrewCount } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, type InvoiceDocument } from "@/lib/types";
import { useClients } from "@/lib/client-store";
import {
  AGING_BASIS_LABELS,
  AGING_BUCKET_LABELS,
  AGING_DUE_BUCKET_LABELS,
  AGING_NOT_YET_DUE_LABEL,
  agingDueDate,
  computeAging,
  daysOverdue,
  daysPastDue,
  isOpenReceivable,
  type AgingBasis,
  type AgingRow,
} from "@/lib/aging";

interface Props {
  documents: InvoiceDocument[];
  /** On its own /reports/aging page the page header already carries the title; keep only the totals line. */
  headless?: boolean;
}

const BASIS_STORAGE_KEY = "aging-report-basis";
const BASES: AgingBasis[] = ["due", "issue"];
const TWO_UP = { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" };

const BUCKET_TONES = [
  "text-stone-700",
  "text-amber-700",
  "text-orange-700",
  "text-rose-700",
];

export function AgingReport({ documents, headless = false }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The viewer's explicit choice, or null to follow the default below.
  const [chosenBasis, setChosenBasis] = useState<AgingBasis | null>(null);
  const { items: clients } = useClients();

  // Default to the due basis only when some open document actually states a
  // due date. Without one, every column under the due basis would read "ימי
  // איחור" over documents that are merely aged from issue - a fresh invoice
  // would look late. So a business that never set a due date keeps exactly
  // the view it always had.
  const hasDatedOpenDoc = useMemo(
    () => documents.some((d) => isOpenReceivable(d) && agingDueDate(d) !== null),
    [documents],
  );
  const basis: AgingBasis = chosenBasis ?? (hasDatedOpenDoc ? "due" : "issue");

  // Restore the viewer's basis after mount (not in the initializer - the page
  // is server-rendered first). Storage can throw (private mode, blocked
  // cookies); the report then simply opens on the default.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BASIS_STORAGE_KEY);
      if (saved === "due" || saved === "issue") setChosenBasis(saved);
    } catch {
      /* storage unavailable - keep the default */
    }
  }, []);

  const pickBasis = (next: AgingBasis) => {
    setChosenBasis(next);
    try {
      localStorage.setItem(BASIS_STORAGE_KEY, next);
    } catch {
      /* storage unavailable - the choice just won't persist */
    }
  };

  const { rows, totals, undatedCount } = useMemo(
    () => computeAging(documents, clients, basis),
    [documents, clients, basis],
  );
  const byDue = basis === "due";
  const bucketLabels = byDue ? AGING_DUE_BUCKET_LABELS : AGING_BUCKET_LABELS;

  if (rows.length === 0) {
    return (
      <div className="card-soft p-6">
        {!headless && (
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <AlertTriangle className="w-5 h-5 text-orange-500 self-center" />
            <h2 className="font-semibold text-stone-900">חובות פתוחים</h2>
            <span className="text-xs text-stone-500">חלוקה לפי ותק החוב</span>
          </div>
        )}
        <p className="text-sm text-stone-600 mt-2">
          אין חשבוניות פתוחות. כל הלקוחות מסונכרנים, נכון לעכשיו 👌
        </p>
      </div>
    );
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="card-soft overflow-hidden">
      <div className={`px-6 py-4 border-b border-orange-100 flex items-baseline gap-3 flex-wrap ${headless ? "justify-end" : "justify-between"}`}>
        {!headless && (
          <div className="flex items-baseline gap-2 flex-wrap">
            <AlertTriangle className="w-5 h-5 text-orange-500 self-center" />
            <h2 className="font-semibold text-stone-900">חובות פתוחים</h2>
            <span
              className="text-xs text-stone-500"
              title={
                byDue
                  ? "כמה ימים עברו מאז מועד התשלום שצוין על המסמך, מה שמכונה בעולם החשבונאות 'גיול חובות'."
                  : "כמה ימים עברו מאז הפקת המסמך, מה שמכונה בעולם החשבונאות 'גיול חובות'."
              }
            >
              לפי ותק החוב
            </span>
          </div>
        )}
        <div className="dash-range rpt-modes" style={TWO_UP} role="group" aria-label="בסיס חישוב הוותק">
          {BASES.map((b) => (
            <button key={b} type="button" aria-pressed={basis === b} onClick={() => pickBasis(b)}
              className={`dash-range-btn${basis === b ? " is-active" : ""}`}>{AGING_BASIS_LABELS[b]}</button>
          ))}
        </div>
        <p className="text-xs text-stone-600">
          {hebrewCount(rows.length, "לקוח אחד", "לקוחות")} · סך פתוח{" "}
          <span className="font-bold text-stone-900" dir="ltr">
            {formatCurrencyWhole(totals.grand)}
          </span>
        </p>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="text-xs text-stone-700 bg-orange-50/50">
          <tr>
            <th scope="col" className="text-right px-6 py-3 font-semibold">לקוח</th>
            {byDue && (
              <th scope="col" className="hidden sm:table-cell text-left px-3 py-3 font-semibold text-stone-600">
                {AGING_NOT_YET_DUE_LABEL}
              </th>
            )}
            {bucketLabels.map((label, i) => (
              <th scope="col" key={i} className={`hidden sm:table-cell text-left px-3 py-3 font-semibold ${BUCKET_TONES[i]}`}>
                {label}
              </th>
            ))}
            <th scope="col" className="text-left px-6 py-3 font-semibold">סה״כ</th>
            <th scope="col" className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = row.clientId || row.clientName;
            const isOpen = expanded.has(key);
            return (
              <FragmentRow
                key={key}
                row={row}
                basis={basis}
                isOpen={isOpen}
                onToggle={() => toggle(key)}
              />
            );
          })}
          <tr className="border-t-2 border-orange-200 bg-orange-50/40 font-bold">
            <td className="px-6 py-3 text-sm text-stone-900">סה״כ</td>
            {byDue && (
              <td className="hidden sm:table-cell px-3 py-3 text-sm text-left tabular-nums text-stone-600">
                {totals.notYetDue > 0 ? formatCurrencyWhole(totals.notYetDue) : "-"}
              </td>
            )}
            {totals.buckets.map((v, i) => (
              <td key={i} className={`hidden sm:table-cell px-3 py-3 text-sm text-left tabular-nums ${BUCKET_TONES[i]}`}>
                {v > 0 ? formatCurrencyWhole(v) : "-"}
              </td>
            ))}
            <td className="px-6 py-3 text-sm text-left tabular-nums text-stone-900" dir="ltr">
              {formatCurrencyWhole(totals.grand)}
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>
      </div>
      {byDue && undatedCount > 0 && (
        <p className="px-6 py-3 border-t border-orange-100 text-xs text-stone-600">
          מסמכים שלא צוין עליהם מועד תשלום נספרים לפי תאריך ההפקה.
        </p>
      )}
    </div>
  );
}

/** The per-document age hint under a client row. */
function ageHint(d: InvoiceDocument, basis: AgingBasis): string {
  const pastDue = basis === "due" ? daysPastDue(d) : null;
  if (pastDue === null) return hebrewCount(daysOverdue(d), "יום אחד", "ימים");
  if (pastDue > 0) return hebrewCount(pastDue, "יום איחור אחד", "ימי איחור");
  if (pastDue === 0) return "לתשלום היום";
  return `בעוד ${hebrewCount(-pastDue, "יום אחד", "ימים")}`;
}

function FragmentRow({
  row,
  basis,
  isOpen,
  onToggle,
}: {
  row: AgingRow;
  basis: AgingBasis;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-orange-50 hover:bg-orange-50/40 transition-colors">
        <td className="px-6 py-3 text-sm font-medium text-stone-900">
          {row.clientId ? (
            <Link href={`/clients/${row.clientId}`} className="hover:text-orange-700">
              {row.clientName}
            </Link>
          ) : (
            row.clientName
          )}
        </td>
        {basis === "due" && (
          <td className="hidden sm:table-cell px-3 py-3 text-sm text-left tabular-nums text-stone-600">
            {row.notYetDue > 0 ? formatCurrencyWhole(row.notYetDue) : "-"}
          </td>
        )}
        {row.buckets.map((v, i) => (
          <td key={i} className={`hidden sm:table-cell px-3 py-3 text-sm text-left tabular-nums ${BUCKET_TONES[i]}`}>
            {v > 0 ? formatCurrencyWhole(v) : "-"}
          </td>
        ))}
        <td className="px-6 py-3 text-sm text-left tabular-nums font-bold text-stone-900" dir="ltr">
          {formatCurrencyWhole(row.total)}
        </td>
        <td className="px-2 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="p-1 rounded-lg hover:bg-orange-100 text-stone-600"
            aria-label={isOpen ? "כיווץ" : "פירוט"}
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-stone-50/40">
          <td colSpan={basis === "due" ? 7 : 6} className="px-6 py-3">
            <ul className="space-y-1.5">
              {row.docs
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((d) => (
                  <li key={d.id} className="text-xs flex items-center justify-between gap-3">
                    <Link
                      href={`/documents/${d.id}`}
                      className="flex items-center gap-2 hover:text-orange-700"
                    >
                      <FileText className="w-3.5 h-3.5 text-stone-400" />
                      <span className="tabular-nums">
                        {DOCUMENT_TYPE_LABELS[d.type]} #{d.number}
                      </span>
                      <span className="text-stone-500">· {formatDate(d.date)}</span>
                      <span className="text-stone-500">
                        ({ageHint(d, basis)})
                      </span>
                    </Link>
                    <span className="tabular-nums font-semibold text-stone-900" dir="ltr">
                      {formatCurrencyWhole(row.openAmounts[d.id] ?? d.totalIls ?? d.total)}
                    </span>
                  </li>
                ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
