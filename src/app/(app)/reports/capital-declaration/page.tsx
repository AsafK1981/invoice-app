"use client";

import { Landmark } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { StoreLoadError } from "@/components/store-load-error";
import { CapitalDeclarationReport } from "@/components/capital-declaration-report";
import { ReportPageHeader } from "@/components/report-page-header";

export default function CapitalDeclarationPage() {
  const { documents, ready: docsReady, error: docsError, retry: retryDocs } = useDocuments();
  const { items: expenses, ready: expReady, error: expError, retry: retryExp } = useExpenses();

  if (docsError || expError) return <StoreLoadError sources={[{ error: docsError, retry: retryDocs }, { error: expError, retry: retryExp }]} />;

  if (!docsReady || !expReady) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  return (
    <div className="space-y-6">
      <ReportPageHeader
        icon={Landmark}
        title="הכנה להצהרת הון"
        subtitle="טיוטה חלקית לצירוף לטופס ההצהרה או לשימוש רואה החשבון - החלק העסקי בלבד."
      />
      <CapitalDeclarationReport headless documents={documents} expenses={expenses} />
    </div>
  );
}
