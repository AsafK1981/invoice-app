"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Building2,
  Users,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  SkipForward,
  Palette,
} from "lucide-react";
import { track } from "@vercel/analytics";
import { useBusiness, saveBusiness } from "@/lib/business-store";
import { clientStore } from "@/lib/client-store";
import { supabase } from "@/lib/supabase";
import { BusinessTypeHint } from "@/components/business-type-hint";
import { todayInIsrael } from "@/lib/date";
import {
  suggestTemplateForBusinessType,
  getTemplate,
  ACCENT_HEX,
  type TemplateId,
} from "@/lib/document-themes";
import type { Business, Client } from "@/lib/types";

type Step = "welcome" | "business" | "design" | "client" | "done";

export default function OnboardingPage() {
  const router = useRouter();
  const { business, ready } = useBusiness();
  const [step, setStep] = useState<Step>("welcome");
  const [saving, setSaving] = useState(false);

  const [bizForm, setBizForm] = useState({
    name: business.name === "העסק שלי" ? "" : business.name,
    businessType: business.businessType,
    taxId: business.taxId === "000000000" ? "" : business.taxId,
    address: business.address,
    phone: business.phone || "",
    email: business.email || "",
    // Free-text profession hint, used ONLY client-side to suggest a document
    // design template (see suggestTemplateForBusinessType). Deliberately not
    // persisted as its own DB column: it drives a one-tap suggestion, not a
    // stored business attribute, so no schema change is needed for it.
    profession: "",
  });

  const [clientForm, setClientForm] = useState({
    name: "",
    taxId: "",
    email: "",
    phone: "",
  });

  // First-time-setup prefill: if the business record has no email yet (i.e.
  // this is a brand-new business, not one being re-edited), offer the
  // authenticated user's own account email as a starting point. Never
  // overwrites a value the user already typed (checked again inside the
  // functional update, since the auth call resolves asynchronously) or an
  // email already saved on the business.
  useEffect(() => {
    if (!ready || business.email) return;
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (cancelled || !user?.email) return;
        setBizForm((f) => (f.email ? f : { ...f, email: user.email! }));
      })
      // Best-effort prefill: on a dropped connection this rejects, and without
      // a catch it surfaced as an unhandled rejection (see the note in
      // `finish`). Failing to prefill one field is not worth an error.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready, business.email]);

  // The exact object saved to the DB by saveBusinessAndAdvance. The `design`
  // step's "use this design" action needs to merge document_design onto the
  // business record — but the `business` value from useBusiness() only
  // refreshes asynchronously after a save (it refetches on a window event),
  // so reading it back immediately after saveBusinessAndAdvance could still
  // see the pre-save snapshot and silently revert the fields the user just
  // typed. This ref-like snapshot is always the freshest known-good state.
  const [savedBusiness, setSavedBusiness] = useState<Business | null>(null);

  // Whether the optional "design" step is inserted into the flow. Decided
  // once, when advancing past the business step (not recomputed on every
  // keystroke), so the progress bar's step count doesn't jitter while the
  // user is still typing their profession.
  const [includeDesignStep, setIncludeDesignStep] = useState(false);

  const suggestedTemplateId: TemplateId = useMemo(
    () => suggestTemplateForBusinessType(bizForm.profession),
    [bizForm.profession],
  );
  const suggestedTemplate = getTemplate(suggestedTemplateId);
  const suggestedAccent = ACCENT_HEX[suggestedTemplate.accent];

  // Only the business NAME is required to move on. The tax ID used to be
  // required here too, and it was the single biggest hole in the funnel: of the
  // real external signups, the ones who never issued anything left within the
  // same MINUTE they signed up, on this screen. Most people do not know their
  // מספר עוסק by heart - it is in a drawer - so "I'll find it and come back"
  // became never coming back. Nothing is lost by deferring it: receipt-editor
  // already hard-gates issuing a legal document while the profile is still
  // placeholder (isPlaceholderBusinessTaxId), and drafts are exempt by design.
  // So the number is now collected at the moment it actually matters.
  async function saveBusinessAndAdvance() {
    if (!bizForm.name.trim()) return;
    setSaving(true);
    try {
      const merged: Business = {
        ...business,
        name: bizForm.name.trim(),
        businessType: bizForm.businessType as Business["businessType"],
        taxId: bizForm.taxId.trim(),
        address: bizForm.address.trim(),
        phone: bizForm.phone.trim() || undefined,
        email: bizForm.email.trim() || undefined,
      };
      await saveBusiness(merged);
      setSavedBusiness(merged);

      // Only offer the design suggestion when it's a confident match (not
      // 'general' — never nudge a user who gave no usable signal) AND the
      // business hasn't already picked a design (respects "existing users
      // keep gold unless they choose"; here that means don't second-guess a
      // choice already on the record).
      const showDesign = suggestedTemplateId !== "general" && !business.documentDesign;
      setIncludeDesignStep(showDesign);
      setStep(showDesign ? "design" : "client");
    } finally {
      setSaving(false);
    }
  }

  async function applyDesignSuggestion() {
    setSaving(true);
    try {
      const base = savedBusiness ?? business;
      await saveBusiness({
        ...base,
        documentDesign: {
          template: suggestedTemplate.id,
          accent: suggestedTemplate.accent,
          font: suggestedTemplate.font,
          logoPosition: "right",
        },
      });
      track("onboarding_design_suggestion_accepted", { template: suggestedTemplate.id });
      setStep("client");
    } finally {
      setSaving(false);
    }
  }

  function skipDesignSuggestion() {
    track("onboarding_design_suggestion_skipped", { template: suggestedTemplate.id });
    setStep("client");
  }

  async function saveClientAndAdvance() {
    if (!clientForm.name.trim()) {
      setStep("done");
      return;
    }
    setSaving(true);
    try {
      const client: Client = {
        id: crypto.randomUUID(),
        name: clientForm.name.trim(),
        taxId: clientForm.taxId.trim() || undefined,
        email: clientForm.email.trim() || undefined,
        phone: clientForm.phone.trim() || undefined,
        createdAt: todayInIsrael(),
      };
      await clientStore.save(client);
      setStep("done");
    } finally {
      setSaving(false);
    }
  }

  async function finish(target: "dashboard" | "new-doc" = "new-doc") {
    // The onboarded flag is a convenience, not a gate, so a failed write must
    // never trap the user on this screen. It used to: `finish` is called bare
    // from three onClick handlers, so when this await rejected the rejection
    // escaped unhandled and the button simply did nothing - no navigation, no
    // message - at the very end of onboarding. Seen in production on iOS
    // 2026-08-15 (Sentry: "TypeError: Load failed", mechanism
    // onunhandledrejection, transaction /onboarding), which is what a dropped
    // mobile connection looks like in WebKit.
    // Worst case now: the flag is not set and the user sees onboarding once
    // more. That is strictly better than a dead button.
    try {
      await supabase.auth.updateUser({ data: { onboarded: true } });
    } catch {
      // deliberately swallowed - the navigation below matters more
    }
    track("onboarding_complete");
    router.push(target === "new-doc" ? "/documents/new" : "/dashboard");
  }

  const stepOrder: Step[] = includeDesignStep
    ? ["welcome", "business", "design", "client", "done"]
    : ["welcome", "business", "client", "done"];
  const stepLabels = includeDesignStep
    ? ["ברוכים הבאים", "פרטי העסק", "עיצוב מסמכים", "לקוח ראשון", "סיום"]
    : ["ברוכים הבאים", "פרטי העסק", "לקוח ראשון", "סיום"];
  const stepIndex = stepOrder.indexOf(step);
  const totalSteps = stepLabels.length;
  const currentStepNumber = stepIndex + 1;
  const progressPercent = ((stepIndex + 1) / totalSteps) * 100;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8">
          <div className="mb-3">
            <p className="text-xs font-semibold text-stone-700">
              שלב <span className="text-orange-600">{currentStepNumber}</span> מתוך {totalSteps}
            </p>
          </div>
          <div className="h-2 bg-orange-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-l from-orange-500 to-rose-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            {stepLabels.map((label, idx) => (
              <div
                key={label}
                className={`flex items-center gap-1.5 text-xs ${
                  idx <= stepIndex ? "text-orange-700 font-semibold" : "text-stone-400"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                    idx < stepIndex
                      ? "bg-gradient-to-br from-orange-500 to-rose-500 text-white"
                      : idx === stepIndex
                      ? "bg-gradient-to-br from-orange-500 to-rose-500 text-white ring-4 ring-orange-200"
                      : "bg-orange-100 text-stone-500"
                  }`}
                >
                  {idx < stepIndex ? "✓" : idx + 1}
                </div>
                <span className="hidden sm:inline">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card-soft p-8 sm:p-10 animate-fade-in-up">
          {step === "welcome" && (
            <div className="text-center">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center mx-auto shadow-xl shadow-orange-200/50 btn-glow mb-6">
                <Sparkles className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-stone-900">ברוכים הבאים! 👋</h1>
              <p className="text-stone-700 mt-3 max-w-md mx-auto">
                {/* "עוד שלושה" and not "שלושה": the progress bar directly above
                    this line reads "שלב 1 מתוך 4" and counts this welcome screen
                    as the first step, so a bare "3 שלבים" contradicts it in the
                    first thing a new user reads. */}
                עוד שלושה צעדים קצרים והחשבון שלך מוכן. זה ייקח פחות מדקה.
              </p>
              <div className="flex flex-col items-center gap-4 mt-8">
                <button
                  onClick={() => setStep("business")}
                  className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3.5 rounded-2xl text-base font-semibold cursor-pointer hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all duration-200"
                >
                  בוא נתחיל
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    track("onboarding_skipped", { step: "welcome" });
                    finish("dashboard");
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-orange-700 underline decoration-stone-300 hover:decoration-orange-500 underline-offset-4 cursor-pointer transition-colors"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  דלג ישר לאפליקציה
                </button>
              </div>
            </div>
          )}

          {step === "business" && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center shadow-md">
                  <Building2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-stone-900">פרטי העסק שלך</h2>
                  <p className="text-sm text-stone-700">פרטים אלה יופיעו על כל מסמך שתפיק</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-stone-700 mb-1 block">
                    שם העסק *
                  </label>
                  <input
                    type="text"
                    name="organization"
                    value={bizForm.name}
                    onChange={(e) => setBizForm({ ...bizForm, name: e.target.value })}
                    placeholder="העסק שלי בע״מ"
                    autoComplete="organization"
                    className="input-warm"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-stone-700 mb-1 block">
                    תחום העיסוק (אופציונלי)
                  </label>
                  <input
                    type="text"
                    name="organization-title"
                    value={bizForm.profession}
                    onChange={(e) => setBizForm({ ...bizForm, profession: e.target.value })}
                    placeholder="לדוגמה: מטפל/ת, מעצב/ת גרפי/ת, חשמלאי, רואה חשבון..."
                    autoComplete="organization-title"
                    className="input-warm"
                  />
                  <p className="text-[11px] text-stone-500 mt-1">
                    עוזר לנו להציע עיצוב מסמכים שמתאים לתחום שלך. אפשר לדלג ולבחור עיצוב בכל שלב
                    מההגדרות.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">
                      סוג עוסק *
                    </label>
                    <select
                      value={bizForm.businessType}
                      onChange={(e) =>
                        setBizForm({
                          ...bizForm,
                          businessType: e.target.value as Business["businessType"],
                        })
                      }
                      className="input-warm"
                    >
                      <option value="exempt">עוסק פטור</option>
                      <option value="authorized">עוסק מורשה</option>
                      <option value="company">חברה בע״מ</option>
                    </select>
                    <BusinessTypeHint type={bizForm.businessType} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">
                      מספר עוסק / ח.פ
                    </label>
                    <input
                      type="text"
                      name="tax-id"
                      dir="ltr"
                      value={bizForm.taxId}
                      onChange={(e) => setBizForm({ ...bizForm, taxId: e.target.value })}
                      placeholder="123456789"
                      autoComplete="on"
                      className="input-warm"
                    />
                    <p className="text-[11px] text-stone-500 mt-1">
                      לא זוכר? אפשר להמשיך בלי, נבקש את זה כשתפיק מסמך רשמי.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-stone-700 mb-1 block">כתובת</label>
                  <input
                    type="text"
                    name="street-address"
                    value={bizForm.address}
                    onChange={(e) => setBizForm({ ...bizForm, address: e.target.value })}
                    placeholder="רחוב, מספר, עיר"
                    autoComplete="street-address"
                    className="input-warm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">טלפון</label>
                    <input
                      type="tel"
                      name="tel"
                      dir="ltr"
                      value={bizForm.phone}
                      onChange={(e) => setBizForm({ ...bizForm, phone: e.target.value })}
                      placeholder="050-1234567"
                      autoComplete="tel"
                      className="input-warm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">
                      אימייל
                    </label>
                    <input
                      type="email"
                      name="email"
                      dir="ltr"
                      value={bizForm.email}
                      onChange={(e) => setBizForm({ ...bizForm, email: e.target.value })}
                      placeholder="contact@business.com"
                      autoComplete="email"
                      className="input-warm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-8">
                <button
                  onClick={() => setStep("welcome")}
                  className="text-sm text-stone-600 hover:text-stone-900 px-4 py-2"
                >
                  חזרה
                </button>
                <button
                  onClick={saveBusinessAndAdvance}
                  disabled={!bizForm.name.trim() || saving}
                  className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:shadow-md hover:shadow-orange-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {saving ? "שומר..." : "המשך"}
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === "design" && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-md flex-shrink-0"
                  style={{ background: suggestedAccent.grad }}
                >
                  <Palette className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-stone-900">התאמנו לך עיצוב מסמכים</h2>
                  <p className="text-sm text-stone-700">
                    בהתאם לתחום שציינת, אפשר לשנות בכל שלב מההגדרות
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border-2 border-stone-200 bg-white overflow-hidden shadow-sm">
                <div className="h-3" style={{ background: suggestedAccent.grad }} aria-hidden="true" />
                <div className="p-5 flex items-center gap-3">
                  <span
                    className="w-6 h-6 rounded-full flex-shrink-0 shadow-sm"
                    style={{ background: suggestedAccent.accent }}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-semibold text-stone-900">{suggestedTemplate.label}</p>
                    <p className="text-xs text-stone-600 mt-0.5">
                      תבנית עם צבעים, פונט ועיצוב שמתאימים לתחום שלך. משפיע רק על מסמכים חדשים.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-8">
                <button
                  onClick={() => setStep("business")}
                  className="text-sm text-stone-600 hover:text-stone-900 px-4 py-2"
                >
                  חזרה
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={skipDesignSuggestion}
                    className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900 px-3 py-2.5"
                  >
                    בחירת עיצוב אחר
                  </button>
                  <button
                    onClick={applyDesignSuggestion}
                    disabled={saving}
                    className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:shadow-md hover:shadow-orange-200 disabled:opacity-50 transition-all"
                  >
                    {saving ? "שומר..." : "השתמשו בעיצוב הזה"}
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "client" && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-md">
                  <Users className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-stone-900">הוסף את הלקוח הראשון</h2>
                  <p className="text-sm text-stone-700">תוכל להוסיף עוד לקוחות בהמשך</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-stone-700 mb-1 block">שם הלקוח</label>
                  <input
                    type="text"
                    name="name"
                    value={clientForm.name}
                    onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                    placeholder="חברת אלפא בע״מ"
                    autoComplete="name"
                    className="input-warm"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">
                      ח.פ / ת.ז
                    </label>
                    <input
                      type="text"
                      name="tax-id"
                      dir="ltr"
                      value={clientForm.taxId}
                      onChange={(e) => setClientForm({ ...clientForm, taxId: e.target.value })}
                      placeholder="514123456"
                      autoComplete="on"
                      className="input-warm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">טלפון</label>
                    <input
                      type="tel"
                      name="tel"
                      dir="ltr"
                      value={clientForm.phone}
                      onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                      placeholder="050-1234567"
                      autoComplete="tel"
                      className="input-warm"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-stone-700 mb-1 block">אימייל</label>
                  <input
                    type="email"
                    name="email"
                    dir="ltr"
                    value={clientForm.email}
                    onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                    placeholder="contact@company.com"
                    autoComplete="email"
                    className="input-warm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between mt-8">
                <button
                  onClick={() => setStep(includeDesignStep ? "design" : "business")}
                  className="text-sm text-stone-600 hover:text-stone-900 px-4 py-2"
                >
                  חזרה
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      track("onboarding_skipped", { step: "client" });
                      setStep("done");
                    }}
                    className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900 px-3 py-2.5"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    דלג
                  </button>
                  <button
                    onClick={saveClientAndAdvance}
                    disabled={saving}
                    className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:shadow-md hover:shadow-orange-200 disabled:opacity-50 transition-all"
                  >
                    {saving ? "שומר..." : "המשך"}
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="text-center">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mx-auto shadow-xl shadow-emerald-200/50 mb-6">
                <CheckCircle2 className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-stone-900">הכל מוכן! 🎉</h1>
              <p className="text-stone-700 mt-3 max-w-md mx-auto">
                החשבון שלך מוכן לשימוש. בוא נפיק את המסמך הראשון.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => finish("new-doc")}
                  className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3.5 rounded-2xl text-base font-semibold hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all"
                >
                  צור מסמך ראשון
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
                <button
                  onClick={() => finish("dashboard")}
                  className="inline-flex items-center gap-2 text-stone-700 hover:text-orange-700 px-4 py-3 text-sm font-medium"
                >
                  אולי אחר כך, למסך הראשי
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
