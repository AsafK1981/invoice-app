import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 5;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  let body: { signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const signature = (body.signature || "").trim();
  if (!signature || signature.length < 2 || signature.length > 200) {
    return NextResponse.json(
      { ok: false, error: "Signature required (2-200 chars)" },
      { status: 400 }
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: doc, error: fetchError } = await admin
    .from("documents")
    .select("id, type, status, approved_at")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !doc) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  if (doc.type !== "quote") {
    return NextResponse.json(
      { ok: false, error: "Only quotes can be approved" },
      { status: 400 }
    );
  }

  if (doc.approved_at) {
    return NextResponse.json(
      { ok: true, alreadyApproved: true, approvedAt: doc.approved_at },
      { status: 200 }
    );
  }

  const approvedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("documents")
    .update({ approved_at: approvedAt, approval_signature: signature })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, approvedAt, signature });
}
