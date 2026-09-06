"use client";

// What the assistant remembers, in one place the user controls. Every row here
// got in through a button the user pressed in the chat, and every row can leave
// with one click - no confirmation dialog, because forgetting something is the
// safe direction.

import { useCallback, useEffect, useState } from "react";
import { Brain, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getBusinessId, onBusinessReady } from "@/lib/business-init";
import { logAudit } from "@/lib/audit-log";
import { MEMORY_CHANGED_EVENT, MEMORY_MAX_FACTS, normalizeFact } from "@/lib/assistant-memory";

interface MemoryFact {
  id: string;
  fact: string;
}

export function AssistantMemorySection() {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [ready, setReady] = useState(false);
  const [removing, setRemoving] = useState("");
  const [error, setError] = useState("");

  const fetchFacts = useCallback(async () => {
    const bid = getBusinessId();
    if (!bid) return;
    const { data } = await supabase
      .from("assistant_memory")
      .select("id, fact")
      .eq("business_id", bid)
      .order("created_at")
      .limit(MEMORY_MAX_FACTS);
    setFacts((data || []).map((r) => ({ id: r.id as string, fact: normalizeFact(r.fact) })));
    setReady(true);
  }, []);

  useEffect(() => {
    onBusinessReady(() => fetchFacts());
    const handler = () => fetchFacts();
    window.addEventListener(MEMORY_CHANGED_EVENT, handler);
    return () => window.removeEventListener(MEMORY_CHANGED_EVENT, handler);
  }, [fetchFacts]);

  async function remove(row: MemoryFact) {
    setRemoving(row.id);
    setError("");
    // .select() so a row RLS refused to touch is reported, not assumed gone.
    const { data, error: delError } = await supabase
      .from("assistant_memory")
      .delete()
      .eq("id", row.id)
      .select("id");
    setRemoving("");
    if (delError || !data?.length) {
      setError("המחיקה נכשלה. נסה שוב.");
      return;
    }
    setFacts((prev) => prev.filter((f) => f.id !== row.id));
    logAudit({
      action: "assistant_memory.deleted",
      targetType: "memory",
      targetId: row.id,
      targetLabel: row.fact,
    });
    window.dispatchEvent(new Event(MEMORY_CHANGED_EVENT));
  }

  return (
    <div id="assistant-memory" className="card-soft p-6 scroll-mt-6">
      <div className="flex items-center gap-2 mb-2">
        <Brain className="w-4 h-4 text-orange-500" />
        <h2 className="font-semibold text-stone-900">מה העוזר זוכר</h2>
        {ready && facts.length > 0 && (
          <span className="text-xs text-stone-500">
            ({facts.length} מתוך {MEMORY_MAX_FACTS})
          </span>
        )}
      </div>
      <p className="text-sm text-stone-700">
        עובדות קצרות עליך שהעוזר החכם משתמש בהן בשיחות הבאות. כל אחת נשמרה רק אחרי שאישרת
        אותה בצ&apos;אט, ואפשר למחוק כל אחת מכאן.
      </p>

      {ready && facts.length === 0 ? (
        <p className="text-sm text-stone-600 mt-3">
          העוזר עדיין לא זוכר כלום. בצ&apos;אט אפשר לכתוב: תזכור ש...
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-orange-50">
          {facts.map((row) => (
            <li key={row.id} className="py-3 flex items-start justify-between gap-3">
              <span dir="auto" className="text-sm text-stone-800 min-w-0 break-words">{row.fact}</span>
              <button
                type="button"
                onClick={() => remove(row)}
                disabled={removing === row.id}
                aria-label={`מחק מהזיכרון: ${row.fact}`}
                title="מחק מהזיכרון"
                className="flex-shrink-0 text-stone-400 hover:text-rose-600 disabled:opacity-50 p-2 -m-1 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
    </div>
  );
}
