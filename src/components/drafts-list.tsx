"use client";

import Link from "next/link";
import { useState } from "react";
import { FileClock, ArrowLeft, Trash2 } from "lucide-react";
import { useDrafts, deleteServerDraft, DOC_TYPE_ROUTE } from "@/lib/draft-store";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { useConfirm } from "@/components/ui/confirm-dialog";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "לפני רגע";
  if (min < 60) return `לפני ${min} דק׳`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `לפני ${hr} ${hr === 1 ? "שעה" : "שעות"}`;
  const days = Math.round(hr / 24);
  return `לפני ${days} ${days === 1 ? "יום" : "ימים"}`;
}

export function DraftsList() {
  const { drafts, ready } = useDrafts();
  const [deleting, setDeleting] = useState<string | null>(null);
  const confirm = useConfirm();

  if (ready && drafts.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
          <FileClock className="w-6 h-6 text-stone-400" />
        </div>
        <p className="text-stone-700 font-semibold">אין טיוטות שמורות</p>
        <p className="text-sm text-stone-500 mt-1">
          כשתתחיל מסמך ותלחץ &quot;שמור טיוטה והמשך אחר כך&quot;, הוא יופיע כאן.
        </p>
      </div>
    );
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "למחוק את הטיוטה?",
      message: "לא ניתן לשחזר טיוטה שנמחקה.",
      tone: "danger",
      confirmLabel: "מחק",
    });
    if (!ok) return;
    setDeleting(id);
    try {
      await deleteServerDraft(id);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <ul className="divide-y divide-stone-100">
      {drafts.map((d) => {
        const items = d.payload.items || [];
        const rough = items.reduce(
          (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
          0,
        );
        return (
          <li
            key={d.id}
            className="flex items-center gap-3 px-4 py-3.5 hover:bg-orange-50/40 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
              <FileClock className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-stone-900 text-sm truncate">
                {DOCUMENT_TYPE_LABELS[d.docType]} · {d.title || "ללא לקוח"}
              </p>
              <p className="text-xs text-stone-500 mt-0.5">
                נשמר {timeAgo(d.updatedAt)}
                {items.length > 0 && (
                  <>
                    {" · "}
                    {items.length} פריטים
                    {rough > 0 && (
                      <>
                        {" · ~"}
                        <span dir="ltr">{formatCurrency(rough)}</span>
                      </>
                    )}
                  </>
                )}
              </p>
            </div>
            <Link
              href={`/documents/new/${DOC_TYPE_ROUTE[d.docType]}?draft=${d.id}`}
              className="inline-flex items-center gap-1.5 bg-gradient-to-l from-orange-500 to-orange-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold hover:shadow-md hover:shadow-orange-200 transition-all flex-shrink-0"
            >
              המשך
              <ArrowLeft className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={() => remove(d.id)}
              disabled={deleting === d.id}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-stone-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors flex-shrink-0"
              title="מחק טיוטה"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
