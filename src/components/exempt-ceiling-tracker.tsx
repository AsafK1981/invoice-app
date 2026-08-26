"use client";

import { useMemo } from "react";
import { AlertTriangle, TrendingUp, ShieldCheck } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { getExemptCeiling } from "@/lib/tax-thresholds";
import { isCountableRevenue } from "@/lib/types";
import type { Business, InvoiceDocument } from "@/lib/types";

interface Props {
  business: Business | null;
  documents: InvoiceDocument[];
}

export function ExemptCeilingTracker({ business, documents }: Props) {
  const year = new Date().getFullYear();
  const ceiling = getExemptCeiling(year);

  const yearlyTurnover = useMemo(() => {
    // Annual ceiling counts real revenue transactions only; the tax authority
    // definition of מחזור עסקאות, not "money received". Excluded:
    //   • drafts / cancelled: not real transactions
    //   • price quotes (הצעת מחיר) / proforma (חשבון עסקה): pre-payment, not revenue
    //   • any doc already converted into another (convertedToId set), its
    //     revenue is represented by the target, so counting both double-counts
    //     (the source quote is marked "paid" on conversion).
    // Credit notes are stored ALREADY NEGATIVE (receipt-editor.tsx applies
    // `sign = -1` on save), so a plain sum already subtracts them - applying
    // a sign here again would double-negate and turn a refund into extra
    // turnover.
    return documents
      .filter((d) => d.date.startsWith(String(year)))
      .filter((d) => d.status !== "draft" && d.status !== "cancelled")
      .filter((d) => isCountableRevenue(d))
      .reduce((sum, d) => sum + (d.totalIls ?? d.total), 0);
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

  // 2026-08-26 colour diet: the card is white like every other card; the
  // meter is ink while things are fine, turns the brand orange as the
  // ceiling nears, and only a real breach paints rose. No teal, no gradients.
  const themes = {
    ok: {
      border: "border-[#e9e4d8]",
      bar: "bg-stone-900",
      icon: ShieldCheck,
      iconColor: "text-stone-600",
      iconBg: "bg-stone-100",
      title: "מחזור שנתי תקין",
    },
    warning: {
      border: "border-[#e9e4d8]",
      bar: "bg-orange-500",
      icon: TrendingUp,
      iconColor: "text-orange-700",
      iconBg: "bg-orange-50",
      title: "מתקרבים לתקרה",
    },
    danger: {
      border: "border-orange-300",
      bar: "bg-orange-500",
      icon: AlertTriangle,
      iconColor: "text-orange-700",
      iconBg: "bg-orange-50",
      title: "כמעט בתקרה: שקול מעבר לעוסק מורשה",
    },
    exceeded: {
      border: "border-rose-400",
      bar: "bg-rose-600",
      icon: AlertTriangle,
      iconColor: "text-rose-700",
      iconBg: "bg-rose-50",
      title: "חרגת מהתקרה: חובה לעבור לעוסק מורשה",
    },
  } as const;

  const theme = themes[tone];
  const Icon = theme.icon;
  const widthPct = Math.min(100, Math.max(0, percentage));

  return (
    <div className={`card-soft p-5 bg-white ${theme.border} border`}>
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

          <div className="mt-3 h-3 rounded-full bg-[#f1efe9] overflow-hidden">
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
              מורשה ברשויות המס. חוקית, חשבוניות מעבר לתקרה כבר היו צריכות
              לכלול מע&quot;מ.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
