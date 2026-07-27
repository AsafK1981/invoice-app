import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPortalToken, PORTAL_COOKIE } from "@/lib/portal-token";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get(PORTAL_COOKIE)?.value || "";
  // Demand aud="session": refuse a raw link token used as a cookie.
  const payload = verifyPortalToken(sessionToken, "session");
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ilike is intentional; client emails were stored as the business
  // typed them, often mixed-case. The token's email is wildcard-safe:
  // request-link's regex rejects `%` and `_`, and signPortalToken
  // lowercases + trims. We still escape defensively in case future
  // edits relax the regex.
  const escapedEmail = payload.email.replace(/[\\%_]/g, "\\$&");
  const { data: clientRows } = await admin
    .from("clients")
    .select("id, business_id, name")
    .ilike("email", escapedEmail);

  if (!clientRows || clientRows.length === 0) {
    return NextResponse.json({ ok: true, documents: [], businesses: [] });
  }

  const clientIds = clientRows.map((c) => c.id as string);
  const businessIds = Array.from(new Set(clientRows.map((c) => c.business_id as string)));

  const [docsRes, bizRes] = await Promise.all([
    admin
      .from("documents")
      .select(
        "id, type, number, date, status, total, total_ils, vat, subtotal, client_id, business_id, paid_at, allocation_number",
      )
      .in("client_id", clientIds)
      .neq("status", "draft")
      .neq("status", "cancelled")
      .order("date", { ascending: false }),
    admin
      .from("businesses")
      .select("id, name, business_type, tax_id, phone, email")
      .in("id", businessIds),
  ]);

  return NextResponse.json({
    ok: true,
    email: payload.email,
    documents: docsRes.data || [],
    businesses: bizRes.data || [],
  });
}
