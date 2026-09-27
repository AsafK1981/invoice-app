"use client";

// Pension + study fund calculator for the self-employed: the mandatory
// minimum to deposit by 31.12, the deposit that uses the full pension tax
// benefits, and the study fund figures. The taxable profit is prefilled from
// the same year-to-date base and linear projection /reports/tax-projection
// uses; the owner can type a different figure.
//
// Spec: docs/superpowers/specs/2026-09-27-pension-calculator-design.md

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Info, PiggyBank } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { StoreLoadError } from "@/components/store-load-error";
import { useBusiness } from "@/lib/business-store";
import { formatCurrencyWhole } from "@/lib/format";
import { todayInIsrael } from "@/lib/date";
import { NumberInput } from "@/components/number-input";
import { projectAnnualTax, yearToDateTaxBase } from "@/lib/tax-projection";
import { roundShekelHalfUp } from "@/lib/ita/income-tax-advances";
import {
  isObligated,
  mandatoryPension,
  pensionFiguresFor,
  pensionTaxBenefit,
  studyFund,
} from "@/lib/pension";

const DAY_MS = 86_400_000;

export default function PensionPage() {
  const { documents, ready: docsReady, error: docsError, retry: retryDocs } = useDocuments();
  const { items: expenses, ready: expReady, error: expError, retry: retryExp } = useExpenses();
  const { business, ready: bizReady, error: bizError, refetch: refetchBiz } = useBusiness();

  // The tax year and day count in Israel time, so the last hours of 31.12
  // abroad never jump a year ahead.
  const today = todayInIsrael();
  const year = Number(today.slice(0, 4));

  const { autoProfit, daysElapsed } = useMemo(() => {
    const [y, m, d] = today.split("-").map(Number);
    const yearStart = Date.UTC(y, 0, 1);
    const daysElapsed = Math.max(1, Math.floor((Date.UTC(y, m - 1, d) - yearStart) / DAY_MS));
    const daysInYear = Math.round((Date.UTC(y + 1, 0, 1) - yearStart) / DAY_MS);
    const { ytdIncome, ytdExpenses } = yearToDateTaxBase(documents, expenses, y, business.businessType);
    const projection = projectAnnualTax({ ytdIncome, ytdExpenses, daysElapsed, daysInYear });
    return { autoProfit: roundShekelHalfUp(projection.projectedProfit), daysElapsed };
  }, [documents, expenses, today, business.businessType]);

  // null = follow the automatic figure; a number = the owner typed one.
  const [override, setOverride] = useState<number | null>(null);
  const [ageOk, setAgeOk] = useState(true);
  const [registeredOk, setRegisteredOk] = useState(true);

  // A failed business read leaves the default business (wrong type, so wrong
  // VAT treatment of the profit): never compute from it.
  if (docsError || expError || bizError) {
    return (
      <StoreLoadError
        sources={[
          { error: docsError, retry: retryDocs },
          { error: expError, retry: retryExp },
          { error: bizError, retry: () => void refetchBiz() },
        ]}
      />
    );
  }

  if (!docsReady || !expReady || !bizReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  // Mandatory pension is for the self-employed; in a company the deposit
  // goes through the owners' payslip, so there is nothing to calculate here.
  if (business.businessType === "company") {
    return (
      <div className="space-y-6">
        <PageHeader year={year} />
        <section className="card-soft p-6 flex items-start gap-3">
          <Info className="w-5 h-5 text-stone-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-stone-800">בחברה ההפקדה לפנסיה נעשית דרך תלוש השכר של בעלי החברה, לא דרך המחשבון הזה.</p>
        </section>
      </div>
    );
  }

  const earlyYear = daysElapsed < 45;
  const profit = override ?? autoProfit;
  const f = pensionFiguresFor(year);
  const mandatory = mandatoryPension(profit, year);
  const benefit = pensionTaxBenefit(profit, year);
  const fund = studyFund(profit, year);
  const obligated = isObligated({ ageBetween21And60: ageOk, sixMonthsRegistered: registeredOk });

  return (
    <div className="space-y-6">
      <PageHeader year={year} />

      {earlyYear && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            עברו רק {daysElapsed} ימים מתחילת השנה, אז ההקרנה לשנה מלאה עדיין גסה. אפשר להזין רווח משוער ידנית.
          </div>
        </div>
      )}

      <section className="card-soft p-6 space-y-5">
        <div>
          <label htmlFor="pension-profit" className="block font-bold text-stone-900 text-lg mb-2">
            רווח חייב לשנת {year}
          </label>
          <div className="flex items-center gap-3 flex-wrap">
            <NumberInput
              id="pension-profit"
              min={0}
              step={1000}
              inputMode="numeric"
              value={profit}
              onValueChange={(v) => setOverride(Math.max(0, v))}
              placeholder="0"
              dir="ltr"
              className="w-48 px-3 py-2 rounded-xl border border-stone-300 bg-white text-lg font-bold text-stone-900"
            />
            {override !== null && (
              <button
                type="button"
                onClick={() => setOverride(null)}
                className="text-sm font-semibold text-orange-700 underline hover:text-orange-800"
              >
                חזרה לחישוב האוטומטי
              </button>
            )}
          </div>
          <p className="text-xs text-stone-600 mt-2">
            לפי ההכנסות וההוצאות באפליקציה, מוקרן לשנה מלאה. אפשר לשנות.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 text-sm text-stone-800">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-orange-600" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} />
            אני בגיל 21 עד 60
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-orange-600" checked={registeredOk} onChange={(e) => setRegisteredOk(e.target.checked)} />
            אני רשום כעצמאי יותר מחצי שנה
          </label>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ResultCard title="המינימום שחובה להפקיד עד 31.12">
          {obligated ? (
            <>
              <BigFigure value={mandatory.total} />
              <p className="text-sm text-stone-700">בערך {formatCurrencyWhole(mandatory.monthly)} בחודש</p>
              <ul className="text-xs text-stone-600 space-y-1 mt-3">
                <li>{f.pensionLowRate}% על {formatCurrencyWhole(mandatory.lowBase)} = {formatCurrencyWhole(mandatory.lowAmount)}</li>
                {mandatory.highBase > 0 && (
                  <li>{f.pensionHighRate}% על {formatCurrencyWhole(mandatory.highBase)} = {formatCurrencyWhole(mandatory.highAmount)}</li>
                )}
                {mandatory.capped && <li>מעל {formatCurrencyWhole(mandatory.fullAverageWage)} אין חובה להפקיד יותר.</li>}
              </ul>
            </>
          ) : (
            <p className="text-sm text-stone-700">לפי מה שסימנת, חובת ההפקדה לא חלה עליך השנה</p>
          )}
        </ResultCard>

        <ResultCard title="כמה כדאי להפקיד בשביל הטבות המס">
          <BigFigure value={benefit.optimalDeposit} />
          <ul className="text-xs text-stone-600 space-y-1 mt-3">
            <li>ניכוי מההכנסה על {formatCurrencyWhole(benefit.deductionDeposit)} ({f.deductionRate}%)</li>
            <li>זיכוי ממס של {formatCurrencyWhole(benefit.creditValue)} על הפקדה של {formatCurrencyWhole(benefit.creditDeposit)} ({f.creditDepositRate}%)</li>
            {profit > f.qualifyingIncome && <li>ההטבות מחושבות עד הכנסה של {formatCurrencyWhole(f.qualifyingIncome)}.</li>}
          </ul>
        </ResultCard>

        <ResultCard title="קרן השתלמות">
          <BigFigure value={fund.deductibleDeposit} />
          <p className="text-xs text-stone-600">{f.studyFundDeductionRate}% מההכנסה, מוכר כהוצאה</p>
          <div className="mt-4 pt-4 border-t border-stone-200">
            <p className="text-xl font-bold text-stone-900 text-right" dir="ltr">{formatCurrencyWhole(fund.exemptDeposit)}</p>
            <p className="text-xs text-stone-600 mt-1">עד {formatCurrencyWhole(fund.exemptDeposit)} בשנה הרווחים פטורים ממס רווחי הון</p>
          </div>
        </ResultCard>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-xs text-stone-600 flex items-start gap-2">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>
          הערכה לפי טבלת התקרות לשנת {f.year}. המינימום תלוי בהכנסה החייבת בפועל בסוף השנה. לא ייעוץ פנסיוני או מס.{" "}
          <Link href="/obligations" className="font-semibold text-orange-700 underline hover:text-orange-800">
            ללוח חובות ההגשה
          </Link>
        </p>
      </div>
    </div>
  );
}

function PageHeader({ year }: { year: number }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
            <PiggyBank className="w-5 h-5 text-white" />
          </span>
          פנסיה וקרן השתלמות
        </h1>
        <p className="text-sm text-stone-700 mt-2 mr-14">
          שנת המס {year}: כמה חובה להפקיד, כמה כדאי להפקיד בשביל הטבות המס, וכמה לקרן השתלמות.
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
  );
}

function ResultCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-soft p-5 flex flex-col">
      <h2 className="text-sm font-semibold text-stone-700 mb-2">{title}</h2>
      {children}
    </section>
  );
}

function BigFigure({ value }: { value: number }) {
  return (
    <p className="text-3xl font-bold text-stone-900 mb-1 text-right" dir="ltr">
      {formatCurrencyWhole(value)}
    </p>
  );
}
