"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { logAudit } from "./audit-log";
import { friendlyError } from "./error-message";
import type { DocumentAttachment } from "./types";

const BUCKET = "document-attachments";

function mapRow(row: Record<string, unknown>): DocumentAttachment {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    filePath: row.file_path as string,
    filename: row.filename as string,
    fileSize: Number(row.file_size) || 0,
    contentType: (row.content_type as string) || undefined,
    uploadedAt: row.uploaded_at as string,
  };
}

export function useAttachments(documentId: string) {
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    if (!documentId) return;
    const { data, error: err } = await supabase
      .from("document_attachments")
      .select("*")
      .eq("document_id", documentId)
      .order("uploaded_at", { ascending: false });
    if (err) {
      setError(friendlyError(err, "שגיאה בטעינת הקבצים"));
    } else {
      setAttachments((data || []).map(mapRow));
      setError(null);
    }
    setReady(true);
  }, [documentId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  return { attachments, ready, error, refetch: fetchList };
}

export async function uploadAttachment(
  documentId: string,
  file: File
): Promise<DocumentAttachment> {
  const safeName = file.name.replace(/[^\w.\-֐-׿]/g, "_");
  const filePath = `${documentId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
  if (uploadError) throw new Error("שגיאה בהעלאה: " + uploadError.message);

  const { data, error: insertError } = await supabase
    .from("document_attachments")
    .insert({
      document_id: documentId,
      file_path: filePath,
      filename: file.name,
      file_size: file.size,
      content_type: file.type || null,
    })
    .select()
    .single();

  if (insertError) {
    // Clean up the orphaned file if the metadata insert failed
    await supabase.storage.from(BUCKET).remove([filePath]);
    throw new Error("שגיאה בשמירת המטא-דאטה: " + insertError.message);
  }

  return mapRow(data);
}

export async function deleteAttachment(attachment: DocumentAttachment): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([attachment.filePath]);
  // We log but don't fail on storage error; the row removal is the canonical truth
  if (storageError) {
    console.warn("Storage delete failed:", storageError.message);
  }
  const { error: dbError } = await supabase
    .from("document_attachments")
    .delete()
    .eq("id", attachment.id);
  if (dbError) throw new Error("שגיאה במחיקה: " + dbError.message);

  logAudit({
    action: "attachment.deleted",
    targetType: "attachment",
    targetId: attachment.id,
    targetLabel: attachment.filename,
    payload: { documentId: attachment.documentId, fileSize: attachment.fileSize },
  });
}

export async function getDownloadUrl(filePath: string, expiresInSec = 60): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, expiresInSec);
  if (error || !data?.signedUrl) {
    throw new Error("לא ניתן ליצור קישור הורדה: " + (error?.message || "unknown"));
  }
  return data.signedUrl;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
