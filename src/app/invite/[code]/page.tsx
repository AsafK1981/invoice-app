"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Gift,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  LogIn,
  ArrowLeft,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type State =
  | { kind: "loading" }
  | { kind: "not-logged-in" }
  | { kind: "redeeming" }
  | { kind: "success"; planTier: "free" | "pro"; daysGranted: number; expiresAt: string }
  | { kind: "error"; text: string };

export default function InviteLandingPage() {
  const params = useParams<{ code: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const code = params?.code?.toUpperCase() || "";
  const [state, setState] = useState<State>({ kind: "loading" });

  const redeem = useCallback(
    async (token: string) => {
      setState({ kind: "redeeming" });
      try {
        const res = await fetch("/api/invite/redeem", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (data.ok) {
          setState({
            kind: "success",
            planTier: data.plan_tier,
            daysGranted: data.days_granted,
            expiresAt: data.expires_at,
          });
        } else {
          setState({ kind: "error", text: data.error || "שגיאה" });
        }
      } catch (err) {
        setState({
          kind: "error",
          text: err instanceof Error ? err.message : "שגיאה",
        });
      }
    },
    [code],
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        setState({ kind: "not-logged-in" });
        return;
      }
      // Auto-redeem on first authenticated visit (or right after OAuth
      // bounces back with ?action=redeem).
      if (search.get("redeemed") === "1") {
        // Already redeemed in this tab — don't double-call.
        return;
      }
      redeem(session.access_token);
    });
  }, [redeem, search]);

  async function handleSignIn() {
    // After OAuth, Supabase will redirect back to this same page.
    // The useEffect above will then auto-redeem.
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/invite/${code}`,
      },
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center px-6 py-12">
      <div className="card-soft p-8 sm:p-12 max-w-md w-full space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-md">
            <Gift className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-900">קיבלת הזמנה!</h1>
            <p className="text-xs text-stone-600 mt-0.5">
              קוד:{" "}
              <code className="font-mono font-bold text-stone-800 bg-stone-100 px-1.5 py-0.5 rounded">
                {code}
              </code>
            </p>
          </div>
        </div>

        {state.kind === "loading" && (
          <p className="text-sm text-stone-700">טוען...</p>
        )}

        {state.kind === "not-logged-in" && (
          <>
            <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 p-5 space-y-2">
              <p className="text-sm text-stone-800 leading-relaxed">
                ברוך הבא ל-<strong>MySuperFriendlyInvoiceApp</strong> — אפליקציה
                להפקת חשבוניות וקבלות לעצמאיים.
              </p>
              <p className="text-sm text-stone-700 leading-relaxed">
                ההזמנה הזו תעניק לך גישה מלאה, בלי כרטיס אשראי. תוכל להפיק
                מסמכים, לנהל לקוחות, לעקוב אחר הכנסות והוצאות — הכל בעברית.
              </p>
            </div>
            <button
              onClick={handleSignIn}
              className="w-full btn-glow inline-flex items-center justify-center gap-2 bg-gradient-to-l from-emerald-500 to-teal-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-emerald-200/60"
            >
              <LogIn className="w-4 h-4" />
              התחבר עם Google כדי להפעיל
            </button>
            <p className="text-xs text-center text-stone-500">
              ההתחברות עם Google — אפס סיסמאות, אפס טפסים.
            </p>
          </>
        )}

        {state.kind === "redeeming" && (
          <div className="text-center py-4">
            <Sparkles className="w-8 h-8 text-orange-500 animate-pulse mx-auto" />
            <p className="text-sm text-stone-700 mt-2">מפעיל את הגישה שלך...</p>
          </div>
        )}

        {state.kind === "success" && (
          <>
            <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-200 p-5">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                <CheckCircle2 className="w-5 h-5" />
                <span>הגישה הופעלה בהצלחה</span>
              </div>
              <p className="text-sm text-stone-800 mt-2 leading-relaxed">
                קיבלת מסלול <strong>{state.planTier === "pro" ? "Pro" : "בסיסי"}</strong>
                {" "}למשך <strong>{state.daysGranted} ימים</strong>.
              </p>
              <p className="text-xs text-stone-600 mt-1">
                פג בתאריך{" "}
                {new Date(state.expiresAt).toLocaleDateString("he-IL", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
            <Link
              href="/dashboard"
              className="w-full btn-glow inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60"
              onClick={() => router.refresh()}
            >
              <Sparkles className="w-4 h-4" />
              בוא נתחיל
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </>
        )}

        {state.kind === "error" && (
          <>
            <div className="rounded-2xl bg-rose-50 border-2 border-rose-200 p-5">
              <div className="flex items-center gap-2 text-rose-700 font-semibold">
                <AlertCircle className="w-5 h-5" />
                <span>לא הצלחנו להפעיל את הגישה</span>
              </div>
              <p className="text-sm text-stone-800 mt-2">{state.text}</p>
            </div>
            <Link
              href="/"
              className="w-full inline-flex items-center justify-center gap-2 text-sm text-stone-700 hover:text-orange-700 py-2"
            >
              חזרה לעמוד הבית
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
