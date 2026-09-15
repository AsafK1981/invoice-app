import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cronAuthError, cronAdminClient } from "@/lib/cron";
import { createNotificationForBusiness } from "@/lib/notifications-server";
import { mapFilingRow, stringMap } from "@/lib/filing-settings";
import { planFilingReminders } from "@/lib/filing-reminders";
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
 * window that is neither filed nor reminded before. Push follows the owner's
 * push_kinds like every other notification.
 *
 * Exactly once: the deadline keys are CLAIMED in filing_preferences.reminded
 * before anything is sent. A failed claim sends nothing; a failed send
 * releases its key so tomorrow's run can try again. A crash between the claim
 * and the send loses that one reminder rather than repeating it.
 *
 * Metadata only: the text names the obligation and the date, never an amount
 * or a client.
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
  let failedClaims = 0;
  let failedSends = 0;

  for (let i = 0; i < loaded.rows.length; i += 100) {
    const chunk = loaded.rows.slice(i, i + 100);
    const { data: bizRows, error: bizError } = await admin
      .from("businesses")
      .select("id,business_type")
      .in("id", chunk.map((r) => r.business_id as string));
    if (bizError) return NextResponse.json({ ok: false, error: bizError.message }, { status: 500 });
    const typeById = new Map((bizRows ?? []).map((b) => [b.id as string, b.business_type as Business["businessType"]]));

    for (const row of chunk) {
      const businessId = row.business_id as string;
      const businessType = typeById.get(businessId);
      if (!businessType) continue;
      businesses++;

      // Claim first. The update is conditional on the row's updated_at (the
      // guard trigger bumps it on every write), so two overlapping runs, or an
      // owner saving at the same moment, cannot both win with a stale map.
      // A lost race re-reads the row once and plans again from fresh data.
      let current: Record<string, unknown> | null = row;
      let plan: ReturnType<typeof planFilingReminders> = [];
      let claimed: Record<string, string> | null = null;
      for (let attempt = 0; attempt < 2 && current; attempt++) {
        const { settings, filed } = mapFilingRow(current);
        const reminded = stringMap(current.reminded);
        plan = planFilingReminders({ businessType, settings, filed, reminded, today });
        if (plan.length === 0) break;
        const next = { ...reminded };
        const claimedAt = new Date().toISOString();
        for (const item of plan) next[item.occurrence.key] = claimedAt;
        const claim = await admin
          .from("filing_preferences")
          .update({ reminded: next })
          .eq("business_id", businessId)
          .eq("updated_at", current.updated_at as string)
          .select("business_id");
        if (claim.error) {
          console.error("[filing-reminders] claim failed", { businessId, error: claim.error.message });
          break;
        }
        if (claim.data && claim.data.length > 0) {
          claimed = next;
          break;
        }
        const fresh = await admin.from("filing_preferences").select("*").eq("business_id", businessId).maybeSingle();
        current = (fresh.data as Record<string, unknown> | null) ?? null;
      }
      if (plan.length === 0) continue;
      if (!claimed) {
        failedClaims++;
        continue;
      }

      const released: string[] = [];
      for (const item of plan) {
        const ok = await createNotificationForBusiness({ businessId, kind: "filing_deadline", title: item.title, body: item.body, href: "/obligations" });
        if (ok) sent++;
        else {
          failedSends++;
          released.push(item.occurrence.key);
        }
      }
      if (released.length > 0) {
        const retry = { ...claimed };
        for (const key of released) delete retry[key];
        const release = await admin.from("filing_preferences").update({ reminded: retry }).eq("business_id", businessId);
        if (release.error) console.error("[filing-reminders] could not release failed reminders", { businessId, keys: released, error: release.error.message });
      }
    }
  }

  return NextResponse.json({ ok: failedClaims === 0 && failedSends === 0, today, businesses, sent, failedClaims, failedSends });
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
