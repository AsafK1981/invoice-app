import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";
import { logAdminAccess } from "@/lib/admin-access-log";
import { checkRate } from "@/lib/rate-limit";
import { todayInIsrael } from "@/lib/date";
import { parseAmount } from "@/lib/import-mapping";
import { mapHeaders } from "@/lib/import-headers";
import { bumpDocumentCounters } from "@/lib/document-counters";
import { mapImportedClientRow } from "@/lib/import-clients";
import {
  mapDocumentRow,
  createSkipAccumulator,
  createUnmappedTypeCollector,
  type SkipSummaryEntry,
  type MapDocumentRowResult,
} from "@/lib/import-documents";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Admin "concierge" import. Lets the owner-admin import a friend's
 * CSV data (clients / products / expenses / documents) into the
 * friend's account, after the friend exported the file from their
 * previous tool (Invoice4U / Greeninvoice / iCount / etc.) and
 * shared it via WhatsApp.
 *
 * Without this endpoint there was no way for an admin to import
 * data into another user's account; the regular /api/* import
 * paths use Supabase client RLS scoped to the calling user.
 *
 * Every import writes an audit_log entry tagged `admin.import` so
 * the target user can see what was done on their behalf.
 *
 * Body:
 *   {
 *     targetUserId: string,
 *     entityType: "clients" | "products" | "expenses" | "documents",
 *     rows: Record<string, string>[]  // parsed CSV rows (client-side)
 *   }
 *
 * Returns: { ok, imported, skipped, errors[] }
 */

type ImportRow = Record<string, string>;
type EntityType = "clients" | "products" | "expenses" | "documents";
type ImportSummary = {
  imported: number;
  skipped: number;
  /** Per-reason labelled skip breakdown (documents import only). */
  skipSummary?: SkipSummaryEntry[];
  /** Rows whose document-type cell wasn't recognized; imported as receipt but flagged for review. */
  unmappedType?: number;
  unmappedTypeSamples?: string[];
  /** Clients whose תנאי תשלום text was present but not recognised (imported without terms). */
  termsUnrecognized?: number;
  errors: string[];
};

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const token = authHeader.slice(7);

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user: caller }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !caller || !isAdminEmail(caller.email)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const rl = checkRate({ key: `admin-import:${caller.id}`, max: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Slow down: 20 imports per minute max" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    targetUserId?: string;
    entityType?: EntityType;
    rows?: ImportRow[];
  };

  if (!body.targetUserId || !/^[0-9a-f-]{36}$/i.test(body.targetUserId)) {
    return NextResponse.json({ ok: false, error: "targetUserId required (UUID)" }, { status: 400 });
  }
  const validEntities: EntityType[] = ["clients", "products", "expenses", "documents"];
  if (!body.entityType || !validEntities.includes(body.entityType)) {
    return NextResponse.json({ ok: false, error: "entityType invalid" }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ ok: false, error: "rows must be a non-empty array" }, { status: 400 });
  }
  if (body.rows.length > 5000) {
    return NextResponse.json({ ok: false, error: "Max 5,000 rows per import" }, { status: 400 });
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Operator access journal. Logged here rather than immediately after the
  // admin check because this is the first point where targetUserId is known
  // to be a well-formed UUID, and a row naming the tenant is worth more than
  // a row two statements earlier that cannot.
  await logAdminAccess(sb, {
    actor: caller.email || caller.id,
    channel: "admin_api",
    action: "admin/import-for-user POST",
    targetUserId: body.targetUserId,
    detail: { entity_type: body.entityType, row_count: body.rows.length },
  });

  // Resolve target user → their primary business_id.
  const { data: businesses } = await sb
    .from("businesses")
    .select("id, name")
    .eq("user_id", body.targetUserId)
    .order("created_at", { ascending: true });

  const targetBusinessId = businesses?.[0]?.id;
  const targetBusinessName = businesses?.[0]?.name;
  if (!targetBusinessId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Target user has no business yet; they need to complete onboarding first",
      },
      { status: 400 },
    );
  }

  const importBatchId = crypto.randomUUID();
  let summary: ImportSummary = { imported: 0, skipped: 0, errors: [] };

  try {
    if (body.entityType === "clients") {
      summary = await importClients(sb, targetBusinessId, body.rows, importBatchId);
    } else if (body.entityType === "products") {
      summary = await importProducts(sb, targetBusinessId, body.rows, importBatchId);
    } else if (body.entityType === "expenses") {
      summary = await importExpenses(sb, targetBusinessId, body.rows, importBatchId);
    } else if (body.entityType === "documents") {
      summary = await importDocuments(sb, targetBusinessId, body.rows, importBatchId);
    }
  } catch (err) {
    console.error("admin import-for-user failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }

  // Audit log entry: transparent to the target user.
  await sb.from("audit_log").insert({
    business_id: targetBusinessId,
    action: "admin.import",
    target_type: body.entityType,
    target_label: `${summary.imported} שורות יובאו על ידי האדמין מקובץ CSV`,
    payload: {
      admin_email: caller.email,
      entity_type: body.entityType,
      imported: summary.imported,
      skipped: summary.skipped,
      error_count: summary.errors.length,
    },
  });

  return NextResponse.json({
    ok: true,
    targetBusinessName,
    targetBusinessId,
    ...summary,
  });
}

// --- per-entity importers ---

type SB = SupabaseClient;

function pick(row: ImportRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

async function importClients(sb: SB, businessId: string, rows: ImportRow[], importBatchId: string): Promise<ImportSummary> {
  const out: ImportSummary = { imported: 0, skipped: 0, errors: [] };
  // Fetch existing client names so we can dedupe by case-insensitive name.
  // The error is checked: `(existing || [])` turned a failed read into "this
  // business has no clients", and the whole file was then imported as new,
  // duplicating every client that was already there.
  const { data: existing, error: existingError } = await sb
    .from("clients")
    .select("name")
    .eq("business_id", businessId);
  if (existingError) {
    throw new Error(`לא הצלחנו לקרוא את הלקוחות הקיימים, והייבוא נעצר: ${existingError.message}`);
  }
  const seen = new Set((existing || []).map((c) => String(c.name).toLowerCase().trim()));

  const toInsert: Array<Record<string, string | null>> = [];
  let termsUnrecognized = 0;
  for (const row of rows) {
    // The same row mapping as the two in-app client importers, so the admin
    // console reads the same columns (תנאי תשלום included) the same way. The
    // id is a placeholder: this path lets the database assign it.
    const mapped = mapImportedClientRow(row, { id: "", createdAt: "" });
    if (!mapped) {
      out.skipped++;
      continue;
    }
    const { client } = mapped;
    const key = client.name.toLowerCase();
    if (seen.has(key)) {
      out.skipped++;
      continue;
    }
    seen.add(key);
    if (mapped.termsUnrecognized) termsUnrecognized++;
    toInsert.push({
      business_id: businessId,
      import_batch_id: importBatchId,
      name: client.name,
      tax_id: client.taxId || null,
      address: client.address || null,
      phone: client.phone || null,
      email: client.email || null,
      notes: client.notes || null,
      payment_terms: client.paymentTerms || null,
    });
  }

  if (toInsert.length > 0) {
    const { error } = await sb.from("clients").insert(toInsert);
    if (error) {
      out.errors.push(error.message);
    } else {
      out.imported = toInsert.length;
      if (termsUnrecognized > 0) out.termsUnrecognized = termsUnrecognized;
    }
  }
  return out;
}

async function importProducts(sb: SB, businessId: string, rows: ImportRow[], importBatchId: string): Promise<ImportSummary> {
  const out: ImportSummary = { imported: 0, skipped: 0, errors: [] };
  // Checked for the same reason as importClients above: a failed read read as
  // "no products yet" duplicates the entire catalogue.
  const { data: existing, error: existingError } = await sb
    .from("products")
    .select("name")
    .eq("business_id", businessId);
  if (existingError) {
    throw new Error(`לא הצלחנו לקרוא את המוצרים הקיימים, והייבוא נעצר: ${existingError.message}`);
  }
  const seen = new Set((existing || []).map((p) => String(p.name).toLowerCase().trim()));

  const toInsert: Array<Record<string, string | number | null>> = [];
  for (const row of rows) {
    const name = pick(row, "שם", "name");
    const price = parseAmount(pick(row, "מחיר", "price"));
    if (!name || price == null) {
      out.skipped++;
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      out.skipped++;
      continue;
    }
    seen.add(key);
    toInsert.push({
      business_id: businessId,
      import_batch_id: importBatchId,
      name,
      description: pick(row, "תיאור", "description") || null,
      price,
      unit: pick(row, "יחידה", "unit") || "יחידה",
    });
  }

  if (toInsert.length > 0) {
    const { error } = await sb.from("products").insert(toInsert);
    if (error) out.errors.push(error.message);
    else out.imported = toInsert.length;
  }
  return out;
}

async function importExpenses(sb: SB, businessId: string, rows: ImportRow[], importBatchId: string): Promise<ImportSummary> {
  const out: ImportSummary = { imported: 0, skipped: 0, errors: [] };
  const today = todayInIsrael();
  const toInsert: Array<Record<string, string | number | null>> = [];
  for (const row of rows) {
    const supplier = pick(row, "ספק", "supplier");
    const amount = parseAmount(pick(row, "סכום", "amount"));
    if (!supplier || amount == null || amount <= 0) {
      out.skipped++;
      continue;
    }
    toInsert.push({
      business_id: businessId,
      import_batch_id: importBatchId,
      date: pick(row, "תאריך", "date") || today,
      category: pick(row, "קטגוריה", "category") || "אחר",
      supplier,
      amount,
      description: pick(row, "תיאור", "description") || null,
    });
  }

  if (toInsert.length > 0) {
    const { error } = await sb.from("expenses").insert(toInsert);
    if (error) out.errors.push(error.message);
    else out.imported = toInsert.length;
  }
  return out;
}

async function importDocuments(sb: SB, businessId: string, rows: ImportRow[], importBatchId: string): Promise<ImportSummary> {
  const out: ImportSummary = { imported: 0, skipped: 0, errors: [] };
  const skips = createSkipAccumulator();
  const unmappedTypes = createUnmappedTypeCollector();
  const today = todayInIsrael();

  // Resolve columns once via the shared cross-vendor header-alias layer, so a
  // Morning / iCount / Rivhit / Hashavshevet / generic-Excel export lands on
  // the same internal fields as an Invoice4U one.
  const headersMap = mapHeaders(Object.keys(rows[0] ?? {}));

  // Cache clients by name → id (we'll create missing ones inline). The error
  // is checked: an empty result read as "this business has no clients" makes
  // the pass below create a fresh record for every client that already exists,
  // splitting each one's history in two.
  const { data: existingClients, error: clientsError } = await sb
    .from("clients")
    .select("id, name")
    .eq("business_id", businessId);
  if (clientsError) {
    throw new Error(`לא הצלחנו לקרוא את רשימת הלקוחות, והייבוא נעצר: ${clientsError.message}`);
  }
  const clientByName = new Map<string, string>();
  for (const c of existingClients || []) clientByName.set(String(c.name).toLowerCase().trim(), String(c.id));

  // Track the highest number per type so we can update document_counters
  // afterwards. Without this, the next live "create document" call would
  // pick a number that already exists in the DB.
  const maxByType = new Map<string, number>();
  // Rows dropped because their client couldn't be created (not a mapDocumentRow
  // skip reason); folded into the skipped total but not the per-reason summary.
  let clientErrorSkips = 0;

  // Pass 1: map every row, and collect the set of client names that don't
  // exist yet. Deferring the doc-row build until pass 2 lets us resolve all
  // missing clients in a single batch insert instead of one round-trip per
  // row (a CSV with thousands of new clients used to mean thousands of
  // sequential inserts here).
  const mappedRows: Array<Extract<MapDocumentRowResult, { ok: true }>> = [];
  const missingClientNames = new Set<string>();

  for (const row of rows) {
    const mapped = mapDocumentRow(row, headersMap, today);
    if (!mapped.ok) {
      skips.add(mapped.skipReason);
      continue;
    }
    const { record, typeMatched, typeRaw } = mapped;
    if (!typeMatched) unmappedTypes.add(typeRaw);

    const key = record.client_name.toLowerCase().trim();
    if (!clientByName.has(key)) missingClientNames.add(key);

    mappedRows.push(mapped);
  }

  // Batch-create all missing clients in one insert instead of one per row.
  // Dedupe by lowercased name (same rule the original per-row lookup used),
  // preserving the first-seen original casing for the inserted row.
  if (missingClientNames.size > 0) {
    const firstSeenName = new Map<string, string>();
    for (const mapped of mappedRows) {
      const name = mapped.record.client_name;
      const key = name.toLowerCase().trim();
      if (missingClientNames.has(key) && !firstSeenName.has(key)) {
        firstSeenName.set(key, name);
      }
    }
    const toInsert = Array.from(firstSeenName.entries()).map(([, name]) => ({
      business_id: businessId,
      import_batch_id: importBatchId,
      name,
    }));
    const { data: newClients, error: clientErr } = await sb
      .from("clients")
      .insert(toInsert)
      .select("id, name");
    if (clientErr) {
      // Same failure mode as before (per-row insert error), just reported
      // once for the whole batch: every row whose client couldn't be
      // created is skipped, not just the first one that hit the error.
      out.errors.push(`קליינטים: ${clientErr.message}`);
      clientErrorSkips += mappedRows.filter((m) =>
        missingClientNames.has(m.record.client_name.toLowerCase().trim()),
      ).length;
    } else {
      for (const c of newClients || []) {
        clientByName.set(String(c.name).toLowerCase().trim(), String(c.id));
      }
    }
  }

  const docsToInsert: Array<Record<string, unknown>> = [];
  for (const mapped of mappedRows) {
    const { record } = mapped;
    const { description, ...docFields } = record;
    const clientId = clientByName.get(record.client_name.toLowerCase().trim());
    if (!clientId) {
      // The batch client insert failed (or, in principle, didn't cover this
      // name) - skip this row exactly as the original per-row path did on
      // a client-insert error.
      continue;
    }

    maxByType.set(record.type, Math.max(maxByType.get(record.type) ?? 0, record.number));
    docsToInsert.push({
      business_id: businessId,
      import_batch_id: importBatchId,
      client_id: clientId,
      subject: description,
      ...docFields,
    });
  }

  if (docsToInsert.length > 0) {
    // Insert in chunks to avoid blowing up the request body.
    const CHUNK = 200;
    for (let i = 0; i < docsToInsert.length; i += CHUNK) {
      const chunk = docsToInsert.slice(i, i + CHUNK);
      const { error } = await sb.from("documents").insert(chunk);
      if (error) {
        out.errors.push(`chunk ${i / CHUNK + 1}: ${error.message}`);
      } else {
        out.imported += chunk.length;
      }
    }
  }

  // Bump document_counters so the next live doc gets max+1 (not a
  // collision with one we just imported). Shares the helper with the two
  // browser import paths: this route had its own copy of the same
  // read-then-write, with all three errors dropped and the read failing open,
  // so an import through the admin console could leave the counter behind a
  // number it had just written.
  await bumpDocumentCounters(sb, businessId, maxByType);

  out.skipped = skips.total + clientErrorSkips;
  out.skipSummary = skips.toSkipSummary();
  out.unmappedType = unmappedTypes.count;
  out.unmappedTypeSamples = unmappedTypes.samples;
  return out;
}
