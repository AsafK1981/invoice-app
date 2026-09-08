"use client";

import { use, useEffect, useState } from "react";
import { Printer, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { ReceiptView } from "@/components/receipt-view";
import { PaymentOptionsCard } from "@/components/payment-options-card";
import { formatDate } from "@/lib/format";
import { docDir, docStrings, toDocLang, type DocLang } from "@/lib/document-strings";
import type { Business, Client, InvoiceDocument, DocumentItem } from "@/lib/types";
import { isComputerizedDocument } from "@/lib/signing/eligibility";

/**
 * The page CHROME around the document (buttons, approval block, hints). It
 * follows the document's own language: whoever opens this link is the customer,
 * and if their invoice is in English the buttons around it must not be Hebrew.
 * The document itself is rendered by ReceiptView from the same language.
 *
 */
const VIEW_STRINGS: Record<DocLang, Record<string, string>> = {
  he: {
    promoTitle: "גם אתם מוציאים חשבוניות?",
    promoBody: "הפיקו חשבוניות וקבלות בעברית ובאנגלית, ונהלו את מסמכי העסק במקום אחד.",
    promoButton: "התחילו בחינם",
    promoHint: "ללא כרטיס אשראי",
    loading: "טוען מסמך...",
    notFound: "המסמך לא נמצא",
    notFoundHint: "הקישור אינו תקין או שהמסמך נמחק",
    downloadPdf: "הורד PDF",
    downloadPdfBusy: "מכין PDF...",
    downloadPdfTitle: "הורד את המסמך כקובץ PDF",
    print: "הדפס",
    printTitle: "הדפס דרך הדפדפן",
    approved: "ההצעה אושרה",
    approvedOn: "אושרה בתאריך",
    approvedBy: "על ידי",
    approveTitle: "אישור ההצעה",
    approveOptional: "לא חובה",
    approveNamePlaceholder: "שם מלא (רק אם בוחרים לאשר)",
    approveButton: "אשר",
    approveBusy: "מאשר...",
    approveNameRequired: "יש להזין שם מלא",
    approveFailed: "שגיאה באישור",
    networkError: "שגיאת רשת",
    footerHint: 'לחץ "הורד PDF" כדי לשמור את המסמך, או "הדפס" כדי לפתוח את חלון ההדפסה.',
    consentTitle: "מסמכים ממוחשבים",
    consentBody:
      "המסמך הזה נשלח אליך כמסמך ממוחשב במקום עותק מודפס. לפי הוראות ניהול ספרים, {business} רשאי לשלוח לך מסמכים כאלה רק בהסכמתך. הורדת ה-PDF או לחיצה על הכפתור נרשמת כהסכמה.",
    consentButton: "מאשר/ת קבלת מסמכים ממוחשבים",
    consentBusy: "רושם...",
    consentDone: "הסכמתך לקבלת מסמכים ממוחשבים נרשמה בתאריך {date}.",
    consentRevoked: "הסכמתך בוטלה בתאריך {date}. מסמכים חדשים יישלחו להדפסה.",
    consentRevoke: "להפסיק לקבל מסמכים ממוחשבים",
    consentRevokeConfirm: "להפסיק לקבל מסמכים ממוחשבים מ{business}? המסמכים הבאים לא ייחשבו מסמכים ממוחשבים.",
    consentFailed: "לא הצלחנו לרשום את הבחירה. נסו שוב.",
    verifyLink: "אימות החתימה האלקטרונית של המסמך",
    paperOnlyHint:
      "מסמך זה אינו מסמך ממוחשב: התשלום נרשם באמצעי שהוראות ניהול הספרים אינן מתירות לחתום עליו אלקטרונית. יש להדפיס אותו ולשמור את הנייר.",
  },
  en: {
    promoTitle: "Do you issue invoices too?",
    promoBody: "Create invoices and receipts in Hebrew and English, and manage your business documents in one place.",
    promoButton: "Start for free",
    promoHint: "No credit card required",
    loading: "Loading document...",
    notFound: "Document not found",
    notFoundHint: "The link is invalid, or the document was deleted",
    downloadPdf: "Download PDF",
    downloadPdfBusy: "Preparing PDF...",
    downloadPdfTitle: "Download this document as a PDF file",
    print: "Print",
    printTitle: "Print from your browser",
    approved: "Quote approved",
    approvedOn: "Approved on",
    approvedBy: "by",
    approveTitle: "Approve this quote",
    approveOptional: "optional",
    approveNamePlaceholder: "Full name (only if you choose to approve)",
    approveButton: "Approve",
    approveBusy: "Approving...",
    approveNameRequired: "Please enter your full name",
    approveFailed: "Approval failed",
    networkError: "Network error",
    footerHint: 'Use "Download PDF" to save the document, or "Print" to open the print dialog.',
    consentTitle: "Computerized documents",
    consentBody:
      "This document is delivered to you as a computerized document instead of a printed copy. Under the Israeli bookkeeping regulations, {business} may send you such documents only with your consent. Downloading the PDF or clicking the button records that consent.",
    consentButton: "I agree to receive computerized documents",
    consentBusy: "Recording...",
    consentDone: "Your consent to receive computerized documents was recorded on {date}.",
    consentRevoked: "Your consent was withdrawn on {date}. New documents will be issued for printing.",
    consentRevoke: "Stop receiving computerized documents",
    consentRevokeConfirm: "Stop receiving computerized documents from {business}? Future documents will not count as computerized documents.",
    consentFailed: "We could not record your choice. Please try again.",
    verifyLink: "Verify the electronic signature of this document",
    paperOnlyHint:
      "This document is not a computerized document: its payment method cannot be signed electronically under the Israeli bookkeeping instructions. Print it and keep the paper.",
  },
};

export default function PublicDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<InvoiceDocument | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  // Whether the document owner is on a free plan (→ show the growth-loop
  // footer credit + the recipient CTA below). Server-decided; see
  // src/app/api/public-document/[id]/route.ts.
  const [showBranding, setShowBranding] = useState(true);
  const [signatureName, setSignatureName] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  // 18ב(ג): this recipient's consent to receive computerized documents from
  // this sender, as the server knows it. null = the document has no client row
  // to hold a consent (unlinked), so the block is not shown at all.
  const [consent, setConsent] = useState<{
    at: string | null;
    source: string | null;
    revokedAt: string | null;
  } | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  // מקור/העתק: the customer link is ALWAYS מקור (VAT rule: the buyer must
  // receive the original). Only when the owner's PDF route explicitly requests
  // ?copy=1 (for the owner's retained reprint) do we render "העתק". Read from
  // the URL directly (not useSearchParams) so the page needs no Suspense
  // boundary; it is fully client-rendered behind a loader anyway.
  const [copy, setCopy] = useState(false);
  // Everything on this page speaks the document's language; until the document
  // has loaded (and if it never does) that is Hebrew, as it always was.
  const language = toDocLang(doc?.language);
  const t = VIEW_STRINGS[language];
  useEffect(() => {
    if (typeof window !== "undefined") {
      setCopy(new URLSearchParams(window.location.search).get("copy") === "1");
    }
  }, []);

  async function handleDownloadPdf() {
    if (!doc || downloadingPdf) return;
    const docLabel = docStrings(doc.language).documentTypes[doc.type];
    const filename =
      `${docLabel}-${doc.number}-${doc.clientName}`.replace(/[\\/:*?"<>|]/g, "-") + ".pdf";
    setDownloadingPdf(true);
    try {
      const res = await fetch(`/api/documents/${id}/pdf`);
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      // 18ב(ג), "באופן ממוחשב": taking the PDF is the recipient accepting the
      // document in computerized form. Recorded once, best-effort, never blocks
      // the download the customer asked for.
      void postConsent("consent", "download");
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fall back to the browser print dialog ("Save as PDF") if the
      // server-side render fails for any reason, so the user is never stuck.
      window.print();
    } finally {
      setDownloadingPdf(false);
    }
  }

  // 18ב(ג): record the recipient's consent, or its withdrawal, for THIS sender.
  // The server is idempotent; the UI only reflects the state it sends back.
  async function postConsent(action: "consent" | "revoke", source: "download" | "button") {
    if (!client || consent === null) return;
    const active = Boolean(consent.at) && !consent.revokedAt;
    if (action === "consent" && active) return;
    if (action === "revoke" && !active) return;
    setConsentBusy(true);
    setConsentError(null);
    try {
      const res = await fetch(`/api/public-document/${id}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error("consent failed");
      setConsent(data.consent ?? null);
    } catch {
      // A silent failure on the download path is acceptable (the download
      // itself succeeded); an explicit click deserves a message.
      if (source === "button") setConsentError(t.consentFailed);
    } finally {
      setConsentBusy(false);
    }
  }

  async function handleApprove() {
    const name = signatureName.trim();
    if (!name || name.length < 2) {
      setApproveError(t.approveNameRequired);
      return;
    }
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetch(`/api/public-document/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: name }),
      });
      const data = await res.json();
      if (!data.ok) {
        setApproveError(t.approveFailed);
        return;
      }
      setDoc((prev) =>
        prev
          ? { ...prev, approvedAt: data.approvedAt, approvalSignature: name }
          : prev
      );
    } catch {
      setApproveError(t.networkError);
    } finally {
      setApproving(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/public-document/${id}`, { cache: "no-store" });
        if (!res.ok) {
          setError("המסמך לא נמצא");
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (!data.ok || !data.document) {
          setError("המסמך לא נמצא");
          setLoading(false);
          return;
        }

        setShowBranding(data.showBranding !== false);
        setConsent(data.consent ?? null);

        const docRow = data.document;
        const items = (data.items || []) as Array<{
          id: string;
          product_id: string | null;
          description: string;
          quantity: number | string;
          unit_price: number | string;
          total: number | string;
        }>;
        const mappedItems: DocumentItem[] = items.map((r) => ({
          id: r.id,
          productId: r.product_id || undefined,
          description: r.description,
          quantity: Number(r.quantity),
          unitPrice: Number(r.unit_price),
          total: Number(r.total),
        }));

        setDoc({
          id: docRow.id,
          type: docRow.type,
          number: Number(docRow.number),
          date: docRow.date,
          clientId: docRow.client_id || "",
          clientName: docRow.client_name,
          subject: docRow.subject || undefined,
          status: docRow.status,
          items: mappedItems,
          subtotal: Number(docRow.subtotal),
          vat: Number(docRow.vat),
          total: Number(docRow.total),
          rounding: docRow.rounding != null ? Number(docRow.rounding) : 0,
          roundTotal: Boolean(docRow.round_total),
          paymentMethod: docRow.payment_method || undefined,
          // Payment split / discount / structured payment detail; must render on
          // the client-facing view and PDF exactly as on the owner's copy.
          paymentDetails: docRow.payment_details || undefined,
          withholdingRate: docRow.withholding_rate != null ? Number(docRow.withholding_rate) : undefined,
          withholdingAmount: docRow.withholding_amount != null ? Number(docRow.withholding_amount) : undefined,
          discountAmount: docRow.discount_amount != null ? Number(docRow.discount_amount) : undefined,
          notes: docRow.notes || undefined,
          approvedAt: docRow.approved_at || undefined,
          approvalSignature: docRow.approval_signature || undefined,
          // הוראות ניהול ספרים 18ב: drives the מקור/העתק label. Once the
          // original has been emitted (set), the public view renders "העתק".
          originalIssuedAt: docRow.original_issued_at || null,
          // מספר הקצאה (חשבונית ישראל); must render on the document the client
          // sees, exactly as on the owner's copy. Without this mapping the
          // public view silently dropped it.
          allocationNumber: docRow.allocation_number || undefined,
          allocationSetAt: docRow.allocation_set_at || undefined,
          // Multi-currency fields; so foreign-currency invoices display in
          // their currency (and the ₪ equivalent) on the client-facing view too.
          currency: docRow.currency || undefined,
          exchangeRate: docRow.exchange_rate != null ? Number(docRow.exchange_rate) : undefined,
          subtotalIls: docRow.subtotal_ils != null ? Number(docRow.subtotal_ils) : undefined,
          vatIls: docRow.vat_ils != null ? Number(docRow.vat_ils) : undefined,
          totalIls: docRow.total_ils != null ? Number(docRow.total_ils) : undefined,
          zeroRated: docRow.zero_rated || undefined,
          // The document's own language drives its rendering AND this page's
          // chrome; a legacy row without the column reads as Hebrew.
          language: docRow.language === "en" ? "en" : "he",
        });

        if (data.business) {
          const biz = data.business;
          setBusiness({
            id: biz.id,
            name: biz.name,
            businessType: biz.business_type,
            taxId: biz.tax_id,
            address: biz.address,
            phone: biz.phone || undefined,
            email: biz.email || undefined,
            logoUrl: biz.logo_url || undefined,
            bankName: biz.bank_name || undefined,
            bankBranch: biz.bank_branch || undefined,
            bankAccount: biz.bank_account || undefined,
            paymentNotes: biz.payment_notes || undefined,
            // Already normalized server-side by /api/public-document (see
            // that route's businessOut construction) - this is what flows
            // through ReceiptView -> the .doc-paper wrapper's inline style,
            // which is what the PDF route's headless Chrome then prints.
            documentDesign: biz.document_design ?? null,
          });
        }

        if (data.client) {
          const cli = data.client;
          setClient({
            id: cli.id,
            name: cli.name,
            taxId: cli.tax_id || undefined,
            address: cli.address || undefined,
            phone: cli.phone || undefined,
            email: cli.email || undefined,
            notes: cli.notes || undefined,
            createdAt: cli.created_at?.slice(0, 10) || "",
          });
        }

        setLoading(false);
      } catch {
        setError("המסמך לא נמצא");
        setLoading(false);
      }
    }

    load();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <p className="text-stone-600 font-medium">{t.loading}</p>
      </div>
    );
  }

  if (error || !doc || !business) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="bg-white rounded-3xl shadow-lg p-10 text-center max-w-md">
          <div className="text-4xl mb-3">🔍</div>
          <h2 className="font-bold text-stone-900 text-lg mb-2">{t.notFound}</h2>
          <p className="text-sm text-stone-600">{t.notFoundHint}</p>
        </div>
      </div>
    );
  }

  return (
    // doc-print-host: this tinted full-height panel is what the server PDF
    // (headless Chrome + printBackground) would otherwise print as a coloured
    // frame around the sheet (BLACK, under the gold skin). document-paper.css
    // flattens anything carrying this marker to white, zero-padding, in print.
    <div
      className="doc-print-host min-h-screen bg-stone-50 py-8 px-4"
      dir={docDir(language)}
      lang={language}
    >
      <div className="no-print max-w-[210mm] mx-auto mb-6 flex items-center justify-end gap-3">
        <button
          onClick={handleDownloadPdf}
          disabled={downloadingPdf}
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-orange-700 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          title={t.downloadPdfTitle}
        >
          <Download className="w-4 h-4" />
          {downloadingPdf ? t.downloadPdfBusy : t.downloadPdf}
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 bg-white border-[1.5px] border-orange-500 text-orange-500 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-stone-50"
          title={t.printTitle}
        >
          <Printer className="w-4 h-4" />
          {t.print}
        </button>
      </div>

      <ReceiptView
        business={business}
        client={client}
        document={doc}
        copy={copy}
        showBranding={showBranding}
      />

      <PaymentOptionsCard business={business} document={doc} />

      {doc.type === "quote" && (
        <div className="no-print max-w-[210mm] mx-auto mt-6">
          {doc.approvedAt ? (
            <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-5 flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-emerald-900">{t.approved}</p>
                <p className="text-sm text-emerald-800 mt-1">
                  {t.approvedOn} {formatDate(doc.approvedAt.slice(0, 10), language)}
                  {doc.approvalSignature && (
                    <> {t.approvedBy} <strong>{doc.approvalSignature}</strong></>
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-stone-50/70 rounded-2xl border border-stone-200 p-4">
              <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
                <h3 className="font-semibold text-stone-800 text-sm">{t.approveTitle}</h3>
                <span className="text-xs text-stone-500 font-medium">{t.approveOptional}</span>
              </div>
              <p className="text-xs text-stone-600 mb-3">
                {language === "en" ? (
                  <>
                    If it suits you, you can approve here in one click and the
                    approval goes straight back to {business?.name || "the supplier"}.
                    Replying by email or phone works just as well.
                  </>
                ) : (
                  <>
                    אם נוח לכם, תוכלו לאשר כאן בלחיצה והאישור יישלח חזרה ל{business?.name || "ספק"}.
                    ניתן גם פשוט לחזור במייל או בטלפון.
                  </>
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder={t.approveNamePlaceholder}
                  autoComplete="name"
                  inputMode="text"
                  className="flex-1 px-3 py-2 rounded-xl border border-stone-300 bg-white focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-300 text-sm"
                  disabled={approving}
                />
                <button
                  onClick={handleApprove}
                  disabled={approving || signatureName.trim().length < 2}
                  className="inline-flex items-center justify-center gap-2 bg-white border border-stone-300 text-stone-700 hover:bg-stone-100 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {approving ? t.approveBusy : t.approveButton}
                </button>
              </div>
              {approveError && (
                <div className="mt-3 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{approveError}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* הוראות ניהול ספרים 18ב(ג): the recipient's consent to computerized
          documents, recorded per sender. Shown only when the document is linked
          to a client row (there is somewhere to keep the consent) and is not a
          draft. Downloading the PDF above records it too. */}
      {client && doc && doc.status !== "draft" && consent !== null && (
        <div className="no-print max-w-[210mm] mx-auto mt-6">
          <div className="bg-white rounded-2xl shadow-sm border border-orange-100 p-5">
            <h3 className="font-semibold text-stone-800 text-sm mb-2">{t.consentTitle}</h3>
            {consent.at && !consent.revokedAt ? (
              <>
                <p className="text-xs text-stone-600">
                  {t.consentDone.replace("{date}", formatDate(consent.at.slice(0, 10), language))}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t.consentRevokeConfirm.replace("{business}", business?.name || ""))) {
                      void postConsent("revoke", "button");
                    }
                  }}
                  disabled={consentBusy}
                  className="mt-2 text-xs text-stone-500 underline hover:text-stone-700 disabled:opacity-50"
                >
                  {t.consentRevoke}
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-stone-600 leading-relaxed">
                  {consent.revokedAt
                    ? t.consentRevoked.replace("{date}", formatDate(consent.revokedAt.slice(0, 10), language))
                    : t.consentBody.replace("{business}", business?.name || "")}
                </p>
                <button
                  type="button"
                  onClick={() => void postConsent("consent", "button")}
                  disabled={consentBusy}
                  className="mt-3 inline-flex items-center justify-center gap-2 bg-white border border-stone-300 text-stone-700 hover:bg-stone-100 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {consentBusy ? t.consentBusy : t.consentButton}
                </button>
              </>
            )}
            {consentError && (
              <div className="mt-3 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{consentError}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="no-print max-w-[210mm] mx-auto mt-6">
        <div className="bg-white rounded-2xl shadow-sm border border-orange-100 p-4 text-center space-y-2">
          <p className="text-xs text-stone-500">{t.footerHint}</p>
          {/* ניהול ספרים סעיף 1 / 18ב(ד): a signed document links to its
              public signature check; a paper-only one says why it is not
              a מסמך ממוחשב. Drafts get neither. */}
          {doc && doc.status !== "draft" && (
            isComputerizedDocument({ type: doc.type, status: doc.status, paymentMethod: doc.paymentMethod }) ? (
              <p className="text-xs">
                <a href={`/verify/${id}`} className="text-orange-700 underline hover:text-orange-800">
                  {t.verifyLink}
                </a>
              </p>
            ) : (
              <p className="text-xs text-amber-800">{t.paperOnlyHint}</p>
            )
          )}
        </div>
      </div>

      {/* Screen-only recipient promotion, hidden for paying subscribers. */}
      {showBranding && (
        <div className="no-print max-w-[210mm] mx-auto mt-4 mb-2">
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-center">
            <p className="text-sm font-semibold text-stone-800">
              {t.promoTitle}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-stone-600">
              {t.promoBody}
            </p>
            <a
              href="/product?utm_source=document&utm_medium=view_cta&utm_campaign=growth_loop"
              className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-l from-orange-500 to-orange-700 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg hover:shadow-orange-200"
            >
              {t.promoButton}
            </a>
            <p className="mt-2 text-[11px] text-stone-500">
              {t.promoHint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
