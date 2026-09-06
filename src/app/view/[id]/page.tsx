"use client";

import { use, useEffect, useState } from "react";
import { Printer, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { ReceiptView } from "@/components/receipt-view";
import { PaymentOptionsCard } from "@/components/payment-options-card";
import { formatDate } from "@/lib/format";
import { docDir, docStrings, toDocLang, type DocLang } from "@/lib/document-strings";
import type { Business, Client, InvoiceDocument, DocumentItem } from "@/lib/types";

/**
 * The page CHROME around the document (buttons, approval block, hints). It
 * follows the document's own language: whoever opens this link is the customer,
 * and if their invoice is in English the buttons around it must not be Hebrew.
 * The document itself is rendered by ReceiptView from the same language.
 *
 * Deliberately small: the growth-loop card at the bottom stays Hebrew in both
 * cases, because it markets an Israeli product to Israeli freelancers.
 */
const VIEW_STRINGS: Record<DocLang, Record<string, string>> = {
  he: {
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
  },
  en: {
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
        setApproveError(data.error || t.approveFailed);
        return;
      }
      setDoc((prev) =>
        prev
          ? { ...prev, approvedAt: data.approvedAt, approvalSignature: name }
          : prev
      );
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : t.networkError);
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50">
        <p className="text-stone-600 font-medium">{t.loading}</p>
      </div>
    );
  }

  if (error || !doc || !business) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50">
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
      className="doc-print-host min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 py-8 px-4"
      dir={docDir(language)}
      lang={language}
    >
      <div className="no-print max-w-[210mm] mx-auto mb-6 flex items-center justify-end gap-3">
        <button
          onClick={handleDownloadPdf}
          disabled={downloadingPdf}
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          title={t.downloadPdfTitle}
        >
          <Download className="w-4 h-4" />
          {downloadingPdf ? t.downloadPdfBusy : t.downloadPdf}
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 bg-white border border-orange-200 text-stone-800 px-4 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50"
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

      {/* Screen-only cards that are still Hebrew by design (the payment-options
          helper and the growth-loop CTA, which markets an Israeli product to
          Israeli freelancers). On an English document the page is LTR, so they
          get their own dir back or Hebrew punctuation ends up on the wrong
          side. */}
      <div dir="rtl" lang="he">
        <PaymentOptionsCard business={business} document={doc} />
      </div>

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

      <div className="no-print max-w-[210mm] mx-auto mt-6">
        <div className="bg-white rounded-2xl shadow-sm border border-orange-100 p-4 text-center">
          <p className="text-xs text-stone-500">{t.footerHint}</p>
        </div>
      </div>

      {/* ── Growth loop: the warmest surface in the product ──────────────────
          Whoever is reading this just received a professional invoice and is
          looking at exactly what the app produces. A large share of them are
          עצמאים who have the same problem. Screen-only (no-print) so it can
          never appear on the printed/PDF document, and hidden entirely for
          paying subscribers. Leads with the 2026 allocation-number mandate -
          the actual pain - rather than with "free", which every competitor
          already shouts. */}
      {showBranding && (
        <div className="no-print max-w-[210mm] mx-auto mt-4 mb-2" dir="rtl" lang="he">
          <div className="rounded-2xl border border-orange-200 bg-gradient-to-l from-orange-50 to-amber-50 p-5 text-center">
            <p className="text-sm font-semibold text-stone-800">
              גם אתם מוציאים חשבוניות?
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-stone-600">
              הפיקו חשבוניות וקבלות בעברית בחינם, עם מספרי הקצאה אוטומטיים
              מרשות המסים, החובה שחלה על כל עוסק מ-2026.
            </p>
            <a
              href="/?utm_source=document&utm_medium=view_cta&utm_campaign=growth_loop"
              className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-l from-orange-500 to-rose-500 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg hover:shadow-orange-200"
            >
              התחילו בחינם ←
            </a>
            <p className="mt-2 text-[11px] text-stone-500">
              ללא כרטיס אשראי
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
