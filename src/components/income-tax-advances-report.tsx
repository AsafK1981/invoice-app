"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { saveIncomeTaxAdvanceRate } from "@/lib/business-store";
import { biMonthlyRange, singleMonthRange, type ReportRange } from "@/lib/ita/vat-periods";
import { advanceDueDate, computeAdvance } from "@/lib/ita/income-tax-advances";
import type { Business, InvoiceDocument } from "@/lib/types";

interface Props {
  business: Business;
  documents: InvoiceDocument[];
}

type PeriodMode = "last_month" | "this_month" | "last_2m" | "this_2m";

const MODE_LABELS: Record<PeriodMode, string> = {
  last_month: "חודש קודם",
  this_month: "חודש נוכחי",
  last_2m: "דו-חודשי קודם",
  this_2m: "דו-חודשי נוכחי",
};

function rangeFor(mode: PeriodMode, today: Date): ReportRange {
  switch (mode) {
    case "last_month": return singleMonthRange(today, -1);
    case "this_month": return singleMonthRange(today, 0);
    case "last_2m": return biMonthlyRange(today, -1);
    case "this_2m": return biMonthlyRange(today, 0);
  }
}

/**
 * מקדמות מס הכנסה. The Tax Authority's online service asks for the period's
 * turnover, multiplies it by the percentage the assessing office set for this
 * business (it is printed on the פנקס מקדמות), and lets the filer subtract tax
 * customers already withheld at source. There is no file to upload, so this
 * report's whole job is to put those numbers one tap from the clipboard.
 *
 * Shown to every business type: an עוסק פטור pays advances too - the exemption
 * is from VAT, not from income tax.
 */
export function IncomeTaxAdvancesReport({ business, documents }: Props) {
  const [mode, setMode] = useState<PeriodMode>("last_month");
  // Memoised for the same reason as in vat-period-report: a fresh Date on
  // every render would invalidate every downstream useMemo.
  const today = useMemo(() => new Date(), []);
  const range = useMemo(() => rangeFor(mode, today), [mode, today]);

  const [rateInput, setRateInput] = useState(
    business.incomeTaxAdvanceRate != null ? String(business.incomeTaxAdvanceRate) : "",
  );
  const [rateSaved, setRateSaved] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  // The store refetches after a save (and other tabs/screens can change it),
  // so follow the stored value whenever it actually differs from the box.
  useEffect(() => {
    const stored = business.incomeTaxAdvanceRate != null ? String(business.incomeTaxAdvanceRate) : "";
    setRateInput((cur) => (Number(cur) === Number(stored) || cur === stored ? cur : stored));
  }, [business.incomeTaxAdvanceRate]);

  const ratePercent = useMemo(() => {
    const n = parseFloat(rateInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [rateInput]);

  const result = useMemo(
    () => computeAdvance(documents, range, ratePercent),
    [documents, range, ratePercent],
  );

  async function persistRate() {
    const raw = rateInput.trim();
    const parsed = raw === "" ? undefined : parseFloat(raw);
    if (raw !== "" && (!Number.isFinite(parsed as number) || (parsed as number) < 0 || (parsed as number) > 100)) {
      setRateError("האחוז חייב להיות מספר בין 0 ל-100");
      return;
    }
    setRateError(null);
    const next = raw === "" ? undefined : Number(parsed);
    if (Number(business.incomeTaxAdvanceRate ?? NaN) === Number(next ?? NaN)) return;
    try {
      // One-column write: never a whole-row save from this snapshot.
      await saveIncomeTaxAdvanceRate(business.id, next);
      setRateSaved(true);
      setTimeout(() => setRateSaved(false), 2000);
    } catch (e) {
      setRateError(e instanceof Error ? e.message : "השמירה נכשלה");
    }
  }

  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string, key: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const rows: { key: string; label: string; display: string; clipboard: string; hint?: string }[] = [
    {
      key: "turnover",
      label: "מחזור עסקאות בתקופה (ללא מע״מ)",
      display: formatCurrency(result.turnover),
      clipboard: String(result.turnover),
      hint: `על ${result.docCount} מסמכים ששולמו בתקופה`,
    },
    {
      key: "rate",
      label: "אחוז המקדמה",
      display: `${result.ratePercent}%`,
      clipboard: String(result.ratePercent),
    },
    {
      key: "advance",
      label: "סכום המקדמה",
      display: formatCurrency(result.advance),
      clipboard: String(result.advance),
    },
    {
      key: "offset",
      label: "ניכוי מס במקור בתקופה (ניתן לקיזוז)",
      display: formatCurrency(result.offset),
      clipboard: String(result.offset),
      hint:
        result.withheld > result.offset
          ? `מתוך ${formatCurrency(result.withheld)} שנוכו בתקופה`
          : undefined,
    },
    {
      key: "due",
      label: "לתשלום",
      display: formatCurrency(result.due),
      clipboard: String(result.due),
    },
  ];

  return (
    <div className="card-soft p-6 print:shadow-none">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <p className="text-sm font-semibold text-stone-700 self-center">
          {range.label} · {formatDate(range.start)} עד {formatDate(range.end)}
        </p>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as PeriodMode)}
          aria-label="תקופת הדיווח"
          className="input-warm py-1.5 px-3 text-sm w-auto max-w-[14rem]"
        >
          {(Object.keys(MODE_LABELS) as PeriodMode[]).map((m) => (
            <option key={m} value={m}>{MODE_LABELS[m]}</option>
          ))}
        </select>
      </div>

      {/* ---------- the one setting this report needs ---------- */}
      <div className="rounded-2xl bg-orange-50/70 border border-orange-100 p-4">
        <label htmlFor="advance-rate" className="text-xs font-semibold text-stone-800 block mb-1">
          אחוז המקדמה (מפנקס המקדמות)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="advance-rate"
            type="number"
            min="0"
            max="100"
            step="0.1"
            dir="ltr"
            inputMode="decimal"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            onBlur={persistRate}
            onKeyDown={(e) => {
              if (e.key === "Enter") void persistRate();
            }}
            placeholder="10"
            className="input-warm w-28 max-w-[7rem]"
          />
          <span className="text-sm text-stone-700">%</span>
          {rateSaved && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              נשמר
            </span>
          )}
        </div>
        {rateError ? (
          <p className="text-xs text-rose-700 mt-1.5 font-semibold">{rateError}</p>
        ) : (
          !rateInput.trim() && (
            <p className="text-xs text-stone-600 mt-1.5 leading-relaxed">
              האחוז מופיע בפנקס המקדמות שקיבלת מפקיד השומה. אפשר לעדכן אותו בכל רגע.
            </p>
          )
        )}
      </div>

      {/* ---------- what to type into the online form ---------- */}
      <ul className="mt-4 divide-y divide-stone-100">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5"
          >
            <span className="text-sm text-stone-800">
              {row.label}
              {row.hint && <span className="block text-xs text-stone-600">{row.hint}</span>}
            </span>
            <span className="flex items-center gap-2">
              <b className="text-base font-extrabold text-stone-900 tabular-nums" dir="ltr">
                {row.display}
              </b>
              <button
                type="button"
                onClick={() => copy(row.clipboard, row.key)}
                title="העתק את המספר בלבד"
                className="no-print inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] px-2.5 rounded-xl text-xs font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
              >
                {copied === row.key ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                    הועתק
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" aria-hidden="true" />
                    העתק
                  </>
                )}
              </button>
            </span>
          </li>
        ))}
      </ul>

      {/* Only meaningful once a rate exists: with no rate there is no advance
          to offset against, so "everything carries over" would be noise. */}
      {result.ratePercent > 0 && result.carriedToAnnual > 0 && (
        <p className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900">
          עודף ניכוי במקור של {formatCurrency(result.carriedToAnnual)} לא אבד, הוא מתקזז בדוח השנתי.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-orange-100 pt-3">
        <p className="text-sm font-semibold text-stone-800">
          מועד הדיווח והתשלום: {formatDate(advanceDueDate(range.end))}
        </p>
        <a
          href="https://www.gov.il/he/service/itc-payment-online-incometax"
          target="_blank"
          rel="noopener"
          className="no-print inline-flex items-center gap-1.5 min-h-[40px] text-sm font-semibold text-orange-700 hover:underline"
        >
          לדיווח ותשלום מקדמות באתר רשות המסים
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
      </div>

      <p className="text-xs text-stone-600 mt-2 leading-relaxed">
        המקדמה מחושבת על המחזור לפני מע״מ לפי המסמכים ששולמו בתקופה. אין קובץ להעלאה, הדיווח הוא טופס מקוון.
      </p>
    </div>
  );
}
