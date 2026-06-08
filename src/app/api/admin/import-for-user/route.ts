import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";
import { checkRate } from "@/lib/rate-limit";

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
 * data into another user's account — the regular /api/* import
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
      { ok: false, error: "Slow down — 20 imports per minute max" },
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
        error: "Target user has no business yet — they need to complete onboarding first",
      },
      { status: 400 },
    );
  }

  let summary: ImportSummary = { imported: 0, skipped: 0, errors: [] };

  try {
    if (body.entityType === "clients") {
      summary = await importClients(sb, targetBusinessId, body.rows);
    } else if (body.entityType === "products") {
      summary = await importProducts(sb, targetBusinessId, body.rows);
    } else if (body.entityType === "expenses") {
      summary = await importExpenses(sb, targetBusinessId, body.rows);
    } else if (body.entityType === "documents") {
      summary = await importDocuments(sb, targetBusinessId, body.rows);
    }
  } catch (err) {
    console.error("admin import-for-user failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }

  // Audit log entry — transparent to the target user.
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

async function importClients(sb: SB, businessId: string, rows: ImportRow[]): Promise<ImportSummary> {
  const out: ImportSummary = { imported: 0, skipped: 0, errors: [] };
  // Fetch existing client names so we can dedupe by case-insensitive name.
  const { data: existing } = await sb.from("clients").select("name").eq("business_id", businessId);
  const seen = new Set((existing || []).map((c) => String(c.name).toLowerCase().trim()));

  const toInsert: Array<Record<string, string | null>> = [];
  for (const row of rows) {
    const name = pick(row, "שם", "name");
    if (!name) {
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
      name,
      tax_id: pick(row, "ח.פ / ת.ז", "ח.פ", "ת.ז", "tax_id") || null,
      address: pick(row, "כתובת", "address") || null,
      phone: pick(row, "טלפון", "phone") || null,
      email: pick(row, "אימייל", "email") || null,
      notes: pick(row, "הערות", "notes") || null,
    });
  }

  if (toInsert.length > 0) {
    const { error } = await sb.from("clients").insert(toInsert);
    if (error) {
      out.errors.push(error.message);
    } else {
      out.imported = toInsert.length;
    }
  }
  return out;
}

async function importProducts(sb: SB, businessId: string, rows: ImportRow[]): Promise<ImportSummary> {
  const out: ImportSummary = { imported: 0, skipped: 0, errors: [] };
  const { data: existing } = await sb.from("products").select("name").eq("business_id", businessId);
  const seen = new Set((existing || []).map((p) => String(p.name).toLowerCase().trim()));

  const toInsert: Array<Record<string, string | number | null>> = [];
  for (const row of rows) {
    const name = pick(row, "שם", "name");
    const priceStr = pick(row, "מחיר", "price").replace(/[₪,\s]/g, "");
    const price = parseFloat(priceStr);
    if (!name || !Number.isFinite(price)) {
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

async function importExpenses(sb: SB, businessId: string, rows: ImportRow[]): Promise<ImportSummary> {
  const out: ImportSummary = { imported: 0, skipped: 0, errors: [] };
  const toInsert: Array<Record<string, string | number | null>> = [];
  for (const row of rows) {
    const supplier = pick(row, "ספק", "supplier");
    const amountStr = pick(row, "סכום", "amount").replace(/[₪,\s]/g, "");
    const amount = parseFloat(amountStr);
    if (!supplier || !Number.isFinite(amount) || amount <= 0) {
      out.skipped++;
      continue;
    }
    toInsert.push({
      business_id: businessId,
      date: pick(row, "תאריך", "date") || new Date().toISOString().slice(0, 10),
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

function resolveDocumentType(raw: string): "receipt" | "tax_invoice" | "tax_invoice_receipt" | "credit_note" | "quote" {
  const t = raw.trim().toLowerCase();
  if (!t) return "receipt";
  if (t === "tax_invoice_receipt" || t.includes("חשבונית מס/קבלה") || t.includes("חשבונית מס קבלה")) return "tax_invoice_receipt";
  if (t === "credit_note" || t.includes("זיכוי")) return "credit_note";
  if (t === "quote" || t.includes("חשבון עסקה") || t.includes("הצעת מחיר") || t.includes("הצעה")) return "quote";
  if (t === "tax_invoice" || t === "invoice" || (t.includes("חשבונית") && t.includes("מס"))) return "tax_invoice";
  return "receipt";
}

async function importDocuments(sb: SB, businessId: string, rows: ImportRow[]): Promise<ImportSummary> {
  const out: ImportSummary = { imported: 0, skipped: 0, errors: [] };

  // Cache clients by name → id (we'll create missing ones inline).
  const { data: existingClients } = await sb.from("clients").select("id, name").eq("business_id", businessId);
  const clientByName = new Map<string, string>();
  for (const c of existingClients || []) clientByName.set(String(c.name).toLowerCase().trim(), String(c.id));

  // Track the highest number per type so we can update document_counters
  // afterwards. Without this, the next live "create document" call would
  // pick a number that already exists in the DB.
  const maxByType = new Map<string, number>();
  const docsToInsert: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const numberRaw = pick(row, "מספר", "number");
    const clientName = pick(row, "לקוח", "client", "client_name");
    const totalStr = pick(row, "סכום", "total").replace(/[₪,\s]/g, "");
    const total = parseFloat(totalStr);

    if (!/^\d+$/.test(numberRaw)) {
      out.skipped++;
      continue;
    }
    const number = parseInt(numberRaw, 10);
    if (!clientName || !Number.isFinite(total) || total <= 0) {
      out.skipped++;
      continue;
    }

    const type = resolveDocumentType(pick(row, "סוג", "type"));
    const date = pick(row, "תאריך", "date") || new Date().toISOString().slice(0, 10);
    const subject = pick(row, "תיאור", "description", "subject") || "שירות";
    const vatStr = pick(row, 'מע"מ', "מעמ", "vat").replace(/[₪,\s]/g, "");
    const vat = parseFloat(vatStr) || 0;
    if (vat > total) {
      out.skipped++;
      continue;
    }
    const subtotal = total - vat;
    const statusRaw = pick(row, "סטטוס", "status").toLowerCase();
    let status: "draft" | "sent" | "paid" | "cancelled" = "paid";
    if (statusRaw === "draft" || statusRaw.includes("טיוטה")) status = "draft";
    else if (statusRaw === "sent" || statusRaw.includes("נשלח")) status = "sent";
    else if (statusRaw === "cancelled" || statusRaw.includes("בוטל")) status = "cancelled";
    else if (type === "quote") status = "sent";

    // Find or create client by name.
    let clientId = clientByName.get(clientName.toLowerCase().trim());
    if (!clientId) {
      const { data: newClient, error: clientErr } = await sb
        .from("clients")
        .insert({ business_id: businessId, name: clientName })
        .select("id")
        .single();
      if (clientErr) {
        out.errors.push(`קליינט ${clientName}: ${clientErr.message}`);
        out.skipped++;
        continue;
      }
      clientId = newClient.id;
      clientByName.set(clientName.toLowerCase().trim(), clientId!);
    }

    maxByType.set(type, Math.max(maxByType.get(type) ?? 0, number));
    docsToInsert.push({
      business_id: businessId,
      type,
      number,
      date,
      client_id: clientId,
      client_name: clientName,
      subject,
      status,
      subtotal,
      vat,
      total,
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
  // collision with one we just imported).
  for (const [type, max] of maxByType) {
    const { data: counter } = await sb
      .from("document_counters")
      .select("next_number")
      .eq("business_id", businessId)
      .eq("doc_type", type)
      .maybeSingle();
    const nextWanted = max + 1;
    if (counter) {
      if ((counter.next_number as number) < nextWanted) {
        await sb
          .from("document_counters")
          .update({ next_number: nextWanted })
          .eq("business_id", businessId)
          .eq("doc_type", type);
      }
    } else {
      await sb
        .from("document_counters")
        .insert({ business_id: businessId, doc_type: type, next_number: nextWanted });
    }
  }

  return out;
}
