"use client";

import { use, useState } from "react";
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
} from "lucide-react";
import { useDocument, deleteDocument, updateDocumentStatus } from "@/lib/document-store";
import { useClients } from "@/lib/client-store";
import { useBusiness } from "@/lib/business-store";
import { sendReceiptEmail } from "@/lib/email";
import { ReceiptView } from "@/components/receipt-view";
import { canIssueTaxInvoices } from "@/lib/vat";
import { formatCurrency } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { document: doc, ready } = useDocument(id);
  const { items: clients } = useClients();
  const { business } = useBusiness();

  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

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
  const canConvert = isQuote && doc.status !== "cancelled";
  const isPaid = doc.status === "paid";
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = `${baseUrl}/view/${doc.id}`;

  const daysSinceSent = (() => {
    if (doc.status !== "sent" || isReceipt) return null;
    const days = Math.floor(
      (Date.now() - new Date(doc.date).getTime()) / (1000 * 60 * 60 * 24)
    );
    return days;
  })();

  function handlePrint() {
    window.print();
  }

  async function handleResend() {
    if (!doc) return;
    const to = client?.email;
    if (!to) {
      setToast({ kind: "error", text: "אין אימייל שמור ללקוח - הוסף בעמוד הלקוחות" });
      return;
    }
    setSending(true);
    setToast(null);
    try {
      const res = await sendReceiptEmail({
        to,
        clientName: doc.clientName,
        receiptNumber: doc.number,
        total: doc.total,
        businessName: business.name,
        documentId: doc.id,
        logoUrl: business.logoUrl,
      });
      if (res.ok) {
        setToast({
          kind: "success",
          text: res.mocked
            ? `מייל מדומה נשלח ל-${to} (יתחבר לשירות אמיתי בהמשך)`
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

  async function handleConvertToReceipt() {
    if (!doc) return;
    const targetType = canIssueTaxInvoices(business) ? "tax-invoice" : "receipt";
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
    if (doc.status !== "draft") {
      alert("לא ניתן למחוק מסמך שנשלח או שולם. ניתן להפיק חשבונית זיכוי במקום.");
      return;
    }
    if (confirm(`למחוק את מסמך #${doc.number}?`)) {
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
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100"
              title="המר את ההצעה לקבלה / חשבונית"
            >
              <RefreshCw className="w-4 h-4" />
              המר ל{canIssueTaxInvoices(business) ? "חשבונית מס" : "קבלה"}
            </button>
          )}
          <button
            onClick={handleDuplicate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-orange-200 text-stone-800 hover:bg-orange-50"
            title="צור עותק חדש"
          >
            <Copy className="w-4 h-4" />
            שכפל
          </button>
          <button
            onClick={handleWhatsApp}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
            title={client?.phone ? `שליחה ל-${client.phone}` : "שליחה ב-WhatsApp"}
          >
            <MessageCircle className="w-4 h-4" />
            WhatsApp
          </button>
          <button
            onClick={handleResend}
            disabled={sending || !client?.email}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-orange-200 text-stone-800 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title={client?.email ? `שליחה ל-${client.email}` : "אין אימייל שמור ללקוח"}
          >
            {sending ? (
              "שולח..."
            ) : (
              <>
                <Mail className="w-4 h-4" />
                מייל
              </>
            )}
          </button>
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-white border border-rose-200 text-rose-700 hover:bg-rose-50"
          >
            <Trash2 className="w-4 h-4" />
            מחק
          </button>
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:shadow-md hover:shadow-orange-200"
          >
            <Printer className="w-4 h-4" />
            הדפס / PDF
          </button>
        </div>
      </div>

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

      <ReceiptView business={business} client={client} document={doc} />

      <div className="no-print card-soft p-4 bg-blue-50 border-blue-200 max-w-[210mm] mx-auto">
        <p className="text-sm text-blue-900">
          <strong>טיפ:</strong> בלחיצה על "הדפס / PDF", בחר "שמור כ-PDF" ביעד ההדפסה של הדפדפן כדי לייצר קובץ PDF.
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
