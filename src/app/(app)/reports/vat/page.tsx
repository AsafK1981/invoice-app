"use client";

import { Receipt } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { useBusiness } from "@/lib/business-store";
import { VatPeriodReport } from "@/components/vat-period-report";
import { ReportPageHeader } from "@/components/report-page-header";

export default function VatReportPage() {
  const { documents, ready: docsReady } = useDocuments();
  const { items: expenses, ready: expReady } = useExpenses();
  const { business, ready: bizReady } = useBusiness();

  if (!docsReady || !expReady || !bizReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  const filesVat = business.businessType === "authorized" || business.businessType === "company";

  return (
    <div className="space-y-6">
      <ReportPageHeader
        icon={Receipt}
        title={filesVat ? "דיווח מע״מ תקופתי" : "הצהרת עוסק פטור שנתית"}
        subtitle={
          filesVat
            ? "מע״מ עסקאות מול מע״מ תשומות לתקופת הדיווח, מוכן להעתקה לדיווח, כולל פירוט כל הוצאה."
            : "המחזור השנתי שמדווחים למע״מ פעם בשנה, מוכן להעתקה."
        }
      />
      <VatPeriodReport headless business={business} documents={documents} expenses={expenses} />
    </div>
  );
}
