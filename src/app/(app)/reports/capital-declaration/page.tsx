"use client";

import { Landmark } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { useExpenses } from "@/lib/expense-store";
import { CapitalDeclarationReport } from "@/components/capital-declaration-report";
import { ReportPageHeader } from "@/components/report-page-header";

export default function CapitalDeclarationPage() {
  const { documents, ready: docsReady } = useDocuments();
  const { items: expenses, ready: expReady } = useExpenses();

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
