"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  Hash,
  X,
} from "lucide-react";
import { useDocument, useDocuments, deleteDocument, updateDocumentStatus, markDocumentEmailed, markDocumentIssued } from "@/lib/document-store";
import { publicDocumentUrl } from "@/lib/public-url";
import { DocumentAttachmentsSection } from "@/components/document-attachments-section";
import { DocumentTimeline } from "@/components/document-timeline";
import { AllocationNumberSection } from "@/components/allocation-number-section";
import { DocumentNumberEditor } from "@/components/document-number-editor";
import { DocumentCustomerTaxEditor } from "@/components/document-customer-tax-editor";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useClients } from "@/lib/client-store";
import { useBusiness } from "@/lib/business-store";
import { sendReceiptEmail } from "@/lib/email";
import { EmailVerificationModal } from "@/components/email-verification-modal";
import { ReceiptView } from "@/components/receipt-view";
import { canIssueTaxInvoices } from "@/lib/vat";
import { requiresAllocationNumber, shouldFocusAllocationOnArrival } from "@/lib/tax-authority";
import { formatCurrency, formatDate } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";
import { docStrings } from "@/lib/document-strings";

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { document: doc, ready } = useDocument(id);
  const { documents: allDocuments } = useDocuments();
  const { items: clients } = useClients();
  const { business } = useBusiness();

  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [emailVerifyModalOpen, setEmailVerifyModalOpen] = useState(false);
  // Mobile-only overflow menu state. The action row has too many buttons
  // to fit on a phone width; on mobile, secondary actions collapse into
  // a "⋯" popover. Desktop (sm+) keeps showing everything inline.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  // PDF-tip card: dismissable, persisted in localStorage so it stays
  // dismissed across pages and sessions. After 1-2 docs the user knows
  // how Print → Save as PDF works.
  const [tipDismissed, setTipDismissed] = useState(false);
  useEffect(() => {
    setTipDismissed(typeof window !== "undefined" && window.localStorage.getItem("invoice-app:pdf-tip-dismissed") === "1");
  }, []);
  function dismissTip() {
    setTipDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("invoice-app:pdf-tip-dismissed", "1");
    }
  }
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
  const searchParams = useSearchParams();
  // Buyer's business/VAT number: the doc's own snapshot, else the linked
  // client's. Absent ⇒ private customer (B2C), for whom no allocation number
  // is ever required. Computed here (ahead of the ready/doc guards below) so
  // the arrival effect right after it - a hook, so it must run unconditionally
  // on every render - can read it.
  const client = clients.find((c) => c.id === doc?.clientId) ?? null;
  const customerTaxId = doc?.clientTaxId || client?.taxId || undefined;
  // Target for the "scroll to + focus + gold ring" landing after a save that
  // still needs an allocation number (see focusAllocationSection below).
  const allocationSectionRef = useRef<HTMLDivElement | null>(null);
  const [allocationRingActive, setAllocationRingActive] = useState(false);
  // Target for the step-2 → step-3 handoff: when the allocation number lands,
  // the page glides down to the delivery tiles and rings them (see
  // handleAllocationReceived below).
  const nextStepsRef = useRef<HTMLElement | null>(null);
  const [nextStepsRingActive, setNextStepsRingActive] = useState(false);
  useEffect(() => {
    if (!ready || !doc) return;
    const param = searchParams.get("needsAllocation");
    if (!shouldFocusAllocationOnArrival(doc, customerTaxId, param)) return;
    focusAllocationSection();
    // Strip the query param so a refresh or back-navigation doesn't re-fire
    // the scroll/ring on a doc that may have gotten its number since.
    router.replace(`/documents/${id}`);
  }, [ready, doc, customerTaxId, id]);

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

  const isQuote = doc.type === "quote";
  const isProforma = doc.type === "proforma";
  const isTaxInvoice = doc.type === "tax_invoice";
  // Price quote (הצעת מחיר) and proforma (חשבון עסקה) share the same
  // pre-payment lifecycle: both can be converted to a receipt/tax-invoice
  // once the client pays. A tax invoice (חשבונית מס) is also convertible -
  // to a plain receipt - so the payment gets its own linked doc instead of
  // a standalone receipt that would double-count the income.
  const isConvertible = isQuote || isProforma || isTaxInvoice;
  // A tax invoice already carries the VAT; its payment doc is always a plain
  // receipt (a tax_invoice_receipt would invoice the same VAT twice).
  const convertTargetLabel =
    isTaxInvoice || !canIssueTaxInvoices(business) ? "קבלה" : "חשבונית מס/קבלה";
  const isReceipt = doc.type === "receipt" || doc.type === "tax_invoice_receipt";
  // Convert button only relevant for sent/paid pre-payment docs that haven't
  // already been converted. Drafts can't be converted (haven't been issued to
  // the client yet); cancelled and already-converted ones can't either.
  const canConvert =
    isConvertible &&
    doc.status !== "cancelled" &&
    doc.status !== "draft" &&
    !doc.convertedToId;
  // The doc this quote/proforma was converted into (if any); used to render a
  // "→ הומר לקבלה #N" link instead of the convert button.
  const convertedDoc = doc.convertedToId
    ? allDocuments.find((d) => d.id === doc.convertedToId)
    : null;
  // The quote/proforma this receipt was created FROM (if it was a conversion),
  // shown as a "← נוצר מהצעה #N" link.
  const sourceQuote = !isConvertible
    ? allDocuments.find((d) => d.convertedToId === doc.id)
    : null;
  // For a credit note: the original invoice it reverses, resolved from the FK
  // (originalDocumentId) among the already-loaded documents. Shown as a
  // clickable "בגין: חשבונית מס #N" link. Manual/external references have no FK
  // and rely on the notes line on the document body instead.
  const originalDoc = doc.originalDocumentId
    ? allDocuments.find((d) => d.id === doc.originalDocumentId)
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

  // True when this doc is on the allocation track at all (legally needs a
  // מספר הקצאה, with or without one yet): the 1-2-3 story applies to it, so
  // the delivery card wears the step-3 medallion.
  const allocationTrack = requiresAllocationNumber(doc, customerTaxId);
  // True while the number is still missing. The send handlers refuse and
  // route the user to the allocation card (toast + scroll + gold ring);
  // sending without the number would be a regulatory violation.
  const allocationGate = allocationTrack && !doc.allocationNumber;

  // "שלח במייל" is the action that actually delivers the document, so it
  // wears the app's one filled-button treatment (`.pgbtn-primary`) while the
  // document hasn't been sent yet - that's the button a freelancer needs to
  // find at a glance. Once it HAS been sent, the pull of a filled button on an
  // already-handled document is pointless (screams for attention nothing else
  // needs), so it drops back to the quiet tier and "הורד PDF" - a lower-stakes,
  // repeatable action - takes the quiet tier permanently instead of the filled
  // one it used to wear.
  const emailIsPrimary = !doc.emailedAt;

  // The "what now?" card. Right after issuing, a user (Asaf, 2026-08-27:
  // "a 70-year-old must understand what to do next") landed on a row of ten
  // small icon buttons and had to guess which one delivers the document. For
  // an issued document that has not been emailed yet the four delivery
  // actions are shown as large labelled tiles in one card instead, and the
  // toolbar drops them so there is exactly one place to look. Once the
  // document has been emailed the toolbar carries them again as usual.
  const showNextSteps = doc.status !== "draft" && doc.status !== "cancelled" && !doc.emailedAt;
  const docReadyWord = doc.type === "proforma" ? "מוכן" : "מוכנה";
  const docItWord = doc.type === "proforma" ? "אותו" : "אותה";

  async function handlePrint() {
    // Render-then-set (18ב): window.print() blocks until the print dialog is
    // dismissed, so the printed sheet reflects the CURRENT flag (מקור while
    // NULL). Only AFTER it returns do we stamp original_issued_at, making this
    // first print the מקור and every later print/download/send an העתק.
    window.print();
    if (!doc) return;
    try {
      await markDocumentIssued(doc.id);
    } catch {
      // Non-fatal: a failed stamp must not disrupt the print UX.
    }
  }

  async function handleDownloadPdf() {
    if (!doc || downloadingPdf) return;
    // One-click real .pdf download. The server route renders the public
    // /view page with headless Chrome (full print CSS: RTL, colors,
    // page-breaks, allocation number) and streams back a PDF; no more
    // "switch the print destination to Save as PDF" dance.
    // The downloaded file is the one the owner forwards to the customer, so it
    // is named in the DOCUMENT's language, matching the server route's own
    // Content-Disposition filename.
    const docLabel = docStrings(doc.language).documentTypes[doc.type];
    const filename =
      `${docLabel}-${doc.number}-${doc.clientName}`.replace(/[\\/:*?"<>|]/g, "-") + ".pdf";
    setDownloadingPdf(true);
    try {
      // Owner reprint: once the doc has been issued/delivered (original_issued_at
      // set) the owner's retained copy is an העתק; before that it's the מקור.
      // The customer-facing /view download stays מקור unconditionally.
      const copyParam = doc.originalIssuedAt ? "?copy=1" : "";
      const res = await fetch(`/api/documents/${doc.id}/pdf${copyParam}`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      // Mirror handlePrint (18ב): the route stamps original_issued_at AFTER
      // producing the bytes, but doesn't notify the client, so our local
      // doc.originalIssuedAt stays stale and a second download would re-send
      // מקור. Stamp it here too; refetch propagates the flag so the NEXT
      // download appends ?copy=1 → העתק. This first download already rendered
      // מקור (copyParam was empty at click time).
      try {
        await markDocumentIssued(doc.id);
      } catch {
        // Non-fatal: a failed stamp must not disrupt the download UX.
      }
    } catch {
      // Fall back to the browser print dialog if the server render fails,
      // so the user always has a way to get the document out.
      window.print();
    } finally {
      setDownloadingPdf(false);
    }
  }

  // Scrolls to + focuses the allocation-number block and rings it gold for
  // ~2.4s (CSS animation, see .allocation-arrival-ring in globals.css).
  // Shared by the arrival effect above (after a save that needs a number)
  // and the two "you can't send yet" gates below, so the user always lands
  // ON the block that blocks them instead of being told to go find it.
  function focusAllocationSection() {
    const el = allocationSectionRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
    setAllocationRingActive(true);
    window.setTimeout(() => setAllocationRingActive(false), 2400);
  }

  // Step 2 just finished (the allocation number landed): hand the user to
  // step 3 by gliding down to the delivery tiles and ringing them, the same
  // gold ring the allocation card gets on arrival. The delay lets the green
  // "המספר התקבל" flip register before the page moves. When the tiles aren't
  // mounted (a draft, or an already-emailed doc) this is a quiet no-op.
  function handleAllocationReceived() {
    window.setTimeout(() => {
      const el = nextStepsRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setNextStepsRingActive(true);
      window.setTimeout(() => setNextStepsRingActive(false), 2400);
    }, 900);
  }

  async function handleResend(asReminder = false) {
    if (!doc) return;
    // Tax Authority gate: don't let the user send a tax invoice that
    // legally requires a מספר הקצאה without one. The law forbids
    // delivering the doc to the buyer until the allocation is in.
    if (requiresAllocationNumber(doc, customerTaxId) && !doc.allocationNumber) {
      setToast({ kind: "error", text: "יש להוסיף מספר הקצאה לפני שליחה." });
      focusAllocationSection();
      return;
    }
    const to = client?.email;
    if (!to) {
      setToast({ kind: "error", text: "אין מייל שמור ללקוח - הוסף בעמוד הלקוחות" });
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
      } else if (res.code === "EMAIL_NOT_VERIFIED") {
        setEmailVerifyModalOpen(true);
      } else {
        setToast({ kind: "error", text: res.error || "שגיאה בשליחה" });
      }
    } finally {
      setSending(false);
    }
  }

  function handleWhatsApp() {
    if (!doc) return;
    if (requiresAllocationNumber(doc, customerTaxId) && !doc.allocationNumber) {
      setToast({ kind: "error", text: "יש להוסיף מספר הקצאה לפני שליחה." });
      focusAllocationSection();
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
    // עוסק מורשה / company: tax_invoice_receipt (חשבונית מס/קבלה), combines
    // the tax invoice and the receipt in one doc, status auto-paid. Routing
    // to plain tax_invoice would leave it status=sent, which is wrong: the
    // client already paid.
    const isAuthorized = canIssueTaxInvoices(business);
    // Tax invoice source → always a plain receipt (VAT already invoiced).
    const targetType =
      doc.type === "tax_invoice" ? "receipt" : isAuthorized ? "tax-invoice-receipt" : "receipt";
    const targetTypeLabel = targetType === "receipt" ? "קבלה" : "חשבונית מס/קבלה";
    const sourceLabel = DOCUMENT_TYPE_LABELS[doc.type];
    const ok = await confirm({
      title: `להמיר את ${sourceLabel} #${doc.number} ל${targetTypeLabel}?`,
      message: `ייפתח טופס חדש עם הפרטים כבר ממולאים. לאחר שתשמור אותו, המסמך המקורי יסומן כשולם ויקושר ל${targetTypeLabel} שייווצר.`,
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

    // A document is deletable iff it was never emailed to the customer
    // (drafts AND issued-but-unsent docs). An emailed doc is a real record the
    // customer holds; it must be reversed with a credit note, not deleted, so
    // the button isn't rendered for those. Issued-but-unsent docs still leave a
    // numbering gap when removed, so we warn about it.
    const message =
      doc.status === "draft"
        ? "למחוק את המסמך? פעולה זו אינה הפיכה."
        : "למחוק את המסמך? המספר לא יוחזר, ייתכן רצף חסר במספור. פעולה זו אינה הפיכה.";

    const ok = await confirm({
      title: `למחוק את מסמך #${doc.number}?`,
      message,
      tone: "danger",
      confirmLabel: "מחק מסמך",
    });
    if (!ok) return;
    try {
      await deleteDocument(doc.id);
      router.push("/documents");
    } catch (err) {
      setToast({
        kind: "error",
        text: err instanceof Error ? err.message : "שגיאה במחיקה",
      });
    }
  }

  return (
    <div className="space-y-6">
      <EmailVerificationModal
        open={emailVerifyModalOpen}
        onClose={() => setEmailVerifyModalOpen(false)}
      />
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
              title={`המר את ה${DOCUMENT_TYPE_LABELS[doc.type]} ל${convertTargetLabel}, המסמך יסומן כשולם`}
              aria-label={`המר את ה${DOCUMENT_TYPE_LABELS[doc.type]} ל${convertTargetLabel}, המסמך יסומן כשולם`}
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">המר ל{convertTargetLabel}</span>
            </button>
          )}
          {/* If this quote/proforma was already converted, show the receipt
              link instead of the convert button so user can navigate over. */}
          {isConvertible && convertedDoc && (
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
          {!isConvertible && sourceQuote && (
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
          {/* On a credit note that references an in-app invoice, link back to
              the original document it reverses (the notes-line reference on the
              printed doc is retained separately; this is the interactive one). */}
          {originalDoc && (
            <Link
              href={`/documents/${originalDoc.id}`}
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-rose-50 border border-rose-200 text-rose-800 hover:bg-rose-100"
              title={`בגין ${DOCUMENT_TYPE_LABELS[originalDoc.type]} #${originalDoc.number}`}
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              <span className="hidden sm:inline">
                בגין {DOCUMENT_TYPE_LABELS[originalDoc.type]} #{originalDoc.number}
              </span>
            </Link>
          )}
          <button
            onClick={handleDuplicate}
            className="hidden sm:inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-orange-200 text-stone-800 hover:bg-orange-50"
            title="צור עותק חדש"
            aria-label="שכפל מסמך"
          >
            <Copy className="w-4 h-4" />
            <span className="hidden sm:inline">שכפל</span>
          </button>
          {/* Delete is offered for any doc that was never emailed to the
              customer (drafts AND issued-but-unsent). `deleteDocument` throws
              for an emailed doc (must be cancelled via credit note), so the
              affordance is hidden for those rather than shown as a dead button. */}
          {!doc.emailedAt && (
            <button
              onClick={handleDelete}
              className="hidden sm:inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-rose-200 text-rose-700 hover:bg-rose-50"
              title="מחק מסמך"
              aria-label="מחק מסמך"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">מחק מסמך</span>
            </button>
          )}
          <button
            onClick={handleCopyLink}
            className="hidden sm:inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-orange-200 text-stone-800 hover:bg-orange-50"
            title="העתק קישור לשיתוף"
          >
            <LinkIcon className="w-4 h-4" />
            <span className="hidden sm:inline">העתק קישור</span>
          </button>
          {!showNextSteps && (<>
          {/* Under the allocation gate the send buttons stay CLICKABLE on
              purpose: handleWhatsApp/handleResend refuse and route the user
              to the allocation card (toast + scroll + gold ring), which
              teaches the order. A greyed-out button with a hover-only tooltip
              is a dead end, especially on touch. */}
          <button
            onClick={handleWhatsApp}
            className="hidden sm:inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              allocationGate
                ? "קודם מבקשים מספר הקצאה - לחיצה תוביל אותך לשם"
                : client?.phone ? `שליחה ל-${client.phone}` : "שליחה ב-WhatsApp"
            }
          >
            <MessageCircle className="w-4 h-4" />
            <span className="hidden sm:inline">שלח ב-WhatsApp</span>
          </button>
          <button
            onClick={() => handleResend(false)}
            disabled={sending || !client?.email}
            className={`inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${
              emailIsPrimary
                ? "pgbtn-primary"
                : "bg-white border border-orange-200 text-stone-800 hover:bg-orange-50"
            }`}
            title={
              allocationGate
                ? "קודם מבקשים מספר הקצאה - לחיצה תוביל אותך לשם"
                : client?.email
                  ? `שליחה ל-${client.email}`
                  : "אין מייל שמור ללקוח"
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
                <span className="hidden sm:inline">שלח במייל</span>
              </>
            )}
          </button>
          {/* Reminder button: relevant for sent quotes/tax_invoices that
              haven't been paid yet. Always shown when the doc TYPE is right
              and status is "sent", so the user discovers the feature exists.
              Disabled with a tooltip explaining the gate when the doc hasn't
              actually been emailed yet (no point reminding what was never
              sent). Hidden entirely for receipts and credit notes. */}
          {doc.status === "sent" &&
            (doc.type === "quote" || doc.type === "proforma" || doc.type === "tax_invoice") && (() => {
              const notYetEmailed = !doc.emailedAt;
              const reminderDisabled = sending || !client?.email || notYetEmailed;
              const reminderTitle = !client?.email
                ? "אין מייל שמור ללקוח"
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
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title="הורד את המסמך כקובץ PDF"
            aria-label="הורד את המסמך כקובץ PDF"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">{downloadingPdf ? "מכין PDF..." : "הורד PDF"}</span>
          </button>
          <button
            onClick={handlePrint}
            className="hidden sm:inline-flex items-center gap-2 bg-white border border-orange-200 text-stone-800 px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-semibold hover:bg-orange-50"
            title="הדפס דרך הדפדפן"
            aria-label="הדפס דרך הדפדפן"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">הדפס</span>
          </button>
          </>)}

          {/* Mobile-only overflow menu. Desktop (sm+) shows the full
              row above; on phones we collapse the secondary actions
              (Duplicate / Copy link / WhatsApp / Reminder / Print /
              Delete) into a "⋯" popover so the row stays a single line
              with just the three actions that stay inline at every width:
              Convert/MarkPaid, Mail, Download PDF. */}
          <div className="relative sm:hidden" ref={moreRef}>
            <button
              onClick={() => setMoreOpen((v) => !v)}
              className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-xl text-sm font-semibold bg-white border border-orange-200 text-stone-800 hover:bg-orange-50"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              title="עוד פעולות"
              aria-label="עוד פעולות"
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
                {!showNextSteps && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    handleWhatsApp();
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-xl text-sm font-medium text-emerald-700 hover:bg-emerald-50 text-right disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </button>
                )}
                {doc.status === "sent" &&
                  (doc.type === "quote" || doc.type === "proforma" || doc.type === "tax_invoice") && (
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
                {!showNextSteps && (
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
                )}
                {!doc.emailedAt && (
                  <>
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
                      מחק מסמך
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The allocation-number step comes FIRST when a number is still needed:
          it is what the user must do next, and burying it under the delivery /
          payment cards is how people ended up sending nothing. It self-hides
          for every document that doesn't need a number.

          Wrapped as a focus + scroll target: right after a save that needs a
          number (?needsAllocation=1) and whenever a blocked send button is
          clicked, the page scrolls here, focuses it, and rings it gold for a
          couple of seconds instead of just telling the user to go find it. */}
      <div
        ref={allocationSectionRef}
        tabIndex={-1}
        className={`no-print scroll-mt-20 rounded-2xl outline-none ${
          allocationRingActive ? "allocation-arrival-ring" : ""
        }`}
      >
        <AllocationNumberSection
          doc={doc}
          customerTaxId={customerTaxId}
          onNumberReceived={handleAllocationReceived}
        />
      </div>

      {/* "The document is ready. How do you want to send it?" - the single
          place to look right after issuing. Four large tiles, each saying in
          plain words what happens when you press it. Email is the filled one
          when it can actually go out; under the allocation gate the send
          tiles stay clickable and route to the allocation card (the same
          scroll + ring the toolbar buttons do) rather than sitting greyed out
          with no explanation. */}
      {showNextSteps && (
        <section
          ref={nextStepsRef}
          aria-labelledby="next-steps-title"
          className={`no-print card-soft p-5 sm:p-6 border-2 border-[color:var(--goldline)] scroll-mt-20 ${
            nextStepsRingActive ? "allocation-arrival-ring" : ""
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="next-steps-title" className="text-lg sm:text-xl font-bold text-stone-900 leading-snug">
                {/* On the allocation track this card IS step 3 of the 1-2-3
                    strip, so it wears the strip's numbered medallion: the
                    save button carries "1", the request button "2", and the
                    delivery card "3". Same gradient recipe as the strip's
                    active badge, so app-skin re-tints them identically. */}
                {allocationTrack && (
                  <span
                    aria-hidden
                    className="me-1.5 inline-flex h-6 w-6 -translate-y-0.5 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 align-middle text-[13px] font-bold"
                  >
                    3
                  </span>
                )}
                {DOCUMENT_TYPE_LABELS[doc.type]} <span dir="ltr">#{doc.number}</span> {docReadyWord}.
                {" "}איך לשלוח {docItWord} ללקוח?
              </h2>
              <p className="text-sm text-stone-600 mt-1">
                {doc.clientName} · {formatCurrency(doc.total)}
                {allocationGate
                  ? " · קודם צריך מספר הקצאה, בכרטיס שלמעלה"
                  : " · בחרו דרך אחת, אפשר גם כמה"}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NextStepTile
              icon={<Mail className="w-5 h-5" />}
              label={sending ? "שולח..." : "שלח במייל"}
              hint={
                !client?.email
                  ? "אין כתובת מייל שמורה ללקוח"
                  : allocationGate
                    ? "אחרי מספר ההקצאה"
                    : <>יישלח אל <Ltr>{client.email}</Ltr></>
              }
              primary={!!client?.email && !allocationGate}
              disabled={sending || !client?.email}
              onClick={() => handleResend(false)}
            />
            <NextStepTile
              icon={<MessageCircle className="w-5 h-5" />}
              iconClass="bg-emerald-50 text-emerald-700"
              label="שלח בוואטסאפ"
              hint={
                allocationGate
                  ? "אחרי מספר ההקצאה"
                  : client?.phone
                    ? <>נפתח וואטסאפ עם הודעה מוכנה אל <Ltr>{client.phone}</Ltr></>
                    : "נפתח וואטסאפ עם הודעה מוכנה, בוחרים למי"
              }
              onClick={handleWhatsApp}
            />
            <NextStepTile
              icon={<Download className="w-5 h-5" />}
              label={downloadingPdf ? "מכין PDF..." : "הורד PDF"}
              hint="קובץ לשמירה במחשב או לצירוף בעצמכם"
              disabled={downloadingPdf}
              onClick={handleDownloadPdf}
            />
            <NextStepTile
              icon={<Printer className="w-5 h-5" />}
              label="הדפס"
              hint="הדפסה על נייר דרך המדפסת"
              onClick={handlePrint}
            />
          </div>
          <button
            type="button"
            onClick={handleCopyLink}
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 underline underline-offset-2"
          >
            <LinkIcon className="w-4 h-4" />
            או העתק קישור לצפייה במסמך
          </button>
        </section>
      )}

      {doc.type === "quote" && doc.approvedAt && (
        <div className="no-print card-soft p-4 flex items-start gap-3 max-w-[210mm] mx-auto bg-emerald-50 border-emerald-200">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-emerald-900">ההצעה אושרה על ידי הלקוח</p>
            <p className="text-xs text-emerald-800 mt-0.5">
              {formatDate(doc.approvedAt)}
              {doc.approvalSignature && <> · נחתם על ידי <strong>{doc.approvalSignature}</strong></>}
            </p>
          </div>
        </div>
      )}

      {/* Delivery status, separate from payment status. Set only when an
          email send actually succeeds (not on doc creation). */}
      {doc.status !== "draft" && doc.status !== "cancelled" && doc.emailedAt && (
        <div className="no-print card-soft p-3 flex items-center gap-3 max-w-[210mm] mx-auto">
              <div
                className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${
                  doc.emailOpenedAt ? "bg-blue-100" : "bg-emerald-100"
                }`}
              >
                <Mail
                  className={`w-4 h-4 ${
                    doc.emailOpenedAt ? "text-blue-700" : "text-emerald-700"
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-stone-900">
                  {doc.emailOpenedAt ? "הלקוח פתח את המייל 👀" : "המסמך נשלח במייל ✓"}
                </p>
                <p className="text-xs text-stone-600 break-words">
                  {/* Who it went to. doc.emailedTo is recorded server-side from
                      the addresses the mail server actually accepted, so it is
                      stated as fact. Documents sent before we started recording
                      it fall back to the linked client's address, explicitly
                      labelled "(כתובת הלקוח)" - that is an inference about
                      where the mail probably went, and must not be dressed up
                      as a record. With neither, we say only when. */}
                  {doc.emailedTo ? (
                    <>
                      נשלח אל{" "}
                      <span dir="ltr" className="break-all">
                        {doc.emailedTo}
                      </span>{" "}
                      ·{" "}
                    </>
                  ) : client?.email ? (
                    <>
                      נשלח אל{" "}
                      <span dir="ltr" className="break-all">
                        {client.email}
                      </span>{" "}
                      <span className="text-stone-400">(כתובת הלקוח)</span> ·{" "}
                    </>
                  ) : (
                    <>נשלח{" "}</>
                  )}
                  {new Date(doc.emailedAt).toLocaleString("he-IL", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {doc.emailOpenedAt && (
                    <>
                      {" · נפתח "}
                      {new Date(doc.emailOpenedAt).toLocaleString("he-IL", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {doc.emailOpenCount && doc.emailOpenCount > 1 && (
                        <> · {doc.emailOpenCount} פתיחות</>
                      )}
                    </>
                  )}
                </p>
              </div>
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

      {/* #15: a number is editable only while the doc is a draft.
          `updateDocumentNumber` throws once issued (number is final by law),
          so for issued docs we show the number read-only with guidance
          instead of an editor that would only error. */}
      {doc.status === "draft" ? (
        <DocumentNumberEditor doc={doc} />
      ) : (
        /* Same skeleton as the delivery card above: one flex row on the card
           itself (no extra wrapper), w-9 icon box, min-w-0 flex-1 text. The
           old markup put dir="ltr" on the TITLE paragraph, which inside the
           RTL page flipped its text-align to left - so the number drifted to
           the far edge of the (wide, because of the long guidance sentence
           below it) text column and detached from the icon. The paragraph now
           inherits RTL and only the "#30040" run is isolated LTR, which is all
           that ever needed direction. */
        <div className="no-print card-soft p-3 flex items-center gap-3 max-w-[210mm] mx-auto">
          <div className="w-9 h-9 rounded-2xl bg-stone-100 flex items-center justify-center shrink-0">
            <Hash className="w-4 h-4 text-stone-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-stone-900">
              {DOCUMENT_TYPE_LABELS[doc.type]} <span dir="ltr">#{doc.number}</span>
            </p>
            <p className="text-xs text-stone-600">
              {/* The "cannot be deleted / cancel via credit note" line only
                  applies once the doc was actually delivered to the customer
                  (emailed). An issued-but-unsent doc is still deletable, so we
                  show only the number-immutability note for it and avoid a
                  line that would contradict the delete button. */}
              {doc.emailedAt &&
              (doc.type === "receipt" ||
                doc.type === "tax_invoice" ||
                doc.type === "tax_invoice_receipt" ||
                doc.type === "credit_note")
                ? "מסמך שנשלח ללקוח: מספרו סופי ואינו ניתן למחיקה. לביטול יש להפיק חשבונית זיכוי."
                : "מסמך שהופק: מספרו סופי ואינו ניתן לשינוי."}
            </p>
          </div>
        </div>
      )}

      {(doc.type === "tax_invoice" ||
        doc.type === "tax_invoice_receipt" ||
        doc.type === "credit_note") && <DocumentCustomerTaxEditor doc={doc} />}

      <ReceiptView
        business={business}
        client={client}
        document={doc}
        // Owner on-screen view: העתק once the doc has been issued/delivered
        // (original_issued_at set), else מקור. handlePrint prints THIS view.
        copy={Boolean(doc.originalIssuedAt)}
      />

      <DocumentAttachmentsSection documentId={doc.id} />

      <div className="no-print">
        <DocumentTimeline document={doc} />
      </div>

      {!tipDismissed && (
        <div className="no-print card-soft p-4 bg-amber-50 border-orange-200 max-w-[210mm] mx-auto flex items-start gap-3">
          <p className="text-sm text-amber-900 flex-1">
            <strong>טיפ:</strong> &quot;הורד PDF&quot; שומר את המסמך כקובץ PDF בלחיצה אחת. &quot;הדפס&quot; פותח את חלון ההדפסה של הדפדפן.
          </p>
          <button
            onClick={dismissTip}
            className="text-amber-700 hover:text-amber-900 hover:bg-amber-100 rounded-lg p-1 flex-shrink-0"
            title="אל תציג שוב"
            aria-label="סגור טיפ"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function docTypeToRoute(type: string): string {
  switch (type) {
    case "receipt":
      return "receipt";
    case "quote":
      return "quote";
    case "proforma":
      return "proforma";
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

/** An address or phone number inside Hebrew copy: kept LTR and moved to the
 *  next line whole rather than split at its own hyphen ("ל--qa" / "ל-050-"
 *  is what a plain `ל-${email}` wrapped into on a phone). */
function Ltr({ children }: { children: React.ReactNode }) {
  return (
    <span dir="ltr" className="inline-block break-all">
      {children}
    </span>
  );
}

/** One large, labelled action in the "what now?" card: icon, the action in
 *  two or three words, and one plain sentence saying what will happen. Big
 *  enough to hit on a phone; `primary` is the single filled tile. */
function NextStepTile({
  icon,
  iconClass = "bg-[color:var(--goldtint)] text-[color:var(--gold-text)]",
  label,
  hint,
  primary = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  iconClass?: string;
  label: string;
  hint: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-3.5 text-right rounded-2xl px-4 py-3.5 min-h-[72px] border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        primary
          ? "bg-gradient-to-l from-orange-500 to-rose-500 border-transparent text-white hover:shadow-lg hover:shadow-orange-200"
          : "bg-white border-stone-200 text-stone-900 hover:border-[color:var(--goldline)] hover:bg-[color:var(--goldtint)]"
      }`}
    >
      <span
        className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
          primary ? "bg-white/20 text-white" : iconClass
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-bold leading-tight">{label}</span>
        <span className={`block text-xs mt-1 leading-snug break-words ${primary ? "text-white/85" : "text-stone-600"}`}>
          {hint}
        </span>
      </span>
    </button>
  );
}
