"use client";

import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { useDocuments } from "@/lib/document-store";
import { DocumentsTable } from "@/components/documents-table";

export default function DocumentsPage() {
  const { documents } = useDocuments();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center shadow-sm">
              <FileText className="w-5 h-5 text-white" />
            </span>
            מסמכים
          </h1>
          <p className="text-sm text-stone-700 mt-2 mr-14">{documents.length} מסמכים סה״כ</p>
        </div>
        <Link
          href="/documents/new"
          className="inline-flex items-center gap-2 bg-gradient-to-l from-orange-500 to-rose-500 text-white px-5 py-3 rounded-2xl text-sm font-semibold hover:shadow-lg hover:shadow-orange-200 transition-all"
        >
          <Plus className="w-4 h-4" />
          מסמך חדש
        </Link>
      </div>

      <div className="card-soft overflow-hidden">
        <DocumentsTable documents={documents} />
      </div>
    </div>
  );
}
