"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { track } from "@vercel/analytics";
import { supabase } from "@/lib/supabase";

function ConfirmInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/onboarding";
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let resolved = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = async (
      session: { user: { id?: string } | null; access_token?: string } | null,
    ) => {
      if (resolved || cancelled) return;
      resolved = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (session) {
        setStatus("ok");
        track("email_confirmed");
        // Fire-and-forget welcome email. Server side de-dupes via
        // user_metadata.welcomed_at so re-clicks of the link don't double-send.
        if (session.access_token) {
          fetch("/api/send-welcome", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
          }).catch(() => {
            // best-effort; not critical
          });
        }
        // Deferred email verification means a user can already be signed in,
        // onboarded, and actively using the app by the time they get around
        // to clicking this confirmation link (it's no longer the gate that
        // blocks entry). Sending an already-onboarded user back through
        // /onboarding is a dead-end detour, so redirect to /dashboard
        // instead when we can positively confirm onboarding is done.
        // Signal: a real (non-placeholder) business row for this user - the
        // same "is configured?" check the rest of the app already uses
        // (see isPlaceholderBusinessName/isPlaceholderBusinessTaxId in
        // src/lib/business-init.ts). If we can't determine this (no user id,
        // query fails), keep the existing next-param-or-/onboarding default
        // untouched rather than guess.
        let target = next;
        const userId = session.user?.id;
        if (userId) {
          try {
            const { data } = await supabase
              .from("businesses")
              .select("name, tax_id")
              .eq("user_id", userId)
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle();
            const hasName = Boolean(data?.name) && data?.name !== "העסק שלי";
            const hasTaxId = Boolean(data?.tax_id) && data?.tax_id !== "000000000";
            if (hasName && hasTaxId) {
              target = "/dashboard";
            }
          } catch {
            // Onboarding-completion signal is best-effort; fall back to the
            // existing next-param-or-/onboarding behaviour on any failure.
          }
        }
        redirectTimer = setTimeout(() => {
          if (!cancelled) router.replace(target);
        }, 1200);
      } else {
        setStatus("error");
        setErrorMsg(
          "הקישור פג תוקף או כבר נעשה בו שימוש. אנא התחבר באמצעות האימייל והסיסמה."
        );
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
        if (session) finish(session);
      }
    });

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!cancelled) finish(session);
      })
      // Safe to swallow: the onAuthStateChange listener above and the
      // fallback timer below both still resolve this screen. Left unguarded
      // it only added an unhandled rejection on a flaky connection.
      .catch(() => {});

    fallbackTimer = setTimeout(() => {
      if (resolved || cancelled) return;
      supabase.auth
        .getSession()
        .then(({ data: { session } }) => {
          if (!cancelled) finish(session);
        })
        // Last resort already; if it rejects there is nothing further to try
        // and `finish(null)` would only send the user to the error state.
        .catch(() => {});
    }, 1500);

    return () => {
      cancelled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (redirectTimer) clearTimeout(redirectTimer);
      subscription.unsubscribe();
    };
  }, [router, next]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto shadow-xl shadow-orange-200/50 btn-glow">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-stone-900 mt-4">MyFriendlyInvoiceApp</h1>
        </div>

        <div className="card-soft p-8 animate-fade-in-up stagger-2 text-center">
          {status === "checking" && (
            <>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto shadow-md mb-4">
                <Sparkles className="w-7 h-7 text-white animate-pulse" />
              </div>
              <h2 className="font-bold text-stone-900 text-lg">מאמת את הקישור...</h2>
              <p className="text-sm text-stone-600 mt-2">רגע אחד</p>
            </>
          )}

          {status === "ok" && (
            <>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mx-auto shadow-md mb-4">
                <CheckCircle2 className="w-7 h-7 text-white" />
              </div>
              <h2 className="font-bold text-stone-900 text-lg">הרישום אושר!</h2>
              <p className="text-sm text-stone-600 mt-2">מעביר אותך להגדרת העסק...</p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto shadow-md mb-4">
                <AlertCircle className="w-7 h-7 text-white" />
              </div>
              <h2 className="font-bold text-stone-900 text-lg">לא הצלחנו להשלים את האימות</h2>
              <p className="text-sm text-stone-600 mt-2">{errorMsg}</p>
              <Link
                href="/login"
                className="mt-5 inline-flex items-center justify-center w-full bg-gradient-to-l from-orange-500 to-rose-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 transition-all"
              >
                לעמוד ההתחברות
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmInner />
    </Suspense>
  );
}
