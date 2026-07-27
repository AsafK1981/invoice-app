"use client";

import { useState } from "react";
import { IdCard, Pencil, Check, X, AlertTriangle } from "lucide-react";
import { updateDocumentClientTaxId } from "@/lib/document-store";
import type { InvoiceDocument } from "@/lib/types";

/**
 * Inline editor for the customer's עוסק/ח.פ number on a document. Surfaced on
 * tax-invoice documents because חשבונית ישראל allocation requires it; lets the
 * user add it to an invoice that was created for an ad-hoc client without one.
 */
export function DocumentCustomerTaxEditor({ doc }: { doc: InvoiceDocument }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(doc.clientTaxId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const current = doc.clientTaxId || "";

  function start() {
    setValue(current);
    setError(null);
    setJustSaved(false);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateDocumentClientTaxId(doc.id, value);
      setEditing(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="no-print card-soft p-4 max-w-[210mm] mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-sky-50 flex items-center justify-center flex-shrink-0">
            <IdCard className="w-4 h-4 text-sky-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-900">
              ח.פ / ת.ז של הלקוח
              {justSaved && <span className="text-emerald-700 font-semibold"> · נשמר ✓</span>}
            </p>
            <p className="text-xs text-stone-600">נדרש לקבלת מספר הקצאה (חשבונית ישראל)</p>
          </div>
        </div>

        {editing ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <input
              type="text"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="מספר עוסק / ח.פ"
              className="w-40 input-warm text-sm py-2 px-2 text-center"
              dir="ltr"
            />
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {saving ? "שומר…" : "שמור"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-xl bg-stone-100 text-stone-700 hover:bg-stone-200"
              title="בטל"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className={`text-base font-bold ${current ? "text-stone-900" : "text-stone-400"}`} dir="ltr">
              {current || "חסר"}
            </span>
            <button
              onClick={start}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-sm font-medium text-sky-700 hover:bg-sky-50"
            >
              <Pencil className="w-3.5 h-3.5" />
              {current ? "ערוך" : "הוסף"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
