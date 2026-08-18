"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { expenseStore } from "@/lib/expense-store";
import { useBusiness } from "@/lib/business-store";
import { todayInIsrael } from "@/lib/date";
import { getVatRate, round2 } from "@/lib/vat";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Expense } from "@/lib/types";

type PrefillFromScan = {
  date?: string;
  category?: string;
  supplier?: string;
  amount?: number;
  vatAmount?: number;
  description?: string;
  /** Set by the scan flow: the uploaded receipt's storage path. The form
   *  carries it through to the save call without exposing it in the UI. */
  receiptPath?: string;
  /** Set by the scan flow: Hebrew names of fields the scanner could not
   *  read. Those arrive blank on purpose (never guessed) and the subtitle
   *  tells the user to fill them in. */
  unreadFields?: string[];
};

interface Props {
  open: boolean;
  onClose: () => void;
  expense?: Expense | null;
  /** Pre-fills the form (used after OCR scan). Ignored when `expense` is set. */
  prefill?: PrefillFromScan | null;
  /** The user's existing expenses (newest first). Powers supplier
   *  autocomplete and "same as last time" autofill for a NEW expense. */
  history?: Expense[];
}

const COMMON_CATEGORIES = [
  "תוכנה",
  "ציוד",
  "שיווק",
  "משרד",
  "שירותים מקצועיים",
  "נסיעות",
  "אחר",
];

/**
 * How the user is typing the amount:
 *  - inclusive: the number is the gross total, VAT is carved out of it
 *  - exclusive: the number is the net, VAT is added on top
 *  - none:      no VAT on this expense (foreign supplier / עוסק פטור supplier)
 * Storage is always `amount` = gross total, `vatAmount` = VAT portion; the
 * mode only decides how those two are derived from what was typed.
 */
type EntryMode = "inclusive" | "exclusive" | "none";

const ENTRY_MODES: { value: EntryMode; label: string }[] = [
  { value: "exclusive", label: "לפני מע״מ" },
  { value: "inclusive", label: "כולל מע״מ" },
  { value: "none", label: "ללא מע״מ" },
];

// Remembers the last category / VAT-entry mode the user actually saved, so a
// brand-new expense defaults to what this user tends to log instead of always
// resetting to the first option. Only read for NEW expenses (see the `open`
// effect below) - editing an existing expense always keeps that expense's own
// values, and an OCR-detected value on a scanned prefill always wins.
const LAST_CATEGORY_KEY = "invoice-app:last-expense-category";
const LAST_VAT_MODE_KEY = "invoice-app:last-expense-vat-mode";

function getLastUsedCategory(): string {
  if (typeof window === "undefined") return COMMON_CATEGORIES[0];
  const stored = window.localStorage.getItem(LAST_CATEGORY_KEY);
  return stored && COMMON_CATEGORIES.includes(stored) ? stored : COMMON_CATEGORIES[0];
}

function rememberCategory(category: string) {
  if (typeof window === "undefined") return;
  if (!COMMON_CATEGORIES.includes(category)) return;
  window.localStorage.setItem(LAST_CATEGORY_KEY, category);
}

function getLastUsedMode(): EntryMode {
  if (typeof window === "undefined") return "inclusive";
  const stored = window.localStorage.getItem(LAST_VAT_MODE_KEY);
  return stored === "exclusive" || stored === "none" ? stored : "inclusive";
}

function rememberMode(mode: EntryMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_VAT_MODE_KEY, mode);
}

/** Mode + override that reproduce a stored (total, vat) pair exactly. */
function modeForStored(vat: number | undefined, showVat: boolean): { mode: EntryMode; override: string | null } {
  if (!showVat) return { mode: "inclusive", override: null };
  if (vat && vat > 0) return { mode: "inclusive", override: String(vat) };
  return { mode: "none", override: null };
}

const normalizeName = (s: string) => s.trim().toLowerCase();

const NO_HISTORY: Expense[] = [];

export function ExpenseFormModal({ open, onClose, expense, prefill, history = NO_HISTORY }: Props) {
  const today = todayInIsrael();
  const { business } = useBusiness();
  const supplierListId = useId();
  // Only עוסק מורשה / company can claim input-VAT credit, so the VAT
  // controls are hidden for עוסק פטור (it'd just be confusion / clutter).
  const showVatField = business.businessType === "authorized" || business.businessType === "company";
  const vatRate = getVatRate(business);

  const [form, setForm] = useState({
    date: today,
    category: getLastUsedCategory(),
    supplier: "",
    amount: "",
    description: "",
  });
  const [mode, setMode] = useState<EntryMode>("inclusive");
  // The VAT the user typed by hand. null = derive it from amount + mode.
  // Cleared whenever amount or mode changes, so VAT follows the number.
  const [vatOverride, setVatOverride] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Supplier-based autofill bookkeeping (new expenses only)
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [autofilledFrom, setAutofilledFrom] = useState<Expense | null>(null);

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setJustSaved(false);
    setCategoryTouched(false);
    setAutofilledFrom(null);
    if (expense) {
      setForm({
        date: expense.date,
        category: expense.category,
        supplier: expense.supplier,
        amount: String(expense.amount),
        description: expense.description || "",
      });
      const m = modeForStored(expense.vatAmount, showVatField);
      setMode(m.mode);
      setVatOverride(m.override);
    } else if (prefill) {
      // Coerce the scan output's category to one of our common values; fall
      // back to "אחר" if the model returned something off-list.
      const cat =
        prefill.category && COMMON_CATEGORIES.includes(prefill.category)
          ? prefill.category
          : "אחר";
      // A missing scan date stays EMPTY - not today. The scanner only omits
      // it when it could not read one, and a silently-defaulted date is
      // exactly the "confidently wrong" data Asaf asked us never to save.
      setForm({
        date: prefill.date || "",
        category: cat,
        supplier: prefill.supplier || "",
        amount: prefill.amount != null ? String(prefill.amount) : "",
        description: prefill.description || "",
      });
      // OCR returns vatAmount only when the receipt shows an explicit VAT
      // line. No line = don't invent input-VAT credit; the user can flip
      // to "כולל מע״מ" with one tap and it auto-fills.
      const m = modeForStored(prefill.vatAmount, showVatField);
      setMode(m.mode);
      setVatOverride(m.override);
    } else {
      setForm({
        date: today,
        category: getLastUsedCategory(),
        supplier: "",
        amount: "",
        description: "",
      });
      setMode(showVatField ? getLastUsedMode() : "inclusive");
      setVatOverride(null);
    }
  }, [open, expense, prefill, showVatField]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ── Amount math ─────────────────────────────────────────────────────
  const entered = parseFloat(form.amount);
  const enteredNum = Number.isFinite(entered) && entered > 0 ? entered : 0;
  const vatOn = showVatField && mode !== "none";
  const autoVat = !vatOn
    ? 0
    : mode === "inclusive"
      ? round2(enteredNum - enteredNum / (1 + vatRate / 100))
      : round2((enteredNum * vatRate) / 100);
  const overrideNum = vatOverride != null ? parseFloat(vatOverride) : NaN;
  const vat = !vatOn ? 0 : Number.isFinite(overrideNum) && overrideNum >= 0 ? overrideNum : autoVat;
  const total = mode === "exclusive" && vatOn ? round2(enteredNum + vat) : enteredNum;
  const net = round2(total - vat);
  const vatOverridden = vatOn && vatOverride != null && Number.isFinite(overrideNum) && round2(overrideNum) !== autoVat;

  function changeMode(next: EntryMode) {
    setMode(next);
    setVatOverride(null);
    rememberMode(next);
  }

  // ── Supplier autocomplete + "same as last time" ─────────────────────
  const knownSuppliers = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of history) {
      const key = normalizeName(e.supplier);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(e.supplier.trim());
    }
    return out;
  }, [history]);

  function handleSupplierChange(value: string) {
    update("supplier", value);
    // Autofill only for a brand-new, hand-typed expense: editing keeps the
    // expense's own values and a scanned receipt already knows its numbers.
    if (expense || prefill) return;
    const key = normalizeName(value);
    if (!key) return;
    const last = history.find((e) => normalizeName(e.supplier) === key);
    if (!last) return;
    setForm((f) => {
      const amountFree = f.amount.trim() === "" || autofilledFrom != null;
      return {
        ...f,
        // Snap to the casing the user saved last time ("vercel" -> "Vercel")
        supplier: last.supplier,
        category: categoryTouched || !COMMON_CATEGORIES.includes(last.category) ? f.category : last.category,
        amount: amountFree ? String(last.amount) : f.amount,
      };
    });
    if (form.amount.trim() === "" || autofilledFrom != null) {
      const m = modeForStored(last.vatAmount, showVatField);
      setMode(m.mode);
      setVatOverride(m.override);
      setAutofilledFrom(last);
    }
  }

  function handleAmountChange(value: string) {
    update("amount", value);
    setVatOverride(null);
    setAutofilledFrom(null);
  }

  async function handleSubmit() {
    if (!form.supplier.trim() || enteredNum <= 0) return;

    const record: Expense = {
      id: expense?.id ?? crypto.randomUUID(),
      date: form.date,
      category: form.category,
      supplier: form.supplier.trim(),
      amount: total,
      description: form.description.trim() || undefined,
      vatAmount: vat > 0 ? round2(vat) : 0,
      receiptPath: expense?.receiptPath || prefill?.receiptPath || undefined,
    };
    setSaving(true);
    await expenseStore.save(record);
    rememberCategory(record.category);
    if (showVatField) rememberMode(mode);
    setSaving(false);
    setJustSaved(true);
    setTimeout(onClose, 900);
  }

  const canSubmit = form.supplier.trim().length > 0 && enteredNum > 0 && /^\d{4}-\d{2}-\d{2}$/.test(form.date);
  const unread = prefill?.unreadFields ?? [];

  const amountLabel = !vatOn
    ? "סכום (₪)"
    : mode === "inclusive"
      ? "סכום כולל מע״מ (₪)"
      : "סכום לפני מע״מ (₪)";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={expense ? "עריכת הוצאה" : prefill ? "הוצאה מתוך מסמך" : "הוצאה חדשה"}
      subtitle={
        expense
          ? "עדכן את פרטי ההוצאה"
          : prefill
            ? unread.length > 0
              ? `לא הצלחתי לקרוא בביטחון: ${unread.join(", ")} - השלם ידנית ובדוק את השאר`
              : "מילאתי לפי המסמך, בדוק ושמור"
            : "תיעוד הוצאה עסקית"
      }
      icon={Wallet}
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-stone-700 hover:bg-white"
          >
            ביטול
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || saving || justSaved}
            className={`px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:shadow-none ${
              justSaved
                ? "bg-emerald-600"
                : "bg-gradient-to-l from-orange-500 to-rose-500 hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300"
            }`}
          >
            {justSaved ? "נשמר ✓" : saving ? "שומר..." : expense ? "שמור שינויים" : "הוסף הוצאה"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="תאריך" required>
            <input
              type="date"
              value={form.date}
              onChange={(e) => update("date", e.target.value)}
              className="input-warm"
            />
          </FormField>

          <FormField label="קטגוריה">
            <select
              value={form.category}
              onChange={(e) => {
                setCategoryTouched(true);
                update("category", e.target.value);
              }}
              className="input-warm"
            >
              {COMMON_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField
          label="ספק / שם העסק"
          required
          hint={
            autofilledFrom
              ? `מולא לפי ההוצאה האחרונה מ-${autofilledFrom.supplier} (${formatDate(autofilledFrom.date)}). אפשר לשנות.`
              : undefined
          }
        >
          <input
            type="text"
            name="organization"
            value={form.supplier}
            onChange={(e) => handleSupplierChange(e.target.value)}
            placeholder="למשל: Vercel, KSP, Google"
            autoComplete="off"
            list={knownSuppliers.length ? supplierListId : undefined}
            className="input-warm"
            autoFocus
          />
        </FormField>
        {knownSuppliers.length > 0 && (
          <datalist id={supplierListId}>
            {knownSuppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}

        {showVatField && (
          <div className="p-3 rounded-xl bg-orange-50/60 border border-orange-100">
            <p className="text-xs font-semibold text-stone-700 mb-2">המחיר שאני מזין הוא</p>
            <div
              role="radiogroup"
              aria-label="אופן הזנת הסכום"
              className="grid grid-cols-3 gap-1 bg-white rounded-xl p-1 text-xs font-semibold border border-orange-100"
            >
              {ENTRY_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => changeMode(m.value)}
                  className={`inline-flex items-center justify-center min-h-[40px] px-2 rounded-lg transition-colors ${
                    mode === m.value
                      ? "bg-gradient-to-l from-orange-500 to-rose-500 text-white shadow-sm"
                      : "text-stone-700 hover:text-stone-900 hover:bg-orange-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={vatOn ? "grid grid-cols-2 gap-3" : ""}>
          <FormField label={amountLabel} required>
            <input
              type="number"
              min="0"
              step="0.01"
              dir="ltr"
              value={form.amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="120"
              className="input-warm"
            />
          </FormField>

          {vatOn && (
            <FormField
              label="מתוכו מע״מ (₪)"
              hint={
                vatOverridden
                  ? "תוקן ידנית"
                  : `מחושב אוטומטית לפי ${vatRate}%, אפשר לתקן`
              }
            >
              <input
                type="number"
                min="0"
                step="0.01"
                dir="ltr"
                value={vatOverride ?? (autoVat > 0 ? String(autoVat) : "")}
                onChange={(e) => setVatOverride(e.target.value)}
                placeholder="אוטומטי"
                className="input-warm"
              />
            </FormField>
          )}
        </div>

        {vatOn && enteredNum > 0 && (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600 -mt-1"
            aria-live="polite"
          >
            <span>
              לפני מע״מ <b className="text-stone-800 tabular-nums">{formatCurrency(net)}</b>
            </span>
            <span className="text-stone-300">·</span>
            <span>
              מע״מ <b className="text-stone-800 tabular-nums">{formatCurrency(vat)}</b>
            </span>
            <span className="text-stone-300">·</span>
            <span>
              סה״כ <b className="text-stone-900 tabular-nums">{formatCurrency(total)}</b>
            </span>
            {vatOverridden && (
              <button
                type="button"
                onClick={() => setVatOverride(null)}
                className="text-orange-700 hover:underline font-semibold"
              >
                חזרה לחישוב אוטומטי
              </button>
            )}
          </div>
        )}

        <FormField label="תיאור / הערות">
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="מה ההוצאה הזאת? (אופציונלי)"
            rows={2}
            className="input-warm"
          />
        </FormField>
      </div>
    </Modal>
  );
}
