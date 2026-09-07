// One batch of the Gmail import, run by the owner from the card.
//
// POST body { mode: 'backfill' | 'incremental', after?: 'YYYY-MM-DD', before?: 'YYYY-MM-DD', pageToken?: string }
//   -> { ok, done, nextPageToken, messages, queued, failed, skipped, quotaHit, authError, throttled }
//
// Bounded on purpose: a few messages per call, well inside the route's time
// limit. The browser loops while `done` is false and shows the running
// totals, which is both the progress bar and the reason a long mailbox does
// not need a background job.

import { NextRequest, NextResponse } from "next/server";
import { checkRate } from "@/lib/rate-limit";
import { resolveInboxCaller } from "@/lib/email-inbox-server";
import { getGmailAccount, importGmailBatch, type GmailSyncRequest } from "@/lib/gmail-connect";

export const runtime = "nodejs";
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BUDGET_MS = 40_000;
const MESSAGES_PER_BATCH = 8;

export async function POST(req: NextRequest) {
  const caller = await resolveInboxCaller(req);
  if (!caller.ok) return caller.response;
  const { admin, business, userId } = caller;

  const rl = checkRate({ key: `gmail-sync:${userId}`, max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "יותר מדי בקשות. נסה שוב בעוד דקה." }, { status: 429 });
  }

  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientSecret) {
    return NextResponse.json({ ok: false, error: "החיבור ל-Gmail עוד לא הופעל בשרת." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const mode = body.mode === "incremental" ? "incremental" : body.mode === "backfill" ? "backfill" : null;
  if (!mode) return NextResponse.json({ ok: false, error: "פעולה לא מוכרת." }, { status: 400 });
  const after = typeof body.after === "string" && DATE_RE.test(body.after) ? body.after : null;
  const before = typeof body.before === "string" && DATE_RE.test(body.before) ? body.before : null;
  const pageToken = typeof body.pageToken === "string" && body.pageToken.length < 500 ? body.pageToken : null;

  const account = await getGmailAccount(admin, business.id);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Gmail לא מחובר לעסק הזה." }, { status: 404 });
  }

  const request: GmailSyncRequest = {
    mode,
    after: mode === "backfill" ? after : after ?? (account.last_sync_at ? account.last_sync_at.slice(0, 10) : null),
    before,
    pageToken,
  };

  const result = await importGmailBatch(
    admin,
    account,
    { id: business.id, user_id: business.userId },
    request,
    { clientSecret, budgetMs: BUDGET_MS, maxMessages: MESSAGES_PER_BATCH },
  );

  // Bookkeeping on the account row: the watermark moves only when a run
  // finished cleanly, and a refused token is remembered so the card can say
  // "reconnect" instead of failing quietly every hour.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (result.authError) patch.last_error = "reconnect";
  else if (result.quotaHit) patch.last_error = "quota";
  else if (result.done) {
    patch.last_error = null;
    if (mode === "backfill") patch.last_backfill_at = new Date().toISOString();
    patch.last_sync_at = new Date().toISOString();
  }
  await admin.from("email_accounts").update(patch).eq("id", account.id).eq("business_id", business.id);

  return NextResponse.json({ ok: true, ...result });
}
