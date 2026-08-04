"use client";

import { useEffect, useState } from "react";
import { Hash, Pencil, Check, X, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getBusinessId } from "@/lib/business-init";
import {
  DEFAULT_NEXT_NUMBER,
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
} from "@/lib/types";

const TYPE_ORDER: DocumentType[] = [
  "receipt",
  "quote",
  "proforma",
  "tax_invoice",
  "tax_invoice_receipt",
  "credit_note",
];

type CounterRow = { doc_type: DocumentType; next_number: number };
type MaxByType = Partial<Record<DocumentType, number>>;

export function DocumentNumberingSettings() {
  const [counters, setCounters] = useState<Record<DocumentType, number>>(
    () => ({ ...DEFAULT_NEXT_NUMBER })
  );
  const [maxUsed, setMaxUsed] = useState<MaxByType>({});
  const [editing, setEditing] = useState<DocumentType | null>(null);
  const [draftValue, setDraftValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  async function load() {
    const bid = getBusinessId();
    if (!bid) return;
    const [countersRes, ...maxResults] = await Promise.all([
      supabase
        .from("document_counters")
        .select("doc_type,next_number")
        .eq("business_id", bid),
      ...TYPE_ORDER.map((type) =>
        supabase
          .from("documents")
          .select("number")
          .eq("business_id", bid)
          .eq("type", type)
          .order("number", { ascending: false })
          .limit(1)
          .maybeSingle()
      ),
    ]);
    if (countersRes.data) {
      const next: Record<DocumentType, number> = { ...DEFAULT_NEXT_NUMBER };
      (countersRes.data as CounterRow[]).forEach((row) => {
        next[row.doc_type] = row.next_number;
      });
      setCounters(next);
    }
    const max: MaxByType = {};
    maxResults.forEach((res, idx) => {
      const row = res.data as { number: number } | null;
      if (row?.number != null) max[TYPE_ORDER[idx]] = row.number;
    });
    setMaxUsed(max);
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(type: DocumentType) {
    setEditing(type);
    setDraftValue(String(counters[type]));
    setError(null);
    setNote(null);
  }

  function cancelEdit() {
    setEditing(null);
    setDraftValue("");
    setError(null);
  }

  async function saveEdit(type: DocumentType) {
    const value = parseInt(draftValue, 10);
    if (!Number.isFinite(value) || value < 1) {
      setError("יש להזין מספר שלם חיובי");
      return;
    }
    // The legitimate "continue a previous series" case means we don't hard-
    // block a custom start number. But setting the next number AT OR BELOW the
    // highest already-issued document of this type invites gaps / duplicates /
    // non-sequential numbering (a tax-audit red flag), so require an explicit
    // confirmation rather than saving silently.
    const used = maxUsed[type];
    if (used !== undefined && value <= used) {
      const ok = await confirm({
        title: `להגדיר מספר הבא ל-${value}?`,
        message:
          `כבר קיימים מסמכים מסוג ${DOCUMENT_TYPE_LABELS[type]} עד מספר ${used}. ` +
          `הגדרת המספר הבא ל-${value} עלולה ליצור כפילות או מספור לא רציף ` +
          `(מספרים תפוסים ייחסמו בהפקה). מומלץ להגדיר מספר גדול מ-${used}. ` +
          `להמשיך בכל זאת?`,
        tone: "danger",
        confirmLabel: "המשך בכל זאת",
      });
      if (!ok) return;
    }
    const bid = getBusinessId();
    if (!bid) return;
    setSaving(true);
    setError(null);
    const { error: upsertError } = await supabase
      .from("document_counters")
      .upsert(
        { business_id: bid, doc_type: type, next_number: value },
        { onConflict: "business_id,doc_type" }
      );
    setSaving(false);
    if (upsertError) {
      setError(upsertError.message);
      return;
    }
    setCounters((c) => ({ ...c, [type]: value }));
    setEditing(null);
    setDraftValue("");
    if (used !== undefined && value <= used) {
      setNote(
        `נשמר. שים לב: כבר קיימים מסמכים מסוג זה עד מספר ${used}, כך שמספרים תפוסים ייחסמו אוטומטית בהפקה.`
      );
    } else {
      setNote(`נשמר. המסמך הבא מסוג זה יקבל מספר ${value}.`);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-700">
        המספור משמש לכל מסמך חדש שתפיק. ניתן לשנות בכל עת לפני יצירת מסמכים נוספים מהסוג הזה.
      </p>
      <div className="space-y-2">
        {TYPE_ORDER.map((type) => {
          const isEditing = editing === type;
          const next = counters[type];
          const used = maxUsed[type];
          return (
            <div
              key={type}
              className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl border border-orange-50 hover:border-orange-100 hover:bg-orange-50/30 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                  <Hash className="w-4 h-4 text-orange-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-900">
                    {DOCUMENT_TYPE_LABELS[type]}
                  </p>
                  <p className="text-xs text-stone-600">
                    {used !== undefined
                      ? `המסמך הבא יקבל מספר ${next} · קיים: עד ${used}`
                      : `המסמך הבא יקבל מספר ${next}`}
                  </p>
                </div>
              </div>
              {isEditing ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type="number"
                    min={1}
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    autoFocus
                    className="w-24 input-warm text-sm py-2 px-2 text-center"
                  />
                  <button
                    onClick={() => saveEdit(type)}
                    disabled={saving}
                    className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
                    title="שמור"
                    aria-label="שמור"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200"
                    title="בטל"
                    aria-label="בטל"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startEdit(type)}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3 rounded-xl text-sm font-medium text-orange-700 hover:bg-orange-100 flex-shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  ערוך
                </button>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {note && (
        <div className="flex items-start gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 p-3 rounded-xl">
          <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}
