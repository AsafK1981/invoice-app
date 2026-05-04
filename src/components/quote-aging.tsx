"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, AlertTriangle, CheckCircle2, FileQuestion, ArrowLeft, ChevronDown } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { InvoiceDocument } from "@/lib/types";

interface Props {
  documents: InvoiceDocument[];
}

type BucketKey = "fresh" | "aging" | "stale";

interface Bucket {
  key: BucketKey;
  label: string;
  count: number;
  value: number;
  items: InvoiceDocument[];
  icon: typeof Clock;
  color: string;
  bg: string;
  border: string;
  expandedBg: string;
}

function daysSince(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

export function QuoteAging({ documents }: Props) {
  const openQuotes = documents.filter((d) => d.type === "quote" && d.status === "sent");

  const fresh: InvoiceDocument[] = [];
  const aging: InvoiceDocument[] = [];
  const stale: InvoiceDocument[] = [];
  for (const q of openQuotes) {
    const d = daysSince(q.date);
    if (d < 7) fresh.push(q);
    else if (d < 14) aging.push(q);
    else stale.push(q);
  }

  // Default to showing the stale bucket if any exist (preserves the
  // urgent "you have N stale quotes" surface from before the buckets
  // became clickable). Otherwise no bucket is auto-expanded.
  const [expanded, setExpanded] = useState<BucketKey | null>(stale.length > 0 ? "stale" : null);
  // If the currently-expanded bucket goes empty mid-session (e.g. the
  // user marked a stale quote as paid, leaving the bucket empty), close
  // it so we don't show an empty list under a now-unclickable card.
  useEffect(() => {
    if (expanded === "fresh" && fresh.length === 0) setExpanded(null);
    else if (expanded === "aging" && aging.length === 0) setExpanded(null);
    else if (expanded === "stale" && stale.length === 0) setExpanded(null);
  }, [expanded, fresh.length, aging.length, stale.length]);

  if (openQuotes.length === 0) return null;

  const totalValue = openQuotes.reduce((s, q) => s + q.total, 0);

  const buckets: Bucket[] = [
    {
      key: "fresh",
      label: "טריות (פחות משבוע)",
      count: fresh.length,
      value: fresh.reduce((s, q) => s + q.total, 0),
      items: fresh,
      icon: CheckCircle2,
      color: "text-emerald-700",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      expandedBg: "bg-emerald-50/50 border-emerald-200",
    },
    {
      key: "aging",
      label: "מתבגרות (1-2 שבועות)",
      count: aging.length,
      value: aging.reduce((s, q) => s + q.total, 0),
      items: aging,
      icon: Clock,
      color: "text-amber-700",
      bg: "bg-amber-50",
      border: "border-amber-200",
      expandedBg: "bg-amber-50/50 border-amber-200",
    },
    {
      key: "stale",
      label: "ישנות (יותר משבועיים)",
      count: stale.length,
      value: stale.reduce((s, q) => s + q.total, 0),
      items: stale,
      icon: AlertTriangle,
      color: "text-rose-700",
      bg: "bg-rose-50",
      border: "border-rose-200",
      expandedBg: "bg-rose-50/50 border-rose-100",
    },
  ];

  const expandedBucket = buckets.find((b) => b.key === expanded) ?? null;

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
            ב-{openQuotes.length} {openQuotes.length === 1 ? "הצעה" : "הצעות"} ממתינות לתשובה. לחץ על קבוצה כדי לראות אילו.
          </p>
        </div>
        <Link
          href="/documents?type=quote&status=sent"
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
          const isExpanded = expanded === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => {
                if (empty) return;
                setExpanded(isExpanded ? null : b.key);
              }}
              disabled={empty}
              aria-expanded={isExpanded}
              className={`text-right rounded-2xl border p-4 transition-all ${
                empty
                  ? "bg-stone-50 border-stone-200 cursor-not-allowed"
                  : isExpanded
                    ? `${b.bg} ${b.border} ring-2 ring-offset-1 ${b.color.replace("text-", "ring-")}/40 cursor-pointer`
                    : `${b.bg} ${b.border} hover:shadow-md hover:-translate-y-0.5 cursor-pointer`
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${empty ? "text-stone-400" : b.color}`} />
                <span className={`text-xs font-medium ${empty ? "text-stone-500" : b.color}`}>
                  {b.label}
                </span>
                {!empty && (
                  <ChevronDown
                    className={`w-3.5 h-3.5 mr-auto ${b.color} transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${empty ? "text-stone-400" : "text-stone-900"}`}>
                  {b.count}
                </span>
                {!empty && (
                  <span className="text-xs text-stone-600">
                    · <span dir="ltr">{formatCurrency(b.value)}</span>
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {expandedBucket && expandedBucket.count > 0 && (
        <div className={`mt-4 ${expandedBucket.expandedBg} border p-3 rounded-xl`}>
          <ul className="space-y-1">
            {expandedBucket.items
              .slice()
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((q) => {
                const days = daysSince(q.date);
                return (
                  <li key={q.id}>
                    <Link
                      href={`/documents/${q.id}`}
                      className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg hover:bg-white/80 transition-colors text-xs group"
                    >
                      <span className="flex items-center gap-2 min-w-0 max-w-[60%]">
                        <span className="font-semibold text-stone-900 truncate">
                          {q.clientName}
                        </span>
                        <span className="text-stone-500 flex-shrink-0">·</span>
                        <span className="text-stone-600 flex-shrink-0">#{q.number}</span>
                      </span>
                      <span className="flex items-center gap-2 text-stone-600 flex-shrink-0">
                        <span className="font-medium" dir="ltr">{formatCurrency(q.total)}</span>
                        <span className={`${expandedBucket.color} font-semibold tabular-nums`} dir="rtl">
                          {days} י׳
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}
