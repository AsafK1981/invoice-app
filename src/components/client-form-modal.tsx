"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { clientStore } from "@/lib/client-store";
import type { Client } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  client?: Client | null;
}

const emptyForm = {
  name: "",
  taxId: "",
  address: "",
  phone: "",
  email: "",
  notes: "",
};

export function ClientFormModal({ open, onClose, client }: Props) {
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!open) return;
    if (client) {
      setForm({
        name: client.name,
        taxId: client.taxId || "",
        address: client.address || "",
        phone: client.phone || "",
        email: client.email || "",
        notes: client.notes || "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, client]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) return;
    const record: Client = {
      id: client?.id ?? crypto.randomUUID(),
      name: form.name.trim(),
      taxId: form.taxId.trim() || undefined,
      address: form.address.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      notes: form.notes.trim() || undefined,
      createdAt: client?.createdAt ?? new Date().toISOString().slice(0, 10),
    };
    await clientStore.save(record);
    onClose();
  }

  const canSubmit = form.name.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? "עריכת לקוח" : "לקוח חדש"}
      subtitle={client ? "עדכן את פרטי הלקוח" : "הוסף לקוח חדש לספר"}
      icon={Users}
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
            {client ? "שמור שינויים" : "הוסף לקוח"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="שם הלקוח" required>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="חברת אלפא בע״מ"
            className="input-warm"
            autoFocus
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="ח.פ / ת.ז">
            <input
              type="text"
              dir="ltr"
              value={form.taxId}
              onChange={(e) => update("taxId", e.target.value)}
              placeholder="514123456"
              className="input-warm"
            />
          </FormField>

          <FormField label="טלפון">
            <input
              type="tel"
              dir="ltr"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="050-1234567"
              className="input-warm"
            />
          </FormField>
        </div>

        <FormField label="אימייל" hint="ישמש לשליחה אוטומטית של קבלות וחשבוניות">
          <input
            type="email"
            dir="ltr"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="contact@company.com"
            className="input-warm"
          />
        </FormField>

        <FormField label="כתובת">
          <input
            type="text"
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            placeholder="דיזנגוף 100, תל אביב"
            className="input-warm"
          />
        </FormField>

        <FormField label="הערות">
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="מידע פנימי על הלקוח (לא יופיע על מסמכים)"
            rows={3}
            className="input-warm"
          />
        </FormField>
      </div>
    </Modal>
  );
}
