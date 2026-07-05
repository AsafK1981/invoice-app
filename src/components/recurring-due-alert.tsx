"use client";

import Link from "next/link";
import { RefreshCw, ArrowLeft } from "lucide-react";
import { useRecurringTemplates } from "@/lib/recurring-store";
import { todayInIsrael } from "@/lib/date";
import { formatDate } from "@/lib/format";

/**
 * Dashboard widget: surfaces recurring templates whose nextDue date has
 * arrived. We don't have a cron firing them automatically; the user has
 * to hit "הפק עכשיו" themselves on /recurring. Without surfacing them
 * elsewhere it's easy to forget the page exists.
 *
 * Renders nothing when there are no due templates, so it doesn't take
 * space on a dashboard with nothing pending.
 */
export function RecurringDueAlert() {
  const { templates, ready } = useRecurringTemplates();
  if (!ready) return null;

  const today = todayInIsrael();
  const due = templates.filter((t) => t.active && t.nextDue <= today);
  if (due.length === 0) return null;

  return (
    <div className="card-soft p-4 bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-2xl bg-violet-100 flex items-center justify-center flex-shrink-0">
          <RefreshCw className="w-5 h-5 text-violet-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="font-semibold text-stone-900">
              {due.length === 1
                ? "תבנית חוזרת מוכנה להפקה"
                : `${due.length} תבניות חוזרות מוכנות להפקה`}
            </p>
            <Link
              href="/recurring"
              className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-800 group"
            >
              לדף החיובים החוזרים
              <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" />
            </Link>
          </div>
          <ul className="mt-2 space-y-0.5 text-xs text-stone-700">
            {due.slice(0, 4).map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <span className="font-medium text-stone-900 truncate">{t.clientName}</span>
                <span className="text-stone-500">·</span>
                <span className="truncate">{t.subject || (t.frequency === "monthly" ? "חודשי" : "שבועי")}</span>
                <span className="text-stone-500">·</span>
                <span className="text-violet-700 font-medium">מועד: {formatDate(t.nextDue)}</span>
              </li>
            ))}
            {due.length > 4 && (
              <li className="text-stone-500">ועוד {due.length - 4}…</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
