"use client";

import { Clock } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { AgingReport } from "@/components/aging-report";
import { ReportPageHeader } from "@/components/report-page-header";

export default function AgingPage() {
  const { documents, ready } = useDocuments();

  if (!ready) {
    return <div className="text-center py-16 text-stone-500">טוען...</div>;
  }

  return (
    <div className="space-y-6">
      <ReportPageHeader
        icon={Clock}
        title="חובות פתוחים"
        subtitle="מי חייב, כמה, ומכמה זמן - כל מסמך שנשלח ועדיין לא שולם, לפי ותק החוב (גיול חובות)."
      />
      <AgingReport documents={documents} headless />
    </div>
  );
}
