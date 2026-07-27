import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRate, clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GDPR / "right to data portability" endpoint.
 * Returns a single JSON file containing every row the requesting user
 * owns across the platform: businesses, clients, products, documents
 * (with line items), expenses, audit log entries, plus account
 * metadata.
 *
 * Limited to one export per user per 5 minutes (it's an expensive
 * cross-table query and a real DDoS vector if unrestricted).
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

  const ip = clientIp(req);
  const rl = checkRate({ key: `export:${user.id}:${ip}`, max: 1, windowMs: 5 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Wait 5 minutes between exports." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetIn / 1000)) } },
    );
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Find all businesses owned by this user
  const { data: businesses } = await sb
    .from("businesses")
    .select("*")
    .eq("user_id", user.id);
  const businessIds = (businesses ?? []).map((b) => b.id);

  if (businessIds.length === 0) {
    return jsonDownload({
      account: serializeUser(user),
      businesses: [],
      clients: [],
      products: [],
      documents: [],
      document_items: [],
      expenses: [],
      audit_log: [],
      exported_at: new Date().toISOString(),
    });
  }

  const [clients, products, documents, expenses, auditLog] = await Promise.all([
    sb.from("clients").select("*").in("business_id", businessIds),
    sb.from("products").select("*").in("business_id", businessIds),
    sb.from("documents").select("*").in("business_id", businessIds),
    sb.from("expenses").select("*").in("business_id", businessIds),
    sb.from("audit_log").select("*").in("business_id", businessIds),
  ]);

  const docIds = (documents.data ?? []).map((d) => d.id);
  const items = docIds.length > 0
    ? await sb.from("document_items").select("*").in("document_id", docIds)
    : { data: [] };

  return jsonDownload({
    account: serializeUser(user),
    businesses: businesses ?? [],
    clients: clients.data ?? [],
    products: products.data ?? [],
    documents: documents.data ?? [],
    document_items: items.data ?? [],
    expenses: expenses.data ?? [],
    audit_log: auditLog.data ?? [],
    exported_at: new Date().toISOString(),
  });
}

function serializeUser(user: { id: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> }) {
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
    metadata: user.user_metadata,
  };
}

function jsonDownload(payload: unknown) {
  const body = JSON.stringify(payload, null, 2);
  const filename = `mysuperfriendlyinvoiceapp-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
