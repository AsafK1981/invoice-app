"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Printer,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Mail,
  MessageCircle,
  Copy,
  RefreshCw,
  Circle,
  Clock,
  Link as LinkIcon,
  Download,
  MoreHorizontal,
} from "lucide-react";
import { useDocument, useDocuments, deleteDocument, updateDocumentStatus, markDocumentEmailed } from "@/lib/document-store";
import { publicDocumentUrl } from "@/lib/public-url";
import { DocumentAttachmentsSection } from "@/components/document-attachments-section";
import { AllocationNumberSection } from "@/components/allocation-number-section";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useClients } from "@/lib/client-store";
import { useBusiness } from "@/lib/business-store";
import { sendReceiptEmail } from "@/lib/email";
import { ReceiptView } from "@/components/receipt-view";
import { canIssueTaxInvoices } from "@/lib/vat";
import { requiresAllocationNumber } from "@/lib/tax-authority";
import { formatCurrency } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { document: doc, ready } = useDocument(id);
  const { documents: allDocuments } = useDocuments();
  const { items: clients } = useClients();
  const { business } = useBusiness();

  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  // Mobile-only overflow menu state. The action row has too many buttons
  // to fit on a phone width; on mobile, secondary actions collapse into
  // a "⋯" popover. Desktop (sm+) keeps showing everything inline.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    function onMouse(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);
  const confirm = useConfirm();

  if (!ready) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  if (!doc) {
    return (
      <div className="card-soft p-12 text-center max-w-md mx-auto">
        <div className="text-4xl mb-3">🔍</div>
        <h2 className="font-bold text-stone-900 mb-2">המסמך לא נמצא</h2>
        <p className="text-sm text-stone-700 mb-5">ייתכן שהמסמך נמחק או שהקישור אינו תקין</p>
        <Link
          href="/documents"
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-md"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה למסמכים
        </Link>
      </div>
    );
  }

  const client = clients.find((c) => c.id === doc.clientId) ?? null;
  const isQuote = doc.type === "quote";
  const isReceipt = doc.type === "receipt" || doc.type === "tax_invoice_receipt";
  // Convert button only relevant for sent/paid quotes that haven't already
  // been converted. Drafts can't be converted (haven't been issued to the
  // client yet); cancelled and already-converted ones can't either.
  const canConvert =
    isQuote &&
    doc.status !== "cancelled" &&
    doc.status !== "draft" &&
    !doc.convertedToId;
  // The doc this quote was converted into (if any) — used to render a
  // "→ הומר לקבלה #N" link instead of the convert button.
  const convertedDoc = doc.convertedToId
    ? allDocuments.find((d) => d.id === doc.convertedToId)
    : null;
  // The quote this receipt was created FROM (if it was a conversion) —
  // shown as a "← נוצר מהצעה #N" link.
  const sourceQuote = !isQuote
    ? allDocuments.find((d) => d.convertedToId === doc.id)
    : null;
  const isPaid = doc.status === "paid";
  // Always use the canonical origin for share links so they don't bake in
  // a per-deploy hash URL and decay into stale-code views.
  const publicUrl = publicDocumentUrl(doc.id);

  const daysSinceSent = (() => {
    if (doc.status !== "sent" || isReceipt) return null;
    const days = Math.floor(
      (Date.now() - new Date(doc.date).getTime()) / (1000 * 60 * 60 * 24)
    );
    return days;
  })();

  // True when the doc legally needs a מספר הקצאה but doesn't have one yet.
  // Used to disable any "send to client" button — sending without it would
  // be a regulatory violation.
  const allocationGate = requiresAllocationNumber(doc) && !doc.allocationNumber;

  function handlePrint() {
    window.print();
  }

  function handleDownloadPdf() {
    if (!doc) return;
    // We tried html2canvas + jspdf and html2canvas-pro — both throw on
    // modern Tailwind colors (oklch, lab, lch). The native browser print
    // dialog has "Save as PDF" built in and works in every browser, every
    // OS, every CSS color function. Swap document.title temporarily so
    // the suggested filename is sensible instead of "Document.pdf".
    const docLabel = DOCUMENT_TYPE_LABELS[doc.type];
    const filename = `${docLabel}-${doc.number}-${doc.clientName}`.replace(/[\\/:*?"<>|]/g, "-");
    const original = document.title;
    document.title = filename;
    try {
      window.print();
    } finally {
      document.title = original;
    }
  }

  async function handleResend(asReminder = false) {
    if (!doc) return;
    // Tax Authority gate: don't let the user send a tax invoice that
    // legally requires a מספר הקצאה without one. The law forbids
    // delivering the doc to the buyer until the allocation is in.
    if (requiresAllocationNumber(doc) && !doc.allocationNumber) {
      setToast({
        kind: "error",
        text: 'יש להוסיף מספר הקצאה לפני שליחה. גלול מטה לבלוק "נדרש מספר הקצאה".',
      });
      return;
    }
    const to = client?.email;
    if (!to) {
      setToast({ kind: "error", text: "אין אימייל שמור ללקוח - הוסף בעמוד הלקוחות" });
      return;
    }
    setSending(true);
    setToast(null);
    try {
      const daysSinceSent = doc.emailedAt
        ? Math.max(
            1,
            Math.floor(
              (Date.now() - new Date(doc.emailedAt).getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
        : undefined;
      const res = await sendReceiptEmail({
        to,
        clientName: doc.clientName,
        receiptNumber: doc.number,
        total: doc.total,
        businessName: business.name,
        documentId: doc.id,
        logoUrl: business.logoUrl,
        kind: asReminder ? "reminder" : "initial",
        daysSinceSent: asReminder ? daysSinceSent : undefined,
      });
      if (res.ok) {
        if (!res.mocked) {
          try {
            await markDocumentEmailed(doc.id);
          } catch {
            // Don't block the success toast if the timestamp update fails
          }
        }
        setToast({
          kind: "success",
          text: res.mocked
            ? `מייל מדומה נשלח ל-${to} (יתחבר לשירות אמיתי בהמשך)`
            : asReminder
              ? `תזכורת נשלחה ל-${to}`
              : `המסמך נשלח ל-${to}`,
        });
      } else {
        setToast({ kind: "error", text: res.error || "שגיאה בשליחה" });
      }
    } finally {
      setSending(false);
    }
  }

  function handleWhatsApp() {
    if (!doc) return;
    if (requiresAllocationNumber(doc) && !doc.allocationNumber) {
      setToast({
        kind: "error",
        text: 'יש להוסיף מספר הקצאה לפני שליחה. גלול מטה לבלוק "נדרש מספר הקצאה".',
      });
      return;
    }
    const docLabel = DOCUMENT_TYPE_LABELS[doc.type];
    const message =
      `שלום ${doc.clientName},\n\n` +
      `מצורף ${docLabel} מספר #${doc.number} על סך ${formatCurrency(doc.total)}.\n\n` +
      `לצפייה והורדה: ${publicUrl}`;
    const phone = (client?.phone || "").replace(/\D/g, "");
    const url = phone
      ? `https://wa.me/${phone.startsWith("0") ? "972" + phone.slice(1) : phone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener");
  }

  async function handleDuplicate() {
    if (!doc) return;
    router.push(`/documents/new/${docTypeToRoute(doc.type)}?from=${doc.id}`);
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setToast({ kind: "success", text: "הקישור הועתק ללוח" });
    } catch {
      setToast({ kind: "error", text: "לא ניתן להעתיק - העתק ידנית: " + publicUrl });
    }
  }

  async function handleConvertToReceipt() {
    if (!doc) return;
    // Convert produces a doc that represents "paid for" the original quote.
    // עוסק פטור: receipt (קבלה).
    // עוסק מורשה / company: tax_invoice_receipt (חשבונית מס/קבלה) — combines
    // the tax invoice and the receipt in one doc, status auto-paid. Routing
    // to plain tax_invoice would leave it status=sent, which is wrong: the
    // client already paid.
    const isAuthorized = canIssueTaxInvoices(business);
    const targetType = isAuthorized ? "tax-invoice-receipt" : "receipt";
    const targetTypeLabel = isAuthorized ? "חשבונית מס/קבלה" : "קבלה";
    const ok = await confirm({
      title: `להמיר את הצעה #${doc.number} ל${targetTypeLabel}?`,
      message: `ייפתח טופס חדש עם פרטי ההצעה כבר ממולאים. לאחר שתשמור אותו, ההצעה המקורית תסומן כשולמה ותקושר ל${targetTypeLabel} שייווצר.`,
      confirmLabel: "המשך",
    });
    if (!ok) return;
    router.push(`/documents/new/${targetType}?from=${doc.id}&convert=1`);
  }

  async function handleTogglePaid() {
    if (!doc) return;
    setStatusUpdating(true);
    setToast(null);
    try {
      const newStatus = isPaid ? "sent" : "paid";
      await updateDocumentStatus(doc.id, newStatus);
      setToast({
        kind: "success",
        text: newStatus === "paid" ? "המסמך סומן כשולם ✓" : "המסמך סומן כלא שולם",
      });
    } catch (err) {
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "שגיאה בעדכון",
      });
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleDelete() {
    if (!doc) return;

    // Quotes (חשבון עסקה / הצעת מחיר) aren't tax-recognized documents —
    // deleting one is fine. Tax invoices and receipts ARE legally
    // protected: the prescribed flow is a credit note, not deletion.
    // For the latter we still allow a force-delete escape hatch (it's
    // the user's own books, and "this was a test" is a real case),
    // just with a much sterner confirm dialog.
    const isLegallyProtected =
      doc.type === "receipt" ||
      doc.type === "tax_invoice" ||
      doc.type === "tax_invoice_receipt" ||
      doc.type === "credit_note";

    let message: string;
    let confirmLabel: string;
    if (doc.status === "draft") {
      message = "פעולה זו לא ניתנת לביטול.";
      confirmLabel = "מחק מסמך";
    } else if (!isLegallyProtected) {
      // Non-draft quote
      message =
        "המסמך כבר הופק. המחיקה היא סופית והמספור לא יוחזר — תהיה רצף חסר במספרי המסמכים.";
      confirmLabel = "מחק בכל זאת";
    } else {
      // Non-draft receipt/tax invoice/credit note: legally should be a
      // credit note. Force-delete is allowed but only for true test data.
      message =
        "מסמכי מס וקבלות הם רשומות חשבונאיות — הדרך הנכונה לבטל היא הפקת חשבונית זיכוי. אם זה היה ניסיון בלבד שלא נשלח ללקוח אמיתי, אפשר למחוק בכפייה. המחיקה לא תוחזר ולא יישאר תיעוד למסמך.";
      confirmLabel = "מחק בכפייה (היה ניסיון)";
    }

    const ok = await confirm({
      title: `למחוק את מסמך #${doc.number}?`,
      message,
      tone: "danger",
      confirmLabel,
    });
    if (ok) {
      await deleteDocument(doc.id);
      router.push("/documents");
    }
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex items-center justify-between flex-wrap gap-3">
        <Link
          href="/documents"
          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה למסמכים
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          {canConvert && (
            <button
              onClick={handleConvertToReceipt}
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100"
              title="המר את ההצעה לקבלה / חשבונית — הצעה תסומן כשולמה"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">המר ל{canIssueTaxInvoices(business) ? "חשבונית מס/קבלה" : "קבלה"}</span>
            </button>
          )}
          {/* If this quote was already converted, show the receipt link
              instead of the convert button so user can navigate over. */}
          {isQuote && convertedDoc && (
            <Link
              href={`/documents/${convertedDoc.id}`}
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100"
              title={`הומר ל${DOCUMENT_TYPE_LABELS[convertedDoc.type]} #${convertedDoc.number}`}
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">
                הומר ל{DOCUMENT_TYPE_LABELS[convertedDoc.type]} #{convertedDoc.number}
              </span>
            </Link>
          )}
          {/* On a receipt that was created via conversion, link back to
              the source quote so user can compare or audit. */}
          {!isQuote && sourceQuote && (
            <Link
              href={`/documents/${sourceQuote.id}`}
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100"
              title={`נוצר מהצעת מחיר #${sourceQuote.number}`}
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              <span className="hidden sm:inline">
                מהצעה #{sourceQuote.number}
              </span>
            </Link>
          )}
          <button
            onClick={handleDuplicate}
            className="hidden sm:inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-orange-200 text-stone-800 hover:bg-orange-50"
            title="צור עותק חדש"
          >
            <Copy className="w-4 h-4" />
            <span className="hidden sm:inline">שכפל</span>
          </button>
          <button
            onClick={handleCopyLink}
            className="hidden sm:inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-orange-200 text-stone-800 hover:bg-orange-50"
            title="העתק קישור לשיתוף"
          >
            <LinkIcon className="w-4 h-4" />
            <span className="hidden sm:inline">העתק קישור</span>
          </button>
          <button
            onClick={handleWhatsApp}
            disabled={allocationGate}
            className="hidden sm:inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              allocationGate
                ? "חסר מספר הקצאה — אסור לשלוח חשבונית מס מבלעדיו"
                : client?.phone ? `שליחה ל-${client.phone}` : "שליחה ב-WhatsApp"
            }
          >
            <MessageCircle className="w-4 h-4" />
            <span className="hidden sm:inline">WhatsApp</span>
          </button>
          <button
            onClick={() => handleResend(false)}
            disabled={sending || !client?.email || allocationGate}
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              allocationGate
                ? "חסר מספר הקצאה — אסור לשלוח חשבונית מס מבלעדיו"
                : client?.email
                  ? `שליחה ל-${client.email}`
                  : "אין אימייל שמור ללקוח"
            }
          >
            {sending ? (
              <>
                <Mail className="w-4 h-4" />
                <span>שולח...</span>
              </>
            ) : (
              <>
                <Mail className="w-4 h-4" />
                <span className="hidden sm:inline">מייל</span>
              </>
            )}
          </button>
          {/* Reminder button — relevant for sent quotes/tax_invoices that
              haven't been paid yet. Always shown when the doc TYPE is right
              and status is "sent", so the user discovers the feature exists.
              Disabled with a tooltip explaining the gate when the doc hasn't
              actually been emailed yet (no point reminding what was never
              sent). Hidden entirely for receipts and credit notes. */}
          {doc.status === "sent" &&
            (doc.type === "quote" || doc.type === "tax_invoice") && (() => {
              const notYetEmailed = !doc.emailedAt;
              const reminderDisabled = sending || !client?.email || notYetEmailed;
              const reminderTitle = !client?.email
                ? "אין אימייל שמור ללקוח"
                : notYetEmailed
                  ? 'יופעל אחרי שתשלחו את המסמך פעם ראשונה (כפתור "מייל")'
                  : `שלח תזכורת ל-${client.email}`;
              return (
                <button
                  onClick={() => handleResend(true)}
                  disabled={reminderDisabled}
                  className="hidden sm:inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={reminderTitle}
                >
                  <Clock className="w-4 h-4" />
                  <span className="hidden sm:inline">תזכורת</span>
                </button>
              );
            })()}
          <button
            onClick={handleDelete}
            className="hidden sm:inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-rose-200 text-rose-700 hover:bg-rose-50"
            title="מחק"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">מחק</span>
          </button>
          <button
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-3 sm:px-5 py-2 min-h-[40px] rounded-xl text-sm font-semibold hover:shadow-md hover:shadow-orange-200"
            title='הורד PDF — בחר "Save as PDF" בחלון ההדפסה'
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">הורד PDF</span>
          </button>
          <button
            onClick={handlePrint}
            className="hidden sm:inline-flex items-center gap-2 bg-white border border-orange-200 text-stone-800 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold hover:bg-orange-50"
            title="הדפס דרך הדפדפן"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">הדפס</span>
          </button>

          {/* Mobile-only overflow menu. Desktop (sm+) shows the full
              row above; on phones we collapse the secondary actions
              (Duplicate / Copy link / WhatsApp / Reminder / Print /
              Delete) into a "⋯" popover so the row stays a single line
              with just the three primary actions: Convert/MarkPaid,
              Mail, Download PDF. */}
          <div className="relative sm:hidden" ref={moreRef}>
            <button
              onClick={() => setMoreOpen((v) => !v)}
              className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-orange-200 text-stone-800 hover:bg-orange-50"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              title="עוד פעולות"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {moreOpen && (
              <div
                role="menu"
                // RTL: anchor to the inline-start side (right in RTL, left in
                // LTR) so the panel doesn't clip off-viewport when the
                // trigger sits near the start of the action row.
                className="absolute top-full mt-2 right-0 z-30 w-56 bg-white rounded-2xl shadow-lg border border-orange-100 p-1 flex flex-col gap-0.5 animate-fade-in"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    handleDuplicate();
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-xl text-sm font-medium text-stone-800 hover:bg-orange-50 text-right"
                >
                  <Copy className="w-4 h-4 text-stone-500" />
                  שכפל
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    handleCopyLink();
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-xl text-sm font-medium text-stone-800 hover:bg-orange-50 text-right"
                >
                  <LinkIcon className="w-4 h-4 text-stone-500" />
                  העתק קישור
                </button>
                <button
                  role="menuitem"
                  disabled={allocationGate}
                  onClick={() => {
                    setMoreOpen(false);
                    handleWhatsApp();
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-xl text-sm font-medium text-emerald-700 hover:bg-emerald-50 text-right disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </button>
                {doc.status === "sent" &&
                  (doc.type === "quote" || doc.type === "tax_invoice") && (
                    <button
                      role="menuitem"
                      disabled={sending || !client?.email || !doc.emailedAt}
                      onClick={() => {
                        setMoreOpen(false);
                        handleResend(true);
                      }}
                      className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-xl text-sm font-medium text-amber-800 hover:bg-amber-50 text-right disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Clock className="w-4 h-4" />
                      שלח תזכורת
                    </button>
                  )}
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    handlePrint();
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-xl text-sm font-medium text-stone-800 hover:bg-orange-50 text-right"
                >
                  <Printer className="w-4 h-4 text-stone-500" />
                  הדפס
                </button>
                <div className="border-t border-stone-100 my-0.5" />
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    handleDelete();
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-xl text-sm font-medium text-rose-700 hover:bg-rose-50 text-right"
                >
                  <Trash2 className="w-4 h-4" />
                  מחק
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {doc.type === "quote" && doc.approvedAt && (
        <div className="no-print card-soft p-4 flex items-start gap-3 max-w-[210mm] mx-auto bg-emerald-50 border-emerald-200">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-emerald-900">ההצעה אושרה על ידי הלקוח</p>
            <p className="text-xs text-emerald-800 mt-0.5">
              {new Date(doc.approvedAt).toLocaleDateString("he-IL")}
              {doc.approvalSignature && <> · נחתם על ידי <strong>{doc.approvalSignature}</strong></>}
            </p>
          </div>
        </div>
      )}

      {/* Delivery status — separate from payment status. Set only when an
          email send actually succeeds (not on doc creation). */}
      {doc.status !== "draft" && doc.status !== "cancelled" && (
        <div className="no-print card-soft p-3 flex items-center gap-3 max-w-[210mm] mx-auto">
          {doc.emailedAt ? (
            <>
              <div className="w-9 h-9 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
                <Mail className="w-4 h-4 text-emerald-700" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-900">המסמך נשלח במייל ✓</p>
                <p className="text-xs text-stone-600">
                  {new Date(doc.emailedAt).toLocaleString("he-IL", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-9 h-9 rounded-2xl bg-stone-100 flex items-center justify-center shrink-0">
                <Mail className="w-4 h-4 text-stone-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-700">טרם נשלח במייל</p>
                <p className="text-xs text-stone-500">
                  לחץ על &quot;מייל&quot; למעלה כדי לשלוח ללקוח
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Status bar - mark as paid for non-receipt documents */}
      {!isReceipt && doc.status !== "draft" && doc.status !== "cancelled" && (
        <div className="no-print card-soft p-4 flex items-center justify-between flex-wrap gap-3 max-w-[210mm] mx-auto">
          <div className="flex items-center gap-3">
            {isPaid ? (
              <>
                <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <p className="font-semibold text-stone-900">שולם ✓</p>
                  <p className="text-xs text-stone-600">המסמך מסומן כשולם</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-amber-700" />
                </div>
                <div>
                  <p className="font-semibold text-stone-900">ממתין לתשלום</p>
                  <p className="text-xs text-stone-600">
                    {daysSinceSent !== null && daysSinceSent > 0
                      ? `${daysSinceSent} ${daysSinceSent === 1 ? "יום" : "ימים"} מאז ההפקה`
                      : "טרם שולם"}
                  </p>
                </div>
              </>
            )}
          </div>
          <button
            onClick={handleTogglePaid}
            disabled={statusUpdating}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 ${
              isPaid
                ? "bg-white border border-stone-200 text-stone-700 hover:bg-stone-50"
                : "bg-gradient-to-l from-emerald-500 to-teal-500 text-white hover:shadow-md hover:shadow-emerald-200"
            }`}
          >
            {statusUpdating ? (
              "שומר..."
            ) : isPaid ? (
              <>
                <Circle className="w-4 h-4" />
                סמן כלא שולם
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                סמן כשולם
              </>
            )}
          </button>
        </div>
      )}

      {toast && (
        <div
          className={`no-print text-sm p-3 rounded-2xl flex items-start gap-2 max-w-[210mm] mx-auto ${
            toast.kind === "success"
              ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
              : "bg-rose-50 text-rose-900 border border-rose-200"
          }`}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-600" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      <AllocationNumberSection doc={doc} />

      <ReceiptView business={business} client={client} document={doc} />

      <DocumentAttachmentsSection documentId={doc.id} />

      <div className="no-print card-soft p-4 bg-blue-50 border-blue-200 max-w-[210mm] mx-auto">
        <p className="text-sm text-blue-900">
          <strong>טיפ:</strong> "הורד PDF" יוצר קובץ מוכן לשליחה. "הדפס" פותח את חלון ההדפסה של הדפדפן לבחירת מדפסת או יעד אחר.
        </p>
      </div>
    </div>
  );
}

function docTypeToRoute(type: string): string {
  switch (type) {
    case "receipt":
      return "receipt";
    case "quote":
      return "quote";
    case "tax_invoice":
      return "tax-invoice";
    case "tax_invoice_receipt":
      return "tax-invoice";
    case "credit_note":
      return "credit-note";
    default:
      return "receipt";
  }
}
