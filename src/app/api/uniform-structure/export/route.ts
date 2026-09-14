import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { checkUniformExport } from "@/lib/uniform-structure/check";
import { uniformFolderPath } from "@/lib/uniform-structure/folder";
import { loadUniformPages } from "@/lib/uniform-structure/load-pages";
import { groupUniformItems, mapUniformBusiness, mapUniformClient, mapUniformDocument, mapUniformExpense } from "@/lib/uniform-structure/rows";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { normalizeBusinessNumber } from "@/lib/israeli-id";
import { generateSampleDataset } from "@/lib/uniform-structure/sample-data";
import { UNIFORM_SOFTWARE } from "@/lib/uniform-structure/software";
import type { Client, Expense, InvoiceDocument } from "@/lib/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
type ExportRow = Record<string, unknown> & { id: string };

/**
 * "מבנה אחיד" / OPENFORMAT 1.31 export. Bundles INI.txt + BKMVDATA.txt
 * (both in Windows-1255) into a single ZIP for download. Used by Tax
 * Authority auditors and by Asaf to feed the official simulator when
 * registering the software in מרשם תוכנות.
 *
 * Query params:
 *   year: 4-digit tax year (defaults to current year)
 *   preflight=true: JSON issues only (every issue carries a stable code)
 *   sample=true: synthetic 2000+ record dataset for the registry simulator
 *
 * Auth: Bearer token; resolves to user → business owned by that user.
 */
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

  const { searchParams } = new URL(req.url);
  const preflight = searchParams.get("preflight") === "true";
  const ip = clientIp(req);
  const rl = checkRate({ key: `uniform:${preflight ? "preflight" : "download"}:${user.id}:${ip}`, max: preflight ? 12 : 3, windowMs: 5 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "המתן 5 דקות בין הורדות." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
    );
  }

  const yearStr = searchParams.get("year");
  const taxYear = yearStr && /^\d{4}$/.test(yearStr)
    ? parseInt(yearStr, 10)
    : new Date().getFullYear();
  if (yearStr && (!/^\d{4}$/.test(yearStr) || taxYear < 1900)) return NextResponse.json({ ok: false, error: "שנת מס לא תקינה" }, { status: 400 });
  try {
  const fromDate = `${taxYear}-01-01`;
  const toDate = `${taxYear}-12-31`;
  // sample=true → synthesize 2000+ records for the Tax Authority's
  // software-registry simulator (which rejects files <2000 records).
  const useSampleData = searchParams.get("sample") === "true";

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: bizRows, error: bizError } = await sb
    .from("businesses")
    .select("*")
    .eq("user_id", user.id)
    .limit(1);
  if (bizError) throw new Error("Business lookup failed");
  const bizRow = bizRows?.[0];
  if (!bizRow) {
    return NextResponse.json({ ok: false, error: "אין עסק פעיל" }, { status: 400 });
  }

  const business = mapUniformBusiness(bizRow);

  let clients: Client[];
  let documents: InvoiceDocument[];
  let expenses: Expense[];

  if (useSampleData) {
    const sample = generateSampleDataset({ business, taxYear });
    clients = sample.clients;
    documents = sample.documents;
    expenses = sample.expenses;
  } else {
    const [clientRows, docRows, expenseRows] = await Promise.all([
      loadUniformPages<ExportRow>((from, to) => sb.from("clients").select("*", { count: "exact" }).eq("business_id", business.id).order("id").range(from, to)),
      loadUniformPages<ExportRow>((from, to) => sb.from("documents").select("*", { count: "exact" }).eq("business_id", business.id).order("id").range(from, to)),
      loadUniformPages<ExportRow>((from, to) => sb.from("expenses").select("*", { count: "exact" }).eq("business_id", business.id).order("id").range(from, to)),
    ]);
    const docIds = docRows.map(d => d.id);
    const itemRows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < docIds.length; offset += 100) {
      const ownedIds = docIds.slice(offset, offset + 100);
      itemRows.push(...await loadUniformPages<ExportRow>((from, to) => sb.from("document_items").select("*", { count: "exact" }).in("document_id", ownedIds).order("id").range(from, to)));
    }
    const itemsByDoc = groupUniformItems(itemRows);
    clients = clientRows.map(mapUniformClient);
    documents = docRows.map((row) => mapUniformDocument(row, itemsByDoc.get(row.id) ?? []));
    expenses = expenseRows.map(mapUniformExpense);
  }

  // The printed 5.4 report quotes the software identity too, so it travels
  // in the header rather than being retyped on the client.
  const software = {
    name: UNIFORM_SOFTWARE.name,
    version: UNIFORM_SOFTWARE.version,
    registrationNumber: UNIFORM_SOFTWARE.registrationNumber,
  };
  const { issues, result, ok } = checkUniformExport(
    { business, documents, clients, expenses, taxYear, fromDate, toDate },
    { sample: useSampleData, registrationNumber: software.registrationNumber },
  );
  if (preflight || !ok || !result) return NextResponse.json({ ok, issues, counts: result?.counts, error: ok ? undefined : "יש לתקן את השגיאות לפני הורדת הקובץ." }, { status: preflight ? 200 : 422 });

  // Section 2.2 of the spec fixes the folder the files live in:
  //   OPENFRMT\<dealer number without check digit>.<YY>\<MMDDhhmm>
  // so the ZIP mirrors it. Unzipping gives the auditor the exact tree the
  // desktop products produce, and the printed 5.4 report names the same path.
  const dealerVat = normalizeBusinessNumber(business.taxId).value ?? business.taxId;
  const openfrmtPath = uniformFolderPath(business.taxId, result.generatedAt);
  const zip = new JSZip();
  zip.file(`${openfrmtPath}/INI.TXT`, result.ini);
  zip.file(`${openfrmtPath}/BKMVDATA.TXT`, result.bkmvdata);
  const blob = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  // Everything the on-screen "דוח הפקה" (sections 2.6 + 5.4) needs, as one
  // ASCII-only header - labels are added client-side, header values cannot
  // carry Hebrew.
  const report = {
    generatedAt: result.generatedAt.toISOString(),
    path: openfrmtPath,
    fromDate,
    toDate,
    taxYear,
    sample: useSampleData,
    software,
    counts: result.counts,
    docTypes: result.docTypeSummary.map((r) => [r.code, r.count, r.total]),
  };

  const filename = `OPENFRMT-${dealerVat}-${taxYear}${useSampleData ? "-SAMPLE" : ""}.zip`;
  return new NextResponse(blob as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Record-Count": String(result.counts.total),
      "X-Doc-Count": String(result.counts.c100),
      "X-Uniform-Report": JSON.stringify(report),
    },
  });
  } catch {
    return NextResponse.json({ ok: false, error: "טעינת נתוני הדוח או בדיקת הקובץ נכשלה. לא הופק קובץ חלקי. נסה שוב.", issues: [{ code: "data_load_failed", level: "error", message: "לא ניתן לוודא שכל נתוני הדוח נטענו. נסה שוב לפני הורדה." }] }, { status: 503 });
  }
}
