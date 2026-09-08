"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { DocumentSignature } from "./types";

// Owner-side, read-only view of a document's signature record. The row is
// written by the server when the first PDF is signed
// (src/lib/signing/sign-document.ts); the owner can only SELECT it (RLS).

function mapRow(row: Record<string, unknown>): DocumentSignature {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    signedAt: row.signed_at as string,
    sha256: row.sha256 as string,
    certFingerprint: row.cert_fingerprint as string,
    algorithm: row.algorithm as string,
    isOriginal: Boolean(row.is_original),
  };
}

export function useDocumentSignature(documentId: string | undefined) {
  const [signature, setSignature] = useState<DocumentSignature | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("document_signatures")
        .select("id, document_id, signed_at, sha256, cert_fingerprint, algorithm, is_original")
        .eq("document_id", documentId)
        .maybeSingle();
      if (cancelled) return;
      setSignature(data ? mapRow(data as Record<string, unknown>) : null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  return { signature, ready };
}
