"use client";

import { useEffect, useState } from "react";
import { MailWarning, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

const DISMISS_KEY = "invoice-app:email-verify-banner-dismissed";

/**
 * Persistent, dismissible reminder shown across the authenticated app when
 * the signed-in user's email is not yet confirmed. Deferred verification
 * lets a new user in immediately at signup, but a typo'd address would
 * otherwise only surface later, at send time - this catches it early.
 *
 * Strictly a `null` check on `email_confirmed_at`: every one of today's
 * existing users already has that field set, so none of them will ever see
 * this render.
 */
export function EmailVerificationBanner() {
  const [needsVerification, setNeedsVerification] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setDismissed(typeof window !== "undefined" && window.sessionStorage.getItem(DISMISS_KEY) === "1");
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        const user = data.user;
        setNeedsVerification(Boolean(user && user.email_confirmed_at == null));
        setEmail(user?.email ?? null);
      })
      // Stay hidden rather than nag on bad information: we cannot tell an
      // unverified user from an unreachable network here.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function dismiss() {
    setDismissed(true);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    }
  }

  async function handleResend() {
    if (resending || cooldown > 0 || !email) return;
    setResending(true);
    setSent(false);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setResending(false);
    if (!error) {
      setSent(true);
      setCooldown(60);
    }
  }

  if (!needsVerification || dismissed) return null;

  return (
    <div className="no-print mb-4 print:hidden rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        <MailWarning className="w-4 h-4 text-amber-700 flex-shrink-0" />
        <p className="text-xs sm:text-sm text-amber-900 flex-1 min-w-0">
          {sent
            ? "שלחנו שוב. בדוק את תיבת הדואר, וגם בתיקיית הספאם."
            : "עדיין לא אימתת את כתובת המייל שלך. אימות נדרש כדי לשלוח מסמכים ללקוחות."}
        </p>
        <button
          type="button"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
          className="text-xs sm:text-sm font-semibold text-amber-800 hover:text-amber-950 underline disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          {resending ? "שולח..." : cooldown > 0 ? `שלח שוב בעוד ${cooldown} שנ׳` : "שלח קישור אימות שוב"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="סגור"
          className="text-amber-700 hover:text-amber-900 hover:bg-amber-100 rounded-lg p-1 flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
