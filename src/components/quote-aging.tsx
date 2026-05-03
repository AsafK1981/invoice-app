"use client";

import Link from "next/link";
import { Clock, AlertTriangle, CheckCircle2, FileQuestion, ArrowLeft } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { InvoiceDocument } from "@/lib/types";

interface Props {
  documents: InvoiceDocument[];
}

interface Bucket {
  label: string;
  count: number;
  value: number;
  icon: typeof Clock;
  color: string;
  bg: string;
  border: string;
}

function daysSince(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

export function QuoteAging({ documents }: Props) {
  const openQuotes = documents.filter((d) => d.type === "quote" && d.status === "sent");

  if (openQuotes.length === 0) return null;

  const fresh: InvoiceDocument[] = [];
  const aging: InvoiceDocument[] = [];
  const stale: InvoiceDocument[] = [];

  for (const q of openQuotes) {
    const d = daysSince(q.date);
    if (d < 7) fresh.push(q);
    else if (d < 14) aging.push(q);
    else stale.push(q);
  }

  const totalValue = openQuotes.reduce((s, q) => s + q.total, 0);

  const buckets: Bucket[] = [
    {
      label: "טריות (פחות משבוע)",
      count: fresh.length,
      value: fresh.reduce((s, q) => s + q.total, 0),
      icon: CheckCircle2,
      color: "text-emerald-700",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
    },
    {
      label: "מתבגרות (1-2 שבועות)",
      count: aging.length,
      value: aging.reduce((s, q) => s + q.total, 0),
      icon: Clock,
      color: "text-amber-700",
      bg: "bg-amber-50",
      border: "border-amber-200",
    },
    {
      label: "ישנות (יותר משבועיים)",
      count: stale.length,
      value: stale.reduce((s, q) => s + q.total, 0),
      icon: AlertTriangle,
      color: "text-rose-700",
      bg: "bg-rose-50",
      border: "border-rose-200",
    },
  ];

  return (
    <div className="card-soft p-5">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-stone-900 flex items-center gap-2">
            <FileQuestion className="w-5 h-5 text-amber-600" />
            הצעות פתוחות לפי גיל
          </h2>
          <p className="text-xs text-stone-600 mt-1">
            סה״כ <span className="font-semibold text-stone-900">{formatCurrency(totalValue)}</span>{" "}
            ב-{openQuotes.length} {openQuotes.length === 1 ? "הצעה" : "הצעות"} ממתינות לתשובה
          </p>
        </div>
        <Link
          href="/documents"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium group flex-shrink-0"
        >
          לכל המסמכים
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {buckets.map((b) => {
          const Icon = b.icon;
          const empty = b.count === 0;
          return (
            <div
              key={b.label}
              className={`rounded-2xl border p-4 ${empty ? "bg-stone-50 border-stone-200" : `${b.bg} ${b.border}`}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${empty ? "text-stone-400" : b.color}`} />
                <span className={`text-xs font-medium ${empty ? "text-stone-500" : b.color}`}>
                  {b.label}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${empty ? "text-stone-400" : "text-stone-900"}`}>
                  {b.count}
                </span>
                {!empty && (
                  <span className="text-xs text-stone-600">
                    · {formatCurrency(b.value)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {stale.length > 0 && (
        <div className="mt-4 bg-rose-50/50 border border-rose-100 p-3 rounded-xl">
          <div className="flex items-start gap-2 text-xs text-rose-700 mb-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              <strong>{stale.length} {stale.length === 1 ? "הצעה" : "הצעות"}</strong> פתוחות מעל שבועיים בשווי{" "}
              {formatCurrency(stale.reduce((s, q) => s + q.total, 0))}. כדאי לפתוח ולשלוח תזכורת.
            </span>
          </div>
          <ul className="space-y-1">
            {stale
              .slice()
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 5)
              .map((q) => {
                const days = daysSince(q.date);
                return (
                  <li key={q.id}>
                    <Link
                      href={`/documents/${q.id}`}
                      className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg hover:bg-white/80 transition-colors text-xs group"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-stone-900 truncate">
                          {q.clientName}
                        </span>
                        <span className="text-stone-500">·</span>
                        <span className="text-stone-600 truncate">#{q.number}</span>
                      </span>
                      <span className="flex items-center gap-2 text-stone-600 flex-shrink-0">
                        <span className="font-medium">{formatCurrency(q.total)}</span>
                        <span className="text-rose-700 font-semibold tabular-nums">
                          {days}י׳
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            {stale.length > 5 && (
              <li className="text-xs text-stone-500 pt-1">ועוד {stale.length - 5}…</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
