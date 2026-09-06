// Push for a notification the BROWSER wrote.
//
// Server producers call sendPushForNotification() directly from
// createNotificationForBusiness. The one client-side producer (the bank-import
// matcher, which inserts payment_matched rows through RLS) has no service role
// and no VAPID private key, so it posts the id of the row it just wrote here.
//
// POST { notificationId } -> { ok }
//
// The row is re-read server-side and scoped to the caller's own user_id, so
// this route can only push what the caller genuinely owns: the body carries an
// id, never a title or a body the caller could put on someone's lock screen.

import { NextRequest, NextResponse } from "next/server";
import { checkRate } from "@/lib/rate-limit";
import { resolvePushCaller } from "@/lib/push-auth";
import { sendPushForNotification } from "@/lib/push-server";
import type { NotificationKind } from "@/lib/notifications";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const caller = await resolvePushCaller(req);
  if (!caller.ok) return caller.response;
  const { admin, userId, businessId } = caller;

  const rl = checkRate({ key: `push:send:${userId}`, max: 60, windowMs: 60 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "יותר מדי בקשות. נסו שוב מאוחר יותר." },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const notificationId = String(body.notificationId || "");
  if (!UUID_RE.test(notificationId)) {
    return NextResponse.json({ ok: false, error: "מזהה התראה לא תקין." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("notifications")
    .select("id, kind, title, body, href, business_id")
    .eq("id", notificationId)
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) {
    console.error("[push] notification lookup failed:", error.message);
    return NextResponse.json({ ok: false, error: "שגיאה בשליחה." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "ההתראה לא נמצאה." }, { status: 404 });
  }

  const result = await sendPushForNotification({
    businessId,
    kind: data.kind as NotificationKind,
    title: String(data.title || ""),
    body: (data.body as string) || undefined,
    href: (data.href as string) || undefined,
    notificationId: data.id as string,
  });

  return NextResponse.json({ ok: true, sent: result.sent });
}
