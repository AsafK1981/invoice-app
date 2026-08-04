import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (rateLimitMap.size > 5000) {
      for (const [k, v] of rateLimitMap) {
        if (v.resetAt < now) rateLimitMap.delete(k);
      }
    }
    return { allowed: true, retryAfter: 0 };
  }
  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Explicit allowlist: never select("*") on a publicly-visible resource.
  // Covers exactly the columns the /view page (src/app/view/[id]/page.tsx)
  // reads off `document`, plus `business_id`/`client_id` which this route
  // itself needs below to fetch the related business/client rows.
  // Deliberately excluded (same columns the old post-select strip removed):
  // email_opened_at, email_open_count, emailed_to, payment_reference,
  // paid_at, converted_to_id, user_id - the recipient of a shared invoice
  // has no business seeing the sender's read-receipt tracking, who else it
  // was mailed to, or their private payment reference. Any future column
  // added to documents (new internal/tracking field) won't accidentally
  // leak via every shared document URL the way select("*") would.
  const docRes = await admin
    .from("documents")
    .select(
      "id, business_id, type, number, date, client_id, client_name, subject, status, subtotal, vat, total, rounding, round_total, payment_method, payment_details, withholding_rate, withholding_amount, discount_amount, notes, approved_at, approval_signature, original_issued_at, allocation_number, allocation_set_at, currency, exchange_rate, subtotal_ils, vat_ils, total_ils, zero_rated",
    )
    .eq("id", id)
    .maybeSingle();

  if (docRes.error || !docRes.data) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const doc = docRes.data as Record<string, unknown>;

  const [itemsRes, bizRes, cliRes] = await Promise.all([
    admin
      .from("document_items")
      .select("*")
      .eq("document_id", id)
      .order("sort_order"),
    // Explicit allowlist: never select("*") on a publicly-visible
    // resource. Any future column added to businesses (tax_authority
    // API keys, internal flags, etc.) won't accidentally leak via
    // every shared document URL. user_id and created_at intentionally
    // dropped: receivers of an invoice don't need them.
    admin
      .from("businesses")
      .select(
        "id, name, business_type, tax_id, address, phone, email, logo_url, bank_name, bank_branch, bank_account, payment_notes, default_doc_notes",
      )
      .eq("id", doc.business_id)
      .maybeSingle(),
    doc.client_id
      ? admin
          .from("clients")
          .select("id, name, tax_id, address, phone, email")
          .eq("id", doc.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return NextResponse.json({
    ok: true,
    document: doc,
    items: itemsRes.data || [],
    business: bizRes.data || null,
    client: cliRes.data || null,
  });
}
