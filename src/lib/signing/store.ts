// The signature record and the signed file: one row in document_signatures
// and one object in the private `signed-documents` bucket per document.
// Service-role only (see scripts/migrations/20260910-document-signatures.sql).

import type { SupabaseClient } from "@supabase/supabase-js";

export const SIGNED_BUCKET = "signed-documents";

export interface SignatureRecord {
  id: string;
  documentId: string;
  businessId: string;
  storagePath: string;
  sha256: string;
  fileSize: number;
  signedAt: string;
  algorithm: string;
  certFingerprint: string;
  isOriginal: boolean;
}

const COLUMNS =
  "id, document_id, business_id, storage_path, sha256, file_size, signed_at, algorithm, cert_fingerprint, is_original";

function mapRow(row: Record<string, unknown>): SignatureRecord {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    businessId: row.business_id as string,
    storagePath: row.storage_path as string,
    sha256: row.sha256 as string,
    fileSize: Number(row.file_size) || 0,
    signedAt: row.signed_at as string,
    algorithm: row.algorithm as string,
    certFingerprint: row.cert_fingerprint as string,
    isOriginal: Boolean(row.is_original),
  };
}

export function signedObjectPath(businessId: string, documentId: string): string {
  return `${businessId}/${documentId}.pdf`;
}

export async function getSignatureRecord(
  admin: SupabaseClient,
  documentId: string,
): Promise<SignatureRecord | null> {
  const res = await admin
    .from("document_signatures")
    .select(COLUMNS)
    .eq("document_id", documentId)
    .maybeSingle();
  if (res.error) throw new Error(`signature record read failed: ${res.error.message}`);
  return res.data ? mapRow(res.data as Record<string, unknown>) : null;
}

/**
 * Uploads the signed bytes and records them. The UNIQUE(document_id) makes a
 * second recording of the same document fail; the caller treats that as
 * "already recorded" and reads the existing row (two downloads racing on the
 * first emission both end up with the one file the winner stored).
 */
export async function storeSignedDocument(
  admin: SupabaseClient,
  args: {
    documentId: string;
    businessId: string;
    bytes: Buffer;
    sha256: string;
    signedAt: Date;
    algorithm: string;
    certFingerprint: string;
    isOriginal: boolean;
  },
): Promise<SignatureRecord> {
  const path = signedObjectPath(args.businessId, args.documentId);
  const up = await admin.storage.from(SIGNED_BUCKET).upload(path, args.bytes, {
    contentType: "application/pdf",
    // Never overwrite: the first signed file is the one on record.
    upsert: false,
  });
  if (up.error) {
    const existing = await getSignatureRecord(admin, args.documentId);
    if (existing) return existing;
    throw new Error(`signed file upload failed: ${up.error.message}`);
  }
  const ins = await admin
    .from("document_signatures")
    .insert({
      document_id: args.documentId,
      business_id: args.businessId,
      storage_path: path,
      sha256: args.sha256,
      file_size: args.bytes.length,
      signed_at: args.signedAt.toISOString(),
      algorithm: args.algorithm,
      cert_fingerprint: args.certFingerprint,
      is_original: args.isOriginal,
    })
    .select(COLUMNS)
    .maybeSingle();
  if (!ins.error && ins.data) return mapRow(ins.data as Record<string, unknown>);
  const existing = await getSignatureRecord(admin, args.documentId);
  if (existing) return existing;
  throw new Error(`signature record insert failed: ${ins.error?.message ?? "unknown"}`);
}

export async function downloadSignedDocument(
  admin: SupabaseClient,
  storagePath: string,
): Promise<Buffer> {
  const dl = await admin.storage.from(SIGNED_BUCKET).download(storagePath);
  if (dl.error || !dl.data) throw new Error(`signed file download failed: ${dl.error?.message ?? "no data"}`);
  return Buffer.from(await dl.data.arrayBuffer());
}

/** Storage paths of every signed file a business owns, for the wipe routes. */
export async function listSignedPaths(admin: SupabaseClient, businessIds: string[]): Promise<string[]> {
  if (businessIds.length === 0) return [];
  const res = await admin
    .from("document_signatures")
    .select("storage_path")
    .in("business_id", businessIds);
  return (res.data || []).map((r) => r.storage_path as string).filter(Boolean);
}
