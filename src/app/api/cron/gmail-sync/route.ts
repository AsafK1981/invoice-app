import { NextResponse } from "next/server";
import { cronAuthError, cronAdminClient } from "@/lib/cron";
import {
  EMAIL_ACCOUNT_COLUMNS,
  daysAgoIso,
  importGmailBatch,
  type EmailAccountRow,
} from "@/lib/gmail-connect";

/**
 * Daily (Vercel's Hobby plan allows cron jobs no more often than once a
 * day; see vercel.json): pull new invoice mail for every connected Gmail
 * account.
 *
 * This is what makes the Gmail filter unnecessary. Each account gets one
 * bounded batch of mail newer than its watermark (two days back on the very
 * first run, so nothing that arrived between connecting and the first tick
 * is missed); the watermark moves only after a clean pass. A refused token
 * is written to last_error so the card can ask the owner to reconnect, and
 * that account is skipped until they do.
 *
 * Whatever this cron queues lands as pending cards on /expenses. It never
 * approves anything.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const TOTAL_BUDGET_MS = 240_000;
const PER_ACCOUNT_BUDGET_MS = 40_000;
const MESSAGES_PER_ACCOUNT = 20;
const QUOTA_BACKOFF_MS = 7 * 24 * 60 * 60_000;

export async function GET(req: Request) {
  const unauthorized = cronAuthError(req);
  if (unauthorized) return unauthorized;

  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientSecret) {
    return NextResponse.json({ ok: false, error: "GOOGLE_OAUTH_CLIENT_SECRET unset" }, { status: 503 });
  }

  const admin = cronAdminClient();
  const startedAt = Date.now();

  const { data: rows, error } = await admin
    .from("email_accounts")
    .select(`${EMAIL_ACCOUNT_COLUMNS}, updated_at, businesses!inner(user_id)`)
    .eq("provider", "gmail")
    .or("last_error.is.null,last_error.neq.reconnect")
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(200);
  if (error) {
    console.error("[gmail-sync] account list failed:", error.message);
    return NextResponse.json({ ok: false, error: "list failed" }, { status: 500 });
  }

  const summary = { accounts: 0, messages: 0, queued: 0, failed: 0, reconnect: 0, throttled: 0, outOfTime: 0 };

  for (const raw of rows ?? []) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
      summary.outOfTime += 1;
      break;
    }
    const account = raw as unknown as EmailAccountRow & {
      updated_at?: string;
      businesses: { user_id: string } | { user_id: string }[];
    };
    const owner = Array.isArray(account.businesses) ? account.businesses[0] : account.businesses;
    if (!owner?.user_id) continue;
    // A month's scans spent: nothing will succeed until the cap resets, so
    // leave that account alone for a week instead of failing it every day.
    if (account.last_error === "quota" && account.updated_at && Date.now() - new Date(account.updated_at).getTime() < QUOTA_BACKOFF_MS) {
      continue;
    }
    summary.accounts += 1;

    const after = account.last_sync_at ? account.last_sync_at.slice(0, 10) : daysAgoIso(2);
    const result = await importGmailBatch(
      admin,
      account,
      { id: account.business_id, user_id: owner.user_id },
      { mode: "incremental", after, pageToken: null },
      { clientSecret, budgetMs: PER_ACCOUNT_BUDGET_MS, maxMessages: MESSAGES_PER_ACCOUNT },
    );
    summary.messages += result.messages;
    summary.queued += result.queued;
    summary.failed += result.failed;

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (result.authError) {
      patch.last_error = "reconnect";
      summary.reconnect += 1;
    } else if (result.quotaHit) {
      patch.last_error = "quota";
    } else if (result.throttled) {
      summary.throttled += 1;
    } else if (result.done && !result.quotaHit) {
      patch.last_error = null;
      patch.last_sync_at = new Date().toISOString();
    }
    await admin.from("email_accounts").update(patch).eq("id", account.id);
  }

  return NextResponse.json({ ok: true, ...summary });
}
