"use client";

import { use, useMemo } from "react";
import { ClipboardList } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { StoreLoadError } from "@/components/store-load-error";
import { useBusiness } from "@/lib/business-store";
import { Form1301Helper } from "@/components/form-1301-helper";
import { ReportPageHeader } from "@/components/report-page-header";
import { periodMatches } from "@/lib/report-period";
import { YearStepper } from "@/components/year-stepper";

export default function Form1301Page({ params }: { params: Promise<{ year: string }> }) {
  const { year: yearStr } = use(params);
  const year = parseInt(yearStr, 10);
  const { documents, ready: docsReady, error: docsError, retry: retryDocs } = useDocuments();
  const { items: expenses, ready: expReady, error: expError, retry: retryExp } = useExpenses();
  const { business, ready: bizReady } = useBusiness();

  const yearDocs = useMemo(() => documents.filter((d) => periodMatches(String(year), d.date)), [documents, year]);
  const yearExpenses = useMemo(() => expenses.filter((e) => periodMatches(String(year), e.date)), [expenses, year]);

  if (!Number.isFinite(year)) {
    return <div className="text-center py-16 text-stone-500">שנה לא תקינה</div>;
  }
  if (docsError || expError) return <StoreLoadError sources={[{ error: docsError, retry: retryDocs }, { error: expError, retry: retryExp }]} />;

  if (!docsReady || !expReady || !bizReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  return (
    <div className="space-y-6">
      <ReportPageHeader
        icon={ClipboardList}
        title={`עזר למילוי טופס 1301 · ${year}`}
        period={`שנת המס ${year}`}
        subtitle="הערכים מוכנים להעתקה ישירה לטופס הדוח השנתי באתר רשות המסים, או לרואה החשבון."
        actions={<YearStepper year={year} base="/reports/form-1301" />}
      />
      <Form1301Helper headless year={year} business={business} documents={yearDocs} expenses={yearExpenses} />
    </div>
  );
}
