// The app side of the WhatsApp binding.
//
// GET  -> current link status for the settings card
// POST -> mint a fresh one-time link code
// DELETE -> unlink this account's phone
//
// Auth is the Bearer Supabase JWT + auth.getUser(), the same shape as
// /api/expenses/scan and /api/send-email. Everything below is scoped to the
// caller's own business; a user can never see or touch another user's binding.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { checkRate, clientIp } from "@/lib/rate-limit";
import { todayInIsrael } from "@/lib/date";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Ambiguous glyphs removed (0/O, 1/I/L) because this code gets read off one
// screen and typed into another; a code that can't be misread is worth more
// than four extra bits of entropy here, and the 10-minute single-use TTL plus
// the per-user mint limit are what actually bound guessing.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * 8 characters, not 6.
 *
 * This code is a bearer credential for a whole account: whoever redeems it
 * binds their WhatsApp number to it and can then issue immutable tax documents
 * as that user. At 6 chars the space is 31^6 ≈ 2^29.7, and the throttles that
 * would bound guessing are per-process in-memory buckets (src/lib/rate-limit.ts)
 * that reset on every serverless cold start — so the entropy has to carry the
 * weight on its own. 31^8 ≈ 2^39.6 is ~950x harder for two more characters the
 * user copies with a button anyway.
 */
function mintCode(): string {
  const pick = (n: number) =>
    Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${pick(4)}-${pick(4)}`;
}

function admin() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function authenticate(req: NextRequest) {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await authClient.auth.getUser(header.slice(7));
  if (error || !data.user) return null;
  return data.user;
}

export async function GET(req: NextRequest) {
  const user = await authenticate(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = admin();

  // A failed lookup must NOT degrade to connected:false. That reads to the user
  // as "not linked", sends them to mint a code, and the redemption then fails on
  // the unique user_id index — a confusing dead end caused by a transient error.
  // Surface the failure instead.
  const { data: identity, error: identityErr } = await db
    .from("whatsapp_identities")
    .select("phone, created_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (identityErr) {
    console.error("[whatsapp] link status lookup failed:", identityErr.message);
    return NextResponse.json(
      { ok: false, error: "לא הצלחנו לטעון את מצב החיבור. נסה שוב." },
      { status: 500 },
    );
  }

  // The usage counter is display-only, so a failure here degrades to 0 rather
  // than blocking the whole card.
  const { data: usage, error: usageErr } = await db
    .from("whatsapp_usage")
    .select("count")
    .eq("user_id", user.id)
    .eq("month", todayInIsrael().slice(0, 7))
    .maybeSingle();
  if (usageErr) {
    console.error("[whatsapp] usage lookup failed:", usageErr.message);
  }

  return NextResponse.json({
    ok: true,
    connected: Boolean(identity),
    phone: identity?.phone ?? null,
    connectedAt: identity?.created_at ?? null,
    usedThisMonth: usage?.count ?? 0,
    botNumber: process.env.NEXT_PUBLIC_WHATSAPP_BOT_NUMBER || null,
  });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ipLimit = checkRate({ key: `wa-link:ip:${ip}`, max: 10, windowMs: 60_000 });
  if (!ipLimit.ok) {
    return NextResponse.json({ ok: false, error: "יותר מדי בקשות." }, { status: 429 });
  }

  const user = await authenticate(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // A code is a bearer credential for the whole account, so minting is capped
  // per user as well as per IP: unlimited minting would let a stolen session
  // spray codes faster than the 10-minute TTL retires them.
  const userLimit = checkRate({ key: `wa-link:user:${user.id}`, max: 5, windowMs: 10 * 60_000 });
  if (!userLimit.ok) {
    return NextResponse.json(
      { ok: false, error: "נוצרו יותר מדי קודים. נסה שוב בעוד כמה דקות." },
      { status: 429 },
    );
  }

  const db = admin();

  const { data: business, error: bizErr } = await db
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (bizErr || !business) {
    return NextResponse.json({ ok: false, error: "לא נמצא עסק מקושר." }, { status: 400 });
  }

  // Fail CLOSED on a lookup error: treating "query failed" as "not linked"
  // would mint a live code for an already-bound account, and that code can only
  // ever fail at redemption.
  const { data: existing, error: existingErr } = await db
    .from("whatsapp_identities")
    .select("phone")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingErr) {
    console.error("[whatsapp] existing-identity check failed:", existingErr.message);
    return NextResponse.json(
      { ok: false, error: "לא הצלחנו לבדוק את מצב החיבור. נסה שוב." },
      { status: 500 },
    );
  }
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "כבר מחובר. נתק את החיבור הקיים לפני יצירת קוד חדש." },
      { status: 409 },
    );
  }

  // INSERT FIRST, then retire everything else.
  //
  // The obvious order (retire, then insert) is racy: two concurrent mints can
  // both run their retirement before either inserts, and both new codes survive
  // — the opposite of the single-outstanding-code property this is here to
  // provide. Inserting first and then retiring "every code for this user except
  // this one" is self-correcting instead: whichever request retires last leaves
  // exactly its own code live, and the loser's code is killed rather than
  // orphaned.
  const code = mintCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { error } = await db.from("whatsapp_link_codes").insert({
    code,
    user_id: user.id,
    business_id: business.id,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[whatsapp] link code insert failed:", error.message);
    return NextResponse.json({ ok: false, error: "יצירת הקוד נכשלה." }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const { error: retireErr } = await db
    .from("whatsapp_link_codes")
    .update({ used_at: nowIso, used_by: "superseded" })
    .eq("user_id", user.id)
    .is("used_at", null)
    .neq("code", code);
  if (retireErr) {
    // Non-fatal: the code we just minted is valid and usable. An older code may
    // also still be live until its 10-minute TTL expires, which is a smaller
    // problem than refusing to hand the user a working code.
    console.error("[whatsapp] code retirement failed:", retireErr.message);
  }

  return NextResponse.json({
    ok: true,
    code,
    expiresAt,
    botNumber: process.env.NEXT_PUBLIC_WHATSAPP_BOT_NUMBER || null,
  });
}

export async function DELETE(req: NextRequest) {
  const user = await authenticate(req);
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const db = admin();
  const { error } = await db.from("whatsapp_identities").delete().eq("user_id", user.id);
  if (error) {
    console.error("[whatsapp] unlink failed:", error.message);
    return NextResponse.json({ ok: false, error: "הניתוק נכשל." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
