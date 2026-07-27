import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { polar } from "@/lib/polar";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Creates a one-time customer portal session for the calling user. The
 * portal lets them update their payment method, cancel, see invoices,
 * and switch plan tier, all hosted by Polar.
 */
export async function POST(req: NextRequest) {
  if (!polar) {
    return NextResponse.json(
      { ok: false, error: "Polar not configured" },
      { status: 503 },
    );
  }

  try {
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

    // Look up by external ID (= Supabase user.id) so we don't need a
    // pre-existing polar_customer_id in metadata. Polar resolves it
    // server-side. Falls back to direct customer ID if we have one
    // (checking app_metadata first since that's the secure write target).
    const customerId =
      ((user.app_metadata || {}) as Record<string, unknown>).polar_customer_id as string | undefined ||
      ((user.user_metadata || {}) as Record<string, unknown>).polar_customer_id as string | undefined;
    const session = customerId
      ? await polar.customerSessions.create({ customerId })
      : await polar.customerSessions.create({ externalCustomerId: user.id });

    return NextResponse.json({ ok: true, url: session.customerPortalUrl });
  } catch (err) {
    console.error("Portal error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
