// The app's view of "expenses from email": the forwarding address, its
// on/off switch, and the queue of scanned mail waiting for approval.
//
// GET  -> { ok, enabled, address, items, pending, pendingCount }
// POST -> { ok, enabled, address }   body: { action: 'enable'|'disable'|'rotate' }
//
// `email_inbox_items` is service-role only (RLS with zero policies), so every
// query below is scoped by the business resolved from the caller's session.

import { NextRequest, NextResponse } from "next/server";
import { checkRate } from "@/lib/rate-limit";
import { generateInboxToken, inboxAddressFor } from "@/lib/email-inbox";
import {
  INBOX_ITEM_COLUMNS,
  resolveInboxCaller,
  toInboxItemDto,
} from "@/lib/email-inbox-server";

export const runtime = "nodejs";

/** How far back a failed item stays visible, so "why didn't this import?" has an answer. */
const FAILED_WINDOW_DAYS = 7;

export async function GET(req: NextRequest) {
  const caller = await resolveInboxCaller(req);
  if (!caller.ok) return caller.response;
  const { admin, business } = caller;

  const since = new Date(Date.now() - FAILED_WINDOW_DAYS * 24 * 60 * 60_000).toISOString();

  // Two queries rather than one OR: pending has no time limit (an item the
  // owner never got round to must not vanish), failed has a 7 day window.
  //
  // The three statuses NOT asked for are as deliberate as the two that are.
  // 'processing' is a mail mid-flight - showing it would put a card with no
  // amount and no supplier in front of the owner, and it may still turn into
  // a failure. 'approved' is already an expense and 'rejected' is already
  // gone; both live in the expenses table or nowhere, not in this queue.
  const [pendingRes, failedRes] = await Promise.all([
    admin
      .from("email_inbox_items")
      .select(INBOX_ITEM_COLUMNS)
      .eq("business_id", business.id)
      .eq("status", "pending")
      .order("received_at", { ascending: false })
      .limit(100),
    admin
      .from("email_inbox_items")
      .select(INBOX_ITEM_COLUMNS)
      .eq("business_id", business.id)
      .eq("status", "failed")
      .gte("created_at", since)
      .order("received_at", { ascending: false })
      .limit(50),
  ]);

  if (pendingRes.error || failedRes.error) {
    console.error(
      "[email-inbox] list failed:",
      pendingRes.error?.message || failedRes.error?.message,
    );
    return NextResponse.json({ ok: false, error: "שגיאה בטעינת התיבה." }, { status: 500 });
  }

  const pending = (pendingRes.data || []).map((r) => toInboxItemDto(r as Record<string, unknown>));
  const failed = (failedRes.data || []).map((r) => toInboxItemDto(r as Record<string, unknown>));
  const items = [...pending, ...failed].sort((a, b) =>
    String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")),
  );

  return NextResponse.json({
    ok: true,
    enabled: business.inboxEnabled,
    // Non-null whenever an address was ever generated, even while disabled,
    // so the settings screen can show what it will be when switched back on.
    address: business.inboxToken ? inboxAddressFor(business.inboxToken) : null,
    items,
    pending,
    pendingCount: pending.length,
  });
}

export async function POST(req: NextRequest) {
  const caller = await resolveInboxCaller(req);
  if (!caller.ok) return caller.response;
  const { admin, business, userId } = caller;

  const rl = checkRate({ key: `email-inbox:settings:${userId}`, max: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "יותר מדי בקשות. נסה שוב בעוד דקה." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action || "");
  if (action !== "enable" && action !== "disable" && action !== "rotate") {
    return NextResponse.json({ ok: false, error: "פעולה לא מוכרת." }, { status: 400 });
  }

  if (action === "disable") {
    // The token is kept: turning the channel back on should restore the same
    // address, so a forwarding rule the owner set up once keeps working. Mail
    // arriving while disabled is dropped (the webhook requires inbox_enabled).
    const { error } = await admin
      .from("businesses")
      .update({ inbox_enabled: false })
      .eq("id", business.id);
    if (error) {
      console.error("[email-inbox] disable failed:", error.message);
      return NextResponse.json({ ok: false, error: "השמירה נכשלה." }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      enabled: false,
      address: business.inboxToken ? inboxAddressFor(business.inboxToken) : null,
    });
  }

  // enable: reuse the existing address if there is one. rotate: always mint a
  // new one (and switch the channel on - asking for a new address means the
  // owner intends to use it), which is also how a leaked address is revoked.
  const keepExisting = action === "enable" && !!business.inboxToken;
  let token = business.inboxToken;

  if (!keepExisting) {
    // The unique index is the arbiter, not a pre-read: two tabs pressing at
    // once must not both "check then write" the same token. ~49 bits makes a
    // real collision astronomically unlikely, so a retry here is paranoia
    // that costs nothing.
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      const candidate = generateInboxToken();
      const { error } = await admin
        .from("businesses")
        .update({ inbox_token: candidate, inbox_enabled: true })
        .eq("id", business.id);
      if (!error) {
        token = candidate;
        saved = true;
        break;
      }
      // 23505 = unique_violation. Never echo the token itself into a log.
      if (error.code !== "23505") {
        console.error("[email-inbox] token write failed:", error.message);
        return NextResponse.json({ ok: false, error: "השמירה נכשלה." }, { status: 500 });
      }
    }
    if (!saved) {
      return NextResponse.json({ ok: false, error: "השמירה נכשלה. נסה שוב." }, { status: 500 });
    }
  } else {
    const { error } = await admin
      .from("businesses")
      .update({ inbox_enabled: true })
      .eq("id", business.id);
    if (error) {
      console.error("[email-inbox] enable failed:", error.message);
      return NextResponse.json({ ok: false, error: "השמירה נכשלה." }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    address: token ? inboxAddressFor(token) : null,
  });
}
