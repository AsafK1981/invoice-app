"use client";

import { useState } from "react";
import { Hash, Pencil, Check, X, AlertTriangle } from "lucide-react";
import { updateDocumentNumber } from "@/lib/document-store";
import { DOCUMENT_TYPE_LABELS, type InvoiceDocument } from "@/lib/types";

/**
 * Inline editor for a finalized document's number. Lets the user set any
 * positive number (gaps allowed — their call); the DB unique index prevents
 * a collision with another document of the same type.
 */
export function DocumentNumberEditor({ doc }: { doc: InvoiceDocument }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(doc.number));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  function start() {
    setValue(String(doc.number));
    setError(null);
    setJustSaved(false);
    setEditing(true);
  }

  async function save() {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) {
      setError("יש להזין מספר שלם חיובי");
      return;
    }
    if (n === doc.number) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateDocumentNumber(doc.id, n);
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
          <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
            <Hash className="w-4 h-4 text-orange-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-900">מספר המסמך</p>
            <p className="text-xs text-stone-600">
              {DOCUMENT_TYPE_LABELS[doc.type]}
              {justSaved && (
                <span className="text-emerald-700 font-semibold"> · נשמר ✓</span>
              )}
            </p>
          </div>
        </div>

        {editing ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <input
              type="number"
              min={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-28 input-warm text-sm py-2 px-2 text-center"
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
            <span className="text-lg font-bold text-stone-900" dir="ltr">
              #{doc.number}
            </span>
            <button
              onClick={start}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-sm font-medium text-orange-700 hover:bg-orange-100"
            >
              <Pencil className="w-3.5 h-3.5" />
              ערוך
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
