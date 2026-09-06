// "שלחו התרעת בדיקה" from the הגדרות card.
//
// POST -> { ok, sent }
//
// Deliberately ignores push_kinds: the question this answers is "does this
// device show anything at all?", which the owner needs settled before they
// decide which kinds to receive. Nothing about the message is caller-supplied
// (see PUSH_TEST_TITLE), so this cannot be turned into a way to put arbitrary
// text on a device - not even the caller's own.

import { NextRequest, NextResponse } from "next/server";
import { checkRate } from "@/lib/rate-limit";
import { resolvePushCaller } from "@/lib/push-auth";
import { sendTestPush } from "@/lib/push-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const caller = await resolvePushCaller(req);
  if (!caller.ok) return caller.response;
  const { userId, businessId } = caller;

  const rl = checkRate({ key: `push:test:${userId}`, max: 5, windowMs: 60 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "נשלחו כבר כמה התרעות בדיקה. נסו שוב בעוד שעה." },
      { status: 429 },
    );
  }

  const result = await sendTestPush(businessId);
  if (result.sent === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "לא נמצא מכשיר פעיל להתרעות. הפעילו את ההתרעות במכשיר הזה ונסו שוב.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, sent: result.sent });
}
