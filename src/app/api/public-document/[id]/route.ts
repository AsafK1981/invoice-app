import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const docRes = await admin
    .from("documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (docRes.error || !docRes.data) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const doc = docRes.data;

  const [itemsRes, bizRes, cliRes] = await Promise.all([
    admin
      .from("document_items")
      .select("*")
      .eq("document_id", id)
      .order("sort_order"),
    admin.from("businesses").select("*").eq("id", doc.business_id).maybeSingle(),
    doc.client_id
      ? admin.from("clients").select("*").eq("id", doc.client_id).maybeSingle()
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
