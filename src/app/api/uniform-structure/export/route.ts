import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { buildUniformStructure } from "@/lib/uniform-structure/builder";
import { generateSampleDataset } from "@/lib/uniform-structure/sample-data";
import type { Business, Client, DocumentItem, Expense, InvoiceDocument } from "@/lib/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

  const ip = clientIp(req);
  const rl = checkRate({ key: `uniform:${user.id}:${ip}`, max: 3, windowMs: 5 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "המתן 5 דקות בין הורדות." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
    );
  }

  const { searchParams } = new URL(req.url);
  const yearStr = searchParams.get("year");
  const taxYear = yearStr && /^\d{4}$/.test(yearStr)
    ? parseInt(yearStr, 10)
    : new Date().getFullYear();
  const fromDate = `${taxYear}-01-01`;
  const toDate = `${taxYear}-12-31`;
  // sample=true → synthesize 2000+ records for the Tax Authority's
  // software-registry simulator (which rejects files <2000 records).
  const useSampleData = searchParams.get("sample") === "true";

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: bizRows } = await sb
    .from("businesses")
    .select("*")
    .eq("user_id", user.id)
    .limit(1);
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
    const [clientsRes, docsRes, expensesRes] = await Promise.all([
      sb.from("clients").select("*").eq("business_id", business.id),
      sb.from("documents")
        .select("*")
        .eq("business_id", business.id)
        .gte("date", fromDate)
        .lte("date", toDate),
      sb.from("expenses")
        .select("*")
        .eq("business_id", business.id)
        .gte("date", fromDate)
        .lte("date", toDate),
    ]);

    const docIds = (docsRes.data ?? []).map((d) => d.id);
    const itemsRes = docIds.length > 0
      ? await sb.from("document_items").select("*").in("document_id", docIds).order("sort_order")
      : { data: [] as Record<string, unknown>[] };

    const itemsByDoc = new Map<string, DocumentItem[]>();
    for (const row of itemsRes.data ?? []) {
      const did = row.document_id as string;
      if (!itemsByDoc.has(did)) itemsByDoc.set(did, []);
      itemsByDoc.get(did)!.push({
        id: row.id as string,
        productId: (row.product_id as string) || undefined,
        description: row.description as string,
        quantity: Number(row.quantity) || 0,
        unitPrice: Number(row.unit_price) || 0,
        total: Number(row.total) || 0,
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
      number: Number(row.number),
      date: (row.date as string) || "",
      clientId: (row.client_id as string) || "",
      clientName: (row.client_name as string) || "",
      subject: (row.subject as string) || undefined,
      status: (row.status as InvoiceDocument["status"]) || "draft",
      items: itemsByDoc.get(row.id as string) ?? [],
      subtotal: Number(row.subtotal) || 0,
      vat: Number(row.vat) || 0,
      total: Number(row.total) || 0,
      // The builder reports every amount in shekels (`totalIls ?? total`), so
      // these have to be carried through or the fallback silently files a
      // foreign-currency invoice at its face value - $100 filed as 100 ₪.
      // Null on ILS documents, which is exactly when the fallback is right.
      currency: (row.currency as string) || undefined,
      subtotalIls: row.subtotal_ils == null ? undefined : Number(row.subtotal_ils),
      vatIls: row.vat_ils == null ? undefined : Number(row.vat_ils),
      totalIls: row.total_ils == null ? undefined : Number(row.total_ils),
      paymentMethod: (row.payment_method as InvoiceDocument["paymentMethod"]) || undefined,
      notes: (row.notes as string) || undefined,
      allocationNumber: (row.allocation_number as string) || undefined,
    }));

    expenses = (expensesRes.data ?? []).map((row) => ({
      id: row.id as string,
      date: row.date as string,
      category: row.category as string,
      supplier: row.supplier as string,
      amount: Number(row.amount) || 0,
      description: (row.description as string) || undefined,
      vatAmount: row.vat_amount != null ? Number(row.vat_amount) : 0,
    }));
  }

  const result = buildUniformStructure({
    business,
    documents,
    clients,
    expenses,
    taxYear,
    fromDate,
    toDate,
    // Registered name at רשות המסים - not the display brand. See builder.ts.
    softwareName: "MySuperFriendlyInvoiceApp",
    softwareVersion: "1.0",
    softwareVendorName: "Asaf Kotler",
    softwareVendorTaxId: "049040686",
    softwareRegistrationNumber: "", // assigned after misim.gov.il approval
  });

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
}
