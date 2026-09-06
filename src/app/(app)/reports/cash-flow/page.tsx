"use client";

import { useMemo } from "react";
import { FileSpreadsheet, TrendingUp } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { useBusiness } from "@/lib/business-store";
import { useClients } from "@/lib/client-store";
import { todayInIsrael } from "@/lib/date";
import { forecastCashFlow } from "@/lib/cash-flow-forecast";
import { exportCashFlowForecast } from "@/lib/csv-export";
import { CashFlowForecast } from "@/components/cash-flow-forecast";
import { ReportPageHeader } from "@/components/report-page-header";
import { DownloadPdfButton } from "@/components/download-pdf-button";

/**
 * תחזית תזרים - the next three months, from what is already known.
 *
 * No period picker on purpose: the window is always "from today forward", and
 * every mode the shared PeriodPicker offers looks backwards.
 */
export default function CashFlowPage() {
  const { documents, ready: docsReady } = useDocuments();
  const { items: expenses, ready: expReady } = useExpenses();
  const { items: clients } = useClients();
  const { business, ready: bizReady } = useBusiness();

  const result = useMemo(
    () =>
      forecastCashFlow({
        documents,
        expenses,
        clients,
        business,
        today: todayInIsrael(),
      }),
    [documents, expenses, clients, business],
  );

  if (!docsReady || !expReady || !bizReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  const periodLabel =
    result.months.length > 0
      ? `${result.months[0].label} - ${result.months[result.months.length - 1].label}`
      : "";

  return (
    <div className="space-y-6">
      <ReportPageHeader
        icon={TrendingUp}
        title="תחזית תזרים"
        subtitle="3 החודשים הקרובים, לפי מה שכבר ידוע"
        actions={
          <>
            <button
              type="button"
              className="pgbtn pgbtn-quiet no-print"
              onClick={() =>
                exportCashFlowForecast(result, {
                  businessName: business.name,
                  subtitle: periodLabel,
                })
              }
              title="ייצוא התחזית לאקסל"
            >
              <FileSpreadsheet aria-hidden="true" />
              ייצוא ל-Excel
            </button>
            <DownloadPdfButton filename="cash-flow-forecast.pdf" />
          </>
        }
      />
      <CashFlowForecast result={result} />
    </div>
  );
}
