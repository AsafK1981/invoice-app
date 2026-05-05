"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  ReceiptText,
  Users,
  TrendingUp,
  Mail,
  FileText,
  Wallet,
  Zap,
  Shield,
  Globe,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Search,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function LandingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        router.replace("/dashboard");
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50">
        <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-xl shadow-orange-200/50 animate-pulse">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
      </div>
    );
  }

  const features = [
    {
      icon: ReceiptText,
      title: "קבלות וחשבוניות",
      desc: "הפק קבלות, חשבונות עסקה וחשבוניות מס בלחיצה אחת. PDF מוכן לשליחה.",
      gradient: "from-emerald-400 to-teal-500",
      bgTint: "from-emerald-50 to-teal-50",
    },
    {
      icon: Mail,
      title: "שליחה אוטומטית",
      desc: "המסמכים נשלחים אוטומטית במייל ללקוח עם קישור לצפייה.",
      gradient: "from-rose-400 to-pink-500",
      bgTint: "from-rose-50 to-pink-50",
    },
    {
      icon: Users,
      title: "ניהול לקוחות",
      desc: "כל הלקוחות, המוצרים והשירותים שלך במקום אחד. חיפוש מהיר ויבוא מקובץ.",
      gradient: "from-violet-400 to-purple-500",
      bgTint: "from-violet-50 to-purple-50",
    },
    {
      icon: TrendingUp,
      title: "דשבורד עם גרפים",
      desc: "ראה את ההכנסות וההוצאות שלך לאורך זמן. גרף לקוחות מובילים.",
      gradient: "from-amber-400 to-orange-500",
      bgTint: "from-amber-50 to-orange-50",
    },
    {
      icon: FileText,
      title: "דו״חות לרו״ח",
      desc: "ייצוא לאקסל. סיכום שנתי, חודשי, רבעוני, ודיווח מע״מ — הכל מוכן.",
      gradient: "from-sky-400 to-blue-500",
      bgTint: "from-sky-50 to-blue-50",
    },
    {
      icon: Wallet,
      title: "מעקב הוצאות",
      desc: "תעד הוצאות עסקיות לפי קטגוריות. חישוב רווח נטו אוטומטי.",
      gradient: "from-stone-400 to-stone-600",
      bgTint: "from-stone-50 to-stone-100",
    },
  ];

  const steps = [
    {
      n: "01",
      icon: Users,
      title: "הוסף לקוח",
      desc: "שם, אימייל וח.פ. לא חייב הכל בהתחלה — אפשר להוסיף תוך כדי.",
    },
    {
      n: "02",
      icon: ReceiptText,
      title: "הפק מסמך",
      desc: "בחר סוג, תאר את השירות, הזן סכום. המספור רץ אוטומטי.",
    },
    {
      n: "03",
      icon: Mail,
      title: "שלח ללקוח",
      desc: "לחיצה אחת. הלקוח מקבל מייל עם PDF וקישור לצפייה. אתה רואה שהוא נשלח.",
    },
  ];

  const pricingPoints = [
    "כל הפיצ'רים ללא הגבלה",
    "ללא מגבלה על מספר חשבוניות או לקוחות",
    "PDF להדפסה והורדה",
    "שליחה במייל ללקוח",
    "גיבוי ענן אוטומטי",
    "תמיכה לעוסק פטור ועוסק מורשה",
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50">
      <header className="px-6 py-5 flex items-center justify-between max-w-7xl mx-auto relative z-20">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-md shadow-orange-200">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-stone-900">MySuperFriendlyInvoiceApp</span>
        </div>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-orange-50 transition-all"
        >
          התחבר
        </Link>
      </header>

      {/* HERO */}
      <section className="landing-decor max-w-7xl mx-auto px-6 pt-12 pb-12 relative">
        <div className="blob blob-1" aria-hidden />
        <div className="blob blob-2" aria-hidden />
        <div className="blob blob-3" aria-hidden />
        <div className="grid-pattern" aria-hidden />

        <div className="animate-fade-in-up max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 bg-white/80 backdrop-blur border border-orange-200 rounded-full px-4 py-1.5 mb-6 text-xs font-semibold text-orange-700 shadow-sm">
            <Sparkles className="w-3 h-3" />
            הדרך הכי פשוטה לנהל חשבוניות
          </div>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold text-stone-900 leading-[1.1] tracking-tight">
            חשבוניות וקבלות
            <br />
            <span className="bg-gradient-to-l from-orange-500 via-rose-500 to-pink-500 bg-clip-text text-transparent">
              בלי כאב ראש
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-stone-700 mt-6 max-w-2xl mx-auto leading-relaxed">
            אפליקציה לעצמאיים בישראל. הפק קבלות וחשבוניות, נהל לקוחות, שלח במייל — הכל בעברית, חינם, ובלי גבולות.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-10">
            <Link
              href="/login"
              className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-7 py-4 rounded-2xl text-base font-semibold hover:shadow-xl hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all duration-200"
            >
              <Sparkles className="w-4 h-4" />
              התחל בחינם
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-1 text-sm text-stone-700 hover:text-orange-700 font-semibold px-4 py-3"
            >
              למד עוד
              <ArrowLeft className="w-4 h-4" />
            </a>
          </div>

          <div className="mt-8 flex items-center justify-center gap-4 text-xs text-stone-600 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              ללא כרטיס אשראי
            </span>
            <span className="text-stone-400">·</span>
            <span className="inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              עברית מלאה
            </span>
            <span className="text-stone-400">·</span>
            <span className="inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              עוסק פטור / מורשה
            </span>
          </div>
        </div>

        {/* PRODUCT MOCKUP — the centerpiece. Stylized "browser frame"
            wrapping a real-looking invoice page. Tells visitors exactly
            what they're getting in 2 seconds, way better than any
            description. */}
        <div className="mt-16 max-w-5xl mx-auto animate-fade-in-up stagger-3">
          <div className="rounded-3xl bg-white border border-orange-200 shadow-2xl shadow-orange-200/40 overflow-hidden">
            {/* Browser chrome */}
            <div className="flex items-center gap-3 px-5 py-3 bg-stone-50 border-b border-stone-200">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-rose-300" />
                <span className="w-3 h-3 rounded-full bg-amber-300" />
                <span className="w-3 h-3 rounded-full bg-emerald-300" />
              </div>
              <div className="flex-1 max-w-md mx-auto bg-white border border-stone-200 rounded-lg px-3 py-1 text-xs text-stone-500 text-center font-mono" dir="ltr">
                mysuperfriendlyinvoiceapp.vercel.app/documents/1042
              </div>
              <div className="w-6" />
            </div>

            {/* App content area */}
            <div className="p-5 sm:p-8 bg-gradient-to-br from-orange-50/40 to-rose-50/30">
              {/* Mock action bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="text-xs text-stone-600 inline-flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" />
                  חזרה למסמכים
                </div>
                <div className="flex items-center gap-2">
                  <div className="hidden sm:inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1.5 rounded-lg text-xs font-semibold">
                    <RefreshCw className="w-3 h-3" />
                    המר לקבלה
                  </div>
                  <div className="inline-flex items-center gap-1.5 bg-white border border-orange-200 text-stone-800 px-2.5 py-1.5 rounded-lg text-xs font-semibold">
                    <Mail className="w-3 h-3" />
                    מייל
                  </div>
                  <div className="inline-flex items-center gap-1.5 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm">
                    הורד PDF
                  </div>
                </div>
              </div>

              {/* Status pill */}
              <div className="bg-white rounded-xl border border-emerald-200 p-3 mb-3 flex items-center gap-3 shadow-sm">
                <div className="w-9 h-9 rounded-2xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-stone-900">המסמך נשלח במייל ✓</p>
                  <p className="text-xs text-stone-600">04.05.2026 · ל-asaf@example.com</p>
                </div>
              </div>

              {/* Invoice */}
              <div className="bg-white rounded-2xl border border-stone-200 p-6 sm:p-8 shadow-lg">
                <div className="flex items-start justify-between pb-5 border-b-2 border-orange-400 gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-400 flex items-center justify-center shadow-md">
                        <Sparkles className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-xl sm:text-2xl font-bold text-stone-900">אסף קוטלר</h3>
                        <p className="text-xs text-stone-700">עוסק פטור · 049040686</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="inline-block px-3 py-1.5 bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-xl font-bold text-sm">
                      חשבון עסקה
                    </div>
                    <p className="text-lg font-bold text-stone-900 mt-2">#1042</p>
                    <p className="text-[10px] text-stone-600">תאריך: 04.05.2026</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-5 text-xs">
                  <div>
                    <p className="text-stone-500 uppercase font-semibold mb-1 text-[10px]">ללקוח</p>
                    <p className="font-bold text-stone-900">דנה לוי</p>
                    <p className="text-stone-700">ח.פ: 12345678</p>
                  </div>
                  <div>
                    <p className="text-stone-500 uppercase font-semibold mb-1 text-[10px]">נושא</p>
                    <p className="text-stone-800">ייעוץ דיגיטלי — אפריל 2026</p>
                  </div>
                </div>

                <div className="mt-5 border border-stone-100 rounded-xl overflow-hidden">
                  <div className="bg-orange-50 px-4 py-2 grid grid-cols-12 gap-2 text-[10px] font-semibold text-stone-700">
                    <div className="col-span-7">תיאור</div>
                    <div className="col-span-2 text-center">כמות</div>
                    <div className="col-span-3 text-left">סה״כ</div>
                  </div>
                  <div className="px-4 py-3 grid grid-cols-12 gap-2 text-xs text-stone-800 border-t border-stone-100">
                    <div className="col-span-7">שעות ייעוץ — אפריל</div>
                    <div className="col-span-2 text-center">10</div>
                    <div className="col-span-3 text-left font-semibold" dir="ltr">₪ 4,650</div>
                  </div>
                </div>

                <div className="flex justify-end mt-4">
                  <div className="bg-gradient-to-l from-orange-50 to-rose-50 border border-orange-200 rounded-xl px-5 py-3">
                    <p className="text-[10px] text-stone-600 font-semibold">סה״כ לתשלום</p>
                    <p className="text-2xl font-bold text-stone-900" dir="ltr">₪ 4,650</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Caption under the mockup */}
          <p className="text-center text-xs text-stone-500 mt-4">
            ככה נראית חשבונית שיוצאת מהאפליקציה — נקייה, מקצועית, מוכנה לשלוח.
          </p>
        </div>
      </section>

      {/* HOW IT WORKS — 3 steps with rhythm */}
      <section className="bg-white/60 backdrop-blur border-y border-orange-100/60">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold text-orange-700 uppercase tracking-wider mb-2">איך זה עובד</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">חשבונית מוכנה תוך 30 שניות</h2>
            <p className="text-stone-700 mt-3 max-w-md mx-auto">
              שלושה שלבים. בלי מדריכים, בלי קורסים, בלי מפתח רואה חשבון.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            {steps.map((s, idx) => {
              const Icon = s.icon;
              return (
                <div key={s.n} className="relative">
                  <div className="card-soft p-6 h-full bg-white">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-md shadow-orange-200/50 flex-shrink-0">
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                      <span className="text-3xl font-bold text-orange-200 leading-none">{s.n}</span>
                    </div>
                    <h3 className="font-bold text-stone-900 mt-2">{s.title}</h3>
                    <p className="text-sm text-stone-700 mt-2 leading-relaxed">{s.desc}</p>
                  </div>
                  {idx < steps.length - 1 && (
                    <ArrowLeft className="hidden md:block absolute top-1/2 -translate-y-1/2 -left-4 w-6 h-6 text-orange-300" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-12 animate-fade-in-up">
          <p className="text-xs font-semibold text-orange-700 uppercase tracking-wider mb-2">פיצ׳רים</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">כל מה שצריך, במקום אחד</h2>
          <p className="text-stone-700 mt-3 max-w-md mx-auto">
            פיצ׳רים שתוכננו במיוחד לעצמאיים בישראל — לא תרגום קלוקל מ-Quickbooks.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, idx) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className={`card-soft p-6 hover:shadow-xl hover:-translate-y-1 transition-all animate-fade-in-up stagger-${(idx % 6) + 1} bg-gradient-to-br ${f.bgTint} border-transparent relative overflow-hidden group`}
              >
                {/* Subtle decorative blob in card corner */}
                <div className={`absolute -top-8 -left-8 w-24 h-24 rounded-full bg-gradient-to-br ${f.gradient} opacity-10 blur-2xl group-hover:opacity-20 transition-opacity`} aria-hidden />
                <div
                  className={`relative w-12 h-12 rounded-2xl bg-gradient-to-br ${f.gradient} flex items-center justify-center shadow-md`}
                >
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-bold text-stone-900 mt-4 relative">{f.title}</h3>
                <p className="text-sm text-stone-700 mt-2 leading-relaxed relative">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* TRUST */}
      <section className="bg-white/60 backdrop-blur border-y border-orange-100/60">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center mx-auto shadow-sm">
                <Shield className="w-7 h-7 text-emerald-700" />
              </div>
              <h3 className="font-bold text-stone-900 mt-4">מאובטח</h3>
              <p className="text-sm text-stone-700 mt-2 leading-relaxed">
                הנתונים שלך מוצפנים ומבודדים. רק אתה רואה אותם. גיבוי אוטומטי.
              </p>
            </div>
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center mx-auto shadow-sm">
                <Globe className="w-7 h-7 text-orange-700" />
              </div>
              <h3 className="font-bold text-stone-900 mt-4">עברית מלאה</h3>
              <p className="text-sm text-stone-700 mt-2 leading-relaxed">
                RTL מלא, חוקי מע״מ ישראלי, תמיכה בעוסק פטור ועוסק מורשה.
              </p>
            </div>
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center mx-auto shadow-sm">
                <Zap className="w-7 h-7 text-violet-700" />
              </div>
              <h3 className="font-bold text-stone-900 mt-4">מהיר</h3>
              <p className="text-sm text-stone-700 mt-2 leading-relaxed">
                ממשק נקי וקל. הפק קבלה ב-30 שניות במקום 5 דקות.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING / CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <div className="card-soft p-8 sm:p-12 bg-gradient-to-br from-white via-orange-50/40 to-rose-50/30 border-orange-200 relative overflow-hidden">
          {/* Decorative gradient blob */}
          <div className="absolute -top-20 -left-20 w-60 h-60 rounded-full bg-gradient-to-br from-orange-300 to-rose-400 opacity-20 blur-3xl" aria-hidden />
          <div className="absolute -bottom-20 -right-20 w-60 h-60 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 opacity-20 blur-3xl" aria-hidden />

          <div className="text-center relative">
            <div className="inline-flex items-center gap-1.5 bg-emerald-100 border border-emerald-200 rounded-full px-4 py-1.5 mb-4 text-xs font-semibold text-emerald-700">
              <Zap className="w-3 h-3" />
              חינם, לתמיד
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-stone-900">חינם לחלוטין</h2>
            <p className="text-stone-700 mt-3 max-w-md mx-auto">
              ללא תשלום, ללא כרטיס אשראי, ללא הפתעות.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8 max-w-xl mx-auto relative">
            {pricingPoints.map((p) => (
              <div key={p} className="flex items-start gap-2">
                <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="w-3 h-3 text-emerald-700" />
                </div>
                <span className="text-sm text-stone-800">{p}</span>
              </div>
            ))}
          </div>
          <div className="text-center mt-10 relative">
            <Link
              href="/login"
              className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-7 py-4 rounded-2xl text-base font-semibold hover:shadow-xl hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              צור חשבון - חינם
            </Link>
            <p className="text-xs text-stone-500 mt-3">תיקח לך פחות מדקה. לא צריך כרטיס אשראי.</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-orange-100 bg-white/40 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-8 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm text-stone-700">
              © 2026 MySuperFriendlyInvoiceApp
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/privacy" className="text-stone-600 hover:text-orange-700">
              מדיניות פרטיות
            </Link>
            <Link href="/terms" className="text-stone-600 hover:text-orange-700">
              תנאי שימוש
            </Link>
            <Link href="/login" className="text-orange-600 hover:text-orange-700 font-semibold">
              התחבר →
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
