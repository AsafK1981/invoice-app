import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientIp } from "@/lib/rate-limit";
import { normalizeDocumentDesign } from "@/lib/document-themes";

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
    // Explicit allowlist, same discipline as the businesses select below:
    // never select("*") on a publicly-visible resource, so a future
    // document_items column can't silently leak via every shared URL.
    // These are exactly the fields the public /view page consumes.
    admin
      .from("document_items")
      .select("id, product_id, description, quantity, unit_price, total")
      .eq("document_id", id)
      .order("sort_order"),
    // Explicit allowlist: never select("*") on a publicly-visible
    // resource. Any future column added to businesses (tax_authority
    // API keys, internal flags, etc.) won't accidentally leak via
    // every shared document URL. user_id and created_at intentionally
    // dropped: receivers of an invoice don't need them.
    admin
      .from("businesses")
      // user_id is selected but NEVER returned to the caller - it is used
      // only, below, to look up whether the owner is a paying subscriber
      // (which decides the footer credit). It is stripped before the response.
      // document_design is returned but ALWAYS normalized first (below) -
      // this route is the one place a malformed/hostile value in that
      // column could otherwise reach a completely unauthenticated caller.
      .select(
        "id, user_id, name, business_type, tax_id, address, phone, email, logo_url, bank_name, bank_branch, bank_account, payment_notes, document_design",
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

  // ── Footer credit: on for everyone EXCEPT a genuinely paying subscriber ──
  // Growth loop (see src/components/document-body.tsx): the small "הופק
  // באמצעות" credit is how this app reaches the sender's clients. Paying
  // customers get it removed - standard SaaS behaviour and a real upgrade
  // incentive. app_metadata is the enforcement source of truth everywhere
  // else in this codebase, so it is the source here too.
  //
  // "Paying" deliberately EXCLUDES trials and beta grants: plan_active is
  // true for those as well, but they are not paying, so they keep the credit.
  // Fails OPEN (branding shown) on any lookup error - never silently strip
  // the growth loop because of a transient auth-admin hiccup.
  let showBranding = true;
  const bizRow = (bizRes.data || null) as Record<string, unknown> | null;
  const ownerId = bizRow?.user_id;
  if (typeof ownerId === "string" && ownerId) {
    try {
      const { data: owner } = await admin.auth.admin.getUserById(ownerId);
      const meta = (owner?.user?.app_metadata || {}) as Record<string, unknown>;
      const isPaying =
        meta.plan_active === true &&
        meta.plan_trialing !== true &&
        meta.plan_beta_grant !== true;
      showBranding = !isPaying;
    } catch {
      // keep showBranding = true
    }
  }

  // Strip user_id: the recipient of a shared invoice must never see the
  // sender's Supabase user id (it is a lookup key elsewhere in the system).
  // document_design is re-serialized through normalizeDocumentDesign() -
  // the ONLY thing an unauthenticated caller ever receives for this field
  // is a value already coerced to the closed enum sets in
  // src/lib/document-themes.ts, never the raw DB value.
  let businessOut: Record<string, unknown> | null = null;
  if (bizRow) {
    const { user_id: _ownerId, document_design, ...rest } = bizRow;
    void _ownerId;
    businessOut = { ...rest, document_design: normalizeDocumentDesign(document_design) };
  }

  return NextResponse.json({
    ok: true,
    document: doc,
    items: itemsRes.data || [],
    business: businessOut,
    client: cliRes.data || null,
    showBranding,
  });
}
