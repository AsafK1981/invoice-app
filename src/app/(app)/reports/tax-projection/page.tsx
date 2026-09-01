"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  AlertTriangle,
  Calculator,
  TrendingUp,
  Wallet,
  Calendar,
  Info,
} from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { isCountableRevenue } from "@/lib/types";
import { useExpenses } from "@/lib/expense-store";
import { useBusiness } from "@/lib/business-store";
import { formatCurrency } from "@/lib/format";
import { NumberInput } from "@/components/number-input";
import {
  projectAnnualTax,
  TAX_CREDIT_DEFAULT_POINTS,
} from "@/lib/tax-projection";

export default function TaxProjectionPage() {
  const { documents, ready: docsReady } = useDocuments();
  const { items: expenses, ready: expReady } = useExpenses();
  const { business, ready: bizReady } = useBusiness();

  const [points, setPoints] = useState(TAX_CREDIT_DEFAULT_POINTS);

  const today = new Date();
  const year = today.getFullYear();

  const { ytd, projection } = useMemo(() => {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const daysElapsed = Math.max(
      1,
      Math.floor((today.getTime() - yearStart.getTime()) / 86400000),
    );
    const daysInYear = Math.floor(
      (yearEnd.getTime() - yearStart.getTime()) / 86400000,
    );

    const prefix = `${year}-`;
    // Credit notes are stored ALREADY NEGATIVE on save (receipt-editor.tsx
    // applies `sign = -1`), so a plain sum already subtracts them; negating
    // them again here would turn a refund into extra projected income.
    const ytdIncome = documents
      .filter((d) => d.status === "paid" && isCountableRevenue(d) && d.date.startsWith(prefix))
      .reduce((s, d) => s + (d.totalIls ?? d.total), 0);
    const ytdExpenses = expenses
      .filter((e) => e.date.startsWith(prefix))
      .reduce((s, e) => s + e.amount, 0);

    const projection = projectAnnualTax({
      ytdIncome,
      ytdExpenses,
      daysElapsed,
      daysInYear,
      taxCreditPoints: points,
    });

    return {
      ytd: { ytdIncome, ytdExpenses, daysElapsed, daysInYear },
      projection,
    };
  }, [documents, expenses, year, points, today]);

  if (!docsReady || !expReady || !bizReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  const earlyYear = ytd.daysElapsed < 45;
  const exempt = business.businessType === "exempt";
  // עוסק פטור doesn't charge or pay VAT but still pays income tax + BL.

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
              <Calculator className="w-5 h-5 text-white" />
            </span>
            צפי מס שנתי
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            הערכה כמה תהיה חייב במס סוף שנת {year}, לפי הקצב הנוכחי. תוודא עם רו״ח לפני החלטה כספית.
          </p>
        </div>
        <Link
          href="/reports"
          className="inline-flex items-center gap-2 text-sm text-stone-700 hover:text-stone-900"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לדו״חות
        </Link>
      </div>

      {earlyYear && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <strong>זהירות:</strong> חלפו רק {ytd.daysElapsed} ימים מתחילת השנה. הצפי לא יציב בתחילת שנה. החל מסוף פברואר התחזית מדויקת יותר.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          label="הכנסות מצטברות השנה"
          value={formatCurrency(ytd.ytdIncome)}
          icon={TrendingUp}
          tone="emerald"
        />
        <Card
          label="הוצאות מצטברות"
          value={formatCurrency(ytd.ytdExpenses)}
          icon={Wallet}
          tone="rose"
        />
        <Card
          label="ימים שחלפו"
          value={`${ytd.daysElapsed} / ${ytd.daysInYear}`}
          icon={Calendar}
          tone="stone"
        />
      </div>

      <section className="card-soft p-6">
        <h2 className="font-bold text-stone-900 text-lg mb-1">צפי לסוף השנה</h2>
        <p className="text-xs text-stone-600 mb-4">
          הקצב הנוכחי × ימים שנשארו עד 31 בדצמבר.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Pill label="הכנסה צפויה" value={formatCurrency(projection.projectedIncome)} />
          <Pill label="הוצאות צפויות" value={formatCurrency(projection.projectedExpenses)} />
          <Pill
            label="רווח חייב"
            value={formatCurrency(projection.projectedProfit)}
            emphasize
          />
        </div>
      </section>

      <section className="card-soft p-6">
        <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
          <h2 className="font-bold text-stone-900 text-lg">חובת מס לתשלום</h2>
          <label className="text-xs text-stone-700 flex items-center gap-2">
            נקודות זיכוי:
            <NumberInput
              step={0.25}
              min={0}
              max={20}
              value={points}
              onValueChange={setPoints}
              className="w-20 px-2 py-1 rounded-lg border border-stone-300 bg-white text-sm"
            />
          </label>
        </div>

        <div className="space-y-3">
          <Bar
            label="מס הכנסה"
            description="לפי מדרגות 2026, אחרי הפחתת זיכויים אישיים."
            value={projection.incomeTax}
            total={projection.totalTax}
            color="from-blue-400 to-blue-500"
          />
          <Bar
            label="ביטוח לאומי + דמי בריאות"
            description="7.7% עד ~₪7,700 לחודש, 18% מעל זה."
            value={projection.bituachLeumi}
            total={projection.totalTax}
            color="from-violet-400 to-violet-500"
          />
        </div>

        <div className="mt-5 pt-5 border-t border-stone-200 flex items-baseline justify-between flex-wrap gap-3">
          <p className="text-sm text-stone-700">סה״כ צפי מס לכל השנה:</p>
          <p
            className="text-3xl font-bold text-stone-900"
            dir="ltr"
            title="מס הכנסה + ביטוח לאומי + דמי בריאות"
          >
            {formatCurrency(projection.totalTax)}
          </p>
        </div>
        <p className="text-xs text-stone-600 mt-1">
          אחוז אפקטיבי על הרווח: {(projection.effectiveRate * 100).toFixed(1)}%
        </p>
      </section>

      <section className="rounded-2xl bg-gradient-to-l from-emerald-50 to-teal-50 border-2 border-emerald-200 p-6">
        <h2 className="font-bold text-emerald-900 text-lg mb-1 flex items-center gap-2">
          <Info className="w-5 h-5" />
          איך לא להישרף בסוף השנה
        </h2>
        <p className="text-sm text-stone-800 mb-4">
          המספרים שלמטה הם המינימום שכדאי לשמור בצד מכל הכנסה, לא לסעוד מהם.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl p-4 border border-emerald-100">
            <p className="text-xs text-stone-600 mb-1">אחוז מכל חשבונית להפריש</p>
            <p className="text-2xl font-bold text-emerald-700">
              {(projection.setAsidePct * 100).toFixed(0)}%
            </p>
            <p className="text-xs text-stone-500 mt-1">
              ברגע שמקבל כסף, מעביר את האחוז הזה לחשבון נפרד.
            </p>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-emerald-100">
            <p className="text-xs text-stone-600 mb-1">להפריש בחודש (מעכשיו עד סוף השנה)</p>
            <p className="text-2xl font-bold text-emerald-700" dir="ltr">
              {formatCurrency(projection.monthlyReserve)}
            </p>
            <p className="text-xs text-stone-500 mt-1">
              ~{projection.monthsRemaining.toFixed(1)} חודשים נשארו עד 31 בדצמבר.
            </p>
          </div>
        </div>
      </section>

      {exempt && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 flex items-start gap-3">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>
            <strong>עוסק פטור:</strong> אינך גובה ולא משלם מע״מ, אבל עדיין משלם מס הכנסה וביטוח לאומי על הרווח. הצפי כאן כולל את שני אלה.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-xs text-stone-600 flex items-start gap-2">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>
          חישוב מבוסס על מדרגות מס וביטוח לאומי לשנת {year}. הנתונים מתעדכנים שנתית. <strong>זו הערכה בלבד</strong>, לפני כל החלטה כספית התייעץ עם רו״ח. אם יש לך הכנסות נוספות (משכורת, שכר דירה) או הוצאות מוכרות נוספות שלא בקובץ ההוצאות, המספרים יהיו לא מדויקים.
        </p>
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  tone: "emerald" | "rose" | "stone";
}) {
  const toneClass = {
    emerald: "from-emerald-400 to-teal-500",
    rose: "from-rose-400 to-pink-500",
    stone: "from-stone-400 to-stone-500",
  }[tone];
  return (
    <div className="card-soft p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-stone-700">{label}</p>
          <p className="text-2xl font-bold mt-2 text-stone-900" dir="ltr">{value}</p>
        </div>
        <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${toneClass} flex items-center justify-center shadow-sm`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

function Pill({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        emphasize
          ? "bg-orange-50 border-orange-200"
          : "bg-stone-50/60 border-stone-200"
      }`}
    >
      <p className="text-xs text-stone-600 mb-1">{label}</p>
      <p
        className={`font-bold ${emphasize ? "text-xl text-stone-900" : "text-lg text-stone-800"}`}
        dir="ltr"
      >
        {value}
      </p>
    </div>
  );
}

function Bar({
  label,
  description,
  value,
  total,
  color,
}: {
  label: string;
  description: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-stone-900">{label}</p>
          <p className="text-xs text-stone-600">{description}</p>
        </div>
        <p className="text-base font-bold text-stone-900" dir="ltr">
          {formatCurrency(value)}
        </p>
      </div>
      <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
        <div
          className={`h-full bg-gradient-to-l ${color}`}
          style={{ width: `${pct.toFixed(1)}%` }}
        />
      </div>
    </div>
  );
}
