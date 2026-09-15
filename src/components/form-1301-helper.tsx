"use client";

import { useMemo } from "react";
import { ClipboardList, Printer, Copy, Check } from "lucide-react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { useState } from "react";
import { formatCurrencyWhole } from "@/lib/format";
import { type Business, type InvoiceDocument, type Expense } from "@/lib/types";
import { countsAsIncome } from "@/lib/revenue";
import { form1301Expenses } from "@/lib/form-1301-figures";
import { canIssueTaxInvoicesByType } from "@/lib/vat";

interface Props {
  year: number;
  business: Business;
  documents: InvoiceDocument[];
  expenses: Expense[];
  /** On its own /reports/form-1301 page the page header already carries the title; skip the card's. */
  headless?: boolean;
}

interface FieldRow {
  code: string;
  label: string;
  value: number;
  note?: string;
}

/**
 * טופס 1301, דוח שנתי ליחיד. Maps computed values to the actual
 * field codes on the form so the user can copy them straight into
 * the gov.il online filing or hand them to their accountant. Codes
 * are taken from the 2025 form revision; fields specific to עוסק
 * מורשה (VAT) are only shown when relevant.
 */
export function Form1301Helper({ headless = false, year, business, documents, expenses }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const fields = useMemo<FieldRow[]>(() => {
    const paid = documents.filter((d) => countsAsIncome(d));
    const grossIncome = paid.reduce((s, d) => s + ((d.subtotalIls ?? d.subtotal) || ((d.totalIls ?? d.total) - (d.vatIls ?? (d.vat || 0)))), 0);
    const totalIncomeWithVat = paid.reduce((s, d) => s + (d.totalIls ?? d.total), 0);
    // Net of credit notes, not absolute: a credit note reduces the
    // transaction and its VAT, and this figure sits next to grossIncome /
    // netProfit above, which are already netted the same way (credit notes
    // are stored ALREADY NEGATIVE on save). Math.abs() here would add a
    // refund's VAT back in as if it were still collected.
    const vatCollected = paid.reduce((s, d) => s + ((d.vatIls ?? d.vat) || 0), 0);
    const { vatInput, deductibleExpenses } = form1301Expenses(expenses, business.businessType);
    const netProfit = grossIncome - deductibleExpenses;

    // Field numbers verified 2026-09-15 against the Tax Authority's own 2025
    // forms (1301-2025 and 1320-2025 PDFs on gov.il): business PROFIT goes in
    // 150 (the registered spouse) or 170 (the other spouse); turnover is the
    // disclosure field 238 / 239 and is not part of the tax calculation;
    // expenses are not a 1301 field at all, they are itemised on נספח א
    // (טופס 1320), whose bottom line is the profit carried to 150 / 170.
    // 158 / 172 are SALARY fields and must never be offered here.
    const rows: FieldRow[] = [
      {
        code: "238 / 239",
        label: "מחזור עסקי מעסק או משלח יד, ללא מע״מ",
        value: grossIncome,
        note: "שדה גילוי בלבד, לא נכנס לחישוב המס. 238 לבן הזוג הרשום, 239 לבן או בת הזוג. מסמכים ששולמו פחות חשבוניות זיכוי.",
      },
      {
        code: "טופס 1320",
        label: "הוצאות מוכרות",
        value: deductibleExpenses,
        note: canIssueTaxInvoicesByType(business.businessType)
          ? "אין שדה אחד כזה ב-1301: ההוצאות מפורטות שורה-שורה בנספח א (טופס 1320). כאן בלי רכיב המע״מ, שמקוזז בדוח המע״מ."
          : "אין שדה אחד כזה ב-1301: ההוצאות מפורטות שורה-שורה בנספח א (טופס 1320). זה הסכום הכולל שנרשם במערכת.",
      },
      {
        code: "150 / 170",
        label: "הכנסה מעסק או משלח יד (הרווח אחרי הוצאות)",
        value: netProfit,
        note: "150 לבן הזוג הרשום, 170 לבן או בת הזוג. זה הסכום שבשורה התחתונה של טופס 1320, לפני מס.",
      },
    ];

    if (business.businessType === "authorized" || business.businessType === "company") {
      rows.push({
        code: "-",
        label: "מע״מ עסקאות שנגבה (לדוח מע״מ)",
        value: vatCollected,
        note: "אינו שדה ב-1301; לדיווח לרשות המע״מ",
      });
      rows.push({
        code: "-",
        label: "מע״מ תשומות (זיכוי לדוח מע״מ)",
        value: vatInput,
        note: "מסכום ה-vatAmount של ההוצאות",
      });
    }

    if (business.businessType === "authorized") {
      rows.push({
        code: "-",
        label: "סך כל המחזור כולל מע״מ",
        value: totalIncomeWithVat,
        note: "להשוואה מול ספח שנתי של רשות המסים",
      });
    }

    return rows;
  }, [documents, expenses, business.businessType]);

  function copy(text: string, code: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="card-soft p-6 print:shadow-none">
      <div className={`flex items-start gap-3 mb-5 flex-wrap ${headless ? "justify-end" : "justify-between"}`}>
        {!headless && (
          <div>
            <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-blue-500" />
              עזר למילוי טופס 1301 · {year}
            </h2>
            <p className="text-sm text-stone-700 mt-1">
              הערכים מוכנים להעתקה ישירה לטופס הדוח השנתי באתר רשות המסים, או לרואה החשבון.
            </p>
          </div>
        )}
        <div className="no-print flex items-center gap-2 flex-wrap">
          <DownloadPdfButton
            filename={`עזר-לטופס-1301-${year}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
            iconClassName="w-4 h-4"
          />
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
          >
            <Printer className="w-4 h-4" />
            הדפס
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-blue-100">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-blue-50 text-stone-700">
            <tr>
              <th scope="col" className="text-right px-4 py-3 font-semibold w-24">שדה</th>
              <th scope="col" className="text-right px-4 py-3 font-semibold">תיאור</th>
              <th scope="col" className="text-left px-4 py-3 font-semibold w-40">ערך</th>
              <th scope="col" className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, idx) => (
              <tr
                key={f.code + idx}
                className={`border-t border-blue-50 ${idx % 2 === 0 ? "bg-white" : "bg-blue-50/30"}`}
              >
                <td className="px-4 py-3 font-mono font-semibold text-blue-900">{f.code}</td>
                <td className="px-4 py-3 text-stone-800">
                  {f.label}
                  {f.note && <div className="text-xs text-stone-500 mt-0.5">{f.note}</div>}
                </td>
                <td className="px-4 py-3 text-left font-bold text-stone-900 tabular-nums">
                  {formatCurrencyWhole(f.value)}
                </td>
                <td className="px-2 py-3">
                  <button
                    onClick={() => copy(String(Math.round(f.value)), f.code + idx)}
                    title="העתק ערך נקי (בלי סימן מטבע)"
                    className="no-print p-1.5 rounded-lg hover:bg-blue-100 text-stone-500 hover:text-blue-700 transition"
                  >
                    {copied === f.code + idx ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
        <strong>שים לב:</strong> השדות שונים מעט לפי מצב משפחתי, מקורות הכנסה נוספים ועיסוקים נוספים.
        זה עזר לחישוב המספרים. את הטופס המלא ממלאים באתר רשות המסים או דרך רואה חשבון.
      </div>
    </div>
  );
}
