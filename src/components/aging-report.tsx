"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, type InvoiceDocument } from "@/lib/types";

interface Props {
  documents: InvoiceDocument[];
}

interface AgingRow {
  clientId: string;
  clientName: string;
  buckets: [number, number, number, number]; // 0-30, 31-60, 61-90, 90+
  total: number;
  docs: InvoiceDocument[];
}

function daysOverdue(doc: InvoiceDocument): number {
  // Use issue date as the proxy for "due"; most freelancers issue and
  // expect payment within 30 days. Compare calendar day to calendar day:
  // doc.date ("YYYY-MM-DD") parses as UTC midnight, so mixing it with a
  // local Date.now() drifts ±1 day near midnight and flips boundary docs
  // between aging buckets. Float both to a UTC calendar day instead.
  const [y, m, d] = doc.date.split("-").map(Number);
  const issuedUTC = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((todayUTC - issuedUTC) / 86400000));
}

function bucketIndex(days: number): 0 | 1 | 2 | 3 {
  if (days <= 30) return 0;
  if (days <= 60) return 1;
  if (days <= 90) return 2;
  return 3;
}

const BUCKET_LABELS = ["0-30 ימים", "31-60 ימים", "61-90 ימים", "מעל 90 ימים"];
const BUCKET_TONES = [
  "text-stone-700",
  "text-amber-700",
  "text-orange-700",
  "text-rose-700",
];

export function AgingReport({ documents }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo<AgingRow[]>(() => {
    const open = documents.filter(
      (d) =>
        d.status === "sent" &&
        (d.type === "quote" || d.type === "proforma" || d.type === "tax_invoice"),
    );

    const byClient = new Map<string, AgingRow>();
    for (const d of open) {
      const days = daysOverdue(d);
      const b = bucketIndex(days);
      const key = d.clientId || `__no_client__:${d.clientName}`;
      let row = byClient.get(key);
      if (!row) {
        row = {
          clientId: d.clientId,
          clientName: d.clientName,
          buckets: [0, 0, 0, 0],
          total: 0,
          docs: [],
        };
        byClient.set(key, row);
      }
      row.buckets[b] += (d.totalIls ?? d.total);
      row.total += (d.totalIls ?? d.total);
      row.docs.push(d);
    }

    return Array.from(byClient.values()).sort((a, b) => b.total - a.total);
  }, [documents]);

  const totals = useMemo(() => {
    const t: [number, number, number, number] = [0, 0, 0, 0];
    let grand = 0;
    for (const r of rows) {
      for (let i = 0; i < 4; i++) t[i] += r.buckets[i];
      grand += r.total;
    }
    return { buckets: t, grand };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="card-soft p-6">
        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          <AlertTriangle className="w-5 h-5 text-orange-500 self-center" />
          <h2 className="font-semibold text-stone-900">חובות פתוחים</h2>
          <span className="text-xs text-stone-500">חלוקה לפי וותק החוב</span>
        </div>
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
      <div className="px-6 py-4 border-b border-orange-100 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <AlertTriangle className="w-5 h-5 text-orange-500 self-center" />
          <h2 className="font-semibold text-stone-900">חובות פתוחים</h2>
          <span
            className="text-xs text-stone-500"
            title="כמה ימים עברו מאז הפקת המסמך, מה שמכונה בעולם החשבונאות 'גיול חובות'."
          >
            לפי וותק החוב
          </span>
        </div>
        <p className="text-xs text-stone-600">
          {rows.length} לקוחות · סך פתוח{" "}
          <span className="font-bold text-stone-900" dir="ltr">
            {formatCurrency(totals.grand)}
          </span>
        </p>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="text-xs text-stone-700 bg-orange-50/50">
          <tr>
            <th className="text-right px-6 py-3 font-semibold">לקוח</th>
            {BUCKET_LABELS.map((label, i) => (
              <th key={i} className={`text-left px-3 py-3 font-semibold ${BUCKET_TONES[i]}`}>
                {label}
              </th>
            ))}
            <th className="text-left px-6 py-3 font-semibold">סה״כ</th>
            <th className="w-10"></th>
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
                isOpen={isOpen}
                onToggle={() => toggle(key)}
              />
            );
          })}
          <tr className="border-t-2 border-orange-200 bg-orange-50/40 font-bold">
            <td className="px-6 py-3 text-sm text-stone-900">סה״כ</td>
            {totals.buckets.map((v, i) => (
              <td key={i} className={`px-3 py-3 text-sm text-left font-mono ${BUCKET_TONES[i]}`}>
                {v > 0 ? formatCurrency(v) : "-"}
              </td>
            ))}
            <td className="px-6 py-3 text-sm text-left font-mono text-stone-900" dir="ltr">
              {formatCurrency(totals.grand)}
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  );
}

function FragmentRow({
  row,
  isOpen,
  onToggle,
}: {
  row: AgingRow;
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
        {row.buckets.map((v, i) => (
          <td key={i} className={`px-3 py-3 text-sm text-left font-mono ${BUCKET_TONES[i]}`}>
            {v > 0 ? formatCurrency(v) : "-"}
          </td>
        ))}
        <td className="px-6 py-3 text-sm text-left font-mono font-bold text-stone-900" dir="ltr">
          {formatCurrency(row.total)}
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
          <td colSpan={6} className="px-6 py-3">
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
                      <span className="font-mono">
                        {DOCUMENT_TYPE_LABELS[d.type]} #{d.number}
                      </span>
                      <span className="text-stone-500">· {formatDate(d.date)}</span>
                      <span className="text-stone-500">
                        ({daysOverdue(d)} ימים)
                      </span>
                    </Link>
                    <span className="font-mono font-semibold text-stone-900" dir="ltr">
                      {formatCurrency(d.totalIls ?? d.total)}
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
