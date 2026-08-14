"use client";

// The in-app AI assistant. Finds documents, answers questions about the
// business's own numbers, and prepares document drafts. It never creates a
// document: a draft is handed back to the user, who opens it in the editor and
// approves it there (numbering, allocation and immutability all live in that
// flow and must stay under the user's control).
//
// Voice dictation (the mic button in the composer) uses the browser-native
// Web Speech API - free, no API key, no server round-trip. Supported in
// Chrome and Safari; Firefox has no support, so the button is hidden there
// rather than shown dead (see useSpeechRecognition's `supported` flag).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X, Send, FileText, Paperclip, Table2, MessageCircle, Mic } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { saveDraftToServer, DOC_TYPE_ROUTE } from "@/lib/draft-store";
import { todayInIsrael } from "@/lib/date";
import type { ParsedAttachment } from "@/lib/import-excel-text";
import { useSpeechRecognition, appendFinalResult } from "@/lib/use-speech-recognition";
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
  drafts?: AssistantDraft[];
}

const SUGGESTIONS = [
  "כמה הכנסתי החודש?",
  "תמצא לי את המסמכים האחרונים",
  "מי הלקוח שהכי הכניס לי השנה?",
];

// Kept as a local literal (rather than a static import from
// import-excel-text.ts) so this widget - which renders on every
// authenticated page via the app layout - doesn't pull the xlsx/papaparse
// bundle (365KB) into its chunk just for an <input accept> string. The
// heavy parsing module itself is loaded on demand in pickFile() below.
// Must stay in sync with ATTACHMENT_ACCEPT in import-excel-text.ts.
const ATTACHMENT_ACCEPT = ".xlsx,.xls,.csv";

export function AssistantWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [openingDraft, setOpeningDraft] = useState("");
  const [attachment, setAttachment] = useState<ParsedAttachment | null>(null);
  const [parsingFile, setParsingFile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const speech = useSpeechRecognition();
  // What was already typed when dictation started, so speech APPENDS to it
  // instead of overwriting it.
  const dictationBaseRef = useRef("");

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

  // While dictating, show what was already typed plus the committed
  // transcript plus the live interim tail, so words appear as he speaks.
  useEffect(() => {
    if (!speech.listening) return;
    const withTranscript = appendFinalResult(dictationBaseRef.current, speech.transcript);
    setInput(appendFinalResult(withTranscript, speech.interim));
  }, [speech.listening, speech.transcript, speech.interim]);

  useEffect(() => {
    if (speech.error) setError(speech.error);
  }, [speech.error]);

  function toggleDictation() {
    if (speech.listening) {
      speech.stop();
      return;
    }
    if (busy || parsingFile) return;
    setError("");
    dictationBaseRef.current = input;
    speech.start();
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setParsingFile(true);
    try {
      const { parseAttachmentToCsvText } = await import("@/lib/import-excel-text");
      setAttachment(await parseAttachmentToCsvText(file));
    } catch (err) {
      setAttachment(null);
      setError(err instanceof Error ? err.message : "לא הצלחתי לקרוא את הקובץ.");
    } finally {
      setParsingFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    const sentAttachment = attachment;
    // A file on its own is a complete request ("here's my month"), so an empty
    // textarea shouldn't block sending it.
    if ((!trimmed && !sentAttachment) || busy) return;
    if (speech.listening) speech.stop();
    setError("");
    setInput("");
    setAttachment(null);

    // The sheet text itself is sent once, out of band. What stays in the
    // transcript is only this marker, so follow-up turns stay small and the
    // 4000-char history truncation can never eat half a spreadsheet.
    const shown = sentAttachment
      ? `[קובץ הועלה: ${sentAttachment.fileName}]${trimmed ? `\n${trimmed}` : ""}`
      : trimmed;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: shown }];
    setMessages(nextMessages);
    setBusy(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("פג תוקף ההתחברות. התחבר מחדש.");
        if (sentAttachment) setAttachment(sentAttachment);
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
          ...(sentAttachment
            ? {
                attachment: {
                  fileName: sentAttachment.fileName,
                  rowsAsCsv: sentAttachment.rowsAsCsv,
                },
              }
            : {}),
        }),
      });
      const json = await res.json().catch(() => ({ ok: false, error: "שגיאה לא ידועה" }));
      if (!res.ok || !json.ok) {
        setError(json.error || `הבקשה נכשלה (${res.status})`);
        // Hand the file back rather than making them find and re-upload it.
        if (sentAttachment) setAttachment(sentAttachment);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: json.reply as string,
          drafts: Array.isArray(json.drafts) ? (json.drafts as AssistantDraft[]) : [],
        },
      ]);
    } catch {
      setError("אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.");
      if (sentAttachment) setAttachment(sentAttachment);
    } finally {
      setBusy(false);
    }
  }

  async function openDraftInEditor(draft: AssistantDraft, key: string) {
    setOpeningDraft(key);
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
      setOpeningDraft("");
    }
  }

  // Always bottom-left, on every route (Asaf, 2026-08-14: the launcher must
  // never change corners). InstallPrompt keeps bottom-right so they can't
  // overlap. Both `left` and `right` have to be set in the same breakpoint:
  // the mobile rules pin the panel to both edges, so overriding only one of
  // them on lg leaves the other stuck at 0.
  const side = "lg:left-6 lg:right-auto";

  if (!open) {
    // A bare sparkle circle does not say "assistant" to anyone who has not
    // been told. The launcher is a labelled pill: a chat glyph, which reads as
    // "talk to something", plus the words. The label stays visible at every
    // width - hiding it on mobile would put the ambiguity back exactly where
    // most first-time users are.
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="פתח את העוזר החכם"
        className={`no-print fixed bottom-4 left-4 right-auto z-40 lg:bottom-6 ${side} h-12 pl-4 pr-3 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-lg shadow-orange-200/60 flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform print:hidden`}
      >
        <span className="relative flex items-center justify-center">
          <MessageCircle className="w-5 h-5" />
          <Sparkles className="w-3 h-3 absolute -top-1 -left-1.5" />
        </span>
        <span className="text-sm font-semibold whitespace-nowrap">עוזר חכם</span>
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
              <p className="text-xs text-stone-500 mt-2">
                אפשר גם לצרף קובץ אקסל (למשל רשימת ההופעות של החודש) ואכין ממנו טיוטות
                בסגנון המסמכים הקודמים שלך.
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
                {m.drafts?.map((d, di) => {
                  const key = `${i}-${di}`;
                  const many = (m.drafts?.length ?? 0) > 1;
                  return (
                    <button
                      key={key}
                      onClick={() => openDraftInEditor(d, key)}
                      disabled={!!openingDraft}
                      className="mt-2 w-full inline-flex items-center justify-center gap-2 min-h-[36px] px-3 rounded-xl bg-white border border-orange-200 text-stone-800 text-xs font-semibold hover:shadow-md transition-all disabled:opacity-60"
                    >
                      <FileText className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">
                        {openingDraft === key
                          ? "פותח..."
                          : many
                            ? `פתח טיוטה: ${d.clientName || "ללא לקוח"}`
                            : "פתח את הטיוטה בעורך"}
                      </span>
                    </button>
                  );
                })}
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
          {attachment && (
            <div className="flex items-center gap-2 mb-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
              <Table2 className="w-4 h-4 text-orange-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-stone-800 truncate">
                  {attachment.fileName}
                </p>
                <p className="text-[10px] text-stone-500 leading-tight">
                  {attachment.rowCount} שורות{attachment.truncated ? " (נחתך)" : ""}
                </p>
              </div>
              <button
                onClick={() => setAttachment(null)}
                aria-label="הסר את הקובץ"
                className="text-stone-400 hover:text-stone-700 p-1 flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy || parsingFile}
              aria-label="צרף קובץ אקסל"
              title="צרף קובץ אקסל או CSV"
              className="w-10 h-10 flex-shrink-0 rounded-xl border border-stone-200 text-stone-500 hover:text-orange-500 hover:border-orange-200 flex items-center justify-center disabled:opacity-40 transition-colors"
            >
              <Paperclip className="w-4 h-4" />
            </button>
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
              placeholder={
                parsingFile
                  ? "קורא את הקובץ..."
                  : speech.listening
                    ? "מדבר... "
                    : "במה אפשר לעזור?"
              }
              className="input-warm flex-1 resize-none max-h-24 text-sm py-2 px-3"
            />
            {speech.supported && (
              <button
                type="button"
                onClick={toggleDictation}
                disabled={busy || parsingFile}
                aria-label={speech.listening ? "עצור הקלדה קולית" : "הקלדה קולית"}
                aria-pressed={speech.listening}
                title={speech.listening ? "עצור הקלדה קולית" : "הקלדה קולית"}
                className={`w-11 h-11 flex-shrink-0 rounded-xl border flex items-center justify-center disabled:opacity-40 transition-colors ${
                  speech.listening
                    ? "bg-rose-500 border-rose-500 text-white animate-pulse"
                    : "border-stone-200 text-stone-500 hover:text-orange-500 hover:border-orange-200"
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => send(input)}
              disabled={busy || parsingFile || (!input.trim() && !attachment)}
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
