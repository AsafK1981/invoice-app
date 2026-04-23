"use client";

import { useState } from "react";
import { Package, Plus, Tag, Pencil, Trash2, Upload } from "lucide-react";
import { useProducts, productStore } from "@/lib/product-store";
import { formatCurrency } from "@/lib/format";
import { ProductFormModal } from "@/components/product-form-modal";
import { CsvImportModal } from "@/components/csv-import-modal";
import type { Product } from "@/lib/types";

export default function ProductsPage() {
  const { items: products } = useProducts();
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setModalOpen(true);
  }

  async function remove(product: Product) {
    if (confirm(`למחוק את "${product.name}"?`)) await productStore.remove(product.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
              <Package className="w-5 h-5 text-white" />
            </span>
            מוצרים ושירותים
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">
            {products.length} פריטים בקטלוג
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
            פריט חדש
          </button>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="card-soft p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center mx-auto mb-4">
            <Package className="w-7 h-7 text-orange-500" />
          </div>
          <h3 className="font-bold text-stone-900 mb-1">הקטלוג ריק</h3>
          <p className="text-sm text-stone-700 mb-5">
            הוסף מוצרים ושירותים כדי להשלים אותם מהר בעורך המסמכים
          </p>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-md"
          >
            <Plus className="w-4 h-4" />
            הוסף פריט
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => (
            <div
              key={p.id}
              className="card-soft p-5 hover:shadow-md hover:-translate-y-0.5 transition-all group relative"
            >
              <div className="absolute top-3 left-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => openEdit(p)}
                  className="w-8 h-8 rounded-xl bg-white hover:bg-orange-50 text-stone-600 hover:text-orange-600 flex items-center justify-center shadow-sm border border-orange-100"
                  title="עריכה"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => remove(p)}
                  className="w-8 h-8 rounded-xl bg-white hover:bg-rose-50 text-stone-600 hover:text-rose-600 flex items-center justify-center shadow-sm border border-orange-100"
                  title="מחיקה"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-200 flex items-center justify-center flex-shrink-0">
                  <Tag className="w-5 h-5 text-orange-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-stone-900">{p.name}</h3>
                  {p.description && (
                    <p className="text-sm text-stone-700 mt-1 line-clamp-2">{p.description}</p>
                  )}
                </div>
              </div>
              <div className="mt-5 flex items-baseline justify-between pt-4 border-t border-orange-100">
                <span className="text-xs font-medium text-stone-700">מחיר ל{p.unit}</span>
                <span className="text-xl font-bold bg-gradient-to-l from-orange-500 to-rose-500 bg-clip-text text-transparent">
                  {formatCurrency(p.price)}
                </span>
              </div>
            </div>
          ))}
        </div>
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
  );
}
