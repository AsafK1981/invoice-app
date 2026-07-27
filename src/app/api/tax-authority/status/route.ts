import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isTaxAuthorityConfigured,
  taxAuthorityEnv,
  allocationRequiredThreshold,
} from "@/lib/tax-authority";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Returns connection status for the calling business' tax authority
 * credentials. Used by the settings UI to render the right state
 * (Connect button vs Connected card).
 *
 * Intentionally does NOT return any token fields, only metadata.
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

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: businesses } = await sb
    .from("businesses")
    .select("id, business_type")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  const biz = businesses?.[0];

  if (!biz) {
    return NextResponse.json({
      ok: true,
      vendorConfigured: isTaxAuthorityConfigured(),
      environment: taxAuthorityEnv(),
      businessType: null,
      connected: false,
      threshold: allocationRequiredThreshold(),
    });
  }

  const { data: creds } = await sb
    .from("tax_authority_credentials")
    .select("vat_number, connected_at, expires_at, last_used_at, environment, last_error")
    .eq("business_id", biz.id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    vendorConfigured: isTaxAuthorityConfigured(),
    environment: taxAuthorityEnv(),
    businessType: biz.business_type,
    connected: !!creds,
    credentials: creds || null,
    threshold: allocationRequiredThreshold(),
  });
}

export async function DELETE(req: NextRequest) {
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

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: businesses } = await sb
    .from("businesses")
    .select("id")
    .eq("user_id", user.id);
  const businessIds = (businesses || []).map((b) => b.id);
  if (businessIds.length === 0) return NextResponse.json({ ok: true });

  await sb.from("tax_authority_credentials").delete().in("business_id", businessIds);
  return NextResponse.json({ ok: true });
}
