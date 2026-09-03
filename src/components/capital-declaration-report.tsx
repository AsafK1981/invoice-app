"use client";

import { useMemo, useState } from "react";
import { Wallet, Printer, Download, ExternalLink, Info, Circle } from "lucide-react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { formatCurrency, formatDate } from "@/lib/format";
import { todayInIsrael } from "@/lib/date";
import { DOCUMENT_TYPE_LABELS, isCountableRevenue, type InvoiceDocument, type Expense } from "@/lib/types";
import { computeOpenReceivables } from "@/lib/capital-declaration";
import { exportCapitalDeclarationDraft } from "@/lib/csv-export";
import { useBusiness } from "@/lib/business-store";

interface Props {
  documents: InvoiceDocument[];
  expenses: Expense[];
  /** On its own /reports/capital-declaration page the page header already carries the title; skip the card's. */
  headless?: boolean;
}

interface YearRow {
  year: number;
  income: number;
  expenses: number;
  profit: number;
  documentsCount: number;
  expensesCount: number;
}

const GOV_IL_FORM_URL = "https://www.gov.il/he/service/itc1219";

/**
 * Everything a הצהרת הון requires that this app has zero data about. This
 * list is shown as an explicit "you still need to fill these" checklist -
 * never rendered as if the app covered them.
 */
const NOT_COVERED_CATEGORIES = [
  "יתרות בחשבונות בנק בישראל",
  "יתרות בחשבונות בנק ונכסים בחו״ל",
  "נדל״ן: דירות, קרקעות, נכסים מסחריים",
  "ניירות ערך וקרנות נאמנות, לפי עלות מקורית (לא שווי שוק)",
  "רכבים וכלי תחבורה אחרים",
  "חפצים בעלי ערך מעל ₪1,000 (תכשיטים, אמנות, שעונים וכו׳)",
  "הלוואות והתחייבויות שאתם חייבים לאחרים",
  "נכסים דיגיטליים - מטבעות קריפטוגרפיים וכיו״ב (נוסף לטופס בעדכון 2025)",
];

/**
 * הצהרת הון, Statement of Capital (טופס 1219). Filed only when the Tax
 * Authority formally demands it (typically every few years, or after a
 * specific request) - never on the taxpayer's own initiative and never
 * automatically imported from רשות המסים; there is no such API. It compares
 * total personal + business wealth at the start and end of a period and
 * reconciles the difference against declared profits and living expenses.
 *
 * This component does two honest, bounded things:
 * 1. Explains what the form is and links to the official gov.il page.
 * 2. Prefills the ONLY slice of it this app actually has data for: the
 *    business's declared income/expenses per year, and open receivables
 *    (money clients still owe). Everything else - bank balances, real
 *    estate, securities, vehicles, valuables, loans - is listed as an
 *    explicit checklist the user must complete separately, never implied
 *    to be covered.
 */
export function CapitalDeclarationReport({ headless = false, documents, expenses }: Props) {
  const { business } = useBusiness();
  const currentYear = new Date().getFullYear();
  const [fromYear, setFromYear] = useState<number>(currentYear - 4);
  const [toYear, setToYear] = useState<number>(currentYear);
  const [asOfDate, setAsOfDate] = useState<string>(todayInIsrael());

  const rows = useMemo<YearRow[]>(() => {
    const result: YearRow[] = [];
    for (let y = fromYear; y <= toYear; y++) {
      const yearDocs = documents.filter(
        (d) => d.status === "paid" && isCountableRevenue(d) && d.date.startsWith(`${y}-`)
      );
      const yearExpenses = expenses.filter((e) => e.date.startsWith(`${y}-`));
      const income = yearDocs.reduce((s, d) => s + (d.totalIls ?? d.total), 0);
      const totalExpenses = yearExpenses.reduce((s, e) => s + e.amount, 0);
      result.push({
        year: y,
        income,
        expenses: totalExpenses,
        profit: income - totalExpenses,
        documentsCount: yearDocs.length,
        expensesCount: yearExpenses.length,
      });
    }
    return result;
  }, [documents, expenses, fromYear, toYear]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        income: acc.income + r.income,
        expenses: acc.expenses + r.expenses,
        profit: acc.profit + r.profit,
        documentsCount: acc.documentsCount + r.documentsCount,
        expensesCount: acc.expensesCount + r.expensesCount,
      }),
      { income: 0, expenses: 0, profit: 0, documentsCount: 0, expensesCount: 0 }
    );
  }, [rows]);

  const receivables = useMemo(
    () => computeOpenReceivables(documents, asOfDate),
    [documents, asOfDate]
  );

  const yearOptions: number[] = [];
  for (let y = currentYear; y >= currentYear - 10; y--) yearOptions.push(y);

  function handleExport() {
    exportCapitalDeclarationDraft({
      asOfDate,
      yearRows: rows,
      receivables,
      notCoveredCategories: NOT_COVERED_CATEGORIES,
      businessName: business.name,
    });
  }

  return (
    <div className="card-soft p-6 print:shadow-none">
      <div className={`flex items-start gap-3 mb-5 flex-wrap ${headless ? "justify-end" : "justify-between"}`}>
        {!headless && (
          <div>
            <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
              <Wallet className="w-5 h-5 text-purple-500" />
              הכנה להצהרת הון
            </h2>
            <p className="text-sm text-stone-700 mt-1">
              טיוטה חלקית לצירוף לטופס ההצהרה או לשימוש רואה החשבון - החלק העסקי בלבד.
            </p>
          </div>
        )}
        <div className="no-print flex items-center gap-2">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50"
          >
            <Download className="w-4 h-4" />
            ייצוא CSV
          </button>
          <DownloadPdfButton
            filename={`הכנה-להצהרת-הון-${asOfDate}`}
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

      {/* Unmissable, always-visible (including in print) disclaimer. This is
          the single most important sentence in the component: nothing below
          it is a completed הצהרת הון, and the app cannot make it one. */}
      <div className="mb-5 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-3">
        <Info className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
        <div>
          <p className="font-bold">זו לא הצהרת הון מוכנה - ולא ניתן להפוך אותה לכזו אוטומטית.</p>
          <p className="mt-1">
            אין דרך לייבא נתונים אוטומטית מרשות המסים. המערכת מכירה רק את נתוני העסק שהוזנו בה:
            הכנסות מדווחות וחייבים פתוחים. היא לא מכירה חשבונות בנק, נדל״ן, ניירות ערך, רכבים,
            חפצי ערך או הלוואות אישיות. הצהרת הון ממלאים רק כשרשות המסים דורשת זאת רשמית בטופס
            1219, ורק לאחר שהשלמתם את כל הסעיפים ואימתתם מול רואה חשבון.
          </p>
        </div>
      </div>

      {/* GUIDE */}
      <div className="mb-6 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-800 space-y-2">
        <h3 className="font-bold text-stone-900">מהי הצהרת הון, בקצרה</h3>
        <p>
          הצהרת הון (טופס 1219) היא דוח שרשות המסים דורשת מעת לעת - בדרך כלל כל כמה שנים, או
          לפי דרישה פרטנית - שבו מפרטים את כל הנכסים וההתחייבויות שלכם נכון לתאריך מסוים. רשות
          המסים משווה בין הצהרות עוקבות ובודקת שהגידול בהון תואם את ההכנסות המדווחות. ממלאים
          אותה רק כשמקבלים דרישה רשמית, לא ביוזמה עצמית ולא כל שנה.
        </p>
        <p>הסעיפים שהטופס דורש:</p>
        <ul className="list-disc mr-5 space-y-0.5">
          <li>יתרות בחשבונות בנק, בישראל ובחו״ל</li>
          <li>נדל״ן</li>
          <li>ניירות ערך וקרנות, לפי עלות מקורית</li>
          <li>רכבים וכלי תחבורה</li>
          <li>חפצי ערך מעל ₪1,000</li>
          <li>הלוואות והתחייבויות</li>
          <li>חייבים - כספים שמגיעים לכם</li>
          <li>נכסים דיגיטליים (נוסף לטופס בעדכון 2025)</li>
        </ul>
        <p>
          <a
            href={GOV_IL_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-purple-700 hover:text-purple-900 font-semibold"
          >
            הטופס הרשמי באתר gov.il
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </p>
      </div>

      <h3 className="font-bold text-stone-900 mb-3">מה שהמערכת יודעת - חלק עסקי בלבד</h3>

      <div className="no-print flex flex-wrap items-center gap-3 mb-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-stone-500">משנת:</span>
          <select
            value={fromYear}
            onChange={(e) => {
              const y = parseInt(e.target.value, 10);
              setFromYear(y);
              if (y > toYear) setToYear(y);
            }}
            className="input-warm py-1.5 px-3 text-sm w-auto"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-stone-500">עד שנת:</span>
          <select
            value={toYear}
            onChange={(e) => {
              const y = parseInt(e.target.value, 10);
              setToYear(y);
              if (y < fromYear) setFromYear(y);
            }}
            className="input-warm py-1.5 px-3 text-sm w-auto"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <span className="text-stone-500 text-xs">
          ({toYear - fromYear + 1} שנים)
        </span>
      </div>

      <p className="text-xs text-stone-600 mb-2">הכנסות עסקיות מוצהרות, לפי שנה (מסמכים ששולמו בפועל):</p>

      <div className="overflow-hidden rounded-2xl border border-purple-100">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-purple-50 text-stone-700">
            <tr>
              <th className="text-right px-4 py-3 font-semibold">שנה</th>
              <th className="text-left px-4 py-3 font-semibold">הכנסות</th>
              <th className="text-left px-4 py-3 font-semibold">הוצאות</th>
              <th className="text-left px-4 py-3 font-semibold">רווח נקי</th>
              <th className="text-left px-4 py-3 font-semibold text-stone-500 hidden md:table-cell">
                מסמכים / הוצאות
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={r.year}
                className={`border-t border-purple-50 ${idx % 2 === 0 ? "bg-white" : "bg-purple-50/30"}`}
              >
                <td className="px-4 py-3 font-semibold text-stone-900">{r.year}</td>
                <td className="px-4 py-3 text-left text-emerald-700 font-semibold tabular-nums">
                  {formatCurrency(r.income)}
                </td>
                <td className="px-4 py-3 text-left text-rose-700 font-semibold tabular-nums">
                  {formatCurrency(r.expenses)}
                </td>
                <td className="px-4 py-3 text-left font-bold text-stone-900 tabular-nums">
                  {formatCurrency(r.profit)}
                </td>
                <td className="px-4 py-3 text-left text-xs text-stone-500 hidden md:table-cell tabular-nums">
                  {r.documentsCount} / {r.expensesCount}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-purple-200 bg-purple-100/60">
              <td className="px-4 py-3 font-bold text-stone-900">סה״כ</td>
              <td className="px-4 py-3 text-left font-bold text-emerald-700 tabular-nums">
                {formatCurrency(totals.income)}
              </td>
              <td className="px-4 py-3 text-left font-bold text-rose-700 tabular-nums">
                {formatCurrency(totals.expenses)}
              </td>
              <td className="px-4 py-3 text-left font-bold text-stone-900 tabular-nums">
                {formatCurrency(totals.profit)}
              </td>
              <td className="px-4 py-3 text-left text-xs text-stone-600 hidden md:table-cell tabular-nums">
                {totals.documentsCount} / {totals.expensesCount}
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
          <div className="text-xs text-emerald-900">ממוצע הכנסה שנתי</div>
          <div className="text-lg font-bold text-emerald-900 mt-0.5">
            {formatCurrency(rows.length > 0 ? totals.income / rows.length : 0)}
          </div>
        </div>
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3">
          <div className="text-xs text-rose-900">ממוצע הוצאה שנתי</div>
          <div className="text-lg font-bold text-rose-900 mt-0.5">
            {formatCurrency(rows.length > 0 ? totals.expenses / rows.length : 0)}
          </div>
        </div>
        <div className="gk-avg-profit rounded-xl bg-stone-50 border border-stone-200 p-3">
          <div className="text-xs text-stone-700">ממוצע רווח שנתי</div>
          <div className="text-lg font-bold text-stone-900 mt-0.5">
            {formatCurrency(rows.length > 0 ? totals.profit / rows.length : 0)}
          </div>
        </div>
      </div>

      {/* RECEIVABLES - a real asset line on הצהרת הון (חייבים), computed as
          of a chosen snapshot date rather than the year range above. */}
      <div className="mt-6 pt-6 border-t border-stone-200">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
          <p className="text-xs text-stone-600">
            חייבים פתוחים (לקוחות שטרם שילמו) - נכס שנכלל בהצהרת הון:
          </p>
          <label className="no-print flex items-center gap-2 text-xs">
            <span className="text-stone-500">נכון לתאריך:</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="input-warm py-1 px-2 text-xs w-auto"
            />
          </label>
        </div>
        <p className="hidden print:block text-xs text-stone-600 mb-2">
          נכון לתאריך {formatDate(asOfDate)}
        </p>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 flex items-baseline justify-between gap-3 flex-wrap">
          <span className="text-sm text-blue-900">
            {receivables.count} מסמכים פתוחים
          </span>
          <span className="text-lg font-bold text-blue-900 tabular-nums" dir="ltr">
            {formatCurrency(receivables.total)}
          </span>
        </div>

        {receivables.docs.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-xl border border-blue-100">
            <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-blue-50/60 text-stone-600">
                <tr>
                  <th className="text-right px-3 py-2 font-semibold">מסמך</th>
                  <th className="text-right px-3 py-2 font-semibold">לקוח</th>
                  <th className="text-right px-3 py-2 font-semibold">תאריך</th>
                  <th className="text-left px-3 py-2 font-semibold">סכום</th>
                </tr>
              </thead>
              <tbody>
                {receivables.docs.map((d, idx) => (
                  <tr
                    key={d.id}
                    className={`border-t border-blue-50 ${idx % 2 === 0 ? "bg-white" : "bg-blue-50/20"}`}
                  >
                    <td className="px-3 py-2 text-stone-800">
                      {DOCUMENT_TYPE_LABELS[d.type]} #{d.number}
                    </td>
                    <td className="px-3 py-2 text-stone-800">{d.clientName}</td>
                    <td className="px-3 py-2 text-stone-600">{formatDate(d.date)}</td>
                    <td className="px-3 py-2 text-left font-semibold tabular-nums" dir="ltr">
                      {formatCurrency(d.totalIls ?? d.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      {/* NOT COVERED - explicit, so nothing here is ever mistaken for a
          system-verified figure. */}
      <div className="mt-6 pt-6 border-t border-stone-200">
        <h3 className="font-bold text-stone-900 mb-1">עדיין לא מכוסה על ידי המערכת - יש למלא בנפרד</h3>
        <p className="text-xs text-stone-600 mb-3">
          אלה סעיפי הצהרת ההון שהמערכת אינה מחזיקה עליהם שום נתון. אין לה גישה לחשבונות בנק, רישומי
          טאבו, ברוקרים, משרד הרישוי או חוזי הלוואה - את אלה משיגים ישירות מהמקורות, ומצרפים בעצמכם.
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-stone-800">
          {NOT_COVERED_CATEGORIES.map((cat) => (
            <li key={cat} className="flex items-start gap-2">
              <Circle className="w-3.5 h-3.5 mt-1 shrink-0 text-stone-400" />
              <span>{cat}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 rounded-xl bg-purple-50 border border-purple-200 p-3 text-xs text-purple-900">
        <strong>שים לב:</strong> הצהרת הון משווה את ההון בתחילת תקופה לסופה. הטבלה והחייבים למעלה
        מספקים רק את חלק העסק שהמערכת מכירה. יש להוסיף את כל הסעיפים האישיים בנפרד ולאמת את כל
        הטיוטה מול רואה חשבון לפני הגשה.
      </div>
    </div>
  );
}
