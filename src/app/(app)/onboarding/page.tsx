"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Building2,
  Users,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  SkipForward,
} from "lucide-react";
import { useBusiness, saveBusiness } from "@/lib/business-store";
import { clientStore } from "@/lib/client-store";
import { supabase } from "@/lib/supabase";
import type { Business, Client } from "@/lib/types";

type Step = "welcome" | "business" | "client" | "done";

export default function OnboardingPage() {
  const router = useRouter();
  const { business } = useBusiness();
  const [step, setStep] = useState<Step>("welcome");
  const [saving, setSaving] = useState(false);

  const [bizForm, setBizForm] = useState({
    name: business.name === "העסק שלי" ? "" : business.name,
    businessType: business.businessType,
    taxId: business.taxId === "000000000" ? "" : business.taxId,
    address: business.address,
    phone: business.phone || "",
    email: business.email || "",
  });

  const [clientForm, setClientForm] = useState({
    name: "",
    taxId: "",
    email: "",
    phone: "",
  });

  async function saveBusinessAndAdvance() {
    if (!bizForm.name.trim() || !bizForm.taxId.trim()) return;
    setSaving(true);
    try {
      await saveBusiness({
        ...business,
        name: bizForm.name.trim(),
        businessType: bizForm.businessType as Business["businessType"],
        taxId: bizForm.taxId.trim(),
        address: bizForm.address.trim(),
        phone: bizForm.phone.trim() || undefined,
        email: bizForm.email.trim() || undefined,
      });
      setStep("client");
    } finally {
      setSaving(false);
    }
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
        createdAt: new Date().toISOString().slice(0, 10),
      };
      await clientStore.save(client);
      setStep("done");
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    await supabase.auth.updateUser({ data: { onboarded: true } });
    router.push("/dashboard");
  }

  const stepIndex = ["welcome", "business", "client", "done"].indexOf(step);
  const stepLabels = ["ברוכים הבאים", "פרטי העסק", "לקוח ראשון", "סיום"];
  const totalSteps = stepLabels.length;
  const currentStepNumber = stepIndex + 1;
  const progressPercent = ((stepIndex + 1) / totalSteps) * 100;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-stone-700">
              שלב <span className="text-orange-600">{currentStepNumber}</span> מתוך {totalSteps}
            </p>
            <p className="text-xs font-semibold text-stone-900">{stepLabels[stepIndex]}</p>
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
                בוא נכין את החשבון שלך ב-3 שלבים מהירים. זה ייקח פחות מדקה.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
                <button
                  onClick={() => setStep("business")}
                  className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3.5 rounded-2xl text-base font-semibold cursor-pointer hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all duration-200"
                >
                  בוא נתחיל
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={finish}
                  className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-6 py-3.5 rounded-2xl text-base font-semibold cursor-pointer hover:bg-orange-50 hover:border-orange-300 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm transition-all duration-200"
                >
                  <SkipForward className="w-4 h-4" />
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
                    value={bizForm.name}
                    onChange={(e) => setBizForm({ ...bizForm, name: e.target.value })}
                    placeholder="העסק שלי בע״מ"
                    className="input-warm"
                    autoFocus
                  />
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
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">
                      מספר עוסק / ח.פ *
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={bizForm.taxId}
                      onChange={(e) => setBizForm({ ...bizForm, taxId: e.target.value })}
                      placeholder="123456789"
                      className="input-warm"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-stone-700 mb-1 block">כתובת</label>
                  <input
                    type="text"
                    value={bizForm.address}
                    onChange={(e) => setBizForm({ ...bizForm, address: e.target.value })}
                    placeholder="רחוב, מספר, עיר"
                    className="input-warm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">טלפון</label>
                    <input
                      type="tel"
                      dir="ltr"
                      value={bizForm.phone}
                      onChange={(e) => setBizForm({ ...bizForm, phone: e.target.value })}
                      placeholder="050-1234567"
                      className="input-warm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">
                      אימייל
                    </label>
                    <input
                      type="email"
                      dir="ltr"
                      value={bizForm.email}
                      onChange={(e) => setBizForm({ ...bizForm, email: e.target.value })}
                      placeholder="contact@business.com"
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
                  disabled={!bizForm.name.trim() || !bizForm.taxId.trim() || saving}
                  className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:shadow-md hover:shadow-orange-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {saving ? "שומר..." : "המשך"}
                  <ArrowLeft className="w-4 h-4" />
                </button>
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
                    value={clientForm.name}
                    onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                    placeholder="חברת אלפא בע״מ"
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
                      dir="ltr"
                      value={clientForm.taxId}
                      onChange={(e) => setClientForm({ ...clientForm, taxId: e.target.value })}
                      placeholder="514123456"
                      className="input-warm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-700 mb-1 block">טלפון</label>
                    <input
                      type="tel"
                      dir="ltr"
                      value={clientForm.phone}
                      onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                      placeholder="050-1234567"
                      className="input-warm"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-stone-700 mb-1 block">אימייל</label>
                  <input
                    type="email"
                    dir="ltr"
                    value={clientForm.email}
                    onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                    placeholder="contact@company.com"
                    className="input-warm"
                  />
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
                    onClick={() => setStep("done")}
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
                החשבון שלך מוכן לשימוש. עכשיו אפשר להתחיל להפיק חשבוניות וקבלות.
              </p>
              <button
                onClick={finish}
                className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3.5 rounded-2xl text-base font-semibold hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all mt-8"
              >
                לדשבורד
                <ArrowRight className="w-4 h-4 rotate-180" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
