import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { validateUniformInput, validateUniformOutput } from "@/lib/uniform-structure/preflight";
import { loadUniformPages } from "@/lib/uniform-structure/load-pages";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { buildUniformStructure } from "@/lib/uniform-structure/builder";
import { generateSampleDataset } from "@/lib/uniform-structure/sample-data";
import { UNIFORM_SOFTWARE } from "@/lib/uniform-structure/software";
import type { Business, Client, DocumentItem, Expense, InvoiceDocument } from "@/lib/types";

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
 *
 * Auth: Bearer token; resolves to user → business owned by that user.
 */
/** `OPENFRMT/<8-digit dealer number>.<YY>/<MMDDhhmm>`, per section 2.2. */
function uniformFolderPath(taxId: string, at: Date): string {
  const dealer = taxId.replace(/\D/g, "").slice(0, 8).padStart(8, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = String(at.getFullYear()).slice(-2);
  const stamp = `${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `OPENFRMT/${dealer}.${yy}/${stamp}`;
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

  const business: Business = {
    id: bizRow.id,
    name: bizRow.name,
    businessType: bizRow.business_type,
    taxId: bizRow.tax_id,
    address: bizRow.address,
    phone: bizRow.phone ?? undefined,
    email: bizRow.email ?? undefined,
  };

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
    const docsRes = { data: docRows }, clientsRes = { data: clientRows }, expensesRes = { data: expenseRows };
    const docIds = docRows.map(d => d.id);
    const itemRows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < docIds.length; offset += 100) {
      const ownedIds = docIds.slice(offset, offset + 100);
      itemRows.push(...await loadUniformPages<ExportRow>((from, to) => sb.from("document_items").select("*", { count: "exact" }).in("document_id", ownedIds).order("id").range(from, to)));
    }
    itemRows.sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    const itemsRes = { data: itemRows };
    const numeric = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;

    const itemsByDoc = new Map<string, DocumentItem[]>();
    for (const row of itemsRes.data ?? []) {
      const did = row.document_id as string;
      if (!itemsByDoc.has(did)) itemsByDoc.set(did, []);
      itemsByDoc.get(did)!.push({
        id: row.id as string,
        productId: (row.product_id as string) || undefined,
        description: row.description as string,
        quantity: numeric(row.quantity),
        unitPrice: numeric(row.unit_price),
        total: numeric(row.total),
      });
    }

    clients = (clientsRes.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      taxId: (row.tax_id as string) || undefined,
      address: (row.address as string) || undefined,
      phone: (row.phone as string) || undefined,
      email: (row.email as string) || undefined,
      createdAt: (row.created_at as string)?.slice(0, 10) || "",
    }));

    documents = (docsRes.data ?? []).map((row) => ({
      id: row.id as string,
      type: row.type as InvoiceDocument["type"],
      number: numeric(row.number),
      date: (row.date as string) || "",
      clientId: (row.client_id as string) || "",
      clientName: (row.client_name as string) || "",
      subject: (row.subject as string) || undefined,
      status: (row.status as InvoiceDocument["status"]) || "draft",
      items: itemsByDoc.get(row.id as string) ?? [],
      subtotal: numeric(row.subtotal),
      vat: numeric(row.vat),
      total: numeric(row.total),
      // Preserve stored ILS snapshots for validation; unsupported FX exports are blocked.
      currency: (row.currency as string) || undefined,
      subtotalIls: row.subtotal_ils == null ? undefined : Number(row.subtotal_ils),
      vatIls: row.vat_ils == null ? undefined : Number(row.vat_ils),
      totalIls: row.total_ils == null ? undefined : Number(row.total_ils),
      rounding: row.rounding == null ? 0 : numeric(row.rounding),
      discountAmount: row.discount_amount == null ? undefined : numeric(row.discount_amount),
      withholdingAmount: row.withholding_amount == null ? undefined : numeric(row.withholding_amount),
      convertedToId: (row.converted_to_id as string) || undefined,
      paymentDetails: row.payment_details as InvoiceDocument["paymentDetails"],
      paymentMethod: (row.payment_method as InvoiceDocument["paymentMethod"]) || undefined,
      notes: (row.notes as string) || undefined,
      allocationNumber: (row.allocation_number as string) || undefined,
    }));

    expenses = (expensesRes.data ?? []).map((row) => ({
      id: row.id as string,
      date: row.date as string,
      category: row.category as string,
      supplier: row.supplier as string,
      amount: numeric(row.amount),
      description: (row.description as string) || undefined,
      vatAmount: row.vat_amount != null ? Number(row.vat_amount) : 0,
    }));
  }

  // The printed 5.4 report quotes the software identity too, so it travels
  // in the header rather than being retyped on the client.
  const software = {
    name: UNIFORM_SOFTWARE.name,
    version: UNIFORM_SOFTWARE.version,
    registrationNumber: UNIFORM_SOFTWARE.registrationNumber,
  };
  const input = {
    business,
    documents,
    clients,
    expenses,
    taxYear,
    fromDate,
    toDate,
  };
  const issues = validateUniformInput(input);
  if (!useSampleData && !software.registrationNumber) issues.push({ level: "warning", message: "מספר תעודת רישום התוכנה טרם הוזן. הבדיקה המקומית אינה אישור רישום או אישור קבלה מרשות המסים." });
  if (issues.some(issue => issue.level === "error")) return NextResponse.json({ ok: false, issues, error: "יש לתקן את השגיאות לפני הורדת הקובץ." }, { status: preflight ? 200 : 422 });
  const result = buildUniformStructure(input);
  issues.push(...validateUniformOutput(result, useSampleData));
  const ok = !issues.some(issue => issue.level === "error");
  if (preflight || !ok) return NextResponse.json({ ok, issues, counts: result.counts, error: ok ? undefined : "יש לתקן את השגיאות לפני הורדת הקובץ." }, { status: preflight ? 200 : 422 });

  // Section 2.2 of the spec fixes the folder the files live in:
  //   OPENFRMT\<dealer number without check digit>.<YY>\<MMDDhhmm>
  // so the ZIP mirrors it. Unzipping gives the auditor the exact tree the
  // desktop products produce, and the printed 5.4 report names the same path.
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

  const filename = `OPENFRMT-${business.taxId}-${taxYear}${useSampleData ? "-SAMPLE" : ""}.zip`;
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
    return NextResponse.json({ ok: false, error: "טעינת נתוני הדוח או בדיקת הקובץ נכשלה. לא הופק קובץ חלקי. נסה שוב.", issues: [{ level: "error", message: "לא ניתן לוודא שכל נתוני הדוח נטענו. נסה שוב לפני הורדה." }] }, { status: 503 });
  }
}
