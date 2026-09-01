"use client";

import { useMemo, useState } from "react";
import { Package, Plus, Tag, Pencil, Trash2, Upload, Printer, Search, X } from "lucide-react";
import { useProducts, useProductsPage, productStore } from "@/lib/product-store";
import { formatCurrency } from "@/lib/format";
import { ProductFormModal } from "@/components/product-form-modal";
import { CsvImportModal } from "@/components/csv-import-modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { PrintSheet, usePrintSheet } from "@/components/print-sheet";
import { useBusiness } from "@/lib/business-store";
import type { Product } from "@/lib/types";

// Search used to be matched in-memory here; it now happens server-side in
// useProductsPage() (see product-store.ts) so a search over a catalog bigger
// than one page still searches the WHOLE catalog, not just the current page.

export default function ProductsPage() {
  // Full, unpaginated list: needed for the unfiltered "X פריטים בקטלוג" count
  // and the empty-catalog check, which may never be silently truncated to
  // one page. The rendered grid below reads from useProductsPage() instead.
  const { items: products } = useProducts();
  const { business } = useBusiness();
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const confirm = useConfirm();
  const { printing, print } = usePrintSheet();

  const { items: filtered, total: filteredTotal, pageSize } = useProductsPage({ page, search });
  const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize));

  /**
   * The printed price list is the WHOLE catalog, not the cards on screen:
   * the grid above is paginated server-side. The search is re-applied here
   * in memory over the same columns the server searches.
   */
  const printRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? products.filter((p) =>
          [p.name, p.description].filter(Boolean).join(" ").toLowerCase().includes(q),
        )
      : [...products];
    return rows.sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [products, search]);

  function updateSearch(value: string) {
    setSearch(value);
    setPage(0);
  }

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setModalOpen(true);
  }

  async function remove(product: Product) {
    const ok = await confirm({
      title: `למחוק את "${product.name}"?`,
      tone: "danger",
      confirmLabel: "מחק",
    });
    if (ok) await productStore.remove(product.id);
  }

  return (
    <>
    <div className="space-y-6" data-print-hidden={printing ? "true" : undefined}>
      <div>
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl fgrad fgrad-violet flex items-center justify-center shadow-sm">
              <Package className="w-5 h-5 text-white" />
            </span>
            מוצרים ושירותים
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            {search.trim()
              ? `${filteredTotal} מתוך ${products.length} פריטים`
              : `${products.length} פריטים בקטלוג`}
          </p>
        </div>
      </div>

      {/* Primary alone at the inline-start (right, under the title), file
          chores pushed to the inline-end. See "PAGE ACTION BAR" in app-skin.css. */}
      <div className="pgbar">
        <button onClick={openNew} className="pgbtn pgbtn-primary pgbtn-hero">
          <Plus aria-hidden="true" />
          פריט חדש
        </button>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={print}
            disabled={products.length === 0}
            className="inline-flex items-center gap-2 bg-white border-2 border-orange-200 text-stone-800 px-4 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50 disabled:opacity-40"
            title="הדפסת המחירון / שמירה כ-PDF"
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
        </div>
      </div>

      {products.length > 0 && (
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
            placeholder="חיפוש: שם, תיאור..."
            className="input-warm pr-10 pl-9"
          />
          {search && (
            <button
              onClick={() => updateSearch("")}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
              aria-label="נקה חיפוש"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState
          icon={Package}
          tone="violet"
          title="הקטלוג ריק"
          description="הוסף את המוצרים והשירותים שאתה מוכר: שם, מחיר, יחידה. בעורך מסמכים תוכל לבחור פריט בקליק ולחסוך הקלדה חוזרת."
          primaryAction={{
            label: "הוסף פריט ראשון",
            onClick: openNew,
            icon: Plus,
          }}
          secondaryAction={{
            label: "ייבוא מקובץ CSV",
            onClick: () => setImportOpen(true),
          }}
        />
      ) : filtered.length === 0 ? (
        <div className="card-soft p-12 text-center">
          <div className="text-4xl mb-2">🔍</div>
          <h3 className="font-bold text-stone-900 mb-1">לא נמצאו פריטים</h3>
          <p className="text-sm text-stone-700 mb-3">
            אין פריטים התואמים ל-&quot;{search}&quot;
          </p>
          <button
            onClick={() => updateSearch("")}
            className="text-sm text-orange-600 hover:underline"
          >
            נקה חיפוש
          </button>
        </div>
      ) : (
        <>
        <div className="card-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="card-soft p-5 hover:shadow-md hover:-translate-y-0.5 transition-all group relative flex flex-col"
            >
              <div className="absolute top-3 left-3 flex gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                <Tooltip label="עריכת מוצר" align="start">
                  <button
                    onClick={() => openEdit(p)}
                    className="w-10 h-10 sm:w-8 sm:h-8 rounded-xl bg-white hover:bg-orange-50 text-stone-600 hover:text-orange-600 flex items-center justify-center shadow-sm border border-orange-100"
                    aria-label="עריכת מוצר"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <Tooltip label="מחיקת מוצר" align="start">
                  <button
                    onClick={() => remove(p)}
                    className="w-10 h-10 sm:w-8 sm:h-8 rounded-xl bg-white hover:bg-rose-50 text-stone-600 hover:text-rose-600 flex items-center justify-center shadow-sm border border-orange-100"
                    aria-label="מחיקת מוצר"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-200 flex items-center justify-center flex-shrink-0">
                  <Tag className="w-5 h-5 text-orange-600" />
                </div>
                <div className="flex-1 min-w-0 mb-5">
                  <h3 className="font-bold text-stone-900">{p.name}</h3>
                  {p.description && (
                    <p className="text-sm text-stone-800 mt-1 line-clamp-2">{p.description}</p>
                  )}
                </div>
              </div>
              <div className="mt-auto flex items-baseline justify-between pt-4 border-t border-orange-100">
                <span className="text-sm font-semibold text-stone-800">מחיר ל{p.unit}</span>
                <span className="text-xl font-bold bg-gradient-to-l from-orange-500 to-rose-500 bg-clip-text text-transparent">
                  {formatCurrency(p.price)}
                </span>
              </div>
            </div>
          ))}
        </div>
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        </>
      )}

      <ProductFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        product={editing}
      />

      <CsvImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityType="products"
      />
    </div>
    {printing && (
      <PrintSheet
        title="מחירון"
        businessName={business.name}
        subtitle={search.trim() ? `חיפוש: "${search.trim()}"` : "כל הפריטים"}
        rows={printRows}
        rowKey={(p) => p.id}
        countLabel={`${printRows.length} פריטים`}
        columns={[
          { key: "name", header: "פריט", render: (p) => p.name },
          { key: "description", header: "תיאור", render: (p) => p.description || "-" },
          { key: "unit", header: "יחידה", render: (p) => p.unit },
          {
            key: "price",
            header: "מחיר",
            align: "end" as const,
            render: (p) => formatCurrency(p.price),
          },
        ]}
      />
    )}
    </>
  );
}
