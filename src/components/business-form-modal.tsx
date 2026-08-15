"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Upload, X, Image as ImageIcon, Landmark } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { BusinessTypeHint } from "@/components/business-type-hint";
import { saveBusiness } from "@/lib/business-store";
import { isPlaceholderBusinessName, isPlaceholderBusinessTaxId } from "@/lib/business-init";
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Treat legacy default placeholder values as if the field were empty,
      // so the input's HTML `placeholder=` shows guidance text instead of
      // "העסק שלי" / "000000000" pre-filled in bold like real data.
      setForm({
        ...business,
        name: isPlaceholderBusinessName(business.name) ? "" : business.name,
        taxId: isPlaceholderBusinessTaxId(business.taxId) ? "" : business.taxId,
      });
      setUploadError(null);
      setSaveError(null);
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
    // Only the formats that render reliably across browsers, PDF print,
    // and email clients. Bucket-level allowed_mime_types enforces the
    // same list server-side, but checking here gives instant feedback
    // for the common case of an iPhone .heic.
    const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"]);
    if (!ALLOWED.has(file.type)) {
      setUploadError("פורמט לא נתמך. השתמש ב-PNG, JPG, WebP או SVG (לא HEIC/HEIF, לא BMP, לא TIFF).");
      return;
    }

    setUploading(true);
    setUploadError(null);

    // Lowercase the extension; Supabase Storage is case-sensitive on
    // path lookups but browsers/CDNs sometimes normalize. Stick to lowercase
    // for predictability.
    const fileExt = (file.name.split(".").pop() || "png").toLowerCase();
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
    setSaveError(null);
    setSaving(true);
    try {
      await saveBusiness({
        ...form,
        name: form.name.trim(),
        taxId: form.taxId.trim(),
        address: form.address.trim(),
        phone: form.phone?.trim() || undefined,
        email: form.email?.trim() || undefined,
        bankName: form.bankName?.trim() || undefined,
        bankBranch: form.bankBranch?.trim() || undefined,
        bankAccount: form.bankAccount?.trim() || undefined,
        paymentNotes: form.paymentNotes?.trim() || undefined,
        defaultDocNotes: form.defaultDocNotes?.trim() || undefined,
      });
      setSaving(false);
      setJustSaved(true);
      setTimeout(onClose, 900);
      return;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
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
            disabled={!canSubmit || uploading || saving || justSaved}
            className={`px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:shadow-none ${
              justSaved
                ? "bg-emerald-600"
                : "bg-gradient-to-l from-orange-500 to-rose-500 hover:shadow-md hover:shadow-orange-200 disabled:from-stone-300 disabled:to-stone-300"
            }`}
          >
            {justSaved ? "נשמר ✓" : saving ? "שומר..." : "שמור שינויים"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {saveError && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
            {saveError}
          </div>
        )}

        <FormField label="לוגו העסק" hint="יופיע על כל מסמך שמופק. מומלץ PNG עם רקע שקוף, עד 2MB">
          <div className="flex items-start gap-4">
            <div className="gk-logo-chip w-24 h-24 rounded-2xl border-2 border-dashed border-orange-200 flex items-center justify-center overflow-hidden bg-white flex-shrink-0">
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
            name="organization"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="שם העסק כפי שיופיע על מסמכים"
            className="input-warm"
            autoComplete="organization"
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
            <BusinessTypeHint type={form.businessType} />
          </FormField>

          <FormField label="מספר עוסק / ח.פ" required>
            <input
              type="text"
              name="tax-id"
              dir="ltr"
              value={form.taxId}
              onChange={(e) => update("taxId", e.target.value)}
              placeholder="123456789"
              autoComplete="on"
              className="input-warm"
            />
          </FormField>
        </div>

        <FormField label="כתובת" required>
          <input
            type="text"
            name="street-address"
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            placeholder="רחוב, מספר, עיר"
            autoComplete="street-address"
            className="input-warm"
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="טלפון">
            <input
              type="tel"
              name="tel"
              dir="ltr"
              value={form.phone || ""}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="050-1234567"
              autoComplete="tel"
              className="input-warm"
            />
          </FormField>

          <FormField label="אימייל">
            <input
              type="email"
              name="email"
              dir="ltr"
              value={form.email || ""}
              onChange={(e) => update("email", e.target.value)}
              placeholder="contact@business.com"
              autoComplete="email"
              className="input-warm"
            />
          </FormField>
        </div>

        <div className="pt-2 border-t border-orange-100">
          <h3 className="text-sm font-semibold text-stone-900 flex items-center gap-2 mb-3">
            <Landmark className="w-4 h-4 text-orange-500" />
            פרטי תשלום
          </h3>
          <p className="text-xs text-stone-600 mb-3">
            יוצגו על מסמכים שמשולמים בהעברה בנקאית, כדי שהלקוח יידע לאן לשלוח את הכסף. כל השדות אופציונליים.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="בנק">
              <input
                type="text"
                value={form.bankName || ""}
                onChange={(e) => update("bankName", e.target.value)}
                placeholder="הפועלים"
                className="input-warm"
              />
            </FormField>
            <FormField label="סניף">
              <input
                type="text"
                dir="ltr"
                value={form.bankBranch || ""}
                onChange={(e) => update("bankBranch", e.target.value)}
                placeholder="604"
                className="input-warm"
              />
            </FormField>
            <FormField label="מספר חשבון">
              <input
                type="text"
                dir="ltr"
                value={form.bankAccount || ""}
                onChange={(e) => update("bankAccount", e.target.value)}
                placeholder="123456"
                className="input-warm"
              />
            </FormField>
          </div>
          <div className="mt-3">
            <FormField label="הערות תשלום (Bit, Paybox וכו')" hint="אופציונלי. יוצג מתחת לפרטי הבנק.">
              <input
                type="text"
                value={form.paymentNotes || ""}
                onChange={(e) => update("paymentNotes", e.target.value)}
                placeholder="לתשלום בביט: 050-1234567"
                className="input-warm"
              />
            </FormField>
          </div>
        </div>

        <div className="pt-2 border-t border-orange-100">
          <FormField
            label="הערות ברירת מחדל למסמכים"
            hint="טקסט אופציונלי שיופיע אוטומטית בשדה ה'הערות' של כל מסמך חדש (תנאי תשלום, מדיניות החזרה וכו'). ניתן לערוך אותו לכל מסמך בנפרד."
          >
            <textarea
              value={form.defaultDocNotes || ""}
              onChange={(e) => update("defaultDocNotes", e.target.value)}
              placeholder="למשל: תשלום תוך 30 יום מקבלת המסמך"
              rows={2}
              className="input-warm"
            />
          </FormField>
        </div>

        <div className="pt-2 border-t border-orange-100">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.roundTotalDefault ?? false}
              onChange={(e) => update("roundTotalDefault", e.target.checked)}
              className="w-4 h-4 accent-orange-500 mt-0.5"
            />
            <span className="text-sm text-stone-700">
              עגל סכום לתשלום לשקל שלם כברירת מחדל
              <span className="block text-xs text-stone-500 mt-0.5">
                המע״מ נשאר מדויק; הפרש העיגול מוצג כשורה נפרדת. ניתן לשנות לכל מסמך בנפרד.
              </span>
            </span>
          </label>
        </div>
      </div>
    </Modal>
  );
}
