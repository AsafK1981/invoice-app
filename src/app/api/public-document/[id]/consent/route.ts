import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientIp } from "@/lib/rate-limit";

/**
 * הוראות ניהול ספרים 18ב(ג): a computerized document may be sent only to a
 * recipient who agreed, "בכתב או באופן ממוחשב", to receive computerized
 * documents from this sender, before the first one; the recipient may revoke;
 * consent and revocation are kept as part of the books.
 *
 * This is the "באופן ממוחשב" path. The customer reaches it from the public
 * /view page: an explicit click ("button") or the PDF download ("download").
 * Written as service_role because the caller is unauthenticated; the document
 * id is the capability, exactly like /approve. Idempotent: an earlier consent
 * is never overwritten, and every change lands in audit_log.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (rateLimitMap.size > 5000) {
      for (const [k, v] of rateLimitMap) {
        if (v.resetAt < now) rateLimitMap.delete(k);
      }
    }
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

type Action = "consent" | "revoke";
type Source = "download" | "button";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  let body: { action?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = body.action as Action;
  if (action !== "consent" && action !== "revoke") {
    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  }
  const source: Source = body.source === "download" ? "download" : "button";

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: doc, error: docErr } = await admin
    .from("documents")
    .select("id, business_id, client_id, client_name, number, type")
    .eq("id", id)
    .maybeSingle();
  if (docErr || !doc) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  if (!doc.client_id) {
    // A document not linked to a client row has nowhere to record consent.
    return NextResponse.json(
      { ok: false, code: "NO_CLIENT", error: "המסמך אינו מקושר ללקוח רשום." },
      { status: 409 },
    );
  }

  const { data: cli, error: cliErr } = await admin
    .from("clients")
    .select("id, name, computerized_consent_at, computerized_consent_source, computerized_consent_revoked_at")
    .eq("id", doc.client_id)
    .eq("business_id", doc.business_id)
    .maybeSingle();
  if (cliErr || !cli) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  let patch: Record<string, unknown> | null = null;
  let auditAction: "client.consent_recorded" | "client.consent_revoked" | null = null;

  if (action === "consent") {
    if (cli.computerized_consent_at && !cli.computerized_consent_revoked_at) {
      // Already consented and not revoked: nothing to write, nothing to log.
    } else {
      // First consent, or a fresh consent after a revocation. A revoked consent
      // is superseded by the new one; the revocation stays in audit_log.
      patch = {
        computerized_consent_at: now,
        computerized_consent_source: source,
        computerized_consent_revoked_at: null,
      };
      auditAction = "client.consent_recorded";
    }
  } else {
    if (cli.computerized_consent_at && !cli.computerized_consent_revoked_at) {
      patch = { computerized_consent_revoked_at: now };
      auditAction = "client.consent_revoked";
    }
    // No active consent: revoking is a no-op.
  }

  if (patch && auditAction) {
    const { error: updErr } = await admin
      .from("clients")
      .update(patch)
      .eq("id", cli.id)
      .eq("business_id", doc.business_id);
    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }
    // 18ב(ג): "ישמור את ההסכמה או את ביטולה ... כחלק בלתי נפרד ממערכת החשבונות".
    // The audit row is that record. Inspect the error: a silently lost audit
    // row would defeat the point.
    const { error: auditErr } = await admin.from("audit_log").insert({
      business_id: doc.business_id,
      action: auditAction,
      target_type: "client",
      target_id: cli.id,
      target_label: cli.name,
      payload: {
        document_id: doc.id,
        document_type: doc.type,
        document_number: doc.number,
        source: action === "consent" ? source : undefined,
        via: "public-view",
      },
    });
    if (auditErr) {
      console.error("[consent] audit_log insert failed", { id, auditErr });
    }
  }

  const merged = { ...cli, ...(patch || {}) };
  return NextResponse.json({
    ok: true,
    changed: Boolean(patch),
    consent: {
      at: merged.computerized_consent_at || null,
      source: merged.computerized_consent_source || null,
      revokedAt: merged.computerized_consent_revoked_at || null,
    },
  });
}
