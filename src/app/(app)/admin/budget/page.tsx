"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Coins,
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  ExternalLink,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  CalendarClock,
  Scale,
  RefreshCw,
  LineChart,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/admin";
import { formatCurrencyWhole, formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/currencies";
import { Modal } from "@/components/ui/modal";
import {
  summarizeBudget,
  totalsInBothCurrencies,
  convertAmount,
  israelDayOf,
  AUTOMATIC_DISPLAY_LIMIT,
  DEFAULT_USD_RATE,
  USD_RATE_STORAGE_KEY,
  type AutomaticIncome,
  type BudgetCurrency,
  type BudgetEntry,
  type BudgetTotals,
  type PerCurrency,
  type BudgetKind,
  type BudgetRecurrence,
  type PolarStatus,
} from "@/lib/admin-budget";
import {
  buildBudgetChart,
  BUDGET_CHART_GRANULARITIES,
  type BudgetChartGranularity,
} from "@/lib/admin-budget-chart";

// The dashboard's own line chart, so the two screens cannot drift apart. Loaded
// lazily: it measures its container, which only exists in the browser.
const MonthlyLineChart = dynamic(
  () => import("@/components/dashboard-chart").then((mod) => mod.MonthlyLineChart),
  { ssr: false, loading: () => <div className="h-[360px] rounded-xl bg-stone-100 animate-pulse" /> },
) as typeof import("@/components/dashboard-chart").MonthlyLineChart;

const CHART_GRANULARITY_STORAGE_KEY = "admin-budget-chart-granularity";

/**
 * The operator's budget: what the app costs to run, what it earns.
 * Design: docs/superpowers/specs/2026-09-17-admin-budget-design.md
 *
 * Self-gated the same way /admin and /admin/invites are: the allow-list check
 * runs before anything is fetched, and the API behind it returns 404 to
 * everyone else regardless of what this page decides.
 *
 * The automatic income rows come from real subscription charges and are
 * READ-ONLY here: editing them would mean editing the billing record. Only the
 * manual rows in this table can be changed.
 */

type FormState = {
  id: string | null;
  kind: BudgetKind;
  title: string;
  party: string;
  amount: string;
  currency: BudgetCurrency;
  is_free: boolean;
  recurrence: BudgetRecurrence;
  is_fixed: boolean;
  entry_date: string;
  payment_method: string;
  link: string;
  notes: string;
  active: boolean;
};

function emptyForm(kind: BudgetKind): FormState {
  return {
    id: null,
    kind,
    title: "",
    party: "",
    amount: "",
    currency: "ILS",
    is_free: false,
    recurrence: "monthly",
    is_fixed: true,
    entry_date: "",
    payment_method: "",
    link: "",
    notes: "",
    active: true,
  };
}

function formFromEntry(entry: BudgetEntry): FormState {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    party: entry.party,
    amount: entry.amount === null ? "" : String(entry.amount),
    currency: entry.currency,
    is_free: entry.is_free,
    recurrence: entry.recurrence,
    is_fixed: entry.is_fixed,
    entry_date: entry.entry_date ?? "",
    payment_method: entry.payment_method ?? "",
    link: entry.link ?? "",
    notes: entry.notes ?? "",
    active: entry.active,
  };
}

const RECURRENCE_LABELS: Record<BudgetRecurrence, string> = {
  once: "חד פעמי",
  monthly: "חודשי",
  yearly: "שנתי",
};

/**
 * The operator's manual override of the USD rate, or null when there is none
 * (the Bank of Israel rate from the server is then in charge).
 *
 * Wrapped: a browser with storage blocked (private mode, a strict policy)
 * throws on access, and a budget page must not go blank over an FX estimate.
 */
function readStoredRate(): number | null {
  try {
    const raw = window.localStorage.getItem(USD_RATE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export default function AdminBudgetPage() {
  const [entries, setEntries] = useState<BudgetEntry[]>([]);
  const [automatic, setAutomatic] = useState<AutomaticIncome[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  // Three possible rates, in order of authority: the operator's override, the
  // Bank of Israel representative rate from the server, the 3.7 estimate.
  const [override, setOverride] = useState<number | null>(null);
  const [serverRate, setServerRate] = useState(DEFAULT_USD_RATE);
  const [serverRateSource, setServerRateSource] = useState<"boi" | "fallback">("fallback");
  const [rateText, setRateText] = useState(String(DEFAULT_USD_RATE));
  const [polarStatus, setPolarStatus] = useState<PolarStatus>("ok");
  const [growTruncated, setGrowTruncated] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  // A save that fails belongs INSIDE the dialog. The page-level toast renders
  // behind the modal's backdrop, so "קישור חייב להתחיל ב-https://" was painted
  // where the operator could not read it: they pressed שמור and nothing
  // appeared to happen.
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<BudgetChartGranularity>("month");

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        const ok = isAdminEmail(user?.email);
        setAllowed(ok);
        setChecked(true);
        if (!ok) setLoading(false);
      })
      // Same guard as the other admin pages: an unhandled rejection here used
      // to leave the gate spinning forever. Deny and stop.
      .catch(() => {
        setAllowed(false);
        setChecked(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CHART_GRANULARITY_STORAGE_KEY);
      if (BUDGET_CHART_GRANULARITIES.some((g) => g.key === saved)) {
        setGranularity(saved as BudgetChartGranularity);
      }
    } catch {
      // Storage unavailable: the month view is the default.
    }
  }, []);

  useEffect(() => {
    const stored = readStoredRate();
    if (stored !== null) {
      setOverride(stored);
      setRateText(String(stored));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/budget", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setEntries(data.entries as BudgetEntry[]);
        setAutomatic(data.automatic as AutomaticIncome[]);
        setPolarStatus(
          data.polarStatus === "unavailable"
            ? "unavailable"
            : data.polarStatus === "partial"
              ? "partial"
              : "ok",
        );
        setGrowTruncated(data.growTruncated === true);
        const rate = Number(data.usdRate);
        if (Number.isFinite(rate) && rate > 0) {
          setServerRate(rate);
          setServerRateSource(data.usdRateSource === "boi" ? "boi" : "fallback");
          // With no override, the box shows the rate actually in use.
          setRateText((current) => (readStoredRate() === null ? rate.toFixed(4) : current));
        }
      } else {
        setToast({ kind: "error", text: data.error || "שגיאה בטעינת התקציב" });
      }
    } catch (err) {
      setToast({ kind: "error", text: err instanceof Error ? err.message : "שגיאה" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  // Reset an armed delete after a few seconds so a forgotten click cannot be
  // completed much later by a stray second click.
  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = setTimeout(() => setConfirmDeleteId(null), 5000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  const usdRate = override ?? serverRate;
  const rateLabel =
    override === null && serverRateSource === "boi" ? "שער יציג בנק ישראל" : "שער משוער";

  const summary = useMemo(
    () => summarizeBudget(entries, automatic, { usdRate }),
    [entries, automatic, usdRate],
  );

  // Every bottom-line figure in BOTH currencies, so no column on this page is a
  // per-currency partial the reader has to add up in their head. Built from the
  // same summary and the same rate, so the cards, the table footer and the
  // totals block cannot disagree.
  const totals = useMemo(() => totalsInBothCurrencies(summary, { usdRate }), [summary, usdRate]);

  const chartPoints = useMemo(
    () => buildBudgetChart(entries, automatic, granularity, { usdRate }),
    [entries, automatic, granularity, usdRate],
  );
  const chartData = useMemo(
    () => chartPoints.map((p) => ({ month: p.label, הכנסות: p.income, הוצאות: p.expense })),
    [chartPoints],
  );
  const chartTotals = useMemo(() => {
    const income = chartPoints.reduce((sum, p) => sum + p.income, 0);
    const expense = chartPoints.reduce((sum, p) => sum + p.expense, 0);
    return { income, expense, net: income - expense };
  }, [chartPoints]);

  const expenses = useMemo(() => entries.filter((e) => e.kind === "expense"), [entries]);
  const manualIncome = useMemo(() => entries.filter((e) => e.kind === "income"), [entries]);
  // The API returns three years of payments; the list shows the most recent ones so
  // a busy month does not bury the manual rows under it. The summary still
  // counts every payment of the current month, not just the ones on screen.
  const automaticRecent = useMemo(
    () => automatic.slice(0, AUTOMATIC_DISPLAY_LIMIT),
    [automatic],
  );

  function pickGranularity(key: BudgetChartGranularity) {
    setGranularity(key);
    try {
      window.localStorage.setItem(CHART_GRANULARITY_STORAGE_KEY, key);
    } catch {
      // Storage unavailable: the choice still applies for this visit.
    }
  }

  function applyRate(text: string) {
    setRateText(text);
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setOverride(parsed);
    try {
      window.localStorage.setItem(USD_RATE_STORAGE_KEY, String(parsed));
    } catch {
      // Storage unavailable: the override still applies for this visit.
    }
  }

  /** Drop the manual override and go back to the Bank of Israel rate. */
  function clearOverride() {
    setOverride(null);
    setRateText(serverRate.toFixed(4));
    try {
      window.localStorage.removeItem(USD_RATE_STORAGE_KEY);
    } catch {
      // Nothing to clear if storage is unavailable.
    }
  }

  /**
   * Open, edit or close the dialog. Every path clears the last save error, so
   * a message can never outlive the attempt that produced it (including while
   * the operator is typing the fix).
   */
  function openForm(next: FormState | null) {
    setFormError(null);
    setForm(next);
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    };
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setToast(null);
    setFormError(null);
    try {
      const payload = {
        kind: form.kind,
        title: form.title,
        party: form.party,
        amount: form.amount.trim() === "" ? null : Number(form.amount),
        currency: form.currency,
        is_free: form.is_free,
        recurrence: form.recurrence,
        is_fixed: form.is_fixed,
        entry_date: form.entry_date || null,
        payment_method: form.payment_method || null,
        link: form.link || null,
        notes: form.notes || null,
        active: form.active,
      };
      const res = await fetch(
        form.id ? `/api/admin/budget/${form.id}` : "/api/admin/budget",
        {
          method: form.id ? "PATCH" : "POST",
          headers: await authHeaders(),
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (data.ok) {
        setToast({ kind: "success", text: form.id ? "הרשומה עודכנה" : "הרשומה נוספה" });
        openForm(null);
        load();
      } else {
        setFormError(data.error || "שגיאה בשמירה");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(entry: BudgetEntry) {
    try {
      const res = await fetch(`/api/admin/budget/${entry.id}`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ active: !entry.active }),
      });
      const data = await res.json();
      if (data.ok) load();
      else setToast({ kind: "error", text: data.error || "שגיאה" });
    } catch {
      // Network down or a non-JSON error page: say so instead of doing nothing.
      setToast({ kind: "error", text: "העדכון נכשל. בדוק את החיבור ונסה שוב" });
    }
  }

  async function handleDelete(entry: BudgetEntry) {
    if (confirmDeleteId !== entry.id) {
      setConfirmDeleteId(entry.id);
      return;
    }
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/admin/budget/${entry.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data.ok) {
        setToast({ kind: "success", text: "הרשומה נמחקה" });
        load();
      } else {
        setToast({ kind: "error", text: data.error || "שגיאה" });
      }
    } catch {
      setToast({ kind: "error", text: "המחיקה נכשלה. בדוק את החיבור ונסה שוב" });
    }
  }

  if (!checked) {
    return <div className="p-8 text-center text-stone-500">בודק הרשאות...</div>;
  }
  if (!allowed) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-stone-900">404</h1>
        <p className="text-stone-600 mt-2">העמוד לא נמצא</p>
      </div>
    );
  }

  const net = summary.netIls;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-sm">
              <Coins className="w-5 h-5 text-white" />
            </span>
            תקציב
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            כמה עולה להפעיל את האפליקציה וכמה היא מכניסה. הכנסות מחיובי מנוי נקראות אוטומטית.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => openForm(emptyForm("expense"))}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-orange-700 text-white hover:shadow-md hover:shadow-orange-200"
          >
            <Plus className="w-4 h-4" />
            הוצאה חדשה
          </button>
          <button
            onClick={() => openForm(emptyForm("income"))}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-emerald-500 to-teal-500 text-white hover:shadow-md hover:shadow-emerald-200"
          >
            <Plus className="w-4 h-4" />
            הכנסה חדשה
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-stone-200 text-stone-800 hover:bg-stone-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            רענן
          </button>
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-orange-700"
          >
            <ArrowRight className="w-4 h-4" />
            חזרה למסך הראשי
          </Link>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className={`flex items-start gap-2 text-sm p-3 rounded-xl ${
            toast.kind === "success"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
              : "bg-rose-50 border border-rose-200 text-rose-900"
          }`}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Each card: the whole figure in shekels, and the SAME whole figure in
            dollars underneath. The sub-line used to read "₪120 + $38", two
            halves of one number that the reader had to add up, which is the
            confusion this page is here to remove. */}
        <SummaryCard
          label="הוצאה חודשית"
          value={formatCurrencyWhole(summary.monthlyRunRateIls)}
          sub={`≈ ${formatMoney(totals.expenses.USD, "USD")}`}
          icon={TrendingDown}
          gradient="from-rose-400 to-pink-500"
          bg="from-rose-50 to-pink-50"
        />
        <SummaryCard
          label="הכנסות החודש"
          value={formatCurrencyWhole(summary.incomeThisMonthIls)}
          sub={`≈ ${formatMoney(totals.income.USD, "USD")}`}
          icon={TrendingUp}
          gradient="from-emerald-400 to-teal-500"
          bg="from-emerald-50 to-teal-50"
        />
        <SummaryCard
          label="מאזן חודשי"
          value={formatCurrencyWhole(net)}
          sub={`≈ ${formatMoney(totals.net.USD, "USD")}`}
          icon={Scale}
          gradient={net >= 0 ? "from-emerald-400 to-teal-500" : "from-amber-400 to-orange-500"}
          bg={net >= 0 ? "from-emerald-50 to-teal-50" : "from-amber-50 to-orange-50"}
        />
        <SummaryCard
          label="החיוב הבא"
          value={summary.nextCharge ? formatDate(summary.nextCharge.date) : "אין תאריך"}
          sub={
            summary.nextCharge
              ? summary.nextCharge.entry.party
              : "לא הוזן תאריך חידוש לאף ספק"
          }
          icon={CalendarClock}
          gradient="from-violet-400 to-purple-500"
          bg="from-violet-50 to-purple-50"
        />
      </div>

      <div className="card-soft p-4 flex items-center gap-3 flex-wrap">
        <label htmlFor="usd-rate" className="text-sm font-medium text-stone-800">
          {rateLabel} לדולר
        </label>
        <input
          id="usd-rate"
          type="number"
          min={0.1}
          step={0.01}
          value={rateText}
          onChange={(e) => applyRate(e.target.value)}
          // max-w as well as w-28: .input-warm in globals.css sets width:100%
          // from outside Tailwind's layer, so it beats the w-28 utility and the
          // rate box rendered as wide as the card. max-width still wins.
          className="input-warm w-28 max-w-[7rem]"
          dir="ltr"
        />
        <span className="text-xs text-stone-600">
          {override !== null
            ? "שער שהזנת ידנית, נשמר רק בדפדפן הזה."
            : serverRateSource === "boi"
              ? "השער היציג של בנק ישראל, נטען אוטומטית. אפשר לשנות ידנית."
              : "לא הצלחנו לקרוא את השער מבנק ישראל, אז זו הערכה בלבד."}
        </span>
        {override !== null && (
          <button
            type="button"
            onClick={clearOverride}
            className="text-xs font-semibold text-stone-600 underline hover:text-orange-700"
          >
            חזרה לשער בנק ישראל
          </button>
        )}
        {summary.missingAmountCount > 0 && (
          <span className="mr-auto text-xs font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-800">
            {summary.missingAmountCount === 1
              ? "רשומה אחת חסרת סכום"
              : `${summary.missingAmountCount} רשומות חסרות סכום`}
          </span>
        )}
      </div>

      {/* Income against expenses over time */}
      <section className="card-soft p-5 min-w-0" aria-labelledby="budget-chart-title">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <LineChart className="w-4 h-4 text-stone-500" />
          <h2 id="budget-chart-title" className="font-semibold text-stone-900">
            הכנסות מול הוצאות
          </h2>
          <p className="text-xs text-stone-600 mr-auto" aria-live="polite">
            בתקופה שבגרף: הכנסות{" "}
            <span className="font-semibold text-stone-900">
              {formatCurrencyWhole(chartTotals.income)}
            </span>{" "}
            · הוצאות{" "}
            <span className="font-semibold text-stone-900">
              {formatCurrencyWhole(chartTotals.expense)}
            </span>{" "}
            · מאזן{" "}
            <span className="font-semibold text-stone-900">
              {formatCurrencyWhole(chartTotals.net)}
            </span>
          </p>
        </div>
        <MonthlyLineChart
          data={chartData}
          range={granularity}
          onRangeChange={pickGranularity}
          ranges={BUDGET_CHART_GRANULARITIES}
          soloStorageKey="admin-budget-chart-series"
        />
        {/* The two limits of the expense line, said where the line is read. */}
        <p className="mt-2 text-[11px] text-stone-500">
          הוצאות קבועות נפרסות על פני ימי החודש ומחושבות לפי המחירים של היום, גם לתקופות קודמות.
          {summary.missingAmountCount > 0 && " ספקים בלי סכום לא נכללים בקו ההוצאות."}
        </p>
      </section>

      {/* Expenses */}
      <section className="card-soft overflow-hidden">
        <div className="px-5 py-3 border-b border-orange-100 flex items-center gap-2 flex-wrap">
          <TrendingDown className="w-4 h-4 text-rose-500" />
          <h2 className="font-semibold text-stone-900">הוצאות</h2>
          <span className="text-xs text-stone-600 mr-auto">
            {expenses.length} ספקים · {summary.activeExpenseCount} פעילים
          </span>
        </div>
        {loading && expenses.length === 0 ? (
          <p className="p-5 text-sm text-stone-500 italic">טוען...</p>
        ) : expenses.length === 0 ? (
          <p className="p-5 text-sm text-stone-500 italic">אין הוצאות עדיין.</p>
        ) : (
          <>
            {/* Desktop: one table. */}
            <table className="w-full text-sm hidden md:table">
              <thead className="bg-orange-50/50 text-xs text-stone-600">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">ספק</th>
                  <th className="px-4 py-2 text-start font-medium">בשביל מה</th>
                  {/* One column per currency instead of one mixed column: a
                      list where row 3 is dollars and row 4 is shekels cannot
                      be read down. Every row now shows both. */}
                  <th className="px-4 py-2 text-start font-medium whitespace-nowrap">בשקלים</th>
                  <th className="px-4 py-2 text-start font-medium whitespace-nowrap">בדולרים</th>
                  <th className="px-4 py-2 text-start font-medium">תדירות</th>
                  <th className="px-4 py-2 text-start font-medium">חיוב הבא</th>
                  {/* A floor under this column: with two money columns added,
                      the table squeezed "כרטיס אשראי (טעינת קרדיט מראש)" down
                      to one word per line and made its row five lines tall. */}
                  <th className="px-4 py-2 text-start font-medium min-w-[8rem]">תשלום</th>
                  <th className="px-4 py-2 text-start font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-50">
                {expenses.map((entry) => (
                  <tr
                    key={entry.id}
                    className={`hover:bg-orange-50/40 ${entry.active ? "" : "opacity-60"}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-stone-900">{entry.party}</span>
                        {!entry.active && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-200 text-stone-600">
                            בוטל
                          </span>
                        )}
                      </div>
                      {entry.link && <VendorLink link={entry.link} />}
                    </td>
                    <td className="px-4 py-3 text-stone-700">{entry.title}</td>
                    {amountKind(entry) === "amount" ? (
                      <>
                        <td className="px-4 py-3 text-start whitespace-nowrap">
                          <MoneyIn entry={entry} to="ILS" usdRate={usdRate} />
                        </td>
                        <td className="px-4 py-3 text-start whitespace-nowrap">
                          <MoneyIn entry={entry} to="USD" usdRate={usdRate} />
                        </td>
                      </>
                    ) : (
                      <>
                        {/* A free tier or a price nobody has filled in is one
                            fact, not two: the badge sits in the shekel column
                            and the dollar column says nothing rather than
                            repeating it. */}
                        <td className="px-4 py-3">
                          <AmountCell entry={entry} onFill={() => openForm(formFromEntry(entry))} />
                        </td>
                        <td className="px-4 py-3 text-stone-400 text-start">-</td>
                      </>
                    )}
                    {/* nowrap on both lines: "חודשי" over "לפי שימוש" was
                        breaking into three lines in a narrow column and made
                        every row three lines tall for no information. */}
                    <td className="px-4 py-3 text-stone-700 whitespace-nowrap">
                      {RECURRENCE_LABELS[entry.recurrence]}
                      <span className="text-xs text-stone-500 block">
                        {entry.is_fixed ? "מחיר קבוע" : "לפי שימוש"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-700">
                      {entry.entry_date ? formatDate(entry.entry_date) : "-"}
                    </td>
                    <td className="px-4 py-3 text-stone-700">{entry.payment_method || "-"}</td>
                    <td className="px-4 py-3">
                      <RowActions
                        entry={entry}
                        armed={confirmDeleteId === entry.id}
                        onEdit={() => openForm(formFromEntry(entry))}
                        onToggle={() => handleToggle(entry)}
                        onDelete={() => handleDelete(entry)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* The column sum, under the column. The card at the bottom of
                  the page says the same thing for the whole budget; this is
                  the one the eye wants while it is still reading the rows. */}
              <tfoot className="border-t-2 border-orange-100 bg-orange-50/40">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold text-stone-900" colSpan={2}>
                    סך ההוצאות לחודש
                  </th>
                  <td className="px-4 py-3 text-start font-bold text-stone-900 tabular-nums whitespace-nowrap">
                    {formatMoney(totals.expenses.ILS, "ILS")}
                  </td>
                  <td className="px-4 py-3 text-start font-semibold text-stone-500 tabular-nums whitespace-nowrap">
                    ≈ {formatMoney(totals.expenses.USD, "USD")}
                  </td>
                  {/* Four, not three: the row has to span תדירות, חיוב הבא,
                      תשלום and פעולות, and one short left a white notch in the
                      tinted footer band. */}
                  <td className="px-4 py-3" colSpan={4} />
                </tr>
              </tfoot>
            </table>

            {/* Mobile: one card per vendor. A seven-column table on a phone is
                a horizontal scroll nobody reads. */}
            <ul className="md:hidden divide-y divide-orange-50">
              {expenses.map((entry) => (
                <li key={entry.id} className={`p-4 space-y-2 ${entry.active ? "" : "opacity-60"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-stone-900">{entry.party}</p>
                      <p className="text-xs text-stone-600">{entry.title}</p>
                    </div>
                    {/* Both currencies on one line on a phone: two stacked
                        columns in a 390px card would be two half-width columns
                        of nothing. */}
                    <MoneyPair
                      entry={entry}
                      usdRate={usdRate}
                      onFill={() => openForm(formFromEntry(entry))}
                    />
                  </div>
                  <p className="text-xs text-stone-600">
                    {RECURRENCE_LABELS[entry.recurrence]} · {entry.is_fixed ? "מחיר קבוע" : "לפי שימוש"}
                    {entry.entry_date && <> · חיוב הבא {formatDate(entry.entry_date)}</>}
                    {entry.payment_method && <> · {entry.payment_method}</>}
                    {!entry.active && <> · בוטל</>}
                  </p>
                  {entry.link && <VendorLink link={entry.link} />}
                  <RowActions
                    entry={entry}
                    armed={confirmDeleteId === entry.id}
                    onEdit={() => openForm(formFromEntry(entry))}
                    onToggle={() => handleToggle(entry)}
                    onDelete={() => handleDelete(entry)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Income */}
      <section className="card-soft overflow-hidden">
        <div className="px-5 py-3 border-b border-orange-100 flex items-center gap-2 flex-wrap">
          <TrendingUp className="w-4 h-4 text-emerald-500" />
          <h2 className="font-semibold text-stone-900">הכנסות</h2>
          <span className="text-xs text-stone-600 mr-auto">
            תשלומי מנוי נקראים אוטומטית ואי אפשר לערוך אותם כאן
          </span>
        </div>

        {/* A missing Polar read is said out loud: silence here would show a
            zero that reads as "nobody paid", which is the opposite of the
            truth when the token or the network is the problem. */}
        {polarStatus === "unavailable" && (
          <p className="px-5 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
            לא ניתן לקרוא הכנסות מ-Polar כרגע. המספרים כאן חלקיים.
          </p>
        )}
        {/* Same principle for a read that succeeded but hit a cap: a ceiling
            nobody mentions turns a partial sum into a wrong one. */}
        {(polarStatus === "partial" || growTruncated) && (
          <p className="px-5 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
            נטענו רק התשלומים האחרונים, כך שהמספרים כאן עשויים להיות חלקיים.
          </p>
        )}

        {automaticRecent.length === 0 && manualIncome.length === 0 ? (
          <p className="p-5 text-sm text-stone-500 italic">אין הכנסות רשומות עדיין.</p>
        ) : (
          <ul className="divide-y divide-orange-50">
            {/* The same two money columns the expenses table has, so a reader
                scanning down the page compares like with like. Hidden on a
                phone, where the values sit on one line inside each row. */}
            <li className="px-5 py-2 bg-orange-50/50 text-xs text-stone-600 hidden md:flex items-center justify-between gap-3">
              <span>מקור</span>
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-4 flex-shrink-0">
                  <span className={`${MONEY_COL_ILS} text-start`}>בשקלים</span>
                  <span className={`${MONEY_COL_USD} text-start`}>בדולרים</span>
                </span>
                {/* Stands in for the row actions below, so the two column
                    headings sit over their own numbers. Without it the header
                    was short by the width of three icon buttons and pointed at
                    the wrong columns. */}
                <span className={INCOME_ACTIONS_SLOT} aria-hidden />
              </span>
            </li>
            {automaticRecent.map((row, i) => (
              <li key={`auto-${row.charged_at}-${i}`} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                      אוטומטי
                    </span>
                    <span className="text-sm font-medium text-stone-900 truncate" dir="ltr">
                      {row.payer_email || "(ללא מייל)"}
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 mt-0.5">
                    {/* The Israel day of the instant, the same day the summary
                        counts it under. Slicing the ISO string would print the
                        UTC one and disagree with the card above. */}
                    {formatDate(israelDayOf(row.charged_at))}
                    {row.provider && <> · {row.provider}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <MoneyColumns
                    amount={row.amount}
                    currency={row.currency}
                    usdRate={usdRate}
                  />
                  {/* An automatic payment has no actions - it is the billing
                      record - but it still needs the slot, or its numbers
                      would sit a hundred pixels off the manual rows'. */}
                  <span className={INCOME_ACTIONS_SLOT} aria-hidden />
                </div>
              </li>
            ))}
            {manualIncome.map((entry) => (
              <li
                key={entry.id}
                className={`px-5 py-3 flex items-center justify-between gap-3 flex-wrap ${
                  entry.active ? "" : "opacity-60"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900">
                    {entry.party}
                    {!entry.active && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-200 text-stone-600 mr-2">
                        בוטל
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-stone-600 mt-0.5">
                    {entry.title} · {RECURRENCE_LABELS[entry.recurrence]}
                    {entry.entry_date && <> · {formatDate(entry.entry_date)}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {amountKind(entry) === "amount" ? (
                    <MoneyColumns
                      amount={entry.amount as number}
                      currency={entry.currency}
                      usdRate={usdRate}
                    />
                  ) : (
                    <AmountCell entry={entry} onFill={() => openForm(formFromEntry(entry))} />
                  )}
                  <div className="flex md:w-[6.5rem]">
                    <RowActions
                      entry={entry}
                      armed={confirmDeleteId === entry.id}
                      onEdit={() => openForm(formFromEntry(entry))}
                      onToggle={() => handleToggle(entry)}
                      onDelete={() => handleDelete(entry)}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Said quietly but said: a refund lowers the month of the ORIGINAL
            charge, not the month it was issued in (see mapPolarOrders). Better
            a small true line than a number that looks exact and is not. */}
        {automaticRecent.length > 0 && (
          <p className="px-5 py-2 text-[11px] text-stone-500 border-t border-orange-50">
            החזרים מקוזזים מהחודש של החיוב המקורי
          </p>
        )}
      </section>

      <TotalsCard
        totals={totals}
        rateLabel={rateLabel}
        missingAmountCount={summary.missingAmountCount}
      />

      <EntryDialog
        form={form}
        saving={saving}
        error={formError}
        onChange={openForm}
        onClose={() => openForm(null)}
        onSave={handleSave}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
  gradient,
  bg,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof Coins;
  gradient: string;
  bg: string;
}) {
  return (
    <div className={`card-soft p-5 bg-gradient-to-br ${bg} border-transparent`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-stone-700">{label}</p>
          <p className="text-xl sm:text-2xl font-bold mt-2 text-stone-900 truncate">{value}</p>
          {/* The sub WRAPS, it does not truncate: on a 390px phone the balance
              card read "האפליקציה מכסה את ..." - a sentence cut mid-thought,
              which is worse than a second line. The value above still
              truncates, since a clipped number is better than a reflowed card. */}
          <p className="text-xs text-stone-600 mt-1">{sub}</p>
        </div>
        <div
          className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${gradient} hidden sm:flex items-center justify-center shadow-md flex-shrink-0`}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

/**
 * The three states a row's price can be in. Only "amount" has a number to
 * convert; the other two are one fact that belongs in one cell.
 */
type AmountKind = "free" | "missing" | "amount";

function amountKind(entry: BudgetEntry): AmountKind {
  if (entry.is_free) return "free";
  if (entry.amount === null) return "missing";
  return "amount";
}

/**
 * Widths for the two money columns in the income LIST, which has no table to
 * align it. Shared by the header row and every row under it, so they line up.
 */
const MONEY_COL_ILS = "w-28";
const MONEY_COL_USD = "w-24";

/**
 * The trailing slot in an income row: three w-8 buttons and two gap-1 gaps,
 * 6.5rem. The header and the read-only automatic rows reserve the same width
 * so every row's money columns land under the same headings. Desktop only -
 * on a phone the list is one column and there is nothing to line up.
 */
const INCOME_ACTIONS_SLOT = "hidden md:block md:w-[6.5rem] flex-shrink-0";

/**
 * One money value in one currency.
 *
 * The currency the vendor actually bills in is rendered in full ink; the other
 * one is muted and prefixed "≈", because it is an estimate that moves with the
 * exchange rate and must never be mistaken for the real charge.
 */
function Money({
  amount,
  from,
  to,
  usdRate,
}: {
  amount: number;
  from: BudgetCurrency;
  to: BudgetCurrency;
  usdRate: number;
}) {
  const original = from === to;
  const value = original ? amount : convertAmount(amount, from, to, usdRate);
  return original ? (
    <span className="font-semibold text-stone-900 tabular-nums whitespace-nowrap">
      {formatMoney(value, to)}
    </span>
  ) : (
    <span className="text-stone-500 tabular-nums whitespace-nowrap">
      ≈ {formatMoney(value, to)}
    </span>
  );
}

/** One table cell's worth of money, for a row that has an amount. */
function MoneyIn({
  entry,
  to,
  usdRate,
}: {
  entry: BudgetEntry;
  to: BudgetCurrency;
  usdRate: number;
}) {
  return (
    <Money amount={entry.amount as number} from={entry.currency} to={to} usdRate={usdRate} />
  );
}

/** Both currencies as two aligned columns, for the income list. */
function MoneyColumns({
  amount,
  currency,
  usdRate,
}: {
  amount: number;
  currency: BudgetCurrency;
  usdRate: number;
}) {
  return (
    <span className="flex items-center gap-4 flex-shrink-0 text-sm">
      <span className={`${MONEY_COL_ILS} text-start hidden md:block`}>
        <Money amount={amount} from={currency} to="ILS" usdRate={usdRate} />
      </span>
      <span className={`${MONEY_COL_USD} text-start hidden md:block`}>
        <Money amount={amount} from={currency} to="USD" usdRate={usdRate} />
      </span>
      {/* Phone: one line, the real charge first. */}
      <span className="md:hidden flex items-center gap-1.5 text-sm">
        <Money amount={amount} from={currency} to={currency} usdRate={usdRate} />
        <span className="text-stone-400">·</span>
        <Money
          amount={amount}
          from={currency}
          to={currency === "ILS" ? "USD" : "ILS"}
          usdRate={usdRate}
        />
      </span>
    </span>
  );
}

/**
 * Both currencies on one line for the phone cards: the real charge, then the
 * conversion. A row with no number shows its badge and nothing else.
 */
function MoneyPair({
  entry,
  usdRate,
  onFill,
}: {
  entry: BudgetEntry;
  usdRate: number;
  onFill: () => void;
}) {
  if (amountKind(entry) !== "amount") {
    return <AmountCell entry={entry} onFill={onFill} />;
  }
  const other: BudgetCurrency = entry.currency === "ILS" ? "USD" : "ILS";
  return (
    <span className="flex items-center gap-1.5 flex-shrink-0 text-sm">
      <MoneyIn entry={entry} to={entry.currency} usdRate={usdRate} />
      <span className="text-stone-400">·</span>
      <MoneyIn entry={entry} to={other} usdRate={usdRate} />
    </span>
  );
}

/**
 * The bottom line, both currencies side by side.
 *
 * Every cell is a WHOLE total expressed in that currency, not the part of the
 * budget that happens to be billed in it: the point of the grid is that either
 * column can be read on its own.
 */
function TotalsCard({
  totals,
  rateLabel,
  missingAmountCount,
}: {
  totals: BudgetTotals;
  rateLabel: string;
  missingAmountCount: number;
}) {
  const rows: { label: string; value: PerCurrency; tone?: "net" }[] = [
    { label: "הוצאות לחודש", value: totals.expenses },
    { label: "הכנסות החודש", value: totals.income },
    { label: "מאזן", value: totals.net, tone: "net" },
  ];
  const positive = totals.net.ILS >= 0;

  return (
    <section className="card-soft overflow-hidden" aria-labelledby="budget-totals-title">
      <div className="px-5 py-3 border-b border-orange-100 flex items-center gap-2 flex-wrap">
        <Scale className="w-4 h-4 text-stone-500" />
        <h2 id="budget-totals-title" className="font-semibold text-stone-900">
          סך הכול
        </h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-orange-50/50 text-xs text-stone-600">
          <tr>
            {/* The row labels speak for themselves; a visible "שורה" header
                over them is noise. Kept for a screen reader. */}
            <th className="px-5 py-2 text-start font-medium">
              <span className="sr-only">שורה</span>
            </th>
            <th className="px-5 py-2 text-start font-medium whitespace-nowrap">בשקלים</th>
            <th className="px-5 py-2 text-start font-medium whitespace-nowrap">בדולרים</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-orange-50">
          {rows.map((row) => {
            const netInk = positive ? "text-emerald-700" : "text-rose-700";
            const ink = row.tone === "net" ? netInk : "text-stone-900";
            return (
              <tr key={row.label} className={row.tone === "net" ? "bg-orange-50/30" : ""}>
                <th className="px-5 py-3 text-start font-medium text-stone-700 whitespace-nowrap">
                  {row.label}
                </th>
                <td className={`px-5 py-3 text-start font-bold tabular-nums whitespace-nowrap ${ink}`}>
                  {formatMoney(row.value.ILS, "ILS")}
                </td>
                <td
                  className={`px-5 py-3 text-start font-semibold tabular-nums whitespace-nowrap ${
                    row.tone === "net" ? netInk : "text-stone-500"
                  }`}
                >
                  ≈ {formatMoney(row.value.USD, "USD")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-5 py-3 text-[11px] text-stone-500 border-t border-orange-50">
        המרה לפי {rateLabel} {totals.usdRate.toFixed(4)} ש&quot;ח לדולר · רשומות חד-פעמיות ורשומות לא
        פעילות לא נספרות
        {missingAmountCount > 0 &&
          ` · ${
            missingAmountCount === 1 ? "רשומה אחת בלי סכום" : `${missingAmountCount} רשומות בלי סכום`
          } לא נספרת${missingAmountCount === 1 ? "" : "ות"}`}
      </p>
    </section>
  );
}

/** The amount, or the two states that are not an amount: free tier, unknown. */
function AmountCell({ entry, onFill }: { entry: BudgetEntry; onFill: () => void }) {
  if (entry.is_free) {
    return (
      <span className="text-xs font-semibold px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700">
        חינם
      </span>
    );
  }
  if (entry.amount === null) {
    return (
      <button
        type="button"
        onClick={onFill}
        className="text-xs font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 whitespace-nowrap"
      >
        חסר סכום
      </button>
    );
  }
  return (
    <span className="font-semibold text-stone-900 whitespace-nowrap">
      {formatMoney(entry.amount, entry.currency)}
    </span>
  );
}

function VendorLink({ link }: { link: string }) {
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-orange-700 mt-0.5"
      dir="ltr"
    >
      <ExternalLink className="w-3 h-3" />
      {link.replace(/^https:\/\//, "").replace(/\/$/, "")}
    </a>
  );
}

/** Edit, activate/deactivate, and a delete that takes two clicks. */
function RowActions({
  entry,
  armed,
  onEdit,
  onToggle,
  onDelete,
}: {
  entry: BudgetEntry;
  armed: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onEdit}
        title="ערוך"
        className="w-8 h-8 rounded-xl flex items-center justify-center text-stone-600 hover:bg-orange-50 hover:text-orange-700"
      >
        <Pencil className="w-4 h-4" />
      </button>
      <button
        onClick={onToggle}
        title={entry.active ? "סמן כבוטל" : "הפעל מחדש"}
        className="w-8 h-8 rounded-xl flex items-center justify-center text-stone-600 hover:bg-amber-50 hover:text-amber-700"
      >
        {entry.active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
      </button>
      {armed ? (
        <button
          onClick={onDelete}
          className="px-2 h-8 rounded-xl text-xs font-semibold bg-rose-100 text-rose-700 hover:bg-rose-200"
        >
          לחץ שוב למחיקה
        </button>
      ) : (
        <button
          onClick={onDelete}
          title="מחק"
          className="w-8 h-8 rounded-xl flex items-center justify-center text-stone-600 hover:bg-rose-50 hover:text-rose-700"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function EntryDialog({
  form,
  saving,
  error,
  onChange,
  onClose,
  onSave,
}: {
  form: FormState | null;
  saving: boolean;
  /** Why the last save failed, shown here rather than in the page toast. */
  error: string | null;
  onChange: (form: FormState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!form) return null;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    onChange({ ...form, [key]: value });
  const isExpense = form.kind === "expense";

  return (
    <Modal
      open
      onClose={onClose}
      title={form.id ? "עריכת רשומה" : isExpense ? "הוצאה חדשה" : "הכנסה חדשה"}
      subtitle={isExpense ? "ספק, מחיר ותדירות" : "משלם, סכום ותאריך"}
      icon={Coins}
      maxWidth="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-xl text-sm font-semibold text-stone-700 bg-white border border-stone-200 hover:bg-stone-50"
          >
            ביטול
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center justify-center min-h-[40px] px-5 rounded-xl text-sm font-semibold text-white bg-gradient-to-l from-orange-500 to-orange-700 hover:shadow-md hover:shadow-orange-200 disabled:opacity-50"
          >
            {saving ? "שומר..." : "שמור"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {error && (
          <div
            role="alert"
            className="sm:col-span-2 flex items-start gap-2 text-sm p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
        <Field label={isExpense ? "ספק" : "משלם"}>
          <input
            value={form.party}
            onChange={(e) => set("party", e.target.value)}
            className="input-warm w-full"
            placeholder={isExpense ? "Vercel" : "לקוח"}
          />
        </Field>
        <Field label="בשביל מה זה">
          <input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            className="input-warm w-full"
            placeholder={isExpense ? "אירוח האתר" : "מנוי שנתי"}
          />
        </Field>
        <Field label="סכום (ריק = עדיין לא ידוע)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
            className="input-warm w-full"
            dir="ltr"
            disabled={form.is_free}
          />
        </Field>
        <Field label="מטבע">
          <select
            value={form.currency}
            onChange={(e) => set("currency", e.target.value as BudgetCurrency)}
            className="input-warm w-full"
          >
            <option value="ILS">שקל</option>
            <option value="USD">דולר</option>
          </select>
        </Field>
        <Field label="תדירות">
          <select
            value={form.recurrence}
            onChange={(e) => set("recurrence", e.target.value as BudgetRecurrence)}
            className="input-warm w-full"
          >
            <option value="monthly">חודשי</option>
            <option value="yearly">שנתי</option>
            <option value="once">חד פעמי</option>
          </select>
        </Field>
        <Field label={form.recurrence === "once" ? "תאריך חיוב" : "חידוש הבא"}>
          <input
            type="date"
            value={form.entry_date}
            onChange={(e) => set("entry_date", e.target.value)}
            className="input-warm w-full"
            dir="ltr"
          />
        </Field>
        <Field label="אמצעי תשלום">
          <input
            value={form.payment_method}
            onChange={(e) => set("payment_method", e.target.value)}
            className="input-warm w-full"
            placeholder="כרטיס אשראי / PayPal / העברה"
          />
        </Field>
        <Field label="קישור לדף החיוב (https)">
          <input
            value={form.link}
            onChange={(e) => set("link", e.target.value)}
            className="input-warm w-full"
            dir="ltr"
            placeholder="https://"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="הערות">
            <input
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              className="input-warm w-full"
            />
          </Field>
        </div>
        <div className="sm:col-span-2 flex items-center gap-4 flex-wrap text-sm text-stone-800">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_free}
              onChange={(e) => set("is_free", e.target.checked)}
            />
            מדרגה חינמית
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_fixed}
              onChange={(e) => set("is_fixed", e.target.checked)}
            />
            מחיר קבוע (לא לפי שימוש)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            פעיל
          </label>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
