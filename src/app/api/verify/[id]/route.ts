import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { getSignatureRecord, downloadSignedDocument } from "@/lib/signing/store";
import { verifySignedPdf } from "@/lib/signing/verify-pdf";

// Public verification of a signed document.
//
//   GET  /api/verify/<document id>   what the books recorded for this document
//                                    (signing time, certificate fingerprint,
//                                    SHA-256) and whether the stored file still
//                                    verifies.
//   POST /api/verify/<document id>   multipart "file": a PDF the customer holds;
//                                    verifies its signature and says whether it
//                                    is byte-for-byte the recorded original, a
//                                    later copy signed by the same business, or
//                                    neither.
//
// Exposes nothing the /view page does not already expose by UUID (type,
// number, date, business name); no line items, no amounts, no customer.

export const runtime = "nodejs";
export const maxDuration = 30;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_UPLOAD = 10 * 1024 * 1024;

function admin() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function limited(req: Request, max: number) {
  const rl = checkRate({ key: `verify:${clientIp(req)}`, max, windowMs: 60_000 });
  if (rl.ok) return null;
  return NextResponse.json(
    { ok: false, error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
  );
}

async function loadContext(id: string) {
  const db = admin();
  const docRes = await db
    .from("documents")
    .select("id, business_id, type, number, date, language, status")
    .eq("id", id)
    .maybeSingle();
  if (!docRes.data) return null;
  const doc = docRes.data as {
    id: string;
    business_id: string;
    type: string;
    number: number;
    date: string;
    language: string | null;
    status: string;
  };
  const bizRes = await db.from("businesses").select("name").eq("id", doc.business_id).maybeSingle();
  const record = await getSignatureRecord(db, id);
  return {
    db,
    document: {
      id: doc.id,
      type: doc.type,
      number: doc.number,
      date: doc.date,
      language: doc.language || "he",
      businessName: (bizRes.data as { name: string } | null)?.name ?? "",
    },
    record,
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rl = limited(req, 30);
  if (rl) return rl;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  const ctx = await loadContext(id);
  if (!ctx) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  if (!ctx.record) {
    return NextResponse.json({ ok: true, document: ctx.document, signature: null, stored: null });
  }

  // Re-verify the stored file every time: the record says what was signed,
  // the file proves it still is.
  let stored: { valid: boolean; reason: string | null; sha256Matches: boolean } | null = null;
  try {
    const bytes = await downloadSignedDocument(ctx.db, ctx.record.storagePath);
    const v = verifySignedPdf(bytes);
    stored = {
      valid: v.valid && v.certFingerprint === ctx.record.certFingerprint,
      reason: v.reason,
      sha256Matches: v.fileSha256 === ctx.record.sha256,
    };
  } catch (err) {
    console.error("[verify] stored file check failed", { id, err });
    stored = { valid: false, reason: "unavailable", sha256Matches: false };
  }

  return NextResponse.json({
    ok: true,
    document: ctx.document,
    signature: {
      signedAt: ctx.record.signedAt,
      sha256: ctx.record.sha256,
      certFingerprint: ctx.record.certFingerprint,
      algorithm: ctx.record.algorithm,
      isOriginal: ctx.record.isOriginal,
      fileSize: ctx.record.fileSize,
    },
    stored,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rl = limited(req, 10);
  if (rl) return rl;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  const ctx = await loadContext(id);
  if (!ctx) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    // fall through: no file
  }
  if (!file) return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });
  if (file.size > MAX_UPLOAD) return NextResponse.json({ ok: false, error: "File too large" }, { status: 413 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const v = verifySignedPdf(bytes);
  const record = ctx.record;
  const sameCertificate = Boolean(record && v.certFingerprint && v.certFingerprint === record.certFingerprint);
  const isRecordedOriginal = Boolean(record && v.fileSha256 === record.sha256);

  return NextResponse.json({
    ok: true,
    document: ctx.document,
    upload: {
      signatureValid: v.valid,
      reason: v.reason,
      signerName: v.signerName,
      signedAt: v.signedAt ? v.signedAt.toISOString() : null,
      certFingerprint: v.certFingerprint,
      sha256: v.fileSha256,
      // The one verdict the customer wants: signed by this business AND untouched.
      authentic: v.valid && sameCertificate,
      sameCertificate,
      isRecordedOriginal,
    },
    recorded: record
      ? { signedAt: record.signedAt, sha256: record.sha256, certFingerprint: record.certFingerprint }
      : null,
  });
}
