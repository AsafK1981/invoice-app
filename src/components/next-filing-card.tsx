"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import type { Business } from "@/lib/types";
import { todayInIsrael } from "@/lib/date";
import { formatDate } from "@/lib/format";
import { OBLIGATIONS, daysUntil, obligationOccurrences, relativeDayLabel } from "@/lib/ita/filing-calendar";
import { useFilingPreferences } from "@/lib/filing-preferences-store";

/** How far ahead the dashboard looks. Past that, the card stays out of the way. */
const WINDOW_DAYS = 21;

/**
 * "ההגשה הבאה" on the dashboard: the nearest filing deadline that is not
 * marked as filed, within the next three weeks, with a link to the calendar.
 * Silent while loading, on a load error and when nothing is due soon: the
 * dashboard must never nag with a broken or empty card.
 */
export function NextFilingCard({ business }: { business: Business }) {
  const { state } = useFilingPreferences(business.id);
  const today = todayInIsrael();

  const next = useMemo(() => {
    if (!state) return null;
    const [y, m, d] = today.split("-").map(Number);
    const end = new Date(Date.UTC(y, m - 1, d + WINDOW_DAYS)).toISOString().slice(0, 10);
    return obligationOccurrences(business.businessType, state.settings, today, end).find((o) => !state.filed[o.key]) ?? null;
  }, [state, business.businessType, today]);

  if (!next) return null;
  const soon = daysUntil(next.date, today) <= 7;

  return (
    <Link
      href="/obligations"
      className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-white px-4 py-3 hover:bg-orange-50/40 transition-colors"
    >
      <span className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
        <CalendarCheck className="w-5 h-5 text-emerald-700" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold text-stone-600">ההגשה הבאה</span>
        <span className="block font-bold text-stone-900 truncate">
          {OBLIGATIONS[next.id].title} · {next.periodLabel}
        </span>
      </span>
      <span className="text-left shrink-0">
        <span className="block tabular-nums font-bold text-stone-900">{formatDate(next.date)}</span>
        <span className={`block text-xs font-bold ${soon ? "text-rose-700" : "text-stone-600"}`}>{relativeDayLabel(next.date, today)}</span>
      </span>
    </Link>
  );
}
