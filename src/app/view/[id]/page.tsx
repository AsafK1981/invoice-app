"use client";

import { use, useEffect, useState } from "react";
import { Printer, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { ReceiptView } from "@/components/receipt-view";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";
import { formatDate } from "@/lib/format";
import type { Business, Client, InvoiceDocument, DocumentItem } from "@/lib/types";

export default function PublicDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<InvoiceDocument | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [signatureName, setSignatureName] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  async function handleApprove() {
    const name = signatureName.trim();
    if (!name || name.length < 2) {
      setApproveError("יש להזין שם מלא");
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
        setApproveError(data.error || "שגיאה באישור");
        return;
      }
      setDoc((prev) =>
        prev
          ? { ...prev, approvedAt: data.approvedAt, approvalSignature: name }
          : prev
      );
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "שגיאת רשת");
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
          paymentMethod: docRow.payment_method || undefined,
          notes: docRow.notes || undefined,
          approvedAt: docRow.approved_at || undefined,
          approvalSignature: docRow.approval_signature || undefined,
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
        <p className="text-stone-600 font-medium">טוען מסמך...</p>
      </div>
    );
  }

  if (error || !doc || !business) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-50">
        <div className="bg-white rounded-3xl shadow-lg p-10 text-center max-w-md">
          <div className="text-4xl mb-3">🔍</div>
          <h2 className="font-bold text-stone-900 text-lg mb-2">המסמך לא נמצא</h2>
          <p className="text-sm text-stone-600">הקישור אינו תקין או שהמסמך נמחק</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 py-8 px-4">
      <div className="no-print max-w-[210mm] mx-auto mb-6 flex items-center justify-end gap-3">
        <button
          onClick={() => {
            if (!doc) return;
            const docLabel = DOCUMENT_TYPE_LABELS[doc.type];
            const filename = `${docLabel}-${doc.number}-${doc.clientName}`.replace(
              /[\\/:*?"<>|]/g,
              "-",
            );
            const original = document.title;
            document.title = filename;
            try {
              window.print();
            } finally {
              document.title = original;
            }
          }}
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all"
          title='הורד PDF — בחר "Save as PDF" בחלון ההדפסה'
        >
          <Download className="w-4 h-4" />
          הורד PDF
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 bg-white border border-orange-200 text-stone-800 px-4 py-2.5 rounded-2xl text-sm font-semibold hover:bg-orange-50"
          title="הדפס דרך הדפדפן"
        >
          <Printer className="w-4 h-4" />
          הדפס
        </button>
      </div>

      <ReceiptView business={business} client={client} document={doc} />

      {doc.type === "quote" && (
        <div className="no-print max-w-[210mm] mx-auto mt-6">
          {doc.approvedAt ? (
            <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-5 flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-emerald-900">ההצעה אושרה</p>
                <p className="text-sm text-emerald-800 mt-1">
                  אושרה בתאריך {formatDate(doc.approvedAt.slice(0, 10))}
                  {doc.approvalSignature && <> על ידי <strong>{doc.approvalSignature}</strong></>}
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-stone-50/70 rounded-2xl border border-stone-200 p-4">
              <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
                <h3 className="font-semibold text-stone-800 text-sm">אישור ההצעה</h3>
                <span className="text-xs text-stone-500 font-medium">לא חובה</span>
              </div>
              <p className="text-xs text-stone-600 mb-3">
                אם נוח לכם, תוכלו לאשר כאן בלחיצה והאישור יישלח חזרה ל{business?.name || "ספק"}.
                ניתן גם פשוט לחזור במייל או בטלפון.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder="שם מלא (רק אם בוחרים לאשר)"
                  className="flex-1 px-3 py-2 rounded-xl border border-stone-300 bg-white focus:border-stone-400 focus:outline-none text-sm"
                  disabled={approving}
                />
                <button
                  onClick={handleApprove}
                  disabled={approving || signatureName.trim().length < 2}
                  className="inline-flex items-center justify-center gap-2 bg-white border border-stone-300 text-stone-700 hover:bg-stone-100 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {approving ? "מאשר..." : "אשר"}
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
          <p className="text-xs text-stone-500">
            לחץ "הורד PDF" כדי לשמור את המסמך, או "הדפס" כדי לפתוח את חלון ההדפסה.
          </p>
        </div>
      </div>
    </div>
  );
}
