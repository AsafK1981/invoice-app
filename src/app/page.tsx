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
      desc: "הפק קבלות, חשבונות עסקה וחשבוניות מס בלחיצה אחת. PDF מוכן להדפסה ושליחה.",
      gradient: "from-emerald-400 to-teal-500",
    },
    {
      icon: Mail,
      title: "שליחה אוטומטית",
      desc: "המסמכים נשלחים אוטומטית במייל ללקוח עם קישור לצפייה. לכמה אימיילים בו זמנית.",
      gradient: "from-rose-400 to-pink-500",
    },
    {
      icon: Users,
      title: "ניהול לקוחות",
      desc: "כל הלקוחות, המוצרים והשירותים שלך במקום אחד. חיפוש מהיר ויבוא מקובץ.",
      gradient: "from-violet-400 to-purple-500",
    },
    {
      icon: TrendingUp,
      title: "דשבורד עם גרפים",
      desc: "ראה את ההכנסות וההוצאות שלך לאורך זמן. גרף לקוחות מובילים, פילוח הוצאות.",
      gradient: "from-amber-400 to-orange-500",
    },
    {
      icon: FileText,
      title: "דו״חות ויצוא",
      desc: "ייצוא לאקסל לרואה החשבון. סיכום שנתי, חודשי, רבעוני - הכל מוכן לדיווח.",
      gradient: "from-sky-400 to-blue-500",
    },
    {
      icon: Wallet,
      title: "מעקב הוצאות",
      desc: "תעד הוצאות עסקיות לפי קטגוריות. חישוב רווח נטו אוטומטי.",
      gradient: "from-stone-400 to-stone-600",
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
      <header className="px-6 py-5 flex items-center justify-between max-w-7xl mx-auto">
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

      <section className="max-w-5xl mx-auto px-6 pt-12 pb-20 text-center animate-fade-in-up">
        <div className="inline-flex items-center gap-1.5 bg-white/70 backdrop-blur border border-orange-200 rounded-full px-4 py-1.5 mb-6 text-xs font-semibold text-orange-700">
          <Sparkles className="w-3 h-3" />
          הדרך הכי פשוטה לנהל חשבוניות
        </div>
        <h1 className="text-4xl sm:text-6xl font-bold text-stone-900 leading-tight">
          חשבוניות וקבלות
          <br />
          <span className="bg-gradient-to-l from-orange-500 to-rose-500 bg-clip-text text-transparent">
            בלי כאב ראש
          </span>
        </h1>
        <p className="text-lg text-stone-700 mt-6 max-w-2xl mx-auto">
          אפליקציה לעצמאיים בישראל. הפק קבלות וחשבוניות, נהל לקוחות, שלח במייל - הכל בעברית, חינם, ובלי גבולות.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-10">
          <Link
            href="/login"
            className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3.5 rounded-2xl text-base font-semibold hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all duration-200"
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
      </section>

      <section id="features" className="max-w-7xl mx-auto px-6 py-12">
        <div className="text-center mb-12 animate-fade-in-up">
          <h2 className="text-3xl font-bold text-stone-900">כל מה שצריך, במקום אחד</h2>
          <p className="text-stone-700 mt-2">פיצ'רים שתוכננו במיוחד לעצמאיים בישראל</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, idx) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className={`card-soft p-6 hover:shadow-md hover:-translate-y-0.5 transition-all animate-fade-in-up stagger-${(idx % 6) + 1}`}
              >
                <div
                  className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${f.gradient} flex items-center justify-center shadow-md`}
                >
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-bold text-stone-900 mt-4">{f.title}</h3>
                <p className="text-sm text-stone-700 mt-2 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16">
        <div className="card-soft p-8 sm:p-12 bg-gradient-to-br from-white to-orange-50/40 border-orange-200">
          <div className="text-center">
            <div className="inline-flex items-center gap-1.5 bg-emerald-100 border border-emerald-200 rounded-full px-4 py-1.5 mb-4 text-xs font-semibold text-emerald-700">
              <Zap className="w-3 h-3" />
              חינם, לתמיד
            </div>
            <h2 className="text-3xl font-bold text-stone-900">חינם לחלוטין</h2>
            <p className="text-stone-700 mt-2 max-w-md mx-auto">
              ללא תשלום, ללא כרטיס אשראי, ללא הפתעות
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8 max-w-xl mx-auto">
            {pricingPoints.map((p) => (
              <div key={p} className="flex items-start gap-2">
                <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="w-3 h-3 text-emerald-700" />
                </div>
                <span className="text-sm text-stone-800">{p}</span>
              </div>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link
              href="/login"
              className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3.5 rounded-2xl text-base font-semibold hover:shadow-lg hover:shadow-orange-200/60 hover:-translate-y-0.5 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              צור חשבון - חינם
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center mx-auto">
              <Shield className="w-7 h-7 text-emerald-700" />
            </div>
            <h3 className="font-bold text-stone-900 mt-3">מאובטח</h3>
            <p className="text-sm text-stone-700 mt-1">
              הנתונים שלך מוצפנים, מבודדים ומגובים אוטומטית. רק אתה רואה אותם.
            </p>
          </div>
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center mx-auto">
              <Globe className="w-7 h-7 text-orange-700" />
            </div>
            <h3 className="font-bold text-stone-900 mt-3">בעברית</h3>
            <p className="text-sm text-stone-700 mt-1">
              הכל בעברית, RTL מלא. מתאים לעוסק פטור ולעוסק מורשה.
            </p>
          </div>
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center mx-auto">
              <Zap className="w-7 h-7 text-violet-700" />
            </div>
            <h3 className="font-bold text-stone-900 mt-3">מהיר</h3>
            <p className="text-sm text-stone-700 mt-1">
              ממשק נקי וקל. הפק קבלה ב-30 שניות במקום 5 דקות.
            </p>
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
