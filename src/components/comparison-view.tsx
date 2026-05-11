import Link from "next/link";
import {
  Sparkles,
  Check,
  X as XIcon,
  Minus,
  ArrowLeft,
  TrendingDown,
  Gift,
  Trophy,
} from "lucide-react";
import type { Competitor, FeatureSupport } from "@/lib/comparison-data";

function Mark({ kind, note }: { kind: FeatureSupport; note?: string }) {
  const className =
    kind === "yes"
      ? "text-emerald-600"
      : kind === "no"
      ? "text-rose-500"
      : "text-amber-600";
  const Icon = kind === "yes" ? Check : kind === "no" ? XIcon : Minus;
  return (
    <div className="flex items-center justify-center" title={note}>
      <Icon className={`w-5 h-5 ${className}`} strokeWidth={3} />
    </div>
  );
}

const formatPrice = (nis: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(nis);

export function ComparisonView({ competitor }: { competitor: Competitor }) {
  // Compare cheapest paid tier on each side that gives the user a
  // "feels unlimited" experience. For us that's Pro at ₪29. For them
  // it varies — pick the cheapest tier that offers unlimited or near.
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          חזרה לעמוד הבית
        </Link>

        {/* Hero */}
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-4xl sm:text-5xl font-bold text-stone-900 leading-tight">
            MySuperFriendlyInvoiceApp
            <span className="block sm:inline mx-3 text-stone-400 font-normal text-3xl">vs</span>
            {competitor.name}
          </h1>
          <p className="text-base sm:text-lg text-stone-700 max-w-2xl mx-auto leading-relaxed">
            {competitor.verdict}
          </p>
          <p className="text-xs text-stone-500">
            השוואה הוגנת. נתוני המתחרים מ-{competitor.url.replace("https://", "")} (עודכן 5/2026)
          </p>
        </div>

        {/* Pricing comparison */}
        <section className="card-soft p-6 sm:p-8 mb-8">
          <div className="flex items-center gap-2 mb-6">
            <TrendingDown className="w-5 h-5 text-orange-500" />
            <h2 className="text-2xl font-bold text-stone-900">השוואת מחירים</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Us */}
            <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-teal-50/40 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-stone-900">MySuperFriendlyInvoiceApp</h3>
              </div>
              <ul className="space-y-2 text-sm">
                <li className="flex items-baseline justify-between">
                  <span className="text-stone-700">בסיסי</span>
                  <span className="font-bold text-stone-900">{formatPrice(19)} / חודש · 30 מסמכים</span>
                </li>
                <li className="flex items-baseline justify-between">
                  <span className="text-stone-700">Pro</span>
                  <span className="font-bold text-stone-900">{formatPrice(29)} / חודש · ללא הגבלה</span>
                </li>
                <li className="flex items-baseline justify-between text-xs text-stone-600 mt-1">
                  <span>חיוב שנתי</span>
                  <span>20% הנחה</span>
                </li>
                <li className="flex items-baseline justify-between text-xs pt-2 mt-2 border-t border-emerald-100">
                  <span className="text-stone-700">ניסיון חינם</span>
                  <span className="font-semibold text-emerald-700">14 ימים · ללא כרטיס אשראי</span>
                </li>
              </ul>
            </div>

            {/* Them */}
            <div className="rounded-2xl border-2 border-stone-200 bg-white p-5">
              <h3 className="font-bold text-stone-900 mb-3">{competitor.name}</h3>
              <ul className="space-y-2 text-sm">
                {competitor.pricing.map((p) => (
                  <li key={p.name} className="flex items-baseline justify-between gap-2">
                    <span className="text-stone-700">{p.name}</span>
                    <span className="font-bold text-stone-900 text-left">
                      {formatPrice(p.priceMonthly)} / חודש · {p.docs}
                    </span>
                  </li>
                ))}
                <li className="flex items-baseline justify-between text-xs pt-2 mt-2 border-t border-stone-100">
                  <span className="text-stone-700">ניסיון חינם</span>
                  <span className="font-semibold text-stone-700">{competitor.freeTrial}</span>
                </li>
              </ul>
            </div>
          </div>

          <p className="text-sm text-stone-700 mt-6 leading-relaxed bg-amber-50 border border-amber-100 rounded-xl p-4">
            <strong className="text-stone-900">למה זה משנה: </strong>
            עצמאי טיפוסי מפיק 20-50 מסמכים בחודש. ב-{competitor.name} מסלול שמתאים לכך עולה{" "}
            {formatPrice(competitor.pricing[Math.min(1, competitor.pricing.length - 1)].priceMonthly)} ומעלה.
            אצלנו Pro ללא הגבלה הוא {formatPrice(29)} בלבד.
          </p>
        </section>

        {/* Feature comparison */}
        <section className="card-soft overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-orange-100 bg-gradient-to-l from-orange-50 to-amber-50">
            <h2 className="text-xl font-bold text-stone-900">השוואת פיצ'רים</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-700">
                <tr>
                  <th className="text-right px-6 py-3 font-semibold">פיצ'ר</th>
                  <th className="px-3 py-3 font-semibold text-center min-w-[80px]">
                    MySuperFriendly
                    <br />
                    InvoiceApp
                  </th>
                  <th className="px-3 py-3 font-semibold text-center min-w-[80px]">{competitor.name}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-50">
                {competitor.features.map((row) => (
                  <tr key={row.feature} className="hover:bg-orange-50/40">
                    <td className="px-6 py-3 text-stone-800">
                      <div>{row.feature}</div>
                      {row.note && (
                        <div className="text-xs text-stone-500 mt-0.5">{row.note}</div>
                      )}
                    </td>
                    <td className="px-3 py-3"><Mark kind={row.us} /></td>
                    <td className="px-3 py-3"><Mark kind={row.them} note={row.note} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-3 border-t border-orange-100 text-xs text-stone-500 flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={3} /> תומך
            </span>
            <span className="flex items-center gap-1">
              <Minus className="w-3.5 h-3.5 text-amber-600" strokeWidth={3} /> חלקי
            </span>
            <span className="flex items-center gap-1">
              <XIcon className="w-3.5 h-3.5 text-rose-500" strokeWidth={3} /> לא תומך
            </span>
          </div>
        </section>

        {/* Strengths */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
          <div className="card-soft p-5">
            <h3 className="font-bold text-stone-900 mb-3">איפה {competitor.name} מנצחים</h3>
            <ul className="space-y-2 text-sm text-stone-800">
              {competitor.theirStrengths.map((s) => (
                <li key={s} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-stone-500 mt-0.5 flex-shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card-soft p-5 bg-gradient-to-br from-emerald-50/40 to-teal-50/30 border-emerald-100">
            <h3 className="font-bold text-stone-900 mb-3">איפה אנחנו מנצחים</h3>
            <ul className="space-y-2 text-sm text-stone-800">
              {competitor.ourStrengths.map((s) => (
                <li key={s} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Founder note */}
        <section className="card-soft p-6 sm:p-8 mb-8 bg-gradient-to-br from-orange-50/60 to-amber-50/40 border-orange-100">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-md flex-shrink-0">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-lg">למה בכלל בנינו את זה?</h3>
              <p className="text-sm text-stone-800 mt-2 leading-relaxed">
                בעלי-בית הם בני אדם שמלאו שולחנם בעבודה ולא רוצים לבזבז עוד 10 דקות בחודש על
                ממשק שמורגש כמו תוכנת חשבוניות מ-2008. אנחנו בנינו את האפליקציה שעצמאי היה רוצה
                בעצמו: מהירה, נקייה, עברית מלאה, עם המחיר ההוגן ביותר בשוק.
              </p>
              <p className="text-sm text-stone-800 mt-3 leading-relaxed">
                {competitor.name} הם פלטפורמה רחבה ובוגרת. אנחנו פלטפורמה ממוקדת ומהירה.
                שני העולמות תקפים — תלוי מה אתה צריך.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center space-y-4 pb-8">
          <h2 className="text-2xl font-bold text-stone-900">רוצה לנסות?</h2>
          <p className="text-stone-700 max-w-md mx-auto">
            14 ימי ניסיון, ללא כרטיס אשראי. אתה מקבל את כל הפיצ'רים של Pro לתקופה הזו.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/login"
              className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3 rounded-2xl text-base font-semibold hover:shadow-xl hover:shadow-orange-200/60"
            >
              <Sparkles className="w-4 h-4" />
              התחל ניסיון חינם
            </Link>
            <Link
              href="/invite/FOR-FRIENDS-ONLY"
              className="inline-flex items-center gap-2 text-sm text-emerald-700 font-semibold hover:text-emerald-800 px-4 py-3"
            >
              <Gift className="w-4 h-4" />
              קיבלת קוד מחבר? לחץ פה
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
