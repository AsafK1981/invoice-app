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
        title="דיווח מע״מ תקופתי"
        subtitle="מע״מ עסקאות מול מע״מ תשומות לתקופת הדיווח, מוכן להעתקה לדיווח, כולל פירוט כל הוצאה."
      />
      {filesVat ? (
        <VatPeriodReport headless business={business} documents={documents} expenses={expenses} />
      ) : (
        <div className="card-soft p-6 text-sm text-stone-700">
          עוסק פטור לא מדווח מע״מ, ולכן הדוח הזה לא רלוונטי לעסק שלך. אם העסק הפך לעוסק מורשה, עדכן את סוג העסק בהגדרות והדוח יופיע כאן.
        </div>
      )}
    </div>
  );
}
