"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { useFilingReportData } from "@/lib/filing-report-data";
import { useBusiness } from "@/lib/business-store";
import { VatPeriodReport, type PeriodMode } from "@/components/vat-period-report";
import { ReportPageHeader } from "@/components/report-page-header";

const MODES: readonly PeriodMode[] = ["this_2m", "last_2m", "this_month", "last_month", "this_year"];

export default function VatReportPage() {
  const [mode, setMode] = useState<PeriodMode>("this_2m");
  // The period lives in the URL (?period=) so coming back from fixing an
  // expense or a document lands on the period the user was working on.
  // Read from window on mount rather than useSearchParams, which would force a
  // Suspense boundary; the report itself only mounts once data has loaded.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("period");
    if (fromUrl && (MODES as readonly string[]).includes(fromUrl)) setMode(fromUrl as PeriodMode);
    setUrlRead(true);
  }, []);
  function changeMode(next: PeriodMode) {
    setMode(next);
    window.history.replaceState(window.history.state, "", `/reports/vat?period=${next}`);
  }
  const { business, ready: bizReady } = useBusiness();
  const { data, error, retry } = useFilingReportData(business.id);

  if (error) return <div role="alert" className="card-soft p-6 space-y-3"><p>{error}</p><button onClick={retry} className="btn-primary">טען שוב</button></div>;
  if (!data || !bizReady || !urlRead) {
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
      <button type="button" onClick={retry} className="btn-secondary no-print">רענן נתונים ובדוק שוב</button>
      <VatPeriodReport headless selectedMode={mode} onPeriodChange={changeMode} business={business} documents={data.documents} expenses={data.expenses} />
    </div>
  );
}
