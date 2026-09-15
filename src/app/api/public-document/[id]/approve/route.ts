import { formatDocTotal } from "@/lib/currencies";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createNotificationForBusiness } from "@/lib/notifications-server";
import { clientIp } from "@/lib/rate-limit";
import { quoteApprovalVerdict } from "@/lib/quote-approval";

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = clientIp(req);
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
    .select("id, type, status, approved_at, converted_to_id, business_id, client_name, number, total, currency")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !doc) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const verdict = quoteApprovalVerdict(doc);
  if (verdict.kind === "rejected") {
    return NextResponse.json({ ok: false, error: verdict.error }, { status: verdict.status });
  }
  if (verdict.kind === "already_approved") {
    return NextResponse.json(
      { ok: true, alreadyApproved: true, approvedAt: verdict.approvedAt },
      { status: 200 }
    );
  }

  // Conditional, so the check above and the write are one atomic step: the
  // row only changes while it is still an unapproved, open quote. Two
  // submits racing each other both pass the read, but only one UPDATE
  // matches, and only that one notifies the owner.
  const approvedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("documents")
    .update({ approved_at: approvedAt, approval_signature: signature })
    .eq("id", id)
    .eq("type", "quote")
    .eq("status", "sent")
    .is("approved_at", null)
    .is("converted_to_id", null)
    .select("id");

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  if (!updated || updated.length === 0) {
    // Lost the race, or the quote changed between the read and the write.
    const { data: current } = await admin
      .from("documents")
      .select("type, status, approved_at, converted_to_id")
      .eq("id", id)
      .maybeSingle();
    if (current?.approved_at) {
      return NextResponse.json(
        { ok: true, alreadyApproved: true, approvedAt: current.approved_at },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { ok: false, error: "Quote can no longer be approved" },
      { status: 409 }
    );
  }

  if (doc.business_id) {
    await createNotificationForBusiness({
      businessId: doc.business_id,
      kind: "quote_approved",
      title: `${doc.client_name} אישר/ה את הצעת המחיר`,
      body: `הצעת מחיר #${doc.number} על סך ${formatDocTotal(Number(doc.total), doc.currency)} אושרה על-ידי ${signature}.`,
      href: `/documents/${id}`,
      documentId: id,
    });
  }

  return NextResponse.json({ ok: true, approvedAt, signature });
}
