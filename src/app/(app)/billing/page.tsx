"use client";

import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";
import { useSearchParams } from "next/navigation";
import {
  CreditCard,
  Check,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  PLANS,
  getPlanStatus,
  TRIAL_DAYS,
  type PlanStatus,
  type PlanTier,
  type BillingInterval,
} from "@/lib/plans";
import { formatCurrency } from "@/lib/format";
import { Modal } from "@/components/ui/modal";
import { Ltr, LtrText } from "@/components/ui/ltr";

export default function BillingPage() {
  const searchParams = useSearchParams();
  const [planStatus, setPlanStatus] = useState<PlanStatus>({ tier: "free", active: true });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<PlanTier | null>(null);
  // Default to yearly: GTM roadmap task 4.4, a single large annual charge best
  // absorbs Grow's fixed ₪59/mo fee, so the annual plan is the recommended default.
  const [interval, setInterval] = useState<BillingInterval>("year");
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  // Confirmation modal: shown when user clicks subscribe, before
  // redirecting to the hosted (Hebrew) checkout page. Sets expectations:
  // a plan summary in Hebrew and what happens after payment.
  const [confirmingTier, setConfirmingTier] = useState<PlanTier | null>(null);
  // Confirmation modal for canceling an active subscription. The user keeps
  // access until the end of the already-paid period.
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    if (searchParams.get("success") === "1") {
      setToast({ kind: "success", text: "🎉 ברוך הבא ל-Pro! התשלום הצליח." });
    } else if (searchParams.get("canceled") === "1") {
      setToast({ kind: "error", text: "התשלום בוטל. תוכל לנסות שוב בכל עת." });
    }
  }, [searchParams]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setPlanStatus(getPlanStatus(user));
      setLoading(false);
    });
  }, []);

  // Step 1: clicking the plan card just opens the confirm modal,
  // the actual checkout call happens inside, after the user reviews
  // the plan + the "next page is in English" notice.
  function handleSubscribe(tier: PlanTier) {
    setToast(null);
    setConfirmingTier(tier);
  }

  // Step 2: user confirmed in the modal, now create the hosted
  // checkout session and redirect to it.
  async function actuallySubscribe(tier: PlanTier) {
    setActionLoading(tier);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tier, interval }),
      });
      const data = await res.json();
      if (data.ok && data.url) {
        track("checkout_started", { tier, interval });
        window.location.href = data.url;
      } else {
        setConfirmingTier(null);
        setToast({ kind: "error", text: data.error || "שגיאה ביצירת קישור תשלום" });
      }
    } catch (err) {
      setConfirmingTier(null);
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "שגיאה",
      });
    } finally {
      setActionLoading(null);
    }
  }

  // Clicking "cancel subscription" just opens the confirm modal; the actual
  // cancel call happens inside, after the user reviews the "you keep access
  // until the end of the paid period" notice.
  function handleManage() {
    setToast(null);
    setConfirmingCancel(true);
  }

  // Rollback path (PAYMENT_PROVIDER=polar): the cancel route refuses with 410,
  // and cancellation is done through Polar's hosted customer portal instead.
  // Returns true if we successfully kicked off the redirect.
  async function redirectToPolarPortal(): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/billing/portal", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const data = await res.json();
    if (data.ok && data.url) {
      window.location.href = data.url;
      return true;
    }
    return false;
  }

  // User confirmed cancellation. Calls the cancel route (Grow path). If it
  // returns 410 we're in the Polar rollback mode; fall back to the hosted
  // portal redirect.
  async function actuallyCancel() {
    setActionLoading("pro");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (res.status === 410) {
        const ok = await redirectToPolarPortal();
        if (!ok) {
          setConfirmingCancel(false);
          setToast({ kind: "error", text: "שגיאה בפתיחת ניהול המנוי" });
        }
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setConfirmingCancel(false);
        setPlanStatus((prev) => ({ ...prev, cancelAtPeriodEnd: true }));
        setToast({
          kind: "success",
          text: "המנוי יבוטל בסוף התקופה. הגישה שלך נשמרת עד אז.",
        });
      } else {
        setConfirmingCancel(false);
        setToast({ kind: "error", text: data.error || "שגיאה" });
      }
    } catch (err) {
      setConfirmingCancel(false);
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "שגיאה",
      });
    } finally {
      setActionLoading(null);
    }
  }

  // Un-do a pending cancellation before the period ends.
  async function handleResume() {
    setActionLoading("pro");
    setToast(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "resume" }),
      });
      if (res.status === 410) {
        const ok = await redirectToPolarPortal();
        if (!ok) setToast({ kind: "error", text: "שגיאה בפתיחת ניהול המנוי" });
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setPlanStatus((prev) => ({ ...prev, cancelAtPeriodEnd: false }));
        setToast({ kind: "success", text: "הביטול בוטל: המנוי ימשיך כרגיל." });
      } else {
        setToast({ kind: "error", text: data.error || "שגיאה" });
      }
    } catch (err) {
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "שגיאה",
      });
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  const isPro = planStatus.tier === "pro" && planStatus.active;
  const isPaying =
    planStatus.active &&
    !planStatus.trialing &&
    planStatus.subscriptionId !== undefined;
  const periodEnd = planStatus.currentPeriodEnd
    ? new Date(planStatus.currentPeriodEnd).toLocaleDateString("he-IL")
    : null;
  const yearlySavings = (priceMonthly: number, priceYearly: number) =>
    Math.round((1 - priceYearly / (priceMonthly * 12)) * 100);

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
          {isPro ? "אתה מנוי על Pro" : "המסלול הנוכחי שלך: בסיסי"}
        </p>
      </div>

      {!isPaying && (
        <div className="flex items-start gap-3 text-sm p-4 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 text-emerald-900">
          <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-600" />
          <div>
            <p className="font-bold">🎉 חינם עכשיו בתקופת ההשקה</p>
            <p className="text-emerald-800/90 mt-0.5">
              כל הפיצ׳רים פתוחים, בלי חיוב ובלי כרטיס אשראי. המחירים המוצגים
              למטה ייכנסו לתוקף בהמשך, ונעדכן מראש, בלי הפתעות.
            </p>
          </div>
        </div>
      )}

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
          <span>
            <LtrText text={toast.text} />
          </span>
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
              {planStatus.cancelAtPeriodEnd ? (
                <>
                  <p className="text-sm text-amber-800 mt-1">
                    {periodEnd
                      ? `המנוי יבוטל ב-${periodEnd}. עד אז יש לך גישה מלאה ל-`
                      : "המנוי יבוטל בסוף התקופה. עד אז יש לך גישה מלאה ל-"}
                    <Ltr>Pro</Ltr>.
                  </p>
                  <button
                    onClick={handleResume}
                    disabled={actionLoading !== null}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                  >
                    <RotateCcw className="w-4 h-4" />
                    {actionLoading !== null ? "טוען..." : "בטל ביטול"}
                  </button>
                </>
              ) : (
                <>
                  {periodEnd && (
                    <p className="text-sm text-stone-700 mt-1">החיוב הבא: {periodEnd}</p>
                  )}
                  <button
                    onClick={handleManage}
                    disabled={actionLoading !== null}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    {actionLoading !== null ? "טוען..." : "ביטול מנוי"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Monthly / Yearly toggle */}
      <div className="flex items-center justify-center">
        <div className="inline-flex items-center bg-white border border-stone-200 rounded-full p-1 shadow-sm">
          <button
            onClick={() => setInterval("month")}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
              interval === "month"
                ? "bg-gradient-to-l from-orange-500 to-rose-500 text-white shadow-sm"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            חודשי
          </button>
          <button
            onClick={() => setInterval("year")}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all flex items-center gap-1.5 ${
              interval === "year"
                ? "bg-gradient-to-l from-orange-500 to-rose-500 text-white shadow-sm"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            שנתי
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                interval === "year" ? "bg-white/25" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              -20%
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {(["free", "pro"] as const).map((tier) => {
          const plan = PLANS[tier];
          const isCurrent = planStatus.tier === tier && planStatus.active;
          const isProCard = tier === "pro";
          const displayPrice = interval === "year" ? plan.priceYearly : plan.priceMonthly;
          const intervalLabel = interval === "year" ? "/ שנה" : "/ חודש";
          const monthlyEquivalent =
            interval === "year" ? Math.round(plan.priceYearly / 12) : null;

          return (
            <div
              key={tier}
              className={`card-soft p-6 relative ${
                isProCard ? "gk-plan-featured bg-gradient-to-br from-violet-50/50 to-purple-50/50 border-violet-200" : ""
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
              <h3 className="font-bold text-stone-900 text-xl">
                <LtrText text={plan.name} />
              </h3>
              <p className="text-sm text-stone-700 mt-1">{plan.description}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-stone-900">
                  {formatCurrency(displayPrice)}
                </span>
                <span className="text-sm text-stone-600">{intervalLabel}</span>
              </div>
              {monthlyEquivalent !== null && (
                <p className="text-xs text-stone-500 mt-1">
                  ({formatCurrency(monthlyEquivalent)} לחודש, נחסך {yearlySavings(plan.priceMonthly, plan.priceYearly)}%)
                </p>
              )}
              <ul className="mt-6 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-stone-800">
                    <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-3 h-3 text-emerald-700" />
                    </div>
                    <span>
                      <LtrText text={f} />
                    </span>
                  </li>
                ))}
              </ul>
              {!isCurrent && (
                <button
                  onClick={() => handleSubscribe(tier)}
                  disabled={actionLoading !== null}
                  className={`w-full mt-6 btn-glow inline-flex items-center justify-center gap-2 text-white py-3 rounded-2xl text-sm font-semibold disabled:opacity-50 transition-all ${
                    isProCard
                      ? "bg-gradient-to-l from-violet-500 to-purple-500 hover:shadow-lg hover:shadow-violet-200/60"
                      : "bg-gradient-to-l from-orange-500 to-rose-500 hover:shadow-lg hover:shadow-orange-200/60"
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  {actionLoading === tier ? (
                    "טוען..."
                  ) : !isPaying ? (
                    `התחל ${TRIAL_DAYS} ימי ניסיון`
                  ) : (
                    <>
                      שדרג ל-
                      <LtrText text={plan.name} />
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-center text-stone-500 mt-4">
        {!isPaying && `${TRIAL_DAYS} ימי ניסיון, ללא חיוב במשך התקופה. `}
        תשלום מאובטח. ניתן לבטל בכל עת.
      </p>

      {/* Confirm-before-redirect modal. Shows a plan summary in Hebrew and
          what happens after payment. The hosted checkout page is in Hebrew,
          so there is no language-switch warning. */}
      <Modal
        open={confirmingTier !== null}
        onClose={() => setConfirmingTier(null)}
        title={
          confirmingTier
            ? `${PLANS[confirmingTier].name}: אישור הזמנה`
            : "אישור הזמנה"
        }
        subtitle={
          interval === "year"
            ? `חיוב שנתי (חיסכון של 20%)`
            : `חיוב חודשי`
        }
        icon={ShieldCheck}
        maxWidth="md"
        footer={
          <div className="flex gap-2 w-full">
            <button
              onClick={() => setConfirmingTier(null)}
              className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-stone-700 hover:bg-white"
            >
              ביטול
            </button>
            <button
              onClick={() => confirmingTier && actuallySubscribe(confirmingTier)}
              disabled={actionLoading !== null}
              className="flex-1 btn-glow inline-flex items-center justify-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200/60 disabled:opacity-50 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              {actionLoading !== null ? "מעביר לתשלום..." : "המשך לתשלום"}
            </button>
          </div>
        }
      >
        {confirmingTier && (
          <div className="space-y-5">
            <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 p-5">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-xs text-stone-700 font-medium">{PLANS[confirmingTier].description}</p>
                  <p className="font-bold text-stone-900 text-xl mt-1">
                    <LtrText text={PLANS[confirmingTier].name} />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-stone-900">
                    {formatCurrency(
                      interval === "year"
                        ? PLANS[confirmingTier].priceYearly
                        : PLANS[confirmingTier].priceMonthly,
                    )}
                  </p>
                  <p className="text-xs text-stone-600">
                    {interval === "year" ? "לשנה" : "לחודש"}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{TRIAL_DAYS} ימי ניסיון: אפס חיוב במשך התקופה הזו</span>
              </div>
            </div>

            <ul className="space-y-2 text-sm">
              {PLANS[confirmingTier].features.slice(0, 4).map((f) => (
                <li key={f} className="flex items-start gap-2 text-stone-800">
                  <Check className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                  <span>
                    <LtrText text={f} />
                  </span>
                </li>
              ))}
            </ul>

            <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 text-sm leading-relaxed">
                  <p className="font-bold text-stone-900">תשלום מאובטח ומעובד בישראל</p>
                  <p className="text-stone-700 mt-1">
                    דף התשלום הבא הוא בעברית ומאובטח לפי תקני הסליקה. שאר
                    האפליקציה נשארת בעברית, וההזמנה שלך תועבר אוטומטית חזרה
                    לאחר התשלום.
                  </p>
                </div>
              </div>
            </div>

            <ul className="text-xs text-stone-600 space-y-1.5">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-stone-400 mt-0.5 flex-shrink-0" />
                ניתן לבטל בכל עת מתוך עמוד "חיוב ומסלולים"
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-stone-400 mt-0.5 flex-shrink-0" />
                החיוב הראשון יתבצע רק לאחר {TRIAL_DAYS} ימי ניסיון
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-stone-400 mt-0.5 flex-shrink-0" />
                חשבונית מס/קבלה תישלח אוטומטית לאחר כל חיוב
              </li>
            </ul>
          </div>
        )}
      </Modal>

      {/* Cancel-confirmation modal. Cancellation is not immediate; the user
          keeps full access until the end of the period they already paid for. */}
      <Modal
        open={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
        title="ביטול מנוי"
        subtitle="הגישה נשמרת עד סוף התקופה"
        icon={XCircle}
        maxWidth="sm"
        footer={
          <div className="flex gap-2 w-full">
            <button
              onClick={() => setConfirmingCancel(false)}
              disabled={actionLoading !== null}
              className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-stone-700 hover:bg-white disabled:opacity-50"
            >
              להשאיר את המנוי
            </button>
            <button
              onClick={actuallyCancel}
              disabled={actionLoading !== null}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-l from-rose-500 to-red-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-rose-200/60 disabled:opacity-50 transition-all"
            >
              <XCircle className="w-4 h-4" />
              {actionLoading !== null ? "מבטל..." : "כן, לבטל"}
            </button>
          </div>
        }
      >
        <p className="text-sm text-stone-800 leading-relaxed">
          לבטל את המנוי? תישאר לך גישה עד סוף התקופה שכבר שולמה. תמיד אפשר לחדש
          לפני שהתקופה נגמרת.
        </p>
      </Modal>
    </div>
  );
}
