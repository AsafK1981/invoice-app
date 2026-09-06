// One browser's subscription to web push.
//
// POST   { endpoint, keys: { p256dh, auth }, userAgent? } -> stores it
// DELETE { endpoint }                                     -> removes it
//
// Both are scoped to the business resolved from the caller's own session. The
// endpoint is a capability URL, so it is never echoed back in a response and
// never written to a log - the answers here carry nothing but ok/error.

import { NextRequest, NextResponse } from "next/server";
import { checkRate } from "@/lib/rate-limit";
import { resolvePushCaller } from "@/lib/push-auth";
import { parsePushSubscription } from "@/lib/push-server";

export const runtime = "nodejs";

async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const caller = await resolvePushCaller(req);
  if (!caller.ok) return caller.response;
  const { admin, userId, businessId } = caller;

  const rl = checkRate({ key: `push:subscribe:${userId}`, max: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "יותר מדי בקשות. נסו שוב בעוד דקה." },
      { status: 429 },
    );
  }

  const body = await readJson(req);
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });

  const parsed = parsePushSubscription(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  // Upsert on the unique endpoint: the same device re-granting permission
  // (or an owner switching business) must update its single row, never stack
  // duplicates that would push the same message twice.
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      business_id: businessId,
      user_id: userId,
      endpoint: parsed.value.endpoint,
      p256dh: parsed.value.p256dh,
      auth: parsed.value.auth,
      user_agent: parsed.value.userAgent,
      last_used_at: null,
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    console.error("[push] subscribe failed:", error.message);
    return NextResponse.json({ ok: false, error: "השמירה נכשלה." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const caller = await resolvePushCaller(req);
  if (!caller.ok) return caller.response;
  const { admin, userId, businessId } = caller;

  const rl = checkRate({ key: `push:unsubscribe:${userId}`, max: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "יותר מדי בקשות. נסו שוב בעוד דקה." },
      { status: 429 },
    );
  }

  const body = await readJson(req);
  const endpoint = body && typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    return NextResponse.json({ ok: false, error: "חסרה כתובת המנוי." }, { status: 400 });
  }

  // Scoped to the caller's business on purpose: holding someone else's
  // endpoint must not be enough to delete their subscription.
  const { error } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("business_id", businessId)
    .eq("endpoint", endpoint);
  if (error) {
    console.error("[push] unsubscribe failed:", error.message);
    return NextResponse.json({ ok: false, error: "הביטול נכשל." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
