"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wallet, Plus, ShoppingBag, Pencil, Trash2, Upload, Search, X, ScanLine, Loader2, Paperclip, Printer } from "lucide-react";
import { useExpenses, expenseStore } from "@/lib/expense-store";
import { useBusiness } from "@/lib/business-store";
import { formatCurrency, formatDate } from "@/lib/format";
import { ExpenseFormModal } from "@/components/expense-form-modal";
import { CsvImportModal } from "@/components/csv-import-modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { PrintSheet, usePrintSheet } from "@/components/print-sheet";
import { PeriodPicker } from "@/components/period-picker";
import { type Period, periodMatches, periodLabel } from "@/lib/report-period";
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
  /** Hebrew field names the scanner could NOT read - shown to the user so
   *  they know what to fill in by hand instead of trusting a blank. */
  unreadFields?: string[];
};

/**
 * Longest edge we send to the scanner. This is the model's own maximum
 * useful input resolution - anything larger is downscaled server-side by
 * the API anyway, so sending a 12MP phone photo only costs upload time and
 * risks the request-size cap. Downscaling to exactly this edge keeps every
 * pixel the model would have seen.
 */
const SCAN_MAX_EDGE = 2576;

/**
 * Photos: decode, downscale to SCAN_MAX_EDGE, re-encode as JPEG. PDFs and
 * anything the browser can't decode (HEIC on non-Safari) pass through as-is
 * and the server reports the format problem clearly.
 */
async function prepareScanFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return fileToBase64(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    // Browser can't decode this image type - let the server explain.
    return fileToBase64(file);
  }
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, SCAN_MAX_EDGE / Math.max(width, height));
    if (scale === 1 && file.type === "image/jpeg" && file.size < 4_000_000) {
      return fileToBase64(file);
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return fileToBase64(file);
    // White backing so transparent PNG receipts don't become black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    bitmap.close();
  }
}

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

export default function ExpensesPage() {
  const { items: expenses } = useExpenses();
  const { business } = useBusiness();
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [prefill, setPrefill] = useState<ScanPrefill | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  // Same period model as /reports ("all" | "2026" | "2026-Q3" | "2026-08" |
  // "from..to"), driven by the shared PeriodPicker in the page header.
  const [period, setPeriod] = useState<Period>("all");
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const { printing, print } = usePrintSheet();

  const availableCategories = useMemo(() => {
    const set = new Set(expenses.map((e) => e.category));
    return Array.from(set).sort();
  }, [expenses]);

  const filtered = useMemo(() => {
    let result = expenses;
    if (categoryFilter !== "all") result = result.filter((e) => e.category === categoryFilter);
    if (period !== "all") result = result.filter((e) => periodMatches(period, e.date));
    if (search.trim()) result = result.filter((e) => matchesExpense(e, search));
    return [...result].sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, search, categoryFilter, period]);

  // `amount` is stored gross (VAT included) and `vatAmount` is the VAT part,
  // so the net column is the difference - same three figures as the income
  // reports: ללא מע״מ / מע״מ / כולל מע״מ.
  const filteredTotal = filtered.reduce((sum, e) => sum + e.amount, 0);
  const grandTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const filteredVat = filtered.reduce((sum, e) => sum + (e.vatAmount ?? 0), 0);
  const grandVat = expenses.reduce((sum, e) => sum + (e.vatAmount ?? 0), 0);
  const filteredNet = filteredTotal - filteredVat;
  const filtersActive = search.trim() !== "" || categoryFilter !== "all" || period !== "all";
  // The expense form only offers VAT entry to עוסק מורשה / company (the ones
  // who reclaim input VAT), so an exempt business would see a column of
  // dashes. Show it for them only if VAT data actually exists (e.g. the
  // business type was changed after some expenses were recorded with VAT).
  const showVat =
    business.businessType === "authorized" ||
    business.businessType === "company" ||
    grandVat > 0;

  // Human description of the active filters, printed under the title so a
  // sheet handed to an accountant says what it is a list OF.
  const printSubtitle = useMemo(() => {
    const parts: string[] = [];
    if (period !== "all") parts.push(`תקופה: ${periodLabel(period)}`);
    if (categoryFilter !== "all") parts.push(`קטגוריה: ${categoryFilter}`);
    if (search.trim()) parts.push(`חיפוש: "${search.trim()}"`);
    return parts.length ? parts.join(" · ") : "כל ההוצאות";
  }, [period, categoryFilter, search]);

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
  }, [search, categoryFilter, period]);

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
      const base64 = await prepareScanFile(file);
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
      // Every field can be null: the scanner leaves anything it could not
      // read with certainty blank rather than guessing (Asaf, 2026-08-17).
      const d = json.data as {
        vendor?: string | null;
        amount?: number | null;
        vatAmount?: number | null;
        date?: string | null;
        category?: string | null;
        description?: string | null;
        unreadFields?: string[];
        receiptPath?: string | null;
      };
      setEditing(null);
      setPrefill({
        supplier: d.vendor ?? undefined,
        amount: d.amount ?? undefined,
        vatAmount: d.vatAmount ?? undefined,
        date: d.date ?? undefined,
        category: d.category ?? undefined,
        description: d.description ?? undefined,
        unreadFields: d.unreadFields ?? [],
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
    setPeriod("all");
  }

  return (
    <>
    <div className="space-y-6" data-print-hidden={printing ? "true" : undefined}>
      {/* Title on the inline-start, the period control on the inline-end -
          the same header the reports page has, so a free date range is one
          click away instead of the last entry of a month dropdown. */}
      <div className="rpt-head">
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
                {showVat && (
                  <span className="text-stone-500 mr-2">
                    מתוכו מע״מ <span className="font-semibold text-stone-700 tabular-nums">{formatCurrency(filteredVat)}</span>
                  </span>
                )}
                <span className="text-stone-500 mr-2">/ סה״כ {formatCurrency(grandTotal)}</span>
              </>
            ) : (
              <>
                סה״כ <span className="font-semibold text-rose-600">{formatCurrency(grandTotal)}</span>
                {showVat && (
                  <span className="text-stone-500 mr-2">
                    מתוכו מע״מ <span className="font-semibold text-stone-700 tabular-nums">{formatCurrency(grandVat)}</span>
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        {expenses.length > 0 && (
          <div className="rpt-controls">
            <PeriodPicker period={period} onChange={setPeriod} />
          </div>
        )}
      </div>

      {/* Primary alone at the inline-start (right, under the title), the
          import / scan chores pushed to the inline-end. See "PAGE ACTION BAR"
          in app-skin.css. */}
      <div className="pgbar">
        <button onClick={openNew} className="pgbtn pgbtn-primary pgbtn-hero">
          <Plus aria-hidden="true" />
          הוצאה חדשה
        </button>
        <div className="flex gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={handleScanFile}
            className="hidden"
          />
          <button
            onClick={print}
            disabled={filtered.length === 0}
            title="הדפסת רשימת ההוצאות המסוננת / שמירה כ-PDF"
            className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-4 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50 disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            הדפסה
          </button>
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
            <table className={`gk-etable w-full ${showVat ? "min-w-[900px]" : "min-w-[640px]"}`}>
              <thead className="text-sm text-stone-700 bg-white">
                <tr>
                  <th className="text-right px-6 py-3 font-semibold">תאריך</th>
                  <th className="text-right px-6 py-3 font-semibold">קטגוריה</th>
                  <th className="text-right px-6 py-3 font-semibold">ספק</th>
                  <th className="text-right px-6 py-3 font-semibold">תיאור</th>
                  {showVat && <th className="text-left px-6 py-3 font-semibold whitespace-nowrap">סכום ללא מע״מ</th>}
                  {showVat && <th className="text-left px-6 py-3 font-semibold">מע״מ</th>}
                  <th className="text-left px-6 py-3 font-semibold whitespace-nowrap">{showVat ? "סכום כולל מע״מ" : "סכום"}</th>
                  <th className="px-4 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={showVat ? 8 : 6} className="px-6 py-16 text-center">
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
                      <td className="px-6 py-3 text-sm font-bold text-stone-900 tabular-nums">{formatDate(e.date)}</td>
                      <td className="px-6 py-3 text-sm">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-sm font-medium">
                          <ShoppingBag className="w-3 h-3" />
                          {e.category}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm font-bold text-stone-900">
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
                      <td className="px-6 py-3 text-sm font-medium text-stone-900">{e.description || "-"}</td>
                      {showVat && (
                        <td className="px-6 py-3 text-sm font-semibold text-left text-stone-700 tabular-nums">
                          {formatCurrency(e.amount - (e.vatAmount ?? 0))}
                        </td>
                      )}
                      {showVat && (
                        <td className="px-6 py-3 text-sm font-semibold text-left text-stone-600 tabular-nums">
                          {e.vatAmount ? formatCurrency(e.vatAmount) : <span className="text-stone-400">-</span>}
                        </td>
                      )}
                      <td className="px-6 py-3 text-base font-bold text-left text-rose-600 tabular-nums">
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
              {filtered.length > 0 && (
                /* Totals of the whole filtered list (not just this page),
                   in the same three columns as the income reports. */
                <tfoot>
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-sm">
                      סה״כ · {filtered.length} הוצאות
                    </td>
                    {showVat && (
                      <td className="px-6 py-4 text-sm text-left tabular-nums whitespace-nowrap">{formatCurrency(filteredNet)}</td>
                    )}
                    {showVat && (
                      <td className="px-6 py-4 text-sm text-left tabular-nums whitespace-nowrap">{formatCurrency(filteredVat)}</td>
                    )}
                    <td className="px-6 py-4 text-base text-left text-rose-600 tabular-nums whitespace-nowrap">{formatCurrency(filteredTotal)}</td>
                    <td className="px-4 py-4"></td>
                  </tr>
                </tfoot>
              )}
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
        history={expenses}
      />

      <CsvImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityType="expenses"
      />
    </div>
    {printing && (
      <PrintSheet
        title="רשימת הוצאות"
        businessName={business.name}
        subtitle={printSubtitle}
        rows={filtered}
        rowKey={(e) => e.id}
        countLabel={`${filtered.length} הוצאות`}
        columns={[
          { key: "date", header: "תאריך", render: (e) => formatDate(e.date), footer: "סה״כ" },
          { key: "category", header: "קטגוריה", render: (e) => e.category },
          { key: "supplier", header: "ספק", render: (e) => e.supplier },
          { key: "description", header: "תיאור", render: (e) => e.description || "-" },
          ...(showVat
            ? [
                {
                  key: "net",
                  header: "סכום ללא מע״מ",
                  align: "end" as const,
                  render: (e: Expense) => formatCurrency(e.amount - (e.vatAmount ?? 0)),
                  footer: formatCurrency(filteredNet),
                },
                {
                  key: "vat",
                  header: "מע״מ",
                  align: "end" as const,
                  render: (e: Expense) => (e.vatAmount ? formatCurrency(e.vatAmount) : "-"),
                  footer: formatCurrency(filteredVat),
                },
              ]
            : []),
          {
            key: "amount",
            header: showVat ? "סכום כולל מע״מ" : "סכום",
            align: "end" as const,
            render: (e) => formatCurrency(e.amount),
            footer: formatCurrency(filteredTotal),
          },
        ]}
      />
    )}
    </>
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
