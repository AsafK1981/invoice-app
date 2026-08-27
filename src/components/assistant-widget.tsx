"use client";

// The in-app AI assistant. Finds documents, answers questions about the
// business's own numbers, and acts: records expenses, adds and updates clients
// and products, marks documents paid (see lib/assistant-actions). Two things it
// does NOT do by itself: it never issues a document - a draft is handed back to
// the user, who opens it in the editor and approves it there (numbering,
// allocation and immutability all live in that flow) - and it never deletes.
// A delete arrives as a `pendingDelete` and runs only when the user clicks the
// red button below the reply, through the same store the screen uses.
//
// Voice dictation (the mic button in the composer) uses the browser-native
// Web Speech API - free, no API key, no server round-trip. Supported in
// Chrome and Safari; Firefox has no support, so the button is hidden there
// rather than shown dead (see useSpeechRecognition's `supported` flag).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, X, Send, FileText, Paperclip, Table2, MessageCircle, Mic, ChevronLeft, Check, Trash2, Pencil, Maximize2, Minimize2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { expenseStore } from "@/lib/expense-store";
import { clientStore } from "@/lib/client-store";
import { productStore } from "@/lib/product-store";
import { logAudit } from "@/lib/audit-log";
import { saveDraftToServer, DOC_TYPE_ROUTE } from "@/lib/draft-store";
import { todayInIsrael } from "@/lib/date";
import type { ParsedAttachment } from "@/lib/import-excel-text";
import { useSpeechRecognition, appendFinalResult } from "@/lib/use-speech-recognition";
import { splitReplyLinks } from "@/lib/assistant-reply";
import type { DocumentType } from "@/lib/types";

interface AssistantDraft {
  documentType: DocumentType;
  clientId: string;
  clientName: string;
  subject: string;
  notes: string;
  items: { description: string; quantity: number; unitPrice: number }[];
}

/** A document the server surfaced this turn (see DocCard in the API route). */
interface AssistantDocCard {
  id: string;
  type: string;
  number: number | null;
  date: string;
  client: string;
  subject?: string;
  status: string;
  statusKey: string;
  total: number;
  currency: string;
}

/** A write the server already performed this turn (see lib/assistant-actions). */
interface AssistantAction {
  kind: "created" | "updated";
  entity: "expense" | "client" | "product" | "document";
  id: string;
  label: string;
  href: string;
}

/** A delete the server is asking the user to confirm with a click. */
interface PendingDelete {
  entity: "expense" | "client" | "product";
  id: string;
  label: string;
}

/** A client contact-field change waiting for the user's click (see lib/assistant-actions). */
interface PendingUpdate {
  entity: "client";
  id: string;
  label: string;
  changes: { field: string; from: string; to: string }[];
  patch: Record<string, string | null>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  drafts?: AssistantDraft[];
  documents?: AssistantDocCard[];
  actions?: AssistantAction[];
  pendingDeletes?: PendingDelete[];
  pendingUpdates?: PendingUpdate[];
}

// The stores' own change events (each store listens for its own). Firing them
// after a server-side write makes whatever screen is open behind the widget
// refetch, so a new expense shows up in the table without a reload.
const CHANGE_EVENT_FOR: Record<AssistantAction["entity"], string> = {
  expense: "invoice-app:expenses-changed",
  client: "invoice-app:clients-changed",
  product: "invoice-app:products-changed",
  document: "invoice-app:documents-changed",
};

const ENTITY_LABEL: Record<PendingDelete["entity"], string> = {
  expense: "ההוצאה",
  client: "הלקוח",
  product: "המוצר",
};

function ActionChips({ actions, onOpen }: { actions: AssistantAction[]; onOpen: () => void }) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {actions.map((a, i) => (
        <Link
          key={`${a.id}-${i}`}
          href={a.href}
          onClick={onOpen}
          className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[13px] text-emerald-800 hover:border-emerald-400 transition-colors"
        >
          <Check className="w-4 h-4 flex-shrink-0 text-emerald-600" />
          <span className="truncate">{a.label}</span>
          <ChevronLeft className="w-3.5 h-3.5 flex-shrink-0 mr-auto text-emerald-500" />
        </Link>
      ))}
    </div>
  );
}

// Same tones the documents table uses for its status pill.
const STATUS_TONE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  sent: "bg-amber-50 text-amber-700 border-amber-200",
  draft: "bg-stone-100 text-stone-600 border-stone-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};

function DocCards({ docs, onOpen }: { docs: AssistantDocCard[]; onOpen: () => void }) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {docs.map((d) => (
        <Link
          key={d.id}
          href={`/documents/${d.id}`}
          onClick={onOpen}
          className="block rounded-xl bg-white border border-stone-200 px-3 py-2 hover:border-orange-300 hover:shadow-md transition-all"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold text-stone-900 truncate">
              {d.type}
              {d.number != null && <span className="text-stone-500 font-normal"> {d.number}</span>}
            </span>
            <span className="text-[13px] font-semibold text-stone-900 tabular-nums whitespace-nowrap">
              {d.currency === "ILS" || !d.currency
                ? formatCurrency(d.total)
                : `${d.total.toLocaleString("he-IL")} ${d.currency}`}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-stone-600">
            <span className="truncate">{d.client}</span>
            <span className="tabular-nums whitespace-nowrap">{formatDate(d.date)}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${
                STATUS_TONE[d.statusKey] ?? STATUS_TONE.draft
              }`}
            >
              {d.status}
            </span>
            <span className="inline-flex items-center gap-0.5 text-[11px] text-orange-600 font-medium">
              פתח
              <ChevronLeft className="w-3 h-3" />
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/**
 * The reply is plain text (the prompt forbids Markdown), but when it names a
 * screen as a bare route ("/migrate") or a full URL, that is the user's next
 * step and it has to be one click away - a how-to answer that ends in a path
 * the user must retype is a dead end with extra steps.
 */
function ReplyText({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const segments = splitReplyLinks(text);
  return (
    <>
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <span key={i}>{s.text}</span>
        ) : s.external ? (
          <a
            key={i}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-700 underline underline-offset-2 break-all"
          >
            {s.text}
          </a>
        ) : (
          <Link
            key={i}
            href={s.href}
            onClick={onNavigate}
            className="text-orange-700 underline underline-offset-2 font-semibold"
          >
            {s.text}
          </Link>
        ),
      )}
    </>
  );
}

const SUGGESTIONS = [
  "כמה הכנסתי החודש?",
  "תוסיף הוצאה: 120 ₪ בסופר-פארם",
  "מי הלקוח שהכי הכניס לי השנה?",
];

// Kept as a local literal (rather than a static import from
// import-excel-text.ts) so this widget - which renders on every
// authenticated page via the app layout - doesn't pull the xlsx/papaparse
// bundle (365KB) into its chunk just for an <input accept> string. The
// heavy parsing module itself is loaded on demand in pickFile() below.
// Must stay in sync with ATTACHMENT_ACCEPT in import-excel-text.ts.
const ATTACHMENT_ACCEPT = ".xlsx,.xls,.csv";

// The panel is resizable (Asaf, 2026-08-18: "let me stretch it up so more
// fits"). Desktop: drag the top edge for height, the top-right corner for
// both axes, or hit the maximize button. Phone: the sheet's grab bar drags
// its height. The chosen size persists in localStorage.
const SIZE_KEY = "assistant-widget-size";
const MIN_W = 360;
const MIN_H = 380;
/** Space kept clear around the panel on desktop (bottom-6 + a top margin). */
const DESKTOP_GAP = 24;

interface PanelSize {
  w: number;
  h: number;
}

function clampSize(size: PanelSize, desktop: boolean): PanelSize {
  if (typeof window === "undefined") return size;
  const maxW = Math.max(MIN_W, window.innerWidth - DESKTOP_GAP * 2);
  const maxH = Math.max(MIN_H, desktop ? window.innerHeight - DESKTOP_GAP * 2 : window.innerHeight);
  return {
    w: Math.min(maxW, Math.max(MIN_W, Math.round(size.w))),
    h: Math.min(maxH, Math.max(MIN_H, Math.round(size.h))),
  };
}

function usePanelSize() {
  const [desktop, setDesktop] = useState(false);
  const [size, setSize] = useState<PanelSize | null>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    try {
      const raw = localStorage.getItem(SIZE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PanelSize> & { max?: boolean };
        if (typeof parsed.w === "number" && typeof parsed.h === "number") {
          setSize({ w: parsed.w, h: parsed.h });
        }
        if (parsed.max) setMaximized(true);
      }
    } catch {
      /* ignore a corrupt value */
    }
    return () => mq.removeEventListener("change", sync);
  }, []);

  const persist = useCallback((next: PanelSize | null, max: boolean) => {
    try {
      if (!next && !max) localStorage.removeItem(SIZE_KEY);
      else localStorage.setItem(SIZE_KEY, JSON.stringify({ ...(next ?? {}), max }));
    } catch {
      /* private mode etc. - the session still works, the size just won't stick */
    }
  }, []);

  return { desktop, size, setSize, maximized, setMaximized, persist };
}

export function AssistantWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { desktop, size, setSize, maximized, setMaximized, persist } = usePanelSize();
  const panelRef = useRef<HTMLDivElement>(null);
  // Set while a resize drag is in flight so the panel skips its size
  // transition and follows the pointer 1:1.
  const [resizing, setResizing] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Per pending-delete key: "working" while the store call runs, "done" after. */
  const [deleteState, setDeleteState] = useState<Record<string, "working" | "done">>({});
  /** Same, for confirm-gated client updates. */
  const [updateState, setUpdateState] = useState<Record<string, "working" | "done">>({});
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

  // Grow the composer with what's typed (up to the CSS max-height, then it
  // scrolls) so a long request is readable in full instead of one 4-word line.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input, open]);

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
          documents: Array.isArray(json.documents) ? (json.documents as AssistantDocCard[]) : [],
          actions: Array.isArray(json.actions) ? (json.actions as AssistantAction[]) : [],
          pendingDeletes: Array.isArray(json.pendingDeletes) ? (json.pendingDeletes as PendingDelete[]) : [],
          pendingUpdates: Array.isArray(json.pendingUpdates) ? (json.pendingUpdates as PendingUpdate[]) : [],
        },
      ]);
      if (Array.isArray(json.actions)) {
        const touched = new Set(
          (json.actions as AssistantAction[]).map((a) => CHANGE_EVENT_FOR[a.entity]).filter(Boolean),
        );
        for (const ev of touched) window.dispatchEvent(new Event(ev));
      }
    } catch {
      setError("אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.");
      if (sentAttachment) setAttachment(sentAttachment);
    } finally {
      setBusy(false);
    }
  }

  // The only path that deletes anything: the user's click, through the same
  // store the screen uses (RLS-scoped, audited, fires the change event).
  // Contact-field changes (email / phone) the server declined to apply on its
  // own. Applied here through the user's own session (RLS-scoped), audited,
  // and announced to the clients screen - only on the click.
  async function confirmUpdate(p: PendingUpdate, key: string) {
    setUpdateState((s) => ({ ...s, [key]: "working" }));
    setError("");
    try {
      const { data, error } = await supabase.from("clients").update(p.patch).eq("id", p.id).select("id");
      if (error || !data?.length) throw new Error(error?.message || "no rows");
      logAudit({
        action: "client.updated",
        targetType: "client",
        targetId: p.id,
        targetLabel: p.label,
        payload: { changed: Object.keys(p.patch), via: "assistant", confirmed: true },
      });
      window.dispatchEvent(new Event(CHANGE_EVENT_FOR.client));
      setUpdateState((s) => ({ ...s, [key]: "done" }));
    } catch {
      setUpdateState((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
      setError("העדכון נכשל. נסה שוב.");
    }
  }

  async function confirmDelete(p: PendingDelete, key: string) {
    setDeleteState((s) => ({ ...s, [key]: "working" }));
    setError("");
    try {
      if (p.entity === "expense") await expenseStore.remove(p.id);
      else if (p.entity === "client") await clientStore.remove(p.id);
      else await productStore.remove(p.id);
      setDeleteState((s) => ({ ...s, [key]: "done" }));
    } catch {
      setDeleteState((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
      setError("המחיקה נכשלה. נסה שוב.");
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

  /**
   * Pointer-driven resize. `axis` says which dimensions the handle controls.
   * The panel is anchored bottom-left, so dragging up grows the height and
   * dragging right grows the width - the deltas are inverted for y.
   */
  function startResize(e: React.PointerEvent, axis: "y" | "xy") {
    if (!panelRef.current) return;
    e.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    setResizing(true);
    setMaximized(false);
    let last: PanelSize = { w: start.w, h: start.h };
    const onMove = (ev: PointerEvent) => {
      const dy = start.y - ev.clientY;
      const dx = axis === "xy" ? ev.clientX - start.x : 0;
      last = clampSize({ w: start.w + dx, h: start.h + dy }, desktop);
      setSize(last);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      setResizing(false);
      persist(last, false);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  function toggleMaximized() {
    const next = !maximized;
    setMaximized(next);
    persist(size, next);
  }

  // Inline size wins over the Tailwind defaults only once the user has
  // touched it (or maximized), so first-time users still get the tuned
  // 440x540 / 70vh defaults from the class list.
  const panelStyle: React.CSSProperties = {};
  if (maximized) {
    if (desktop) {
      panelStyle.width = `min(760px, calc(100vw - ${DESKTOP_GAP * 2}px))`;
      panelStyle.height = `calc(100dvh - ${DESKTOP_GAP * 2}px)`;
    } else {
      panelStyle.height = "100dvh";
    }
  } else if (size) {
    if (desktop) panelStyle.width = `${size.w}px`;
    panelStyle.height = `${size.h}px`;
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
    // Asaf (2026-08-18) still did not notice it in the corner, so it is a
    // larger on desktop (bumped again 2026-08-27: "still too small") and does a short hop + glow ring every ~30s
    // (CSS-only, respects prefers-reduced-motion) to catch the eye.
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="פתח את העוזר החכם"
        className={`assistant-launcher no-print fixed left-4 right-auto z-40 ${side} h-12 pl-4 pr-3 lg:h-16 lg:pl-6 lg:pr-5 lg:gap-3 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-lg shadow-orange-300/60 flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform print:hidden`}
      >
        {/* Attention ring: expands and fades once per nudge cycle (see
            .assistant-launcher::after in app-skin.css). Decorative only. */}
        <span aria-hidden="true" className="assistant-launcher-ring" />
        <span className="relative flex items-center justify-center">
          <MessageCircle className="w-5 h-5 lg:w-7 lg:h-7" />
          <Sparkles className="w-3 h-3 lg:w-4 lg:h-4 absolute -top-1 -left-1.5 lg:-top-1.5 lg:-left-2" />
        </span>
        <span className="text-sm lg:text-lg font-semibold whitespace-nowrap">עוזר חכם</span>
      </button>
    );
  }

  return (
    <div
      className={`no-print fixed bottom-0 left-0 right-0 z-40 lg:bottom-6 ${side} lg:w-[440px] print:hidden`}
      style={desktop && panelStyle.width ? { width: panelStyle.width } : undefined}
    >
      <div
        ref={panelRef}
        className={`card-soft relative bg-white flex flex-col h-[70vh] lg:h-[540px] max-h-[100dvh] lg:max-h-[calc(100dvh-3rem)] overflow-hidden rounded-b-none lg:rounded-2xl shadow-2xl shadow-orange-200/40 ${
          resizing ? "" : "transition-[width,height] duration-150"
        }`}
        style={panelStyle.height ? { height: panelStyle.height } : undefined}
      >
        {/* Resize handles. Top edge: height. Top-right corner: width + height
            (desktop only - on the phone the sheet is always full-width). The
            hit areas are wider than the visible bar so a finger or a rushed
            mouse still catches them. */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="שנה את גובה החלון (גרירה)"
          onPointerDown={(e) => startResize(e, "y")}
          className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize touch-none z-10 flex items-start justify-center group"
        >
          <span className="mt-1 h-1 w-10 rounded-full bg-stone-300 group-hover:bg-orange-400 transition-colors lg:opacity-0 lg:group-hover:opacity-100" />
        </div>
        {desktop && (
          <div
            role="separator"
            aria-label="שנה את גודל החלון (גרירה)"
            onPointerDown={(e) => startResize(e, "xy")}
            className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize touch-none z-20"
          />
        )}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-200 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-stone-900 text-sm leading-tight">העוזר החכם</p>
            <p className="text-[11px] text-stone-500 leading-tight">מוצא, רושם, מעדכן ומכין טיוטות</p>
          </div>
          <button
            onClick={toggleMaximized}
            aria-label={maximized ? "הקטן את החלון" : "הגדל את החלון"}
            title={maximized ? "הקטן" : "הגדל"}
            className="text-stone-400 hover:text-stone-700 p-1"
          >
            {maximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
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
                {m.role === "assistant" ? (
                  <ReplyText text={m.content} onNavigate={() => setOpen(false)} />
                ) : (
                  m.content
                )}
                {m.documents && m.documents.length > 0 && (
                  <DocCards docs={m.documents} onOpen={() => setOpen(false)} />
                )}
                {m.actions && m.actions.length > 0 && (
                  <ActionChips actions={m.actions} onOpen={() => setOpen(false)} />
                )}
                {m.pendingUpdates?.map((p, pi) => {
                  const key = `upd-${i}-${pi}`;
                  const state = updateState[key];
                  return (
                    <div
                      key={key}
                      className={`mt-2 rounded-xl border px-3 py-2 text-[13px] ${
                        state === "done"
                          ? "bg-stone-50 border-stone-200 text-stone-500"
                          : "bg-amber-50 border-amber-200 text-amber-900"
                      }`}
                    >
                      {state === "done" ? (
                        <span className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-stone-400" />
                          עודכן: {p.label}
                        </span>
                      ) : (
                        <>
                          <div className="font-medium">לעדכן את הלקוח {p.label}?</div>
                          <ul className="mt-1 space-y-0.5">
                            {p.changes.map((c) => (
                              <li key={c.field} className="flex flex-wrap items-baseline gap-x-1.5">
                                <span className="text-amber-700">{c.field}:</span>
                                <span className="line-through text-stone-500" dir="auto">{c.from}</span>
                                <span aria-hidden>←</span>
                                <span className="font-semibold" dir="auto">{c.to}</span>
                              </li>
                            ))}
                          </ul>
                          <button
                            type="button"
                            onClick={() => confirmUpdate(p, key)}
                            disabled={state === "working"}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            {state === "working" ? "מעדכן..." : "כן, עדכן"}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                {m.pendingDeletes?.map((p, pi) => {
                  const key = `del-${i}-${pi}`;
                  const state = deleteState[key];
                  return (
                    <div
                      key={key}
                      className={`mt-2 rounded-xl border px-3 py-2 text-[13px] ${
                        state === "done"
                          ? "bg-stone-50 border-stone-200 text-stone-500"
                          : "bg-rose-50 border-rose-200 text-rose-800"
                      }`}
                    >
                      {state === "done" ? (
                        <span className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-stone-400" />
                          נמחק: {p.label}
                        </span>
                      ) : (
                        <>
                          <div>למחוק את {ENTITY_LABEL[p.entity]}? {p.label}</div>
                          <button
                            type="button"
                            onClick={() => confirmDelete(p, key)}
                            disabled={state === "working"}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {state === "working" ? "מוחק..." : "כן, מחק"}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
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
            rows={2}
            placeholder={
              parsingFile
                ? "קורא את הקובץ..."
                : speech.listening
                  ? "מדבר... "
                  : "במה אפשר לעזור?"
            }
            className="input-warm block w-full resize-none min-h-[3.25rem] max-h-44 overflow-y-auto text-sm leading-relaxed py-2.5 px-3.5"
          />
          <div className="flex items-center gap-2 mt-2">
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
            {speech.supported && (
              <button
                type="button"
                onClick={toggleDictation}
                disabled={busy || parsingFile}
                aria-label={speech.listening ? "עצור הקלדה קולית" : "הקלדה קולית"}
                aria-pressed={speech.listening}
                title={speech.listening ? "עצור הקלדה קולית" : "הקלדה קולית"}
                className={`w-10 h-10 flex-shrink-0 rounded-xl border flex items-center justify-center disabled:opacity-40 transition-colors ${
                  speech.listening
                    ? "bg-rose-500 border-rose-500 text-white animate-pulse"
                    : "border-stone-200 text-stone-500 hover:text-orange-500 hover:border-orange-200"
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
            <span className="flex-1 text-[10px] text-stone-400 text-center hidden sm:block">
              Enter לשליחה · Shift+Enter לשורה חדשה
            </span>
            <button
              onClick={() => send(input)}
              disabled={busy || parsingFile || (!input.trim() && !attachment)}
              aria-label="שלח"
              className="ms-auto h-10 px-4 flex-shrink-0 rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 text-white flex items-center justify-center gap-1.5 text-sm font-semibold disabled:opacity-40 transition-opacity"
            >
              <span>שלח</span>
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-stone-400 mt-2 text-center">
            העוזר יכול לטעות. מסמכים הוא רק מכין כטיוטה; מחיקה ושינוי פרטי קשר של לקוח תמיד עוברים דרכך.
          </p>
        </div>
      </div>
    </div>
  );
}
