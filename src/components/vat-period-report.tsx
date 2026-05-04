"use client";

import { useMemo, useState } from "react";
import { Printer, Receipt, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { Business, InvoiceDocument, Expense } from "@/lib/types";

interface Props {
  business: Business;
  documents: InvoiceDocument[];
  expenses: Expense[];
}

type PeriodMode = "this_2m" | "last_2m" | "this_month" | "last_month" | "this_year";

const MODE_LABELS: Record<PeriodMode, string> = {
  this_2m: "תקופה דו-חודשית נוכחית",
  last_2m: "תקופה דו-חודשית קודמת",
  this_month: "חודש נוכחי",
  last_month: "חודש קודם",
  this_year: "שנה נוכחית",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Israeli bi-monthly periods are Jan-Feb / Mar-Apr / May-Jun / Jul-Aug /
 * Sep-Oct / Nov-Dec. The "current" period is the one containing today;
 * the "previous" is the one before it.
 */
function biMonthlyRange(reference: Date, offsetPeriods: number): { start: string; end: string; label: string } {
  // Period index (0..5) for the reference month (0-based). Period N covers months 2N..2N+1.
  const refMonth = reference.getMonth();
  const refYear = reference.getFullYear();
  const refPeriodIndex = Math.floor(refMonth / 2);

  // Apply offset, wrapping years.
  let targetIndex = refPeriodIndex + offsetPeriods;
  let targetYear = refYear;
  while (targetIndex < 0) {
    targetIndex += 6;
    targetYear -= 1;
  }
  while (targetIndex > 5) {
    targetIndex -= 6;
    targetYear += 1;
  }

  const startMonth = targetIndex * 2; // 0-based
  const endMonth = startMonth + 1;
  const start = `${targetYear}-${pad(startMonth + 1)}-01`;
  // Last day of endMonth
  const lastDay = new Date(targetYear, endMonth + 1, 0).getDate();
  const end = `${targetYear}-${pad(endMonth + 1)}-${pad(lastDay)}`;
  const monthNames = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
  ];
  const label = `${monthNames[startMonth]}–${monthNames[endMonth]} ${targetYear}`;
  return { start, end, label };
}

function singleMonthRange(reference: Date, offset: number): { start: string; end: string; label: string } {
  const d = new Date(reference.getFullYear(), reference.getMonth() + offset, 1);
  const y = d.getFullYear();
  const m = d.getMonth();
  const start = `${y}-${pad(m + 1)}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const end = `${y}-${pad(m + 1)}-${pad(lastDay)}`;
  const monthNames = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
  ];
  return { start, end, label: `${monthNames[m]} ${y}` };
}

function yearRange(reference: Date): { start: string; end: string; label: string } {
  const y = reference.getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31`, label: `שנת ${y}` };
}

export function VatPeriodReport({ business, documents, expenses }: Props) {
  // ALL hooks must run before any conditional return — same trap as
  // React #310 yesterday. The early return for עוסק פטור comes last.
  const [mode, setMode] = useState<PeriodMode>("this_2m");
  const today = new Date();
  const range = useMemo(() => {
    switch (mode) {
      case "this_2m": return biMonthlyRange(today, 0);
      case "last_2m": return biMonthlyRange(today, -1);
      case "this_month": return singleMonthRange(today, 0);
      case "last_month": return singleMonthRange(today, -1);
      case "this_year": return yearRange(today);
    }
    // unreachable, satisfies TS
    return biMonthlyRange(today, 0);
  }, [mode, today]);

  const stats = useMemo(() => {
    const docsInRange = documents.filter(
      (d) => d.date >= range.start && d.date <= range.end &&
             d.status !== "draft" && d.status !== "cancelled"
    );
    const expensesInRange = expenses.filter(
      (e) => e.date >= range.start && e.date <= range.end
    );

    // Output VAT (מע"מ עסקאות) = sum of VAT charged on tax invoices and
    // tax-invoice-receipts. Credit notes subtract.
    let outputVat = 0;
    let taxableSales = 0;
    for (const d of docsInRange) {
      if (d.type === "tax_invoice" || d.type === "tax_invoice_receipt") {
        outputVat += d.vat;
        taxableSales += d.subtotal;
      } else if (d.type === "credit_note") {
        outputVat -= d.vat;
        taxableSales -= d.subtotal;
      }
    }

    // Input VAT (מע"מ תשומות) = sum of vat_amount on expenses in period.
    let inputVat = 0;
    let inputBase = 0;
    for (const e of expensesInRange) {
      const v = e.vatAmount || 0;
      inputVat += v;
      inputBase += (e.amount - v);
    }

    return {
      outputVat,
      inputVat,
      netDue: outputVat - inputVat,
      taxableSales,
      inputBase,
      docCount: docsInRange.filter(
        (d) => d.type === "tax_invoice" || d.type === "tax_invoice_receipt" || d.type === "credit_note"
      ).length,
      expenseCount: expensesInRange.length,
    };
  }, [documents, expenses, range]);

  // Hidden for עוסק פטור — they don't file VAT.
  if (business.businessType !== "authorized" && business.businessType !== "company") {
    return null;
  }

  const refundDue = stats.netDue < 0;

  return (
    <div className="card-soft p-6 print:shadow-none">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-orange-500" />
            דיווח מע״מ תקופתי
          </h2>
          <p className="text-sm text-stone-700 mt-1">
            {range.label} · {range.start.slice(0, 10)} עד {range.end.slice(0, 10)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as PeriodMode)}
            className="input-warm py-1.5 px-3 text-sm w-auto"
          >
            {(Object.keys(MODE_LABELS) as PeriodMode[]).map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m]}</option>
            ))}
          </select>
          <button
            onClick={() => window.print()}
            className="no-print inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
          >
            <Printer className="w-4 h-4" />
            הדפס
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 mb-1">
            <ArrowUpFromLine className="w-3.5 h-3.5" />
            מע״מ עסקאות (פלט)
          </div>
          <p className="text-2xl font-bold text-stone-900" dir="ltr">{formatCurrency(stats.outputVat)}</p>
          <p className="text-xs text-stone-600 mt-1">
            על {stats.docCount} מסמכי מס · בסיס {formatCurrency(stats.taxableSales)}
          </p>
        </div>
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-rose-700 mb-1">
            <ArrowDownToLine className="w-3.5 h-3.5" />
            מע״מ תשומות (קלט)
          </div>
          <p className="text-2xl font-bold text-stone-900" dir="ltr">{formatCurrency(stats.inputVat)}</p>
          <p className="text-xs text-stone-600 mt-1">
            על {stats.expenseCount} הוצאות · בסיס {formatCurrency(stats.inputBase)}
          </p>
        </div>
        <div
          className={`rounded-2xl border p-4 ${
            refundDue ? "bg-blue-50 border-blue-200" : "bg-orange-50 border-orange-200"
          }`}
        >
          <div
            className={`text-xs font-medium mb-1 ${refundDue ? "text-blue-700" : "text-orange-700"}`}
          >
            {refundDue ? "החזר ממע״מ" : "מע״מ לתשלום"}
          </div>
          <p className="text-2xl font-bold text-stone-900" dir="ltr">
            {formatCurrency(Math.abs(stats.netDue))}
          </p>
          <p className="text-xs text-stone-600 mt-1">
            {refundDue
              ? "תשומות עולות על עסקאות"
              : "סכום להעביר לרשות המסים"}
          </p>
        </div>
      </div>

      <div className="text-xs text-stone-600 leading-relaxed border-t border-orange-100 pt-3">
        <strong className="text-stone-700">איך מחושב:</strong>{" "}
        מע״מ עסקאות = ה-מע״מ שנגבה מהלקוחות בחשבוניות מס וחשבוניות מס/קבלה (ללא טיוטות וביטולים, חשבוניות זיכוי מקטינות).
        מע״מ תשומות = שדה &quot;מתוכו מע״מ&quot; שהזנת על כל הוצאה. הסיכום אינו תחליף לדוח טופס 102 אצל רואה החשבון —
        משמש לבקרה והכנה בלבד.
      </div>
    </div>
  );
}
