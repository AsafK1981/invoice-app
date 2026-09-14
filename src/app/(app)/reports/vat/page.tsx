"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { useFilingReportData } from "@/lib/filing-report-data";
import { useBusiness } from "@/lib/business-store";
import { VatPeriodReport } from "@/components/vat-period-report";
import { ReportPageHeader } from "@/components/report-page-header";
import {
  DEFAULT_VAT_PERIOD_MODE,
  VAT_PERIOD_STORAGE_KEY,
  resolveVatPeriodMode,
  type VatPeriodMode,
} from "@/lib/vat-report-period";

export default function VatReportPage() {
  const [mode, setMode] = useState<VatPeriodMode>(DEFAULT_VAT_PERIOD_MODE);
  // The period lives in the URL (?period=) so coming back from fixing an
  // expense or a document lands on the period the user was working on, and in
  // localStorage so a monthly filer switches once and it sticks.
  // Read from window on mount rather than useSearchParams, which would force a
  // Suspense boundary; the report itself only mounts once data has loaded.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(VAT_PERIOD_STORAGE_KEY);
    } catch {
      stored = null;
    }
    setMode(resolveVatPeriodMode(new URLSearchParams(window.location.search).get("period"), stored));
    setUrlRead(true);
  }, []);
  function changeMode(next: VatPeriodMode) {
    setMode(next);
    try {
      window.localStorage.setItem(VAT_PERIOD_STORAGE_KEY, next);
    } catch {
      // Storage blocked (private mode): the URL still carries the choice.
    }
    window.history.replaceState(window.history.state, "", `/reports/vat?period=${next}`);
  }
  const { business, ready: bizReady } = useBusiness();
  // Keep the report mounted while an inline fix refetches, so the panel's
  // count updates in place instead of flashing back to "טוען...".
  const { data, error, retry, refreshing } = useFilingReportData(business.id, true, true);

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
      <VatPeriodReport headless selectedMode={mode} onPeriodChange={changeMode} business={business} documents={data.documents} expenses={data.expenses} refreshing={refreshing} />
    </div>
  );
}
