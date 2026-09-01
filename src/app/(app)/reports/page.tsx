"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Wallet, Clock, Download, ChevronDown,
  FileText, ClipboardList, Calculator, BookOpen, FileSpreadsheet, Landmark, FileArchive,
  SlidersHorizontal, Receipt, ArrowLeft, Minus, Printer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { isCountableRevenue } from "@/lib/types";
import { useExpenses } from "@/lib/expense-store";
import { useBusiness } from "@/lib/business-store";
import { useClients } from "@/lib/client-store";
import { formatCurrency } from "@/lib/format";
import { exportDocuments, exportExpenses, exportMonthlySummary } from "@/lib/csv-export";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/error-message";
import { computeAging, AGING_BUCKET_LABELS } from "@/lib/aging";
import {
  type Period, HEBREW_MONTHS_SHORT,
  periodYear, periodMatches, periodMatchesMonth, periodChartMonths, periodLabel,
  periodStepLabel, shiftPeriod, periodRange, previousEquivalentRange, inRange,
  monthLabel,
} from "@/lib/report-period";
import { PeriodPicker } from "@/components/period-picker";
import { ReportsBarChart, type BarDatum } from "@/components/reports-bar-chart";
import type { InvoiceDocument, Expense } from "@/lib/types";

type MonthTotals = { income: number; expenses: number; docs: number };

/** Paid, countable income and expenses summed per "YYYY-MM". */
function bucketByMonth(documents: InvoiceDocument[], expenses: Expense[]): Map<string, MonthTotals> {
  const map = new Map<string, MonthTotals>();
  for (const d of documents) {
    if (d.status !== "paid" || !isCountableRevenue(d)) continue;
    const m = d.date.slice(0, 7);
    const cur = map.get(m) || { income: 0, expenses: 0, docs: 0 };
    cur.income += d.totalIls ?? d.total;
    cur.docs += 1;
    map.set(m, cur);
  }
  for (const e of expenses) {
    const m = e.date.slice(0, 7);
    const cur = map.get(m) || { income: 0, expenses: 0, docs: 0 };
    cur.expenses += e.amount;
    map.set(m, cur);
  }
  return map;
}

function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export default function ReportsPage() {
  const { documents, ready: docsReady } = useDocuments();
  const { items: expenses, ready: expReady } = useExpenses();
  const { items: clients } = useClients();
  const { business } = useBusiness();
  const showToast = useToast();
  const [period, setPeriod] = useState<Period>(() => String(new Date().getFullYear()));

  const year = periodYear(period);
  /** File-name tag for the exports: "2026-08", or "2026-01-05_2026-03-10" for a range. */
  const fileTag = period.replace("..", "_");

  /* ---------- period-scoped totals ---------- */
  const filteredDocs = useMemo(() => documents.filter((d) => periodMatches(period, d.date)), [documents, period]);
  const filteredExpenses = useMemo(() => expenses.filter((e) => periodMatches(period, e.date)), [expenses, period]);

  const paidDocs = useMemo(
    () => filteredDocs.filter((d) => d.status === "paid" && isCountableRevenue(d)),
    [filteredDocs],
  );
  const totalIncome = paidDocs.reduce((sum, d) => sum + (d.totalIls ?? d.total), 0);
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const profit = totalIncome - totalExpenses;

  /* ---------- same period one unit earlier, clipped to the same day ---------- */
  const comparison = useMemo(() => {
    const cur = periodRange(period);
    const prev = previousEquivalentRange(period);
    if (!cur || !prev) return null;
    let curIncome = 0, prevIncome = 0, curExpenses = 0, prevExpenses = 0;
    for (const d of documents) {
      if (d.status !== "paid" || !isCountableRevenue(d)) continue;
      const v = d.totalIls ?? d.total;
      if (inRange(d.date, cur)) curIncome += v;
      else if (inRange(d.date, prev)) prevIncome += v;
    }
    for (const e of expenses) {
      if (inRange(e.date, cur)) curExpenses += e.amount;
      else if (inRange(e.date, prev)) prevExpenses += e.amount;
    }
    return {
      income: deltaPct(curIncome, prevIncome),
      expenses: deltaPct(curExpenses, prevExpenses),
      label: periodStepLabel(shiftPeriod(period, -1)),
    };
  }, [documents, expenses, period]);

  /* ---------- open receivables (all time - a debt is a debt) ---------- */
  const aging = useMemo(() => computeAging(documents, clients), [documents, clients]);

  /* ---------- month buckets for the chart + the table ----------
     `monthTotals` sums EVERYTHING, for the chart's dimmed context months;
     `periodTotals` sums only what the period matched, so a free range that
     starts on the 20th shows that month's bar and table row from the 20th,
     the same figures the KPIs above add up to. For whole-month periods the
     two agree on every active month. */
  const monthTotals = useMemo(() => bucketByMonth(documents, expenses), [documents, expenses]);
  const periodTotals = useMemo(
    () => bucketByMonth(filteredDocs, filteredExpenses),
    [filteredDocs, filteredExpenses],
  );

  const chartData = useMemo<BarDatum[]>(() => {
    const months = periodChartMonths(period);
    const showYear = year === null || months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
    return months.map((ym) => {
      const active = periodMatchesMonth(period, ym);
      const t = (active ? periodTotals : monthTotals).get(ym) || { income: 0, expenses: 0 };
      const mi = parseInt(ym.slice(5, 7), 10) - 1;
      return {
        key: ym,
        label: showYear ? `${HEBREW_MONTHS_SHORT[mi]} ${ym.slice(2, 4)}` : HEBREW_MONTHS_SHORT[mi],
        title: monthLabel(ym),
        income: t.income,
        expenses: t.expenses,
        active,
      };
    });
  }, [monthTotals, periodTotals, year, period]);

  /* Newest month first; `cumulative` is the running profit from the oldest
     month of the period up to and including this row, so the top row equals
     the period total. `margin` is null for a month with no income (an
     expense-only month has no meaningful margin). */
  const tableRows = useMemo(() => {
    const asc = Array.from(periodTotals.entries())
      .sort(([a], [b]) => a.localeCompare(b));
    let running = 0;
    return asc
      .map(([ym, t]) => {
        running += t.income - t.expenses;
        return {
          month: ym,
          label: monthLabel(ym),
          income: t.income,
          expenses: t.expenses,
          docs: t.docs,
          margin: t.income > 0 ? Math.round(((t.income - t.expenses) / t.income) * 100) : null,
          cumulative: running,
        };
      })
      .reverse();
  }, [periodTotals]);
  const totalDocs = tableRows.reduce((sum, r) => sum + r.docs, 0);
  const totalMargin = totalIncome > 0 ? Math.round((profit / totalIncome) * 100) : null;

  /* ---------- exports ---------- */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const exportYear = year ?? new Date().getFullYear();

  async function downloadUniformStructure(sample = false) {
    setMenuOpen(false);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      showToast("פג תוקף ההתחברות, התחבר מחדש");
      return;
    }
    const qs = `year=${exportYear}${sample ? "&sample=true" : ""}`;
    const res = await fetch(`/api/uniform-structure/export?${qs}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "שגיאה לא ידועה" }));
      showToast(friendlyError(err, `ייצוא נכשל (${res.status})`));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `OPENFRMT-${business.taxId}-${exportYear}${sample ? "-SAMPLE" : ""}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------- the report cards ---------- */
  const filesVat = business.businessType === "authorized" || business.businessType === "company";
  const cards: ReportCardSpec[] = [
    {
      icon: FileText, title: "סיכום שנתי לדיווח", href: `/reports/annual/${exportYear}`, featured: true,
      desc: "כל המספרים לדוח השנתי במקום אחד: הכנסות לפי סוג מסמך, הוצאות לפי קטגוריה, לקוחות גדולים.",
    },
    {
      icon: ClipboardList, title: "עזר לטופס 1301", href: `/reports/form-1301/${exportYear}`,
      desc: "הערכים מוכנים להעתקה ישירה לטופס הדוח השנתי באתר רשות המסים.",
    },
    ...(filesVat
      ? [{
          icon: Receipt, title: "דיווח מע״מ תקופתי", href: "/reports/vat",
          desc: "מע״מ עסקאות מול מע״מ תשומות לתקופת הדיווח, מוכן להעתקה לדיווח, כולל פירוט כל הוצאה.",
        } as ReportCardSpec]
      : []),
    {
      icon: Calculator, title: "צפי מס שנתי", href: "/reports/tax-projection",
      desc: "כמה מס הכנסה וביטוח לאומי צפויים לסוף השנה, וכמה כדאי לשמור בצד.",
    },
    {
      icon: BookOpen, title: "יומן שנתי", href: `/reports/journal/${exportYear}`,
      desc: "יומן הכנסות והוצאות מעוצב להדפסה או לשמירה כ-PDF.",
    },
    {
      icon: FileSpreadsheet, title: "דוח חשבוניות תקופתי", href: "/reports/invoices-period",
      desc: "חודש, חודשיים, רבעון או חצי שנה: מספר, תאריך, סכום, מספר הקצאה.",
    },
    {
      icon: Landmark, title: "הכנה להצהרת הון", href: "/reports/capital-declaration",
      desc: "טיוטה של החלק העסקי בלבד, לצירוף לטופס 1219 או לרואה החשבון.",
    },
    {
      icon: FileArchive, title: "מבנה אחיד (OPENFORMAT)", action: "הורד", onClick: () => downloadUniformStructure(false),
      desc: `קבצי מבנה אחיד לשנת ${exportYear} לפי דרישת רשות המסים, לביקורת או לרואה החשבון.`,
    },
    {
      icon: SlidersHorizontal, title: "דוח מותאם", href: "/reports/custom",
      desc: "בחר מסננים חופשיים - תאריך, לקוח, סוג, סטטוס - והפק כל חתך.",
    },
  ];

  if (!docsReady || !expReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  const bucketColors = ["#fdba74", "#f97316", "#c2410c", "#9a3520"];
  const topDebtors = aging.rows.slice(0, 3);

  return (
    <div className="space-y-6 rpt">
      {/* ---------- header: title + one period control that scopes the whole page ---------- */}
      <div className="rpt-head">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl fgrad fgrad-emerald flex items-center justify-center shadow-sm">
              <TrendingUp className="w-5 h-5 text-white" />
            </span>
            דו״חות
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">מה נכנס, מה יצא ומה נשאר - לפי התקופה שבחרת</p>
        </div>
        <div className="rpt-controls">
          <PeriodPicker period={period} onChange={setPeriod} />
          <div className="rpt-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="pgbtn pgbtn-quiet"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Download aria-hidden="true" />
              ייצוא
              <ChevronDown aria-hidden="true" className="rpt-menu-caret" />
            </button>
            {menuOpen && (
              <div className="rpt-menu" role="menu">
                <div className="rpt-menu-cap">{periodLabel(period)}</div>
                <button type="button" role="menuitem" disabled={filteredDocs.length === 0}
                  onClick={() => { exportDocuments(filteredDocs, fileTag); setMenuOpen(false); }}>
                  <FileSpreadsheet aria-hidden="true" />
                  <span>מסמכים ל-Excel</span>
                  <small>{filteredDocs.length}</small>
                </button>
                <button type="button" role="menuitem" disabled={filteredExpenses.length === 0}
                  onClick={() => { exportExpenses(filteredExpenses, fileTag); setMenuOpen(false); }}>
                  <FileSpreadsheet aria-hidden="true" />
                  <span>הוצאות ל-Excel</span>
                  <small>{filteredExpenses.length}</small>
                </button>
                <button type="button" role="menuitem" disabled={tableRows.length === 0}
                  onClick={() => { exportMonthlySummary(tableRows, fileTag); setMenuOpen(false); }}>
                  <FileSpreadsheet aria-hidden="true" />
                  <span>הטבלה החודשית ל-Excel</span>
                  <small>{tableRows.length}</small>
                </button>
                <div className="rpt-menu-cap">לרשות המסים · {exportYear}</div>
                <button type="button" role="menuitem" onClick={() => downloadUniformStructure(false)}
                  title="ייצוא קבצי מבנה אחיד (OPENFORMAT 1.31) מהנתונים האמיתיים, לביקורת">
                  <FileArchive aria-hidden="true" />
                  <span>מבנה אחיד</span>
                </button>
                <button type="button" role="menuitem" onClick={() => downloadUniformStructure(true)}
                  title="קבצי מבנה אחיד עם נתוני דוגמה סינתטיים, לסימולטור של רשות המסים">
                  <FileArchive aria-hidden="true" />
                  <span>מבנה אחיד: קובץ דוגמה</span>
                </button>
              </div>
            )}
          </div>
          {/* No print sheet here: this page IS the report. `.rpt-controls` is
              already hidden in print (app-skin.css), so the button prints
              itself away along with the rest of the controls. */}
          <button
            type="button"
            className="pgbtn pgbtn-quiet"
            onClick={() => window.print()}
            title="הדפסת לוח הדוחות / שמירה כ-PDF"
          >
            <Printer aria-hidden="true" />
            הדפסה
          </button>
        </div>
      </div>

      {/* ---------- four numbers, one style ---------- */}
      <div className="rpt-kpis">
        <Kpi icon={TrendingUp} label="הכנסות (שולם)" value={formatCurrency(totalIncome)}>
          <Delta pct={comparison?.income ?? null} vs={comparison?.label} />
        </Kpi>
        <Kpi icon={TrendingDown} label="הוצאות" value={formatCurrency(totalExpenses)}>
          <Delta pct={comparison?.expenses ?? null} vs={comparison?.label} inverse />
        </Kpi>
        <Kpi icon={Wallet} label="רווח נטו" value={formatCurrency(profit)}>
          <span>{totalIncome > 0 ? `${Math.round((profit / totalIncome) * 100)}% מההכנסות` : "אין עדיין הכנסות בתקופה"}</span>
        </Kpi>
        <Kpi icon={Clock} label="פתוח לגבייה" value={formatCurrency(aging.totals.grand)}>
          <span>
            {aging.rows.length === 0
              ? "אין חשבוניות פתוחות"
              : `${aging.rows.length} לקוחות · ${aging.totals.docCount} מסמכים`}
          </span>
        </Kpi>
      </div>

      {/* ---------- chart + open receivables ---------- */}
      <div className="rpt-row2">
        <section className="card-soft rpt-card" aria-label="הכנסות מול הוצאות">
          <div className="rpt-card-head">
            <div>
              <h2 className="rpt-h2">הכנסות מול הוצאות</h2>
              <p className="rpt-hint">לפי חודש · {year === null ? "12 החודשים האחרונים" : year}</p>
            </div>
            <div className="rpt-legend" aria-hidden="true">
              <span><i className="rpt-chart-dot rpt-chart-dot-income" />הכנסות (שולם)</span>
              <span><i className="rpt-chart-dot rpt-chart-dot-expense" />הוצאות</span>
            </div>
          </div>
          <div className="rpt-card-body">
            <ReportsBarChart data={chartData} />
          </div>
        </section>

        <section className="card-soft rpt-card rpt-aging" aria-label="חובות פתוחים">
          <div className="rpt-card-head">
            <div>
              <h2 className="rpt-h2">חובות פתוחים</h2>
              <p className="rpt-hint">לפי ותק החוב</p>
            </div>
            <Link href="/reports/aging" className="rpt-link">לדוח המלא</Link>
          </div>
          <div className="rpt-card-body rpt-aging-body">
            {aging.rows.length === 0 ? (
              <p className="text-sm text-stone-600">אין חשבוניות פתוחות. כל הלקוחות שילמו, נכון לעכשיו.</p>
            ) : (
              <>
                <div className="rpt-aging-total" dir="ltr">{formatCurrency(aging.totals.grand)}</div>
                <div className="rpt-aging-bar" aria-hidden="true">
                  {aging.totals.buckets.map((v, i) =>
                    v > 0 ? <i key={i} style={{ flex: v, background: bucketColors[i] }} /> : null,
                  )}
                </div>
                <dl className="rpt-aging-buckets">
                  {aging.totals.buckets.map((v, i) => (
                    <div key={i}>
                      <dt><i style={{ background: v > 0 ? bucketColors[i] : "var(--icotile)" }} />{AGING_BUCKET_LABELS[i]}</dt>
                      <dd dir="ltr">{v > 0 ? formatCurrency(v) : "-"}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="rpt-aging-clients">
                  {topDebtors.map((r) => (
                    <li key={r.clientId || r.clientName}>
                      {r.clientId ? (
                        <Link href={`/clients/${r.clientId}`}>{r.clientName}</Link>
                      ) : (
                        <span>{r.clientName}</span>
                      )}
                      <b dir="ltr">{formatCurrency(r.total)}</b>
                    </li>
                  ))}
                  {aging.rows.length > topDebtors.length && (
                    <li className="rpt-aging-more">
                      <Link href="/reports/aging">ועוד {aging.rows.length - topDebtors.length} לקוחות</Link>
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>
        </section>
      </div>

      {/* ---------- month by month ---------- */}
      <section className="card-soft rpt-card overflow-hidden" aria-label="פירוט חודשי">
        <div className="rpt-card-head">
          <div>
            <h2 className="rpt-h2">פירוט חודשי</h2>
            <p className="rpt-hint">הכנסות ששולמו, הוצאות, רווח ושולי רווח לכל חודש · {periodLabel(period)}</p>
          </div>
          <button
            type="button"
            className="pgbtn pgbtn-quiet rpt-btn-sm"
            disabled={tableRows.length === 0}
            onClick={() => exportMonthlySummary(tableRows, fileTag)}
          >
            <Download aria-hidden="true" />
            Excel
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="rpt-table">
            <thead>
              <tr>
                <th>חודש</th>
                <th className="n rpt-col-wide">מסמכים</th>
                <th className="n">הכנסות</th>
                <th className="n">הוצאות</th>
                <th className="n">רווח</th>
                <th className="n rpt-col-wide">שולי רווח</th>
                <th className="n rpt-col-wide">רווח מצטבר</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="rpt-empty">אין נתונים לתקופה הנבחרת</td>
                </tr>
              ) : (
                <>
                  {tableRows.map((r) => (
                    <tr key={r.month}>
                      <td className="rpt-td-month">{r.label}</td>
                      <td className="n rpt-td-docs rpt-col-wide">{r.docs}</td>
                      <td className="n rpt-td-income" dir="ltr">{formatCurrency(r.income)}</td>
                      <td className="n rpt-td-expense" dir="ltr">{formatCurrency(r.expenses)}</td>
                      <td className="n rpt-td-profit" dir="ltr">{formatCurrency(r.income - r.expenses)}</td>
                      <td className="n rpt-col-wide"><MarginPill pct={r.margin} /></td>
                      <td className="n rpt-td-cum rpt-col-wide" dir="ltr">{formatCurrency(r.cumulative)}</td>
                    </tr>
                  ))}
                  {tableRows.length > 1 && (
                    <tr className="rpt-total">
                      <td>סה״כ · {periodStepLabel(period)}</td>
                      <td className="n rpt-col-wide">{totalDocs}</td>
                      <td className="n" dir="ltr">{formatCurrency(totalIncome)}</td>
                      <td className="n" dir="ltr">{formatCurrency(totalExpenses)}</td>
                      <td className="n" dir="ltr">{formatCurrency(profit)}</td>
                      <td className="n rpt-col-wide"><MarginPill pct={totalMargin} /></td>
                      <td className="n rpt-col-wide" dir="ltr">{formatCurrency(profit)}</td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- one card per report, each opens on its own page ---------- */}
      <section aria-label="דוחות למס ולרואה החשבון">
        <div className="rpt-sect-head">
          <h2 className="rpt-h2">דוחות למס ולרואה החשבון</h2>
          <p className="rpt-hint">הדוחות השנתיים מחושבים לשנת {exportYear}</p>
        </div>
        <div className="rpt-grid">
          {cards.map((c) => <ReportCard key={c.title} {...c} />)}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Kpi({ icon: Icon, label, value, children }: { icon: LucideIcon; label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="card-soft rpt-kpi">
      <div className="rpt-kpi-lab">
        <span>{label}</span>
        <span className="rpt-icot rpt-icot-sm"><Icon aria-hidden="true" /></span>
      </div>
      <div className="rpt-kpi-val" dir="ltr">{value}</div>
      <div className="rpt-kpi-foot">{children}</div>
    </div>
  );
}

/** Profit margin of a month as a small pill; `null` = no income that month. */
function MarginPill({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="rpt-td-cum">-</span>;
  const tone = pct < 0 ? "down" : pct === 0 ? "flat" : "up";
  return <span className={`rpt-delta rpt-delta-${tone}`} dir="ltr">{pct}%</span>;
}

/** "+18% לעומת 2025". `inverse`: for expenses, going UP is the bad direction. */
function Delta({ pct, vs, inverse = false }: { pct: number | null; vs?: string; inverse?: boolean }) {
  if (pct === null || !vs) return <span>אין נתוני השוואה</span>;
  const good = inverse ? pct <= 0 : pct >= 0;
  const flat = Math.abs(pct) < 1;
  const tone = flat ? "flat" : good ? "up" : "down";
  const Arrow = flat ? Minus : pct >= 0 ? TrendingUp : TrendingDown;
  return (
    <>
      <span className={`rpt-delta rpt-delta-${tone}`}>
        <Arrow aria-hidden="true" />
        {Math.abs(pct)}%
      </span>
      <span>לעומת {vs}</span>
    </>
  );
}

interface ReportCardSpec {
  icon: LucideIcon;
  title: string;
  desc: string;
  href?: string;
  onClick?: () => void;
  action?: string;
  featured?: boolean;
}

function ReportCard({ icon: Icon, title, desc, href, onClick, action = "פתח", featured }: ReportCardSpec) {
  const inner = (
    <>
      <span className="rpt-icot"><Icon aria-hidden="true" /></span>
      <span className="rpt-rc-title">{title}</span>
      <span className="rpt-rc-desc">{desc}</span>
      <span className="rpt-rc-go">{action}<ArrowLeft aria-hidden="true" /></span>
    </>
  );
  const cls = `card-soft rpt-rc${featured ? " rpt-rc-featured" : ""}`;
  return href ? (
    <Link href={href} className={cls}>{inner}</Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>{inner}</button>
  );
}
