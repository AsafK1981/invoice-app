// Shared server-side plumbing for the two authenticated /api/email-inbox
// routes: who is calling, which business is theirs, and one shape for an
// inbox item on the wire.
//
// `email_inbox_items` has RLS enabled with ZERO policies (service role only),
// so these routes read it with the service key. That means EVERY query here
// must carry `.eq("business_id", business.id)` for the business resolved from
// the caller's own session - the database is not going to do it for us.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface InboxCallerBusiness {
  id: string;
  userId: string;
  inboxToken: string | null;
  inboxEnabled: boolean;
}

export type InboxCaller =
  | { ok: true; admin: SupabaseClient; userId: string; business: InboxCallerBusiness }
  | { ok: false; response: NextResponse };

/**
 * Bearer-token auth + business lookup, exactly like /api/expenses/scan and
 * /api/tax-authority/status: validate the session with the anon client's
 * auth.getUser(), then use the service role only after that check passed.
 */
export async function resolveInboxCaller(req: Request): Promise<InboxCaller> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  const token = authHeader.slice(7);

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Same "first business by created_at" rule the rest of the app uses.
  const { data: rows, error } = await admin
    .from("businesses")
    .select("id, user_id, inbox_token, inbox_enabled")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) {
    console.error("[email-inbox] business lookup failed:", error.message);
    return { ok: false, response: NextResponse.json({ ok: false, error: "שגיאה בטעינת העסק." }, { status: 500 }) };
  }
  const row = rows?.[0];
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "לא נמצא עסק למשתמש הזה." }, { status: 404 }),
    };
  }

  return {
    ok: true,
    admin,
    userId: user.id,
    business: {
      id: row.id as string,
      userId: row.user_id as string,
      inboxToken: (row.inbox_token as string) || null,
      inboxEnabled: Boolean(row.inbox_enabled),
    },
  };
}

/** Columns the app needs for an inbox item. Never selects anything else. */
export const INBOX_ITEM_COLUMNS =
  "id, from_address, subject, received_at, attachment_name, attachment_type, receipt_path, scan, status, reason, detail, expense_id, created_at, resolved_at";

export interface InboxItemDto {
  id: string;
  from: string | null;
  subject: string | null;
  receivedAt: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  /** Path in the private `expense-receipts` bucket; sign it client-side. */
  receiptPath: string | null;
  /** ScanFields, or null while the item is still being processed. */
  scan: unknown;
  status: "pending" | "approved" | "rejected" | "failed";
  reason: string | null;
  /** Companion to `reason`. Today: the Gmail forwarding confirmation URL. */
  detail: string | null;
  expenseId: string | null;
  createdAt: string | null;
}

export function toInboxItemDto(row: Record<string, unknown>): InboxItemDto {
  return {
    id: row.id as string,
    from: (row.from_address as string) ?? null,
    subject: (row.subject as string) ?? null,
    receivedAt: (row.received_at as string) ?? null,
    attachmentName: (row.attachment_name as string) ?? null,
    attachmentType: (row.attachment_type as string) ?? null,
    receiptPath: (row.receipt_path as string) ?? null,
    scan: row.scan ?? null,
    status: row.status as InboxItemDto["status"],
    reason: (row.reason as string) ?? null,
    detail: (row.detail as string) ?? null,
    expenseId: (row.expense_id as string) ?? null,
    createdAt: (row.created_at as string) ?? null,
  };
}
