"use client";

import { useState } from "react";
import { Wallet, Plus, ShoppingBag, Pencil, Trash2, Upload } from "lucide-react";
import { useExpenses, expenseStore } from "@/lib/expense-store";
import { formatCurrency, formatDate } from "@/lib/format";
import { ExpenseFormModal } from "@/components/expense-form-modal";
import { CsvImportModal } from "@/components/csv-import-modal";
import type { Expense } from "@/lib/types";

export default function ExpensesPage() {
  const { items: expenses } = useExpenses();
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const sorted = [...expenses].sort((a, b) => b.date.localeCompare(a.date));

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(expense: Expense) {
    setEditing(expense);
    setModalOpen(true);
  }

  async function remove(expense: Expense) {
    if (confirm(`למחוק הוצאה לספק "${expense.supplier}"?`)) await expenseStore.remove(expense.id);
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
            סה״כ <span className="font-semibold text-rose-600">{formatCurrency(total)}</span>
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
          <table className="w-full">
            <thead className="text-xs text-stone-700 bg-orange-50/50 border-b border-orange-100">
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
              {sorted.map((e) => (
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
                      <button
                        onClick={() => openEdit(e)}
                        className="w-8 h-8 rounded-xl text-stone-400 hover:text-orange-600 hover:bg-orange-50 flex items-center justify-center"
                        title="עריכה"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => remove(e)}
                        className="w-8 h-8 rounded-xl text-stone-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                        title="מחיקה"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
