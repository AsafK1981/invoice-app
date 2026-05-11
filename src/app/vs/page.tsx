import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Sparkles, BarChart3 } from "lucide-react";
import { COMPETITORS } from "@/lib/comparison-data";

export const metadata: Metadata = {
  title: "השוואות מול תוכנות חשבוניות אחרות",
  description:
    "השוואות הוגנות מול Invoice4U, חשבונית ירוקה, ועוד — מחירים, פיצ'רים, יתרונות וחסרונות.",
  alternates: { canonical: "/vs" },
};

export default function VsIndex() {
  const list = Object.values(COMPETITORS);
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium mb-6"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לעמוד הבית
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-md">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-stone-900">השוואות מול תוכנות אחרות</h1>
            <p className="text-sm text-stone-700 mt-1">
              מי כדאי לי? בהשוואה הוגנת — איפה אנחנו חזקים, איפה הם.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {list.map((c) => (
            <Link
              key={c.slug}
              href={`/vs/${c.slug}`}
              className="card-soft block p-6 hover:shadow-lg hover:shadow-orange-200/40 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h2 className="font-bold text-stone-900 text-xl">
                    MySuperFriendlyInvoiceApp vs {c.name}
                  </h2>
                  <p className="text-sm text-stone-700 mt-2 leading-relaxed">{c.verdict}</p>
                  <p className="text-xs text-orange-600 mt-3 font-semibold inline-flex items-center gap-1">
                    קרא את ההשוואה המלאה
                    <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="text-center mt-10">
          <Link
            href="/login"
            className="btn-glow inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-6 py-3 rounded-2xl text-base font-semibold hover:shadow-xl hover:shadow-orange-200/60"
          >
            <Sparkles className="w-4 h-4" />
            התחל ניסיון חינם של 14 ימים
          </Link>
        </div>
      </div>
    </div>
  );
}
