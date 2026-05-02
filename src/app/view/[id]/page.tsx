"use client";

import { use, useEffect, useState } from "react";
import { Printer, Download } from "lucide-react";
import { ReceiptView } from "@/components/receipt-view";
import { downloadElementAsPdf } from "@/lib/pdf-export";
import { DOCUMENT_TYPE_LABELS } from "@/lib/types";
import type { Business, Client, InvoiceDocument, DocumentItem } from "@/lib/types";

export default function PublicDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<InvoiceDocument | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [downloading, setDownloading] = useState(false);

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
          onClick={async () => {
            const target = document.querySelector(".receipt-view") as HTMLElement | null;
            if (!target || !doc) return;
            setDownloading(true);
            try {
              const docLabel = DOCUMENT_TYPE_LABELS[doc.type];
              const filename = `${docLabel}-${doc.number}-${doc.clientName}.pdf`.replace(
                /[\\/:*?"<>|]/g,
                "-"
              );
              await downloadElementAsPdf(target, filename);
            } finally {
              setDownloading(false);
            }
          }}
          disabled={downloading}
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-2.5 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          {downloading ? "מכין PDF..." : "הורד PDF"}
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
