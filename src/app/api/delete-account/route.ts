import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    // Identify the user from the bearer token
    const authHeader = req.headers.get("authorization");
    let token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    // If no auth header, try to read the access token from supabase cookies
    // (Supabase JS sets cookies named sb-<project>-auth-token in some setups)
    if (!token) {
      const cookies = req.headers.get("cookie") || "";
      const match = cookies.match(/sb-[^=]*-auth-token=([^;]+)/);
      if (match) {
        try {
          const decoded = JSON.parse(decodeURIComponent(match[1]));
          token = decoded?.access_token || decoded?.[0]?.access_token;
        } catch {}
      }
    }

    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Find all businesses owned by the user
    const { data: businesses } = await admin
      .from("businesses")
      .select("id")
      .eq("user_id", user.id);

    const businessIds = (businesses || []).map((b) => b.id);

    if (businessIds.length > 0) {
      // Cascade delete: documents → document_items, then everything else
      const { data: docs } = await admin
        .from("documents")
        .select("id")
        .in("business_id", businessIds);
      const docIds = (docs || []).map((d) => d.id);

      if (docIds.length > 0) {
        await admin.from("document_items").delete().in("document_id", docIds);
      }
      await admin.from("documents").delete().in("business_id", businessIds);
      await admin.from("expenses").delete().in("business_id", businessIds);
      await admin.from("clients").delete().in("business_id", businessIds);
      await admin.from("products").delete().in("business_id", businessIds);
      await admin.from("document_counters").delete().in("business_id", businessIds);
      await admin.from("businesses").delete().eq("user_id", user.id);
    }

    // Finally delete the auth user
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Delete account error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
