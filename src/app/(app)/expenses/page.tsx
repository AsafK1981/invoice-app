"use client";

import { useMemo, useState } from "react";
import { Wallet, Plus, ShoppingBag, Pencil, Trash2, Upload, Search, X } from "lucide-react";
import { useExpenses, expenseStore } from "@/lib/expense-store";
import { formatCurrency, formatDate } from "@/lib/format";
import { ExpenseFormModal } from "@/components/expense-form-modal";
import { CsvImportModal } from "@/components/csv-import-modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import type { Expense } from "@/lib/types";

function matchesExpense(e: Expense, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    e.category,
    e.supplier,
    e.description || "",
    e.date,
    formatDate(e.date),
    String(e.amount),
    String(Math.round(e.amount)),
    formatCurrency(e.amount),
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((t) => haystack.includes(t));
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const names = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  return `${names[parseInt(m, 10) - 1]} ${year}`;
}

export default function ExpensesPage() {
  const { items: expenses } = useExpenses();
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const confirm = useConfirm();

  const availableMonths = useMemo(() => {
    const set = new Set(expenses.map((e) => e.date.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [expenses]);

  const availableCategories = useMemo(() => {
    const set = new Set(expenses.map((e) => e.category));
    return Array.from(set).sort();
  }, [expenses]);

  const filtered = useMemo(() => {
    let result = expenses;
    if (categoryFilter !== "all") result = result.filter((e) => e.category === categoryFilter);
    if (monthFilter !== "all") result = result.filter((e) => e.date.startsWith(monthFilter));
    if (search.trim()) result = result.filter((e) => matchesExpense(e, search));
    return [...result].sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, search, categoryFilter, monthFilter]);

  const filteredTotal = filtered.reduce((sum, e) => sum + e.amount, 0);
  const grandTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const filtersActive = search.trim() !== "" || categoryFilter !== "all" || monthFilter !== "all";

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(expense: Expense) {
    setEditing(expense);
    setModalOpen(true);
  }

  async function remove(expense: Expense) {
    const ok = await confirm({
      title: `למחוק הוצאה לספק "${expense.supplier}"?`,
      message: `סכום: ${formatCurrency(expense.amount)}`,
      tone: "danger",
      confirmLabel: "מחק",
    });
    if (ok) await expenseStore.remove(expense.id);
  }

  function clearFilters() {
    setSearch("");
    setCategoryFilter("all");
    setMonthFilter("all");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-sm">
              <Wallet className="w-5 h-5 text-white" />
            </span>
            הוצאות
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            {filtersActive ? (
              <>
                מסונן: <span className="font-semibold text-rose-600">{formatCurrency(filteredTotal)}</span>
                <span className="text-stone-500 mr-2">/ סה״כ {formatCurrency(grandTotal)}</span>
              </>
            ) : (
              <>
                סה״כ <span className="font-semibold text-rose-600">{formatCurrency(grandTotal)}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-4 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50"
          >
            <Upload className="w-4 h-4" />
            ייבוא
          </button>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all"
          >
            <Plus className="w-4 h-4" />
            הוצאה חדשה
          </button>
        </div>
      </div>

      {expenses.length === 0 ? (
        <div className="card-soft p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-100 to-pink-100 flex items-center justify-center mx-auto mb-4">
            <Wallet className="w-7 h-7 text-rose-500" />
          </div>
          <h3 className="font-bold text-stone-900 mb-1">אין הוצאות מתועדות</h3>
          <p className="text-sm text-stone-700 mb-5">
            תיעוד הוצאות יעזור לך לחשב רווח נטו ולהכין דיווחים
          </p>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-md"
          >
            <Plus className="w-4 h-4" />
            הוסף הוצאה ראשונה
          </button>
        </div>
      ) : (
        <div className="card-soft overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-6 py-4 bg-orange-50/50 border-b border-orange-100">
            <div className="relative">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש: ספק, קטגוריה, סכום, תיאור..."
                className="input-warm pr-10 pl-9 w-72"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                  aria-label="נקה חיפוש"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <FilterSelect
              label="קטגוריה"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                { value: "all", label: "כל הקטגוריות" },
                ...availableCategories.map((c) => ({ value: c, label: c })),
              ]}
            />
            <FilterSelect
              label="חודש"
              value={monthFilter}
              onChange={setMonthFilter}
              options={[
                { value: "all", label: "כל החודשים" },
                ...availableMonths.map((m) => ({ value: m, label: formatMonthLabel(m) })),
              ]}
            />
            {filtersActive && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center justify-center min-h-[36px] px-3 text-sm font-medium text-orange-700 hover:bg-orange-100 rounded-xl"
              >
                נקה הכל
              </button>
            )}
            <div className="text-sm font-medium text-stone-700 mr-auto">
              {filtered.length} הוצאות
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="text-xs text-stone-700 bg-white">
                <tr>
                  <th className="text-right px-6 py-3 font-semibold">תאריך</th>
                  <th className="text-right px-6 py-3 font-semibold">קטגוריה</th>
                  <th className="text-right px-6 py-3 font-semibold">ספק</th>
                  <th className="text-right px-6 py-3 font-semibold">תיאור</th>
                  <th className="text-left px-6 py-3 font-semibold">סכום</th>
                  <th className="px-4 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="text-4xl mb-2">🔍</div>
                      <div className="text-sm text-stone-500">אין הוצאות התואמות לסינון הנבחר</div>
                      <button
                        onClick={clearFilters}
                        className="text-sm text-orange-600 hover:underline mt-2"
                      >
                        נקה את כל הסינונים
                      </button>
                    </td>
                  </tr>
                ) : (
                  filtered.map((e) => (
                    <tr
                      key={e.id}
                      className="border-t border-orange-50 hover:bg-rose-50/40 transition-colors group"
                    >
                      <td className="px-6 py-3 text-sm text-stone-700">{formatDate(e.date)}</td>
                      <td className="px-6 py-3 text-sm">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
                          <ShoppingBag className="w-3 h-3" />
                          {e.category}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm font-medium text-stone-900">{e.supplier}</td>
                      <td className="px-6 py-3 text-sm text-stone-700">{e.description || "—"}</td>
                      <td className="px-6 py-3 text-sm font-bold text-left text-rose-600">
                        {formatCurrency(e.amount)}
                      </td>
                      <td className="px-2 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                          <Tooltip label="עריכת הוצאה" side="top">
                            <button
                              onClick={() => openEdit(e)}
                              className="w-8 h-8 rounded-xl text-stone-400 hover:text-orange-600 hover:bg-orange-50 flex items-center justify-center"
                              aria-label="עריכת הוצאה"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>
                          <Tooltip label="מחיקת הוצאה" side="top">
                            <button
                              onClick={() => remove(e)}
                              className="w-8 h-8 rounded-xl text-stone-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                              aria-label="מחיקת הוצאה"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ExpenseFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        expense={editing}
      />

      <CsvImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityType="expenses"
      />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-stone-500">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-warm py-1.5 px-3 text-sm w-auto"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
