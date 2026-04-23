"use client";

import { useEffect, useState } from "react";
import { Users, Plus, X, Mail } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { clientStore } from "@/lib/client-store";
import { parseEmails, joinEmails, isValidEmail } from "@/lib/emails";
import type { Client } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  client?: Client | null;
}

export function ClientFormModal({ open, onClose, client }: Props) {
  const [form, setForm] = useState({
    name: "",
    taxId: "",
    address: "",
    phone: "",
    notes: "",
  });
  const [emails, setEmails] = useState<string[]>([""]);

  useEffect(() => {
    if (!open) return;
    if (client) {
      setForm({
        name: client.name,
        taxId: client.taxId || "",
        address: client.address || "",
        phone: client.phone || "",
        notes: client.notes || "",
      });
      const parsed = parseEmails(client.email);
      setEmails(parsed.length > 0 ? parsed : [""]);
    } else {
      setForm({ name: "", taxId: "", address: "", phone: "", notes: "" });
      setEmails([""]);
    }
  }, [open, client]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateEmail(idx: number, value: string) {
    setEmails((list) => list.map((e, i) => (i === idx ? value : e)));
  }

  function addEmail() {
    setEmails((list) => [...list, ""]);
  }

  function removeEmail(idx: number) {
    setEmails((list) => {
      const next = list.filter((_, i) => i !== idx);
      return next.length === 0 ? [""] : next;
    });
  }

  async function handleSubmit() {
    if (!form.name.trim()) return;
    const cleanEmails = emails.map((e) => e.trim()).filter(Boolean);
    const record: Client = {
      id: client?.id ?? crypto.randomUUID(),
      name: form.name.trim(),
      taxId: form.taxId.trim() || undefined,
      address: form.address.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: cleanEmails.length > 0 ? joinEmails(cleanEmails) : undefined,
      notes: form.notes.trim() || undefined,
      createdAt: client?.createdAt ?? new Date().toISOString().slice(0, 10),
    };
    await clientStore.save(record);
    onClose();
  }

  const canSubmit = form.name.trim().length > 0;
  const invalidEmailCount = emails.filter(
    (e) => e.trim() && !isValidEmail(e.trim()),
  ).length;

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

        <FormField
          label="אימיילים"
          hint="ניתן להוסיף כמה אימיילים - מסמכים יישלחו לכולם"
        >
          <div className="space-y-2">
            {emails.map((email, idx) => {
              const trimmed = email.trim();
              const invalid = trimmed && !isValidEmail(trimmed);
              return (
                <div key={idx} className="flex gap-2 items-start">
                  <div className="flex-1 relative">
                    <Mail className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
                    <input
                      type="email"
                      dir="ltr"
                      value={email}
                      onChange={(e) => updateEmail(idx, e.target.value)}
                      placeholder={idx === 0 ? "primary@company.com" : "additional@company.com"}
                      className={`input-warm pr-10 ${invalid ? "border-rose-400" : ""}`}
                    />
                  </div>
                  {(emails.length > 1 || email) && (
                    <button
                      type="button"
                      onClick={() => removeEmail(idx)}
                      className="text-stone-400 hover:text-rose-500 p-2 rounded-xl hover:bg-rose-50 transition-colors"
                      title="הסר"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={addEmail}
              className="inline-flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700 font-semibold px-2 py-1 rounded-lg hover:bg-orange-50"
            >
              <Plus className="w-3.5 h-3.5" />
              הוסף אימייל נוסף
            </button>
            {invalidEmailCount > 0 && (
              <p className="text-xs text-rose-600">
                יש {invalidEmailCount} אימייל לא תקין - בדוק את הכתובות שהודגשו באדום
              </p>
            )}
          </div>
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
