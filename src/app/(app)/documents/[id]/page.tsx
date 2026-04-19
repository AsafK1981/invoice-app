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
} from "lucide-react";
import { useDocument, deleteDocument } from "@/lib/document-store";
import { useClients } from "@/lib/client-store";
import { useBusiness } from "@/lib/business-store";
import { sendReceiptEmail } from "@/lib/email";
import { ReceiptView } from "@/components/receipt-view";

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { document: doc, ready } = useDocument(id);
  const { items: clients } = useClients();
  const { business } = useBusiness();

  const [sending, setSending] = useState(false);
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
                שלח במייל
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
            הדפס / הורד PDF
          </button>
        </div>
      </div>

      {toast && (
        <div
          className={`no-print text-sm p-3 rounded-2xl flex items-start gap-2 ${
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
          <strong>טיפ:</strong> בלחיצה על "הדפס / הורד PDF", בחר "שמור כ-PDF" (Save as PDF)
          ביעד ההדפסה של הדפדפן כדי לייצר קובץ PDF.
        </p>
      </div>
    </div>
  );
}
