"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wallet, Plus, ShoppingBag, Pencil, Trash2, Upload, Search, X, ScanLine, Loader2, Paperclip } from "lucide-react";
import { useExpenses, expenseStore } from "@/lib/expense-store";
import { formatCurrency, formatDate } from "@/lib/format";
import { ExpenseFormModal } from "@/components/expense-form-modal";
import { CsvImportModal } from "@/components/csv-import-modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { supabase } from "@/lib/supabase";
import type { Expense } from "@/lib/types";

/**
 * Rows shown per page in the expenses table.
 *
 * NOT wired into the Supabase fetch: useExpenses() stays a full fetch (see
 * expense-store.ts). This page derives grandTotal/filteredTotal - real money
 * figures - by summing over EVERY expense, filtered or not, and the category/
 * month filter dropdowns list every distinct value that exists. Fetching only
 * one page server-side would quietly turn both into "total of this page only"
 * and "options seen on this page only" - a wrong-numbers bug, not a UX one.
 * So the pagination here only controls how many of the already-fetched,
 * already-filtered rows get RENDERED at once; the filters/totals still see
 * the whole list.
 */
const PAGE_SIZE = 50;

type ScanPrefill = {
  date?: string;
  category?: string;
  supplier?: string;
  amount?: number;
  vatAmount?: number;
  description?: string;
  receiptPath?: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

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
  const [prefill, setPrefill] = useState<ScanPrefill | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [filtered, page]
  );
  // Any change to what's filtered (new search, new filter selection, or the
  // list itself changing after an add/edit/delete) can leave `page` pointing
  // past the new last page - reset to page 1 whenever the filtered set does.
  useEffect(() => {
    setPage(0);
  }, [search, categoryFilter, monthFilter]);

  function openNew() {
    setEditing(null);
    setPrefill(null);
    setModalOpen(true);
  }

  function openEdit(expense: Expense) {
    setEditing(expense);
    setPrefill(null);
    setModalOpen(true);
  }

  function triggerScan() {
    setScanError(null);
    fileInputRef.current?.click();
  }

  async function openReceipt(receiptPath: string) {
    const { data, error } = await supabase.storage
      .from("expense-receipts")
      .createSignedUrl(receiptPath, 60 * 60);
    if (error || !data?.signedUrl) {
      setScanError(error?.message || "לא ניתן לפתוח את הקובץ.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function handleScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      setScanError("רק תמונה או PDF.");
      return;
    }
    setScanning(true);
    setScanError(null);
    try {
      const base64 = await fileToBase64(file);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setScanError("ההתחברות שלך פגה. רענן את הדף ונסה שוב.");
        return;
      }
      const res = await fetch("/api/expenses/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ image: base64 }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setScanError(json.error || "סריקה נכשלה.");
        return;
      }
      // The OCR API returns the supplier name as `vendor` (the term the
      // model thinks in). The expense form's field is `supplier`. Map at
      // the boundary so the rest of the code can stay in form-vocabulary.
      const d = json.data as {
        vendor?: string;
        amount?: number;
        vatAmount?: number | null;
        date?: string;
        category?: string;
        description?: string;
        receiptPath?: string | null;
      };
      setEditing(null);
      setPrefill({
        supplier: d.vendor,
        amount: d.amount,
        vatAmount: d.vatAmount ?? undefined,
        date: d.date,
        category: d.category,
        description: d.description,
        receiptPath: d.receiptPath || undefined,
      });
      setModalOpen(true);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "סריקה נכשלה.");
    } finally {
      setScanning(false);
    }
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
            <span className="w-11 h-11 rounded-2xl fgrad fgrad-pink flex items-center justify-center shadow-sm">
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={handleScanFile}
            className="hidden"
          />
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-4 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50"
          >
            <Upload className="w-4 h-4" />
            ייבוא
          </button>
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 bg-white border-2 border-sky-300 text-sky-800 px-4 py-2.5 rounded-2xl text-sm font-semibold hover:bg-sky-50 disabled:opacity-60"
          >
            {scanning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                מנתח...
              </>
            ) : (
              <>
                <ScanLine className="w-4 h-4" />
                העלה קבלה / מסמך
              </>
            )}
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

      {scanError && (
        <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-2xl text-sm">
          <span className="font-semibold">סריקה נכשלה:</span>
          <span className="flex-1">{scanError}</span>
          <button
            onClick={() => setScanError(null)}
            className="text-rose-600 hover:text-rose-900"
            aria-label="סגור"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {expenses.length === 0 ? (
        <EmptyState
          icon={Wallet}
          tone="pink"
          title="אין הוצאות מתועדות"
          description="תיעוד הוצאות מאפשר לך לחשב רווח נטו, להפיק דיווחים תקופתיים, ולהיות מוכן ליום של הצהרת הון. הוסף הוצאה ראשונה: שתי דקות עבודה, חודשים של שקט."
          primaryAction={{
            label: "הוסף הוצאה ראשונה",
            onClick: openNew,
            icon: Plus,
          }}
          secondaryAction={{
            label: "ייבוא מקובץ CSV",
            onClick: () => setImportOpen(true),
          }}
        />
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
            <table className="gk-etable w-full min-w-[640px]">
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
                  paginated.map((e) => (
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
                      <td className="px-6 py-3 text-sm font-medium text-stone-900">
                        <div className="flex items-center gap-2">
                          {e.receiptPath && (
                            <Tooltip label="פתח את הקובץ המקורי" side="top">
                              <button
                                onClick={() => openReceipt(e.receiptPath!)}
                                className="w-6 h-6 rounded-lg text-sky-600 hover:bg-sky-50 flex items-center justify-center flex-shrink-0"
                                aria-label="פתח קבלה מצורפת"
                              >
                                <Paperclip className="w-3.5 h-3.5" />
                              </button>
                            </Tooltip>
                          )}
                          <span>{e.supplier}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-sm text-stone-700">{e.description || "-"}</td>
                      <td className="px-6 py-3 text-sm font-bold text-left text-rose-600">
                        {formatCurrency(e.amount)}
                      </td>
                      <td className="px-2 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                          <Tooltip label="עריכת הוצאה" side="top">
                            <button
                              onClick={() => openEdit(e)}
                              className="w-10 h-10 sm:w-8 sm:h-8 rounded-xl text-stone-400 hover:text-orange-600 hover:bg-orange-50 flex items-center justify-center"
                              aria-label="עריכת הוצאה"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>
                          <Tooltip label="מחיקת הוצאה" side="top">
                            <button
                              onClick={() => remove(e)}
                              className="w-10 h-10 sm:w-8 sm:h-8 rounded-xl text-stone-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
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
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </div>
      )}

      <ExpenseFormModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setPrefill(null);
        }}
        expense={editing}
        prefill={prefill}
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
