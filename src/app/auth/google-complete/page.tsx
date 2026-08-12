"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, AlertCircle } from "lucide-react";
import { track } from "@vercel/analytics";
import { supabase } from "@/lib/supabase";

/**
 * Lands here from /api/auth/google-redirect (redirect-mode Google sign-in)
 * with the Supabase session pair in two SHORT-LIVED COOKIES scoped to this
 * exact path. Cookies - not a URL fragment - because a fragment is
 * attacker-craftable (login-CSRF: a link carrying the attacker's session)
 * and visible to URL observers (Sentry replay, extensions); a cookie can
 * only have been set by our own callback route on our own origin. We
 * consume and delete them in one synchronous step before any async work.
 */
function takeHandoffCookies(): { access: string; refresh: string } | null {
  const read = (name: string) => {
    const hit = document.cookie
      .split("; ")
      .find((c) => c.startsWith(name + "="));
    if (!hit) return null;
    return decodeURIComponent(hit.slice(name.length + 1));
  };
  const access = read("g_auth_at");
  const refresh = read("g_auth_rt");
  // Single-use: clear immediately with the same attributes they were set
  // with, whether or not they were present/valid.
  const clear = "Path=/auth/google-complete; Max-Age=0; Secure; SameSite=Lax";
  document.cookie = `g_auth_at=; ${clear}`;
  document.cookie = `g_auth_rt=; ${clear}`;
  if (!access || !refresh) return null;
  return { access, refresh };
}

export default function GoogleCompletePage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    // The handoff cookies are single-use, so this effect must run its
    // course exactly once. Guard with a ref against React StrictMode's
    // dev double-invoke - and deliberately NO "cancelled" cleanup flag:
    // StrictMode unmounts between the two invocations, and a cancelled
    // flag would strand the successful sign-in on the spinner (council
    // GPT-seat finding, 2026-08-12). router.replace after unmount is
    // harmless; a dead redirect is not.
    if (ran.current) return;
    ran.current = true;

    async function complete() {
      const tokens = takeHandoffCookies();
      if (!tokens) {
        setFailed(true);
        return;
      }
      const { error } = await supabase.auth.setSession({
        access_token: tokens.access,
        refresh_token: tokens.refresh,
      });
      if (error) {
        setFailed(true);
        return;
      }
      track("sign_in_google");
      // Same routing rule as the rest of the auth flows: a Google user may
      // be brand new (no business yet) - send them to onboarding; returning
      // users go straight to the dashboard. If the query itself fails,
      // default to /dashboard: Google sign-ins are mostly returning users,
      // and the dashboard renders an onboarding checklist for an
      // incomplete/missing business anyway, so a wrong guess is a soft
      // landing - while dumping an existing user into /onboarding is not.
      const { data: biz, error: bizError } = await supabase
        .from("businesses")
        .select("id")
        .limit(1);
      const target = bizError
        ? "/dashboard"
        : biz && biz.length > 0
          ? "/dashboard"
          : "/onboarding";
      router.replace(target);
      router.refresh();
    }

    complete();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto shadow-xl shadow-orange-200/50 btn-glow">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-stone-900 mt-4">חשבונית ידידותית</h1>
        </div>

        <div className="card-soft p-8 animate-fade-in-up stagger-2 text-center">
          {!failed ? (
            <>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto shadow-md mb-4">
                <Sparkles className="w-7 h-7 text-white animate-pulse" />
              </div>
              <h2 className="font-bold text-stone-900 text-lg">מתחבר עם Google...</h2>
              <p className="text-sm text-stone-600 mt-2">רגע אחד</p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto shadow-md mb-4">
                <AlertCircle className="w-7 h-7 text-white" />
              </div>
              <h2 className="font-bold text-stone-900 text-lg">ההתחברות לא הושלמה</h2>
              <p className="text-sm text-stone-600 mt-2">
                משהו השתבש בדרך חזרה מ-Google. נסה שוב - זה בדרך כלל עובד בפעם השנייה.
              </p>
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
