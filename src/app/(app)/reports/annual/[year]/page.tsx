"use client";

import { use, useMemo } from "react";
import { FileText } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { TaxYearDetail } from "@/components/tax-year-detail";
import { ReportPageHeader } from "@/components/report-page-header";
import { periodMatches } from "@/lib/report-period";
import { YearStepper } from "@/components/year-stepper";

export default function AnnualSummaryPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: yearStr } = use(params);
  const year = parseInt(yearStr, 10);
  const { documents, ready: docsReady } = useDocuments();
  const { items: expenses, ready: expReady } = useExpenses();

  const yearDocs = useMemo(() => documents.filter((d) => periodMatches(String(year), d.date)), [documents, year]);
  const yearExpenses = useMemo(() => expenses.filter((e) => periodMatches(String(year), e.date)), [expenses, year]);

  if (!Number.isFinite(year)) {
    return <div className="text-center py-16 text-stone-500">שנה לא תקינה</div>;
  }
  if (!docsReady || !expReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  return (
    <div className="space-y-6">
      <ReportPageHeader
        icon={FileText}
        title={`סיכום שנתי לדיווח · ${year}`}
        subtitle="כל המספרים לדוח השנתי במקום אחד: הכנסות לפי סוג מסמך, הוצאות לפי קטגוריה, הלקוחות הגדולים."
        actions={<YearStepper year={year} base="/reports/annual" />}
      />
      <TaxYearDetail headless
        year={year}
        documents={yearDocs}
        expenses={yearExpenses}
        allDocuments={documents}
        allExpenses={expenses}
      />
    </div>
  );
}
