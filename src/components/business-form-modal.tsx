"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Upload, X, Image as ImageIcon } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { saveBusiness } from "@/lib/business-store";
import { supabase } from "@/lib/supabase";
import type { Business } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  business: Business;
}

export function BusinessFormModal({ open, onClose, business }: Props) {
  const [form, setForm] = useState(business);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(business);
      setUploadError(null);
    }
  }, [open, business]);

  function update<K extends keyof Business>(key: K, value: Business[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setUploadError("הקובץ גדול מדי (מקסימום 2MB)");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setUploadError("יש להעלות קובץ תמונה בלבד");
      return;
    }

    setUploading(true);
    setUploadError(null);

    const fileExt = file.name.split(".").pop();
    const fileName = `${business.id}-${Date.now()}.${fileExt}`;

    const { error: uploadErr } = await supabase.storage
      .from("business-logos")
      .upload(fileName, file, { upsert: true });

    if (uploadErr) {
      setUploadError(`שגיאה בהעלאה: ${uploadErr.message}`);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from("business-logos")
      .getPublicUrl(fileName);

    update("logoUrl", urlData.publicUrl);
    setUploading(false);
  }

  function removeLogo() {
    update("logoUrl", undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
            disabled={!canSubmit || uploading}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-gradient-to-l from-orange-500 to-rose-500 text-white hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300 disabled:shadow-none"
          >
            שמור שינויים
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="לוגו העסק" hint="יופיע על כל מסמך שמופק. מומלץ PNG עם רקע שקוף, עד 2MB">
          <div className="flex items-start gap-4">
            <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-orange-200 flex items-center justify-center overflow-hidden bg-white flex-shrink-0">
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <ImageIcon className="w-8 h-8 text-orange-300" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                {uploading ? "מעלה..." : form.logoUrl ? "החלף לוגו" : "העלה לוגו"}
              </button>
              {form.logoUrl && (
                <button
                  type="button"
                  onClick={removeLogo}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-rose-700 hover:bg-rose-50 mr-2"
                >
                  <X className="w-4 h-4" />
                  הסר
                </button>
              )}
              {uploadError && (
                <p className="text-xs text-rose-600">{uploadError}</p>
              )}
            </div>
          </div>
        </FormField>

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
