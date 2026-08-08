"use client";

// The in-app AI assistant. Finds documents, answers questions about the
// business's own numbers, and prepares document drafts. It never creates a
// document: a draft is handed back to the user, who opens it in the editor and
// approves it there (numbering, allocation and immutability all live in that
// flow and must stay under the user's control).

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { Sparkles, X, Send, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { saveDraftToServer, DOC_TYPE_ROUTE } from "@/lib/draft-store";
import { todayInIsrael } from "@/lib/date";
import type { DocumentType } from "@/lib/types";

interface AssistantDraft {
  documentType: DocumentType;
  clientId: string;
  clientName: string;
  subject: string;
  notes: string;
  items: { description: string; quantity: number; unitPrice: number }[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  draft?: AssistantDraft | null;
}

const SUGGESTIONS = [
  "כמה הכנסתי החודש?",
  "תמצא לי את המסמכים האחרונים",
  "מי הלקוח שהכי הכניס לי השנה?",
];

export function AssistantWidget() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [openingDraft, setOpeningDraft] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // InstallPrompt sits bottom-right, and flips to bottom-left over the single
  // document paper. Mirror it so the two never overlap.
  const overDocumentPaper =
    /^\/documents\/[^/]+$/.test(pathname || "") && !/^\/documents\/new/.test(pathname || "");

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError("");
    setInput("");

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setBusy(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("פג תוקף ההתחברות. התחבר מחדש.");
        return;
      }

      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const json = await res.json().catch(() => ({ ok: false, error: "שגיאה לא ידועה" }));
      if (!res.ok || !json.ok) {
        setError(json.error || `הבקשה נכשלה (${res.status})`);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: json.reply as string, draft: json.draft ?? null },
      ]);
    } catch {
      setError("אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.");
    } finally {
      setBusy(false);
    }
  }

  async function openDraftInEditor(draft: AssistantDraft) {
    setOpeningDraft(true);
    setError("");
    try {
      const id = await saveDraftToServer({
        documentType: draft.documentType,
        title: draft.clientName || "טיוטה מהעוזר",
        payload: {
          documentType: draft.documentType,
          currency: "ILS",
          zeroRated: false,
          rate: 1,
          allocationNumber: "",
          clientId: draft.clientId || "",
          adhocMode: !draft.clientId,
          adhocName: draft.clientId ? "" : draft.clientName,
          adhocTaxId: "",
          adhocEmail: "",
          date: todayInIsrael(),
          subject: draft.subject || "",
          validUntil: "",
          paymentMethod: "bank_transfer",
          notes: draft.notes || "",
          vatMode: "exclusive",
          roundTotal: false,
          items: draft.items.map((it, i) => ({
            id: `assistant-${i}`,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
          })),
        },
      });
      setOpen(false);
      router.push(`/documents/new/${DOC_TYPE_ROUTE[draft.documentType]}?draft=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "פתיחת הטיוטה נכשלה.");
    } finally {
      setOpeningDraft(false);
    }
  }

  // Both `left` and `right` have to be set in the same breakpoint: the mobile
  // rules pin the panel to both edges, so overriding only one of them on lg
  // leaves the other stuck at 0. Pairing `lg:left-6` with a bare `lg:left-auto`
  // is worse still - two utilities for the same property, resolved by
  // stylesheet order rather than class order, which silently dropped the panel
  // into RTL static flow on top of the sidebar.
  const side = overDocumentPaper ? "lg:right-6 lg:left-auto" : "lg:left-6 lg:right-auto";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="פתח את העוזר החכם"
        className={`no-print fixed bottom-4 left-4 right-auto z-40 lg:bottom-6 ${side} w-14 h-14 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-lg shadow-orange-200/60 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform print:hidden`}
      >
        <Sparkles className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div
      className={`no-print fixed bottom-0 left-0 right-0 z-40 lg:bottom-6 ${side} lg:w-[400px] print:hidden`}
    >
      <div className="card-soft bg-white flex flex-col h-[70vh] lg:h-[540px] max-h-[calc(100vh-2rem)] overflow-hidden rounded-b-none lg:rounded-2xl shadow-2xl shadow-orange-200/40">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-200 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-stone-900 text-sm leading-tight">העוזר החכם</p>
            <p className="text-[11px] text-stone-500 leading-tight">מוצא מסמכים ומכין טיוטות</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="סגור"
            className="text-stone-400 hover:text-stone-700 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-6">
              <p className="text-sm text-stone-600">
                שאל אותי על המסמכים וההכנסות שלך, או בקש להכין טיוטה.
              </p>
              <div className="flex flex-col gap-2 mt-4">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-xs text-stone-700 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-xl px-3 py-2 transition-colors text-right"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-start" : "flex justify-end"}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                  m.role === "user"
                    ? "bg-gradient-to-br from-orange-400 to-rose-500 text-white"
                    : "bg-stone-100 text-stone-800"
                }`}
              >
                {m.content}
                {m.draft && (
                  <button
                    onClick={() => openDraftInEditor(m.draft!)}
                    disabled={openingDraft}
                    className="mt-2 w-full inline-flex items-center justify-center gap-2 min-h-[36px] px-3 rounded-xl bg-white border border-orange-200 text-stone-800 text-xs font-semibold hover:shadow-md transition-all disabled:opacity-60"
                  >
                    <FileText className="w-4 h-4" />
                    {openingDraft ? "פותח..." : "פתח את הטיוטה בעורך"}
                  </button>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-end">
              <div className="bg-stone-100 text-stone-500 rounded-2xl px-3 py-2 text-sm">
                חושב...
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Extra bottom padding on phones: the sheet sits flush against the
            screen edge, so on a device with a home indicator the disclaimer
            line would otherwise land underneath it. */}
        <div
          className="border-t border-stone-200 p-3 flex-shrink-0"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="במה אפשר לעזור?"
              className="input-warm flex-1 resize-none max-h-24 text-sm py-2 px-3"
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              aria-label="שלח"
              className="w-10 h-10 flex-shrink-0 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 text-white flex items-center justify-center disabled:opacity-40 transition-opacity"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-stone-400 mt-2 text-center">
            העוזר יכול לטעות. הוא מכין טיוטות בלבד - אתה מאשר.
          </p>
        </div>
      </div>
    </div>
  );
}
