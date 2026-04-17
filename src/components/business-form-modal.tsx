"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { saveBusiness } from "@/lib/business-store";
import type { Business } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  business: Business;
}

export function BusinessFormModal({ open, onClose, business }: Props) {
  const [form, setForm] = useState(business);

  useEffect(() => {
    if (open) setForm(business);
  }, [open, business]);

  function update<K extends keyof Business>(key: K, value: Business[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.taxId.trim()) return;
    await saveBusiness({
      ...form,
      name: form.name.trim(),
      taxId: form.taxId.trim(),
      address: form.address.trim(),
      phone: form.phone?.trim() || undefined,
      email: form.email?.trim() || undefined,
    });
    onClose();
  }

  const canSubmit = form.name.trim().length > 0 && form.taxId.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="עריכת פרטי העסק"
      subtitle="פרטים אלה יופיעו על כל מסמך שמופק"
      icon={Building2}
      maxWidth="lg"
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
            שמור שינויים
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="שם העסק" required>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="שם העסק כפי שיופיע על מסמכים"
            className="input-warm"
            autoFocus
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="סוג עוסק" required>
            <select
              value={form.businessType}
              onChange={(e) => update("businessType", e.target.value as Business["businessType"])}
              className="input-warm"
            >
              <option value="exempt">עוסק פטור</option>
              <option value="authorized">עוסק מורשה</option>
              <option value="company">חברה בע״מ</option>
            </select>
          </FormField>

          <FormField label="מספר עוסק / ח.פ" required>
            <input
              type="text"
              dir="ltr"
              value={form.taxId}
              onChange={(e) => update("taxId", e.target.value)}
              placeholder="123456789"
              className="input-warm"
            />
          </FormField>
        </div>

        <FormField label="כתובת" required>
          <input
            type="text"
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            placeholder="רחוב, מספר, עיר"
            className="input-warm"
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="טלפון">
            <input
              type="tel"
              dir="ltr"
              value={form.phone || ""}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="050-1234567"
              className="input-warm"
            />
          </FormField>

          <FormField label="אימייל">
            <input
              type="email"
              dir="ltr"
              value={form.email || ""}
              onChange={(e) => update("email", e.target.value)}
              placeholder="contact@business.com"
              className="input-warm"
            />
          </FormField>
        </div>
      </div>
    </Modal>
  );
}
