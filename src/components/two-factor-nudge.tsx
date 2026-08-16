"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

const SNOOZE_KEY = "invoice-app:2fa-nudge-snoozed-until";
const SNOOZE_DAYS = 30;

/**
 * Gentle, dismissible reminder to enable two-factor authentication.
 * Shown across the authenticated app to users with no verified TOTP factor
 * (as of 2026-08-16 that was every user; docs/security-procedures.md §7
 * promised a persistent nudge that never actually existed).
 *
 * Deliberately quiet: one line, dismiss snoozes it for 30 days (localStorage,
 * so it survives the session unlike the email-verification banner), and it
 * hides itself on /settings where the enrolment UI already is.
 *
 * Fails closed to "hidden": any error listing factors means we do not know,
 * and a wrong nag on bad information is worse than no nag.
 */
export function TwoFactorNudge() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const until = Number(window.localStorage.getItem(SNOOZE_KEY) || 0);
    if (until > Date.now()) return;
    let cancelled = false;
    supabase.auth.mfa
      .listFactors()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const verified = (data.totp || []).some((f) => f.status === "verified");
        setShow(!verified);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function snooze() {
    setShow(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 3600 * 1000));
    }
  }

  if (!show || pathname?.startsWith("/settings")) return null;

  return (
    <div className="no-print mb-4 print:hidden rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        <ShieldCheck className="w-4 h-4 text-amber-700 flex-shrink-0" aria-hidden="true" />
        <p className="text-xs sm:text-sm text-stone-700 flex-1 min-w-0">
          המסמכים והלקוחות שלך שווים הגנה נוספת: הפעלת אימות דו-שלבי לוקחת דקה
          וחוסמת כניסה גם אם הסיסמה דלפה.
        </p>
        <Link
          href="/settings"
          className="text-xs sm:text-sm font-semibold text-amber-800 hover:text-amber-950 underline flex-shrink-0"
        >
          הפעל עכשיו
        </Link>
        <button
          type="button"
          onClick={snooze}
          aria-label="הסתר לחודש"
          title="הסתר לחודש"
          className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200/70 flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
