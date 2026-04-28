"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CreditCard,
  Check,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PLANS, getPlanStatus, type PlanStatus } from "@/lib/plans";
import { formatCurrency } from "@/lib/format";

export default function BillingPage() {
  const searchParams = useSearchParams();
  const [planStatus, setPlanStatus] = useState<PlanStatus>({ tier: "free", active: true });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (searchParams.get("success") === "1") {
      setToast({ kind: "success", text: "🎉 ברוך הבא ל-Pro! התשלום הצליח." });
    } else if (searchParams.get("canceled") === "1") {
      setToast({ kind: "error", text: "התשלום בוטל. תוכל לנסות שוב בכל עת." });
    }
  }, [searchParams]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setPlanStatus(getPlanStatus(user?.user_metadata));
      setLoading(false);
    });
  }, []);

  async function handleUpgrade() {
    setActionLoading(true);
    setToast(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (data.ok && data.url) {
        window.location.href = data.url;
      } else {
        setToast({ kind: "error", text: data.error || "שגיאה ביצירת קישור תשלום" });
      }
    } catch (err) {
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "שגיאה",
      });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleManage() {
    setActionLoading(true);
    setToast(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (data.ok && data.url) {
        window.location.href = data.url;
      } else {
        setToast({ kind: "error", text: data.error || "שגיאה" });
      }
    } catch (err) {
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "שגיאה",
      });
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  const isPro = planStatus.tier === "pro" && planStatus.active;
  const periodEnd = planStatus.currentPeriodEnd
    ? new Date(planStatus.currentPeriodEnd).toLocaleDateString("he-IL")
    : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-sm">
            <CreditCard className="w-5 h-5 text-white" />
          </span>
          חיוב ומסלולים
        </h1>
        <p className="text-sm text-stone-700 mt-2 mr-14">
          {isPro ? "אתה מנוי על Pro" : "המסלול הנוכחי שלך: חינם"}
        </p>
      </div>

      {toast && (
        <div
          className={`flex items-start gap-2 text-sm p-4 rounded-2xl ${
            toast.kind === "success"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
              : "bg-rose-50 border border-rose-200 text-rose-900"
          }`}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-600" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {isPro && (
        <div className="card-soft p-6 bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-md">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-stone-900 text-lg">המנוי שלך פעיל ✨</h2>
              {planStatus.cancelAtPeriodEnd && periodEnd ? (
                <p className="text-sm text-amber-800 mt-1">
                  המנוי בוטל ויסתיים ב-{periodEnd}. עד אז יש לך גישה מלאה ל-Pro.
                </p>
              ) : periodEnd ? (
                <p className="text-sm text-stone-700 mt-1">החיוב הבא: {periodEnd}</p>
              ) : null}
              <button
                onClick={handleManage}
                disabled={actionLoading}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50"
              >
                <ExternalLink className="w-4 h-4" />
                {actionLoading ? "טוען..." : "נהל מנוי / בטל / עדכן כרטיס"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {(["free", "pro"] as const).map((tier) => {
          const plan = PLANS[tier];
          const isCurrent = planStatus.tier === tier && planStatus.active;
          const isProCard = tier === "pro";

          return (
            <div
              key={tier}
              className={`card-soft p-6 relative ${
                isProCard ? "bg-gradient-to-br from-violet-50/50 to-purple-50/50 border-violet-200" : ""
              }`}
            >
              {isProCard && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 inline-flex items-center gap-1 bg-gradient-to-l from-violet-500 to-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-md">
                  <Zap className="w-3 h-3" />
                  מומלץ
                </div>
              )}
              {isCurrent && (
                <div className="absolute top-4 left-4 inline-flex items-center gap-1 bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3 h-3" />
                  המסלול שלך
                </div>
              )}
              <h3 className="font-bold text-stone-900 text-xl">{plan.name}</h3>
              <p className="text-sm text-stone-700 mt-1">{plan.description}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-stone-900">
                  {plan.priceMonthly === 0 ? "חינם" : formatCurrency(plan.priceMonthly)}
                </span>
                {plan.priceMonthly > 0 && (
                  <span className="text-sm text-stone-600">/ חודש</span>
                )}
              </div>
              <ul className="mt-6 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-stone-800">
                    <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-3 h-3 text-emerald-700" />
                    </div>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {!isCurrent && tier === "pro" && (
                <button
                  onClick={handleUpgrade}
                  disabled={actionLoading}
                  className="w-full mt-6 btn-glow inline-flex items-center justify-center gap-2 bg-gradient-to-l from-violet-500 to-purple-500 text-white py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-violet-200/60 disabled:opacity-50 transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  {actionLoading ? "טוען..." : "שדרג ל-Pro"}
                </button>
              )}
              {isCurrent && tier === "free" && (
                <p className="mt-6 text-xs text-center text-stone-600">
                  שדרג ל-Pro כדי לקבל גישה ללא הגבלות
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-center text-stone-500 mt-4">
        תשלום מאובטח דרך Stripe. ניתן לבטל בכל עת.
      </p>
    </div>
  );
}
