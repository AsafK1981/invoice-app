"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Plus, Upload, Banknote } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useDrafts } from "@/lib/draft-store";
import { DocumentsTable } from "@/components/documents-table";
import { DraftsList } from "@/components/drafts-list";
import { CsvImportModal } from "@/components/csv-import-modal";
import { BankImportModal } from "@/components/bank-import-modal";
import { formatCurrency } from "@/lib/format";

export default function DocumentsPage() {
  const { documents } = useDocuments();
  const { drafts } = useDrafts();
  const [tab, setTab] = useState<"documents" | "drafts">("documents");
  const [importOpen, setImportOpen] = useState(false);
  const [bankImportOpen, setBankImportOpen] = useState(false);

  const unpaidDocuments = useMemo(
    () =>
      documents.filter(
        (d) =>
          (d.type === "tax_invoice" || d.type === "quote" || d.type === "proforma") &&
          (d.status === "sent" || d.status === "draft"),
      ),
    [documents],
  );

  const totals = useMemo(() => {
    let paid = 0;
    let outstanding = 0;
    for (const d of documents) {
      if (d.status === "draft" || d.status === "cancelled") continue;
      const sign = d.type === "credit_note" ? -1 : 1;
      if (d.status === "paid") paid += sign * d.total;
      else if (d.status === "sent" && (d.type === "quote" || d.type === "proforma" || d.type === "tax_invoice")) {
        // "outstanding" = sent but unpaid quotes/invoices → money potentially
        // owed to you. Receipts and tax_invoice_receipts are paid by definition
        // and aren't double-counted here.
        outstanding += d.total;
      }
    }
    return { paid, outstanding };
  }, [documents]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-sm">
              <FileText className="w-5 h-5 text-white" />
            </span>
            מסמכים
          </h1>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-stone-700 mt-2 mr-14">
            <span>{documents.length} מסמכים סה״כ</span>
            {totals.paid > 0 && (
              <>
                <span className="text-stone-400">·</span>
                <span>
                  שולם:{" "}
                  <span className="font-semibold text-emerald-700" dir="ltr">
                    {formatCurrency(totals.paid)}
                  </span>
                </span>
              </>
            )}
            {totals.outstanding > 0 && (
              <>
                <span className="text-stone-400">·</span>
                <span>
                  ממתין לתשלום:{" "}
                  <span className="font-semibold text-amber-700" dir="ltr">
                    {formatCurrency(totals.outstanding)}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setBankImportOpen(true)}
            disabled={unpaidDocuments.length === 0}
            className="inline-flex items-center gap-2 bg-white border border-emerald-200 text-stone-800 px-4 py-3 rounded-2xl text-sm font-semibold hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title="העלאת תדפיס חשבון בנק לזיהוי תשלומים וסימון אוטומטי של חשבוניות"
          >
            <Banknote className="w-4 h-4 text-emerald-600" />
            ייבוא תנועות מהבנק
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 bg-white border border-orange-200 text-stone-800 px-4 py-3 rounded-2xl text-sm font-semibold hover:bg-orange-50"
            title="ייבוא מסמכים היסטוריים מקובץ CSV"
          >
            <Upload className="w-4 h-4" />
            ייבוא היסטורי
          </button>
          <Link
            href="/documents/new"
            className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all"
          >
            <Plus className="w-4 h-4" />
            מסמך חדש
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-stone-200">
        <button
          onClick={() => setTab("documents")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            tab === "documents"
              ? "border-orange-500 text-orange-700"
              : "border-transparent text-stone-500 hover:text-stone-800"
          }`}
        >
          מסמכים
        </button>
        <button
          onClick={() => setTab("drafts")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors inline-flex items-center gap-2 ${
            tab === "drafts"
              ? "border-orange-500 text-orange-700"
              : "border-transparent text-stone-500 hover:text-stone-800"
          }`}
        >
          טיוטות
          {drafts.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
              {drafts.length}
            </span>
          )}
        </button>
      </div>

      <div className="card-soft overflow-hidden">
        {tab === "documents" ? (
          <DocumentsTable documents={documents} showExport />
        ) : (
          <DraftsList />
        )}
      </div>

      <CsvImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entityType="documents"
      />

      <BankImportModal
        open={bankImportOpen}
        onClose={() => setBankImportOpen(false)}
        unpaidDocuments={unpaidDocuments}
        onPaid={() => setBankImportOpen(false)}
      />
    </div>
  );
}
