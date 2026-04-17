"use client";

import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { productStore } from "@/lib/product-store";
import type { Product } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  product?: Product | null;
}

const emptyForm = {
  name: "",
  description: "",
  price: "",
  unit: "יחידה",
};

export function ProductFormModal({ open, onClose, product }: Props) {
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!open) return;
    if (product) {
      setForm({
        name: product.name,
        description: product.description || "",
        price: String(product.price),
        unit: product.unit,
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, product]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    const price = parseFloat(form.price);
    if (!form.name.trim() || isNaN(price) || price < 0) return;

    const record: Product = {
      id: product?.id ?? crypto.randomUUID(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      price,
      unit: form.unit.trim() || "יחידה",
    };
    await productStore.save(record);
    onClose();
  }

  const canSubmit = form.name.trim().length > 0 && parseFloat(form.price) >= 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? "עריכת פריט" : "פריט חדש"}
      subtitle={product ? "עדכן את פרטי הפריט בקטלוג" : "הוסף מוצר או שירות לקטלוג"}
      icon={Package}
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
            {product ? "שמור שינויים" : "הוסף פריט"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="שם המוצר/שירות" required>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="ייעוץ טכנולוגי - שעה"
            className="input-warm"
            autoFocus
          />
        </FormField>

        <FormField label="תיאור" hint="יופיע אוטומטית בתיאור הפריט על המסמך">
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="תיאור קצר של המוצר או השירות"
            rows={2}
            className="input-warm"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="מחיר (₪)" required>
            <input
              type="number"
              min="0"
              step="0.01"
              dir="ltr"
              value={form.price}
              onChange={(e) => update("price", e.target.value)}
              placeholder="450"
              className="input-warm"
            />
          </FormField>

          <FormField label="יחידת מידה">
            <input
              type="text"
              value={form.unit}
              onChange={(e) => update("unit", e.target.value)}
              placeholder="שעה / יחידה / פרויקט"
              className="input-warm"
            />
          </FormField>
        </div>
      </div>
    </Modal>
  );
}
