"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { expenseStore } from "@/lib/expense-store";
import { useBusiness } from "@/lib/business-store";
import type { Expense } from "@/lib/types";

type PrefillFromScan = {
  date?: string;
  category?: string;
  supplier?: string;
  amount?: number;
  vatAmount?: number;
  description?: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  expense?: Expense | null;
  /** Pre-fills the form (used after OCR scan). Ignored when `expense` is set. */
  prefill?: PrefillFromScan | null;
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

export function ExpenseFormModal({ open, onClose, expense, prefill }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const { business } = useBusiness();
  // Only עוסק מורשה / company can claim input-VAT credit, so the field
  // is hidden for עוסק פטור (it'd just be confusion / clutter for them).
  const showVatField = business.businessType === "authorized" || business.businessType === "company";

  const [form, setForm] = useState({
    date: today,
    category: COMMON_CATEGORIES[0],
    supplier: "",
    amount: "",
    vatAmount: "",
    description: "",
  });

  useEffect(() => {
    if (!open) return;
    if (expense) {
      setForm({
        date: expense.date,
        category: expense.category,
        supplier: expense.supplier,
        amount: String(expense.amount),
        vatAmount: expense.vatAmount ? String(expense.vatAmount) : "",
        description: expense.description || "",
      });
    } else if (prefill) {
      // Coerce the scan output's category to one of our common values; fall
      // back to "אחר" if the model returned something off-list.
      const cat =
        prefill.category && COMMON_CATEGORIES.includes(prefill.category)
          ? prefill.category
          : "אחר";
      setForm({
        date: prefill.date || today,
        category: cat,
        supplier: prefill.supplier || "",
        amount: prefill.amount != null ? String(prefill.amount) : "",
        vatAmount: prefill.vatAmount != null ? String(prefill.vatAmount) : "",
        description: prefill.description || "",
      });
    } else {
      setForm({
        date: today,
        category: COMMON_CATEGORIES[0],
        supplier: "",
        amount: "",
        vatAmount: "",
        description: "",
      });
    }
  }, [open, expense, prefill]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    const amount = parseFloat(form.amount);
    if (!form.supplier.trim() || isNaN(amount) || amount <= 0) return;
    const vatRaw = parseFloat(form.vatAmount);
    const vat = showVatField && Number.isFinite(vatRaw) && vatRaw > 0 ? vatRaw : 0;

    const record: Expense = {
      id: expense?.id ?? crypto.randomUUID(),
      date: form.date,
      category: form.category,
      supplier: form.supplier.trim(),
      amount,
      description: form.description.trim() || undefined,
      vatAmount: vat,
    };
    await expenseStore.save(record);
    onClose();
  }

  const canSubmit = form.supplier.trim().length > 0 && parseFloat(form.amount) > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={expense ? "עריכת הוצאה" : prefill ? "סריקת קבלה" : "הוצאה חדשה"}
      subtitle={
        expense
          ? "עדכן את פרטי ההוצאה"
          : prefill
            ? "בדוק את הפרטים שזוהו ושמור"
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
            disabled={!canSubmit}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-rose-500 text-white hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none"
          >
            {expense ? "שמור שינויים" : "הוסף הוצאה"}
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
              onChange={(e) => update("category", e.target.value)}
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

        <FormField label="ספק / שם העסק" required>
          <input
            type="text"
            value={form.supplier}
            onChange={(e) => update("supplier", e.target.value)}
            placeholder="למשל: Vercel, KSP, Google"
            className="input-warm"
            autoFocus
          />
        </FormField>

        <div className={showVatField ? "grid grid-cols-2 gap-3" : ""}>
          <FormField label="סכום כולל מע״מ (₪)" required>
            <input
              type="number"
              min="0"
              step="0.01"
              dir="ltr"
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
              placeholder="120"
              className="input-warm"
            />
          </FormField>

          {showVatField && (
            <FormField label="מתוכו מע״מ (₪)" hint="להחזר במע״מ תשומות">
              <input
                type="number"
                min="0"
                step="0.01"
                dir="ltr"
                value={form.vatAmount}
                onChange={(e) => update("vatAmount", e.target.value)}
                placeholder="20.40"
                className="input-warm"
              />
            </FormField>
          )}
        </div>

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
