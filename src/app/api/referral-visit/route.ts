import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isFriendReferral, normalizeReferralSlug } from "@/lib/attribution";
import { checkRate, clientIp } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Global ceiling on visit rows per rolling hour, counted in the database. */
const MAX_VISITS_PER_HOUR = 300;

/**
 * Counts a visit to an accountant's personal link (/from-accountant?ref=).
 *
 * Public on purpose: the visitor is a stranger who has not signed up. So the
 * boundary is strict: the slug must match the same shape the DB CHECK
 * enforces, the write is one row of (slug, now) and nothing about the
 * visitor, a single IP gets a small budget, and the table as a whole accepts
 * at most MAX_VISITS_PER_HOUR rows an hour. The in-memory limiter is per
 * function instance, so the database count is the real flood ceiling (council
 * review, 2026-09-30). The browser reports each slug once (see
 * takeReferralVisitToReport), so the figure reads as "people who opened the
 * link", not page views.
 *
 * Always answers 204: for a bad slug, when capped, and when the write fails.
 * A counter must never be able to break the landing page, and the caller has
 * nothing to do with the answer.
 */
export async function POST(req: NextRequest) {
  const done = () => new NextResponse(null, { status: 204 });
  try {
    const rl = checkRate({ key: `ref-visit:ip:${clientIp(req)}`, max: 10, windowMs: 60_000 });
    if (!rl.ok) return done();

    const body = await req.json().catch(() => ({}));
    const ref = normalizeReferralSlug(typeof body?.ref === "string" ? body.ref : null);
    // Friend invite codes are never counted here; the browser does not send
    // them, and a hand-made request must not either.
    if (!ref || isFriendReferral(ref) || !serviceKey) return done();

    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count, error } = await sb
      .from("referral_visits")
      .select("id", { count: "exact", head: true })
      .gte("visited_at", hourAgo);
    // Unknown load is treated as "over the cap": skip the row, keep the page.
    if (error || count === null || count >= MAX_VISITS_PER_HOUR) return done();

    await sb.from("referral_visits").insert({ ref });
    return done();
  } catch {
    return done();
  }
}
