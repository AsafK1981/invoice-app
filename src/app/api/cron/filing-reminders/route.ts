import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cronAuthError, cronAdminClient } from "@/lib/cron";
import { remindBusiness } from "@/lib/filing-reminders-server";
import { todayInIsrael } from "@/lib/date";
import type { Business } from "@/lib/types";

export const maxDuration = 300;

const PAGE_SIZE = 500;

/**
 * Daily filing-deadline reminders (vercel.json, 06:00 UTC = 08:00-09:00 in
 * Israel).
 *
 * Who: only businesses that have a filing_preferences row, i.e. owners who
 * opened /obligations (the page creates the row on the first visit and shows
 * the reminder setting there). Nobody who never saw the calendar starts
 * getting deadline notifications on the day this ships.
 *
 * What: one in-app notification per deadline inside the owner's "days before"
 * window that is neither filed nor reminded before, with the amount due when
 * it can be computed (VAT net, income-tax advance, the owner's Bituach Leumi
 * advance). Push follows the owner's push_kinds like every other notification.
 *
 * Exactly once: the deadline keys are CLAIMED in filing_preferences.reminded
 * before anything is sent. A failed claim sends nothing; a failed send
 * releases its key so tomorrow's run can try again. A crash between the claim
 * and the send loses that one reminder rather than repeating it.
 *
 * Privacy: amounts are computed from the owner's own data and written only
 * into the owner's notification; logs and this route's JSON carry ids and
 * counts only, never an amount or a client.
 *
 * The per-business flow lives in src/lib/filing-reminders-server.ts.
 */
export async function GET(req: Request) {
  const unauth = cronAuthError(req);
  if (unauth) return unauth;

  const admin = cronAdminClient();
  const today = todayInIsrael();

  const loaded = await loadPreferenceRows(admin);
  if (loaded.error) return NextResponse.json({ ok: false, error: loaded.error }, { status: 500 });

  let businesses = 0;
  let sent = 0;
  let withAmount = 0;
  let failedClaims = 0;
  let failedSends = 0;
  let failedBusinesses = 0;

  for (let i = 0; i < loaded.rows.length; i += 100) {
    const chunk = loaded.rows.slice(i, i + 100);
    const { data: bizRows, error: bizError } = await admin
      .from("businesses")
      .select("id,tax_id,business_type,income_tax_advance_rate")
      .in("id", chunk.map((r) => r.business_id as string));
    if (bizError) return NextResponse.json({ ok: false, error: bizError.message }, { status: 500 });
    const byId = new Map((bizRows ?? []).map((b) => [b.id as string, b as Record<string, unknown>]));

    for (const row of chunk) {
      const businessId = row.business_id as string;
      const biz = byId.get(businessId);
      const businessType = biz?.business_type as Business["businessType"] | undefined;
      if (!biz || !businessType) continue;
      businesses++;

      const rate = biz.income_tax_advance_rate == null ? undefined : Number(biz.income_tax_advance_rate);
      let outcome: Awaited<ReturnType<typeof remindBusiness>>;
      try {
        outcome = await remindBusiness({
          admin,
          row,
          business: {
            id: businessId,
            taxId: typeof biz.tax_id === "string" ? biz.tax_id : "",
            businessType,
            incomeTaxAdvanceRate: rate !== undefined && Number.isFinite(rate) ? rate : undefined,
          },
          today,
        });
      } catch {
        // One business failing must never stop the others.
        console.error("[filing-reminders] business failed", { businessId });
        failedBusinesses++;
        continue;
      }
      sent += outcome.sent;
      withAmount += outcome.withAmount;
      failedSends += outcome.failedSends;
      if (outcome.failedClaim) failedClaims++;
    }
  }

  return NextResponse.json({
    ok: failedClaims === 0 && failedSends === 0 && failedBusinesses === 0,
    today,
    businesses,
    sent,
    withAmount,
    failedClaims,
    failedSends,
    failedBusinesses,
  });
}

/** Every filing_preferences row with reminders on, paged so the PostgREST row cap never silently drops businesses. */
async function loadPreferenceRows(admin: SupabaseClient): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("filing_preferences")
      .select("*")
      .eq("reminders_enabled", true)
      .order("business_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { rows: [], error: error.message };
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { rows, error: null };
}
