"use client";

import { Percent } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useBusiness } from "@/lib/business-store";
import { IncomeTaxAdvancesReport } from "@/components/income-tax-advances-report";
import { ReportPageHeader } from "@/components/report-page-header";

export default function AdvancesReportPage() {
  const { documents, ready: docsReady } = useDocuments();
  const { business, ready: bizReady } = useBusiness();

  if (!docsReady || !bizReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  return (
    <div className="space-y-6">
      <ReportPageHeader
        icon={Percent}
        title="מקדמות מס הכנסה"
        subtitle="המחזור לתקופה, אחוז המקדמה והסכום לתשלום, מוכנים להעתקה לטופס המקוון."
      />
      <IncomeTaxAdvancesReport business={business} documents={documents} />
    </div>
  );
}
