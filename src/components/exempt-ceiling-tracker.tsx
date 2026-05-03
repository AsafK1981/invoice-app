"use client";

import { useMemo } from "react";
import { AlertTriangle, TrendingUp, ShieldCheck } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { Business, InvoiceDocument } from "@/lib/types";

// Annual turnover ceiling for עוסק פטור. The Tax Authority adjusts this
// roughly yearly — if you're reading this and it's wrong, update it here.
// Source: רשות המסים, סעיף 31 לחוק מע"מ.
//   2024: 107,692 ₪
//   2025: 120,000 ₪
//   2026: 120,000 ₪ (no published change as of 2026-05)
const CEILING_BY_YEAR: Record<number, number> = {
  2024: 107_692,
  2025: 120_000,
  2026: 120_000,
};
const FALLBACK_CEILING = 120_000;

function getCeiling(year: number): number {
  return CEILING_BY_YEAR[year] ?? FALLBACK_CEILING;
}

interface Props {
  business: Business | null;
  documents: InvoiceDocument[];
}

export function ExemptCeilingTracker({ business, documents }: Props) {
  const year = new Date().getFullYear();
  const ceiling = getCeiling(year);

  const yearlyTurnover = useMemo(() => {
    // Annual ceiling counts all issued documents (drafts and cancelled
    // excluded — they don't represent real transactions). This matches the
    // tax authority definition of מחזור עסקאות, not "money received".
    // Credit notes subtract.
    return documents
      .filter((d) => d.date.startsWith(String(year)))
      .filter((d) => d.status !== "draft" && d.status !== "cancelled")
      .reduce((sum, d) => {
        const sign = d.type === "credit_note" ? -1 : 1;
        return sum + sign * d.total;
      }, 0);
  }, [documents, year]);

  if (!business || business.businessType !== "exempt") return null;

  const percentage = ceiling > 0 ? (yearlyTurnover / ceiling) * 100 : 0;
  const remaining = ceiling - yearlyTurnover;
  const exceeded = yearlyTurnover > ceiling;

  let tone: "ok" | "warning" | "danger" | "exceeded";
  if (exceeded) tone = "exceeded";
  else if (percentage >= 90) tone = "danger";
  else if (percentage >= 70) tone = "warning";
  else tone = "ok";

  const themes = {
    ok: {
      bg: "from-emerald-50 to-teal-50",
      border: "border-emerald-200",
      bar: "bg-gradient-to-l from-emerald-400 to-teal-500",
      icon: ShieldCheck,
      iconColor: "text-emerald-600",
      iconBg: "bg-emerald-100",
      title: "מחזור שנתי תקין",
    },
    warning: {
      bg: "from-amber-50 to-yellow-50",
      border: "border-amber-300",
      bar: "bg-gradient-to-l from-amber-400 to-yellow-500",
      icon: TrendingUp,
      iconColor: "text-amber-700",
      iconBg: "bg-amber-100",
      title: "מתקרבים לתקרה",
    },
    danger: {
      bg: "from-orange-50 to-rose-50",
      border: "border-orange-300",
      bar: "bg-gradient-to-l from-orange-500 to-rose-500",
      icon: AlertTriangle,
      iconColor: "text-orange-700",
      iconBg: "bg-orange-100",
      title: "כמעט בתקרה — שקול מעבר לעוסק מורשה",
    },
    exceeded: {
      bg: "from-rose-50 to-pink-50",
      border: "border-rose-400",
      bar: "bg-gradient-to-l from-rose-500 to-pink-500",
      icon: AlertTriangle,
      iconColor: "text-rose-700",
      iconBg: "bg-rose-100",
      title: "חרגת מהתקרה — חובה לעבור לעוסק מורשה",
    },
  } as const;

  const theme = themes[tone];
  const Icon = theme.icon;
  const widthPct = Math.min(100, Math.max(0, percentage));

  return (
    <div className={`card-soft p-5 bg-gradient-to-br ${theme.bg} ${theme.border} border`}>
      <div className="flex items-start gap-4">
        <div className={`w-11 h-11 rounded-2xl ${theme.iconBg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${theme.iconColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-sm font-bold text-stone-900">{theme.title}</p>
            <p className="text-xs text-stone-600">
              תקרת עוסק פטור {year}: {formatCurrency(ceiling)}
            </p>
          </div>

          <div className="mt-3 h-3 rounded-full bg-white/60 overflow-hidden">
            <div
              className={`h-full ${theme.bar} transition-all duration-500`}
              style={{ width: `${widthPct}%` }}
            />
          </div>

          <div className="mt-2 flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-base font-bold text-stone-900">
              <span dir="ltr" className="inline-flex items-baseline gap-1">
                {formatCurrency(yearlyTurnover)}
                <span className="text-xs font-medium text-stone-600">
                  ({percentage.toFixed(0)}%)
                </span>
              </span>
            </p>
            <p className="text-xs font-medium text-stone-700">
              {exceeded ? (
                <span className="text-rose-700 font-bold">
                  חריגה של {formatCurrency(yearlyTurnover - ceiling)}
                </span>
              ) : (
                <>נותרו {formatCurrency(remaining)} עד התקרה</>
              )}
            </p>
          </div>

          {tone === "danger" && (
            <p className="text-xs text-orange-800 mt-2">
              קרוב לתקרת המחזור השנתית. אם תחרוג, תידרש להירשם כעוסק מורשה
              ולחייב מע&quot;מ. כדאי להיערך מראש.
            </p>
          )}
          {tone === "exceeded" && (
            <p className="text-xs text-rose-800 mt-2 font-medium">
              חרגת מהתקרה. החל מתחילת השנה הבאה (לכל המאוחר) חובה להירשם כעוסק
              מורשה ברשויות המס. חוקית — חשבוניות מעבר לתקרה כבר היו צריכות
              לכלול מע&quot;מ.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
