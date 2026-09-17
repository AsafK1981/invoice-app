"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isAdminEmail } from "@/lib/admin";
import { formatCurrency, formatCurrencyWhole, formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/currencies";
import { Modal } from "@/components/ui/modal";
import {
  summarizeBudget,
  israelDayOf,
  AUTOMATIC_DISPLAY_LIMIT,
  DEFAULT_USD_RATE,
  USD_RATE_STORAGE_KEY,
  type AutomaticIncome,
  type BudgetCurrency,
  type BudgetEntry,
  type BudgetKind,
  type BudgetRecurrence,
  type PolarStatus,
} from "@/lib/admin-budget";

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

  const expenses = useMemo(() => entries.filter((e) => e.kind === "expense"), [entries]);
  const manualIncome = useMemo(() => entries.filter((e) => e.kind === "income"), [entries]);
  // The API returns a year of payments; the list shows the most recent ones so
  // a busy month does not bury the manual rows under it. The summary still
  // counts every payment of the current month, not just the ones on screen.
  const automaticRecent = useMemo(
    () => automatic.slice(0, AUTOMATIC_DISPLAY_LIMIT),
    [automatic],
  );

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
    const res = await fetch(`/api/admin/budget/${entry.id}`, {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify({ active: !entry.active }),
    });
    const data = await res.json();
    if (data.ok) load();
    else setToast({ kind: "error", text: data.error || "שגיאה" });
  }

  async function handleDelete(entry: BudgetEntry) {
    if (confirmDeleteId !== entry.id) {
      setConfirmDeleteId(entry.id);
      return;
    }
    setConfirmDeleteId(null);
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
        <SummaryCard
          label="הוצאה חודשית"
          value={formatCurrencyWhole(summary.monthlyRunRateIls)}
          sub={`${formatCurrency(summary.monthlyRunRate.ILS)} + ${formatMoney(summary.monthlyRunRate.USD, "USD")}`}
          icon={TrendingDown}
          gradient="from-rose-400 to-pink-500"
          bg="from-rose-50 to-pink-50"
        />
        <SummaryCard
          label="הכנסות החודש"
          value={formatCurrencyWhole(summary.incomeThisMonthIls)}
          sub={`מתוכן ${formatCurrency(summary.automaticIncomeIls)} מתשלומי מנוי`}
          icon={TrendingUp}
          gradient="from-emerald-400 to-teal-500"
          bg="from-emerald-50 to-teal-50"
        />
        <SummaryCard
          label="מאזן חודשי"
          value={formatCurrencyWhole(net)}
          sub={net >= 0 ? "האפליקציה מכסה את עצמה" : "עדיין בהשקעה"}
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
            {summary.missingAmountCount} רשומות חסרות סכום
          </span>
        )}
      </div>

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
                  <th className="px-4 py-2 text-start font-medium">סכום</th>
                  <th className="px-4 py-2 text-start font-medium">תדירות</th>
                  <th className="px-4 py-2 text-start font-medium">חיוב הבא</th>
                  <th className="px-4 py-2 text-start font-medium">תשלום</th>
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
                    <td className="px-4 py-3">
                      <AmountCell entry={entry} onFill={() => openForm(formFromEntry(entry))} />
                    </td>
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
                    <AmountCell entry={entry} onFill={() => openForm(formFromEntry(entry))} />
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
                <span className="font-semibold text-stone-900 flex-shrink-0">
                  {formatMoney(row.amount, row.currency)}
                </span>
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
                  <AmountCell entry={entry} onFill={() => openForm(formFromEntry(entry))} />
                  <RowActions
                    entry={entry}
                    armed={confirmDeleteId === entry.id}
                    onEdit={() => openForm(formFromEntry(entry))}
                    onToggle={() => handleToggle(entry)}
                    onDelete={() => handleDelete(entry)}
                  />
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
