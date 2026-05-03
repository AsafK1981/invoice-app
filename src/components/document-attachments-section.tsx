"use client";

import { useRef, useState } from "react";
import { Paperclip, Upload, Download, Trash2, FileText, Image as ImageIcon, AlertCircle } from "lucide-react";
import {
  useAttachments,
  uploadAttachment,
  deleteAttachment,
  getDownloadUrl,
  formatFileSize,
} from "@/lib/attachment-store";
import type { DocumentAttachment } from "@/lib/types";

interface Props {
  documentId: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function DocumentAttachmentsSection({ documentId }: Props) {
  const { attachments, ready, refetch } = useAttachments(documentId);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      setError("הקובץ גדול מדי (מקסימום 10MB)");
      e.target.value = "";
      return;
    }

    setError(null);
    setUploading(true);
    try {
      await uploadAttachment(documentId, file);
      await refetch();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בהעלאה");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(att: DocumentAttachment) {
    try {
      const url = await getDownloadUrl(att.filePath);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בהורדה");
    }
  }

  async function handleDelete(att: DocumentAttachment) {
    if (!confirm(`למחוק את "${att.filename}"?`)) return;
    try {
      await deleteAttachment(att);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה במחיקה");
    }
  }

  return (
    <div className="no-print card-soft p-5 max-w-[210mm] mx-auto">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold text-stone-900 flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-orange-500" />
          קבצים מצורפים
          {ready && attachments.length > 0 && (
            <span className="text-xs text-stone-500 font-normal">({attachments.length})</span>
          )}
        </h3>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFile}
          className="hidden"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-sm font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "מעלה..." : "צרף קובץ"}
        </button>
      </div>

      <p className="text-xs text-stone-600 mb-3">
        חוזה חתום, צילום תשלום, או כל קובץ עזר אחר. מקסימום 10MB לקובץ. הקבצים פרטיים — רק אתה רואה אותם.
      </p>

      {error && (
        <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl mb-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {ready && attachments.length === 0 && !uploading && (
        <p className="text-sm text-stone-500 italic py-2">לא צורפו קבצים עדיין.</p>
      )}

      {attachments.length > 0 && (
        <ul className="space-y-2">
          {attachments.map((att) => {
            const isImage = att.contentType?.startsWith("image/");
            const Icon = isImage ? ImageIcon : FileText;
            return (
              <li
                key={att.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-orange-50/40 border border-orange-100"
              >
                <div className="w-9 h-9 rounded-xl bg-white border border-orange-200 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-900 truncate">{att.filename}</p>
                  <p className="text-xs text-stone-600">{formatFileSize(att.fileSize)}</p>
                </div>
                <button
                  onClick={() => handleDownload(att)}
                  className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-lg text-stone-600 hover:text-orange-700 hover:bg-orange-50"
                  title="הורד"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(att)}
                  className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                  title="מחק"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
