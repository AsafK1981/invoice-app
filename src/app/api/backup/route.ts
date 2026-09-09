import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { downloadSignedDocument } from "@/lib/signing/store";
import { docStrings } from "@/lib/document-strings";
import { UNIFORM_SOFTWARE } from "@/lib/uniform-structure/software";

// הוראות ניהול ספרים סעיף 25(ו): the quarterly backup of the computerized
// documents and the computerized bookkeeping system, kept at a place in
// Israel other than where the books are kept. Our own backups are ours; this
// is the one the TAXPAYER makes and keeps. One ZIP:
//
//   data.json                 every row the business owns (business, clients,
//                             products, documents + items, expenses, audit log,
//                             signature records), the way /api/export-data
//                             returns it
//   signed/<type>-<n>.pdf     the signed originals on record (the מסמכים
//                             ממוחשבים themselves)
//   README.txt                what this is, and what 25(ו) asks of the owner
//
// The download is recorded in audit_log (business.backup_exported) so the
// quarterly reminder cron knows whether this quarter is covered.
//
// Streamed: a business with many signed PDFs produces a ZIP well past the
// size a buffered serverless response may return, and JSZip can emit the
// archive incrementally while the PDFs are still being fetched.

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function quarterOf(d: Date): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7);
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rl = checkRate({ key: `backup:${user.id}:${clientIp(req)}`, max: 2, windowMs: 10 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "המתן 10 דקות בין גיבויים." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
    );
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: bizRows } = await sb.from("businesses").select("*").eq("user_id", user.id).limit(1);
  const business = bizRows?.[0];
  if (!business) return NextResponse.json({ ok: false, error: "אין עסק פעיל" }, { status: 400 });
  const businessId = business.id as string;

  const [clients, products, documents, expenses, auditLog, signatures] = await Promise.all([
    sb.from("clients").select("*").eq("business_id", businessId),
    sb.from("products").select("*").eq("business_id", businessId),
    sb.from("documents").select("*").eq("business_id", businessId).order("date", { ascending: true }),
    sb.from("expenses").select("*").eq("business_id", businessId),
    sb.from("audit_log").select("*").eq("business_id", businessId).order("created_at", { ascending: true }),
    sb
      .from("document_signatures")
      .select("id, document_id, storage_path, sha256, file_size, signed_at, algorithm, cert_fingerprint, is_original")
      .eq("business_id", businessId),
  ]);
  const docRows = (documents.data ?? []) as Array<Record<string, unknown>>;
  const docIds = docRows.map((d) => d.id as string);
  const items = docIds.length > 0 ? await sb.from("document_items").select("*").in("document_id", docIds) : { data: [] };

  const exportedAt = new Date();
  const zip = new JSZip();
  zip.file(
    "data.json",
    JSON.stringify(
      {
        software: { name: UNIFORM_SOFTWARE.name, version: UNIFORM_SOFTWARE.version },
        exported_at: exportedAt.toISOString(),
        quarter: quarterOf(exportedAt),
        account: { id: user.id, email: user.email ?? null },
        business,
        clients: clients.data ?? [],
        products: products.data ?? [],
        documents: docRows,
        document_items: items.data ?? [],
        expenses: expenses.data ?? [],
        audit_log: auditLog.data ?? [],
        document_signatures: signatures.data ?? [],
      },
      null,
      2,
    ),
  );

  // Signed originals: each PDF is fetched lazily as the archive streams.
  const byDocId = new Map(docRows.map((d) => [d.id as string, d]));
  const sigRows = (signatures.data ?? []) as Array<Record<string, unknown>>;
  const manifest: string[] = [];
  for (const sig of sigRows) {
    const doc = byDocId.get(sig.document_id as string);
    if (!doc) continue;
    const labels = docStrings((doc.language as string) || "he").documentTypes as Record<string, string>;
    const label = labels[doc.type as string] || (doc.type as string);
    const name = `signed/${label}-${doc.number}.pdf`.replace(/[\\/:*?"<>|]/g, (ch) => (ch === "/" ? "/" : "-"));
    zip.file(
      name,
      downloadSignedDocument(sb, sig.storage_path as string).catch((err) => {
        console.error("[backup] signed file missing", { documentId: sig.document_id, err });
        return Buffer.from(`missing: ${sig.storage_path}\n`);
      }),
    );
    manifest.push(`${name}\t${sig.sha256}\t${sig.signed_at}`);
  }

  const readme = [
    `גיבוי רבעוני - ${UNIFORM_SOFTWARE.name} ${UNIFORM_SOFTWARE.version}`,
    `עסק: ${business.name} (${business.tax_id})`,
    `הופק: ${exportedAt.toISOString()}   רבעון: ${quarterOf(exportedAt)}`,
    ``,
    `הוראות מס הכנסה (ניהול פנקסי חשבונות), סעיף 25(ו):`,
    `בשבוע הראשון של כל רבעון יש לערוך גיבוי למסמכים הממוחשבים ולמערכת החשבונות,`,
    `ולשמור אותו במקום בישראל שאינו המקום שבו מוחזקת מערכת החשבונות, מקום שעליו`,
    `הודעת בכתב לפקיד השומה. שמור את הקובץ הזה במקום כזה (דיסק חיצוני, כונן ענן`,
    `ישראלי, מחשב במשרד רואה החשבון) ואל תמחק גיבויים ישנים: שבע שנים (סעיף 25(א)).`,
    ``,
    `תוכן:`,
    `  data.json     כל הרשומות של העסק: פרטי העסק, ${(clients.data ?? []).length} לקוחות,`,
    `                ${(products.data ?? []).length} מוצרים, ${docRows.length} מסמכים ו-${(items.data ?? []).length} שורות,`,
    `                ${(expenses.data ?? []).length} הוצאות, ${(auditLog.data ?? []).length} רשומות יומן, ${sigRows.length} רשומות חתימה`,
    `  signed/       ${sigRows.length} קבצי PDF חתומים בחתימה אלקטרונית מאובטחת (המסמכים הממוחשבים עצמם)`,
    `  signed/MANIFEST.tsv   שם קובץ, SHA-256, זמן חתימה - לכל קובץ חתום`,
    ``,
    `אימות קובץ חתום: https://friendlyinvoice.co.il/verify/<מזהה המסמך>`,
    `קבצי "מבנה אחיד" (OPENFORMAT) מופקים בנפרד ממסך הדוחות.`,
  ].join("\n");
  zip.file("README.txt", "﻿" + readme);
  if (manifest.length > 0) zip.file("signed/MANIFEST.tsv", "﻿" + ["file\tsha256\tsigned_at", ...manifest].join("\n"));

  // Recorded before streaming so a client that disconnects mid-download
  // still counts as having asked for the backup this quarter (and the
  // reminder cron can see the attempt).
  await sb.from("audit_log").insert({
    business_id: businessId,
    action: "business.backup_exported",
    target_type: "business",
    target_id: businessId,
    target_label: business.name,
    payload: {
      quarter: quarterOf(exportedAt),
      documents: docRows.length,
      signed_files: sigRows.length,
    },
  });

  const nodeStream = zip.generateNodeStream({
    type: "nodebuffer",
    streamFiles: true,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const safeName = String(business.name || "business").replace(/[\\/:*?"<>|]/g, "-");
  const filename = `backup-${safeName}-${exportedAt.toISOString().slice(0, 10)}.zip`;
  return new NextResponse(Readable.toWeb(nodeStream as unknown as Readable) as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="backup-${exportedAt.toISOString().slice(0, 10)}.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
