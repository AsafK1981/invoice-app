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
  // The action row's slot for "ייצוא ל-Excel". The button itself is rendered
  // by <DocumentsTable>, which is the only thing that knows what is currently
  // filtered; this page just says WHERE it goes. See the `exportSlot` prop.
  const [exportSlot, setExportSlot] = useState<HTMLElement | null>(null);

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
      // Credit notes are stored ALREADY NEGATIVE on save (receipt-editor.tsx
      // applies `sign = -1`), so a plain sum already subtracts them; applying
      // a sign here again would double-negate and turn a refund into extra
      // "paid" total. `totalIls` normalizes foreign-currency documents into
      // shekels so they don't get summed at their native face value.
      if (d.status === "paid") paid += (d.totalIls ?? d.total);
      else if (d.status === "sent" && (d.type === "quote" || d.type === "proforma" || d.type === "tax_invoice")) {
        // "outstanding" = sent but unpaid quotes/invoices → money potentially
        // owed to you. Receipts and tax_invoice_receipts are paid by definition
        // and aren't double-counted here.
        outstanding += (d.totalIls ?? d.total);
      }
    }
    return { paid, outstanding };
  }, [documents]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl fgrad fgrad-indigo flex items-center justify-center shadow-sm">
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
        {/* Three quiet file chores and one call to action. All four wear the
            one `.pgbtn` treatment (see "PAGE ACTION ROW" in app-skin.css):
            one height, one radius, one gap, one icon size, and colour spent
            only on the primary. The bank button used to be the odd one out in
            stock-Tailwind emerald, which this skin does not re-tint, so it
            rendered mint-green between two gold-outlined siblings. */}
        <div className="pgactions">
          <button
            onClick={() => setBankImportOpen(true)}
            disabled={unpaidDocuments.length === 0}
            className="pgbtn pgbtn-quiet"
            title="העלאת תדפיס חשבון בנק לזיהוי תשלומים וסימון אוטומטי של חשבוניות"
          >
            <Banknote aria-hidden="true" />
            ייבוא תנועות מהבנק
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="pgbtn pgbtn-quiet"
            title="ייבוא מסמכים היסטוריים מקובץ CSV"
          >
            <Upload aria-hidden="true" />
            ייבוא היסטורי
          </button>
          {/* Import's opposite number lands here, immediately beside it and in
              the same treatment: `display: contents`, so the portalled button
              is a direct child of this row (a flex item, or a grid item on a
              phone) and the slot costs nothing while the drafts tab is open. */}
          <div ref={setExportSlot} className="contents" />
          <Link href="/documents/new" className="pgbtn pgbtn-primary">
            <Plus aria-hidden="true" />
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
          <DocumentsTable documents={documents} exportSlot={exportSlot} />
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
