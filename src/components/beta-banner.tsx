"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, Clock, AlertTriangle, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getPlanStatus, type PlanStatus } from "@/lib/plans";

/**
 * Shown only to users whose access came from a beta invite (not a paid
 * Polar sub). Color + tone shift as the expiry date approaches:
 *
 *   > 30 days  → emerald, chill ("גישת בטא פעילה")
 *   8-30 days  → amber, gentle reminder ("X ימים נשארו")
 *   1-7 days   → rose, urgent ("נגמר בעוד X ימים")
 *   expired    → rose-strong, blocking-ish ("פג, שדרג עכשיו")
 *
 * Dismissible per browser; reappears every session so the user is
 * gently nagged but not bothered constantly.
 */
const DISMISS_KEY = "invoice-app:beta-banner-dismissed";

export function BetaBanner() {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        const s = getPlanStatus(user);
        setStatus(s);
      })
      // Banner stays hidden if we cannot read the plan - better than an
      // unhandled rejection over a decorative strip.
      .catch(() => {});
    // Per-day dismissal: re-shows once a day even after the user closes it.
    try {
      const stored = window.sessionStorage.getItem(DISMISS_KEY);
      setDismissed(stored === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setDismissed(true);
  }

  if (!status) return null;
  if (!status.betaGrant && !status.betaExpired) return null;
  if (dismissed && status.daysRemaining !== null && (status.daysRemaining ?? 99) > 7 && !status.betaExpired) {
    // Dismissal only allowed in the calm zone (>7 days remaining and not expired).
    return null;
  }

  const days = status.daysRemaining ?? 0;
  const isExpired = status.betaExpired === true;
  const isUrgent = !isExpired && days <= 7;
  const isReminder = !isExpired && !isUrgent && days <= 30;

  // Color palette per state
  const palette = isExpired
    ? "from-rose-50 to-pink-50 border-rose-300 text-rose-900"
    : isUrgent
    ? "from-orange-50 to-orange-100 border-rose-200 text-rose-900"
    : isReminder
    ? "from-amber-50 to-orange-50 border-amber-200 text-amber-900"
    : "from-emerald-50 to-teal-50 border-emerald-200 text-emerald-900";

  const iconBg = isExpired || isUrgent
    ? "bg-gradient-to-br from-rose-500 to-pink-500"
    : isReminder
    ? "bg-gradient-to-br from-amber-500 to-orange-500"
    : "bg-gradient-to-br from-emerald-500 to-teal-500";

  const Icon = isExpired ? AlertTriangle : isUrgent ? Clock : isReminder ? Clock : Gift;

  const dateLabel = status.currentPeriodEnd
    ? new Date(status.currentPeriodEnd).toLocaleDateString("he-IL", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const headline = isExpired
    ? "תקופת הבטא שלך הסתיימה"
    : isUrgent
    ? `הבטא שלך נגמרת בעוד ${days} ${days === 1 ? "יום" : "ימים"}`
    : isReminder
    ? `${days} ימים נשארו בבטא`
    : "גישת בטא פעילה";

  const subtitle = isExpired
    ? "חזרת למסלול הבסיסי. כדי להמשיך עם כל הפיצ'רים, שדרג עכשיו."
    : dateLabel
    ? `המסלול שלך פג בתאריך ${dateLabel}. תוכל להמשיך לתשלום חודשי בכל עת.`
    : "תהנה מכל הפיצ'רים בחינם בתקופת הבטא.";

  return (
    <div
      className={`card-soft border-2 bg-gradient-to-l ${palette} p-4 sm:p-5 mb-4`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm flex-shrink-0 ${iconBg}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-bold text-stone-900">{headline}</p>
            {!isExpired && !isUrgent && (
              <button
                onClick={dismiss}
                aria-label="סגור הודעה"
                className="text-stone-500 hover:text-stone-800 -mt-1 -mr-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-sm text-stone-700 mt-1 leading-relaxed">{subtitle}</p>
          {(isExpired || isUrgent || isReminder) && (
            <Link
              href="/billing"
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-orange-700 text-white hover:shadow-md hover:shadow-orange-200"
            >
              <Sparkles className="w-4 h-4" />
              {isExpired ? "שדרג עכשיו" : "המשך לתשלום"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
